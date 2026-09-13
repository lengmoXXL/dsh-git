# dsh-git

一个 DSH 插件：把仓库的历史放到 harness 面前——右侧栏里的 **Git log** 标签页列出工作区改动与最近提交，点一条改动、或点某个提交里的某个文件，就在旁边**新开一个只读、带语法高亮、双栏对齐的 diff 标签页**。

[English](README.md) | 中文

![Git log 标签页：上面是工作区改动，下面是提交历史](docs/screenshots/zh/01-log.png)

| 双栏 · 折行 | 双栏 · 不折行 | 单栏 |
| --- | --- | --- |
| ![一条改动的双栏对齐视图，长行折行](docs/screenshots/zh/02-diff-split.png) | ![同一条改动，每一栏各自横向滚动长行](docs/screenshots/zh/03-diff-unwrapped.png) | ![一条改动按单栏阅读](docs/screenshots/zh/04-diff-inline.png) |

## 它做什么

- 往右侧栏加一个页面类型：按 `+` 打开 guide，选 **Git log** 就地打开它。
- 照编辑器「源代码管理」列表的样子画工作区——冲突、已暂存、未暂存、未跟踪——下面接历史：一行一条提交，ref 画成胶囊。
- 提交可以在原位展开成它改动的文件列表；点其中一个文件，开的是**那个文件在这个提交里**的 diff。
- 每个 diff 都是**自己的标签页**，身份就是它的地址。两个 diff 可以并排开着而不是互相顶掉，从旧会话恢复出来的标签页也照样能解析。
- 对齐用的是 VS Code 自己的 diff 引擎，高亮用的是 harness 自己那套 shiki 设置；配对只是近似时会明说，不假装精确。
- **只读**。不 stage、不 commit、不 discard、不写工作区；每个 git 子进程都带 `GIT_OPTIONAL_LOCKS=0`，所以连 `git status` 都不会顺手重写 index。

## 安装

需要 Node 22.19+（或 24+）与 DSH CLI。

```sh
dsh plugin --profile web add https://github.com/lengmoXXL/dsh-git
dsh --profile web
```

安装时包会通过自己的 `prepare` 脚本自行构建。pnpm 默认会拦住来自 git 的插件的构建脚本，直到它被放进白名单：pnpm 会把要加的 key 打出来，把它加到 `~/.dsh/profiles/web/pnpm-workspace.yaml` 的 `allowBuilds` 下，再跑同一条命令即可。之后对同一个 URL 再 `add` 一次就是更新。

想直接改这个插件，就克隆下来加本地目录：`npm install && npm run build`，然后 `dsh plugin --profile web add "$PWD"`。只改客户端半边时只需 `npm run build`——服务端会轮询到新的 bundle 并通过 SSE 让页面热重载；改 host 半边需要重启服务。

## 怎么用

**右侧栏 `+` → Git log。** 标签页先列改动（按分组），再列历史。点一条改动 → 在同一个 pane 里新开一个标签页显示它的 diff。点一条提交 → 就在那一行下面展开它改动的文件列表；点其中一个文件 → 新开一个标签页显示那个文件在那个提交里的 diff，再点就再开一个，互不覆盖。标签页可拖动、可分裂到第二个 pane、可浮动——这些由外壳提供，插件不参与。

diff 自己的控件在它的 banner 上：**双栏 / 单栏**、**折行 / 不折行**，以及**复制**。这四个选择是读者的偏好，记在浏览器里，所有 diff 标签页共用。改动行只**染底**、不改字色，所以代码仍然好读；折叠与省略都会带着自己的行数说明写出来。

这个面板是查看器，不是编辑器：这里没有 stage 或 commit。

## 它是怎么做的

