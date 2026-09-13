# dsh-git

给 DeepSeek Harness Web GUI 的只读 Git 工具，以**右侧栏标签页**的形式工作：按 `+` 打开 guide，选 **Git log** 得到提交历史与工作区改动；点任一条 log entry，就在旁边**新开一个 code diff 标签页**。交互上接近 neogit + codediff 的组合。

每个 diff 是双栏（旧 | 新）行对齐视图。因为资源标签页的身份就是它的地址，两个 diff 可以同时开着并排看，而不是互相顶掉。

Host 半边全程走 `ctx.fs` 与 `ctx.subprocess`，不直接碰 `node:fs` 或 `child_process`。这是它能看 remote 机器 diff 的原因：当部署用 `dsh-remote-ssh-worktree` 这类插件把 `ctx.fs` / `ctx.subprocess` 路由到远端时，本插件不需要任何改动——它问的执行世界自己知道那个仓库在哪台机器上。

**本插件只读。** 不 stage、不 commit、不 discard、不改工作区。每个 git 子进程都带 `GIT_OPTIONAL_LOCKS=0`，所以连 `git status` 都不会顺手重写 index。

## 安装

需要 DSH CLI 与一个 Web profile（默认名为 `web`）。

```sh
# 1. 构建（产出 lib/index.js 与 lib/client.js）
cd /Users/lzy/Projects/dsh-git
npm install
npm run build

# 2. 装进 profile —— 这会在 profile 目录里执行 pnpm，
#    并把声明了 dsh.bundle.patch 的依赖自动加进 dsh.profile.bundles
dsh plugin --profile web add /Users/lzy/Projects/dsh-git

# 3. 重启 Web 服务，刷新页面
#    （若用 ~/.dsh/reload-8080.sh 则直接运行它）
pnpm dsh web --port 8080
```

> 已装过一次后，**只改 host 半边代码**需要重启服务；**只改客户端代码**只需 `npm run build`，服务端会轮询到新的 `lib/client.js` 并通过 SSE 让页面热重载。

### 不安装的试用方式

profile 支持 `--patch` 覆盖层，里面插入的插件 `name` 可以是相对于该 patch 文件的路径：

```sh
pnpm dsh web --port 8080 --patch ./overlay.yml
```

```yaml
- insert:
    - id: dsh-git
      name: /Users/lzy/Projects/dsh-git
```

这种方式不去动 profile 的依赖与 bundles。

## 怎么用

1. **右侧栏按 `+`** → 打开 guide（若该 pane 已有 guide 则聚焦它）。
2. 点 **Git log** 胶囊 → guide 原位换成日志页，里面是**改动**（按 冲突/已暂存/未暂存/未跟踪 分组）与**历史**。
3. 点任一条改动，或任一条提交 → 在**同一个 pane 里新开一个标签页**显示对应的 diff。再点一条就再开一个，互不覆盖。
4. 标签页可拖动、可分裂到第二个 pane、可浮动——这些都由外壳提供，插件不参与。

## 面板行为

- **diff 语义**：未暂存 = index ↔ 工作区；已暂存 = HEAD ↔ index；提交内文件 = 该提交 ↔ 第一个父提交。
- **点击提交**打开的是**整个提交**的 diff：提交信息 + 逐个文件的双栏 diff，在一个滚动区里。
- 重命名按旧路径 ↔ 新路径对照；新增/删除的一侧为空；二进制文件只给提示不画行。
- 连续未改动行超过 6 行会折叠成一条可展开的 `⋯ N 行未改动`——点击标签页里则会展开/收起（后端返回的省略行见下）。
- 日志页刷新时机：标签页挂载、切换会话、点刷新按钮。

### 对齐用的是 VS Code 的 diff 引擎

行对齐不是自己写的 LCS，而是 [`vscode-diff`](https://www.npmjs.com/package/vscode-diff)——VS Code 编辑器自带的那套 diff computer 的独立打包（MIT，19 KB gzip，作为普通依赖由 host bundle 外部引用）。选它的理由：同样的 Myers + 动态规划核心、同样的行裁剪，diff 读起来就是编辑器里那个味道；而且它比手写对齐多给了字符级 `innerChanges`，将来做行内高亮不用再换引擎。

两个边界由本插件守住：

- **未改动的行绝不会被标成改动**。这是适配层唯一的不变量——位置式回退（已删除）之所以危险，就是会把一行改动涂成整屏红绿。
- computer 报 `hitTimeout` 时（超出 `maxDiffMs` 预算），标签页会显示「对齐超出时间预算，配对为近似结果」，而不是假装精确。

已知坑：`vscode-diff` 的 `toRangeMapping2` 对「某一侧整块为空」的输入会抛内部断言错误（整文件新增/删除经前缀后缀裁剪后正是这个形状）。适配层对空侧直接走平凡对齐、不调 computer，并对 computer 调用保留一个保持上述不变量的最后兜底。

### 大文件：只给改动，并明说省略

一个几千行的文件，改动通常散落在各处。若按「前 N 行」截断，读者只会看到一屏未改动内容、真正的改动在截断线以下。所以超过行数上限时，返回的是**改动区 ± 4 行上下文**，两处改动之间与首尾的省略都以 `⋯ N 行未显示` 显式标出（两侧行数不同时显示 `N / M`）。

这些省略行**不会**让 `+added / −removed` 失真：计数来自完整对齐，与返回了多少行无关。

## HTTP 接口

host 半边在 `ctx.get('webServer')` 上注册 `/dsh-git` 前缀路由；没有 Web server 的 profile（headless、SDK）里插件照常加载，只是没有标签页。

| 端点 | 返回 |
| --- | --- |
| `GET /dsh-git/status?sessionId=` | 仓库、分支、ahead/behind、全部改动条目 |
| `GET /dsh-git/history?sessionId=&limit=&skip=` | 一页提交（含 refs、作者、时间） |
| `GET /dsh-git/commit?sessionId=&rev=` | 一个提交及其改动文件 |
| `GET /dsh-git/diff?sessionId=&path=&origPath=&source=&rev=` | 单条改动的对齐双栏行 |
| `GET /dsh-git/commit-diff?sessionId=&rev=` | 整个提交：逐个文件的已对齐 diff |

`source` 取 `worktree` / `index` / `commit`。失败体是 `{ code, message }`，code 取 `session/unknown`、`git/unavailable`、`git/not-a-repository`、`git/unknown-revision`、`git/path-outside-repo`、`git/bad-request`、`git/command-failed`。

### 工作区是怎么定的

由 host 依据 `sessionId` 解析：先看**活动会话**的 header，不是活动会话就读**持久化**的 header。两条路都指向同一个 `cwd`——结论不应取决于那个会话此刻是否正在运行，否则刷新页面后面板会指向别处。

两者都拿不到时**报 `session/unknown`**，而不是回退到部署的 workspace root：后者只适用于「header 里没有 cwd」的情况，用它顶替一个没人认识的会话身份，只会静默显示另一个仓库，而错误的仓库比拒绝更糟。

浏览器不提供任何路径；它回传的仓库相对路径还会再过一遍围栏，拒绝绝对路径与 `..`。

## 配置

在 profile 的 patch 层给这一行加 config 即可，全部可选：

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `maxLines` | `4000` | 一次 diff 返回的行数上限，超出则按改动区裁剪并标注省略 |
| `maxBytes` | `2097152` | 一次 diff 每侧的字节上限 |
| `historyLimit` | `50` | 历史每页最多返回多少提交 |
| `maxEntries` | `2000` | status 最多返回多少条改动 |
| `maxCommitFiles` | `100` | 一个提交的聚合 diff 最多包含多少文件 |
| `maxDiffMs` | `2000` | diff computer 的时间预算；超出则配对为近似并明示 |

```yaml
- id: dsh-git
  config:
    historyLimit: 100
```

## 开发

```sh
npm run typecheck   # host 与 client 两套 tsconfig
npm test            # 先 build，再跑单测 + 端到端
npm run build
npm run watch       # 客户端 bundle 监听重建
```

测试分三层：

- **纯函数单测**：porcelain v2 解析、双栏对齐（含大文件、锚点、诚实回退、hunk 裁剪）、路径围栏、日志与 name-status 解析、资源地址往返、日志页派生状态、face 的请求与失败分类。
- **真实仓库端到端**：在临时目录里建真仓库、造出六类改动，用真实的 `LocalFileSystem` + `LocalSubprocessRuntime` 驱动整个 host 半边，断言 status / history / commit / diff / commit-diff 的实际输出，以及「未知会话身份被拒绝」「非活动会话按持久化 header 解析」。
- **构建产物**：真实 `lib/client.js` 在桩 loader 下求值，校验注册 id、导出面、两个标签页类型的声明与 body 注册、资源 provider、双语字典键一致、diff 能画出单条改动 / 整个提交 / 省略行、CSS 已内联、以及 `require` 的目标全部落在 shell 的模块表内。

## 已知限制

- 合并提交的文件列表取的是「相对第一个父提交」的差异（`-m --first-parent`）。
- 冲突文件的新侧是带冲突标记的工作区内容，旧侧优先用 stage 2（ours）；没有三方合并视图。
- 二进制文件只给提示；不做行内（intraline）高亮。
- 日志页不订阅文件系统变更推送，需要手动刷新。
- 只读：不提供 stage / commit / discard。

## 结构

```
src/
  index.ts            host 插件体（name / inject / Config / apply）
  shared/wire.ts      两端共用的 wire 类型（纯类型，无运行时）
  git/                执行与解析：run、repo、status、history、commit、revision、sidediff
  api/                handler（纯请求处理）与 serve（webServer 路由适配）
  client/
    index.ts          两个标签页类型的声明、body 注册、资源 provider
    git-address.ts    资源地址的构造与解析（标签页身份即地址）
    provider.ts       git 资源 provider：地址 → 内容
    LogBody.tsx       日志页：改动 + 历史，点击开新标签页
    DiffBody.tsx      diff 标签页：单条改动或整个提交
    ChangeList.tsx / HistoryList.tsx / SideBySide.tsx / Feedback.tsx
    state.ts / format.ts / face.ts / locales.ts / glyphs.tsx
cordis.patch.yml      bundle 补丁：只 insert 一行 dsh-git
tsdown.config.ts      host ESM + client CJS(window.__ModuleLoader__) + CSS Modules 内联
```