- **host 负责对齐，浏览器只负责画。** 不解析 patch、也不在浏览器里算 diff：host 读出文件两侧，用 [`vscode-diff`](https://www.npmjs.com/package/vscode-diff)——VS Code 编辑器自带的那套 diff computer——对齐，所以一行代表的意思就是编辑器会说的意思，同一个改动的两个视图也不可能互相矛盾。
- **host 半边全程走 `ctx.fs` 与 `ctx.subprocess`**，不碰 `node:fs` 或 `child_process`。部署只要用 `dsh-remote-ssh-worktree` 这类插件把这两个 seam 路由到别的机器，本插件不用任何改动就能看**那台机器**上的仓库 diff：它问执行世界，执行世界自己知道仓库在哪。
- **工作区由 Session 身份决定**，在 host 侧解析，而不是采信浏览器给的路径；浏览器确实回传的仓库相对路径，也会在送进 git 命令前先过一遍围栏。
- **浏览器半边与外壳只共用一个运行时模块**（primitives 包），其余 Harness 导入全是 `import type`。这正是它能让加载器当作一个 bundle 拿住的原因。
- **每个页面都带着「画它的是哪次构建」。** 把鼠标停在 diff 里 `abc^ → abc` 上、或日志页的仓库名上，就能看到这一页跑的那个 bundle 的构建时间：diff 的**内容**由 host 现读，而**布局**来自浏览器加载的那个 bundle。

## HTTP 接口

host 半边在 `ctx.get('webServer')` 上注册 `/dsh-git` 前缀。没有 web server 的 profile（headless、SDK）里插件照常加载，只是没有标签页。

| 端点 | 返回 |
| --- | --- |
| `GET /dsh-git/status?sessionId=` | 仓库、分支与 ahead/behind、全部改动 |
| `GET /dsh-git/history?sessionId=&limit=&skip=` | 一页提交（含 refs、作者、时间） |
| `GET /dsh-git/commit?sessionId=&rev=` | 一个提交及其改动的文件 |
| `GET /dsh-git/diff?sessionId=&path=&origPath=&source=&rev=` | 一条改动，逐行对齐 |
| `GET /dsh-git/commit-diff?sessionId=&rev=` | 一个提交，逐个文件的对齐 diff |

`source` 取 `worktree` / `index` / `commit`。失败体是 `{ code, message }`，code 取 `session/unknown`、`git/unavailable`、`git/not-a-repository`、`git/unknown-revision`、`git/path-outside-repo`、`git/bad-request`、`git/command-failed`。

## 配置

全部可选，写在 profile 的 patch 层：

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `maxLines` | `4000` | 一次 diff 返回的行数上限；超出则按改动区裁剪，并写明省略了什么 |
| `maxBytes` | `2097152` | 每侧最多读多少字节 |
| `historyLimit` | `50` | 历史每页最多返回多少提交 |
| `maxEntries` | `2000` | status 最多返回多少条改动 |
| `maxCommitFiles` | `100` | 一个提交的聚合 diff 最多包含多少文件 |
| `maxDiffMs` | `2000` | diff computer 的时间预算；超出则配对标记为近似 |

```yaml
- id: dsh-git
  config:
    historyLimit: 100
```

## 已知限制

- **只读**：不 stage、不 commit、不 discard、不 checkout。
- 合并提交取的是「相对第一个父提交」的差异。
- 冲突文件的新侧是带冲突标记的工作区内容，旧侧优先用 stage 2；没有三方合并视图。
- 二进制文件只列名不画行；不做行内（intraline）高亮。
- 语法高亮是插件自带的一份：加载器按**包名**解析外壳的模块，拿不到它内部那一份。`shiki` 与 `@shikijs/langs` 精确锁在与 harness 相同的版本，颜色取自同一张 `--shiki-*` 色板。
- 日志页不订阅文件系统变更推送，靠刷新按钮重读。

## 开发

```sh
npm test            # 先构建，再跑单测与端到端
npm run typecheck   # host 与 client 两套 tsconfig
npm run watch       # 客户端 bundle 监听重建
```

端到端套件大部分是**对构建产物及其内联 CSS** 断言，而不是对源码断言：因此「某条规则不再被产出」「组件引用了一个样式表里根本没定义的类」这类问题会在那里失败。

## License

MIT
