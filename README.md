# dsh-git

给 DeepSeek Harness Web GUI 的只读 Git 工具，以**右侧栏标签页**的形式工作：按 `+` 打开 guide，选 **Git log** 得到提交历史与工作区改动；点任一条 log entry，就在旁边**新开一个 code diff 标签页**。交互上接近 neogit + codediff 的组合。

每个 diff 是双栏（旧 | 新）行对齐视图。因为资源标签页的身份就是它的地址，两个 diff 可以同时开着并排看，而不是互相顶掉。

Host 半边全程走 `ctx.fs` 与 `ctx.subprocess`，不直接碰 `node:fs` 或 `child_process`。这是它能看 remote 机器 diff 的原因：当部署用 `dsh-remote-ssh-worktree` 这类插件把 `ctx.fs` / `ctx.subprocess` 路由到远端时，本插件不需要任何改动——它问的执行世界自己知道那个仓库在哪台机器上。

**本插件只读。** 不 stage、不 commit、不 discard、不改工作区。每个 git 子进程都带 `GIT_OPTIONAL_LOCKS=0`，所以连 `git status` 都不会顺手重写 index。

## 安装

需要 Node 22.19+（或 24+）与 DSH CLI。

```sh
# 1. 克隆并构建（产出 lib/index.js 与 lib/client.js）
git clone https://github.com/lengmoXXL/dsh-git
cd dsh-git && npm install && npm run build

# 2. 装进 profile —— 这会在 profile 目录里执行 pnpm，
#    并把声明了 dsh.bundle.patch 的依赖自动加进 dsh.profile.bundles
dsh plugin --profile web add "$PWD"

# 3. 重启 Web 服务，刷新页面
dsh --profile web
```

> 已装过一次后，**只改 host 半边代码**需要重启服务；**只改客户端代码**只需 `npm run build`，服务端会轮询到新的 `lib/client.js` 并通过 SSE 让页面热重载。

热重载是在**同一个文档里**重新求值 bundle，所以内联样式也要跟着换：每个 CSS Module 的 `<style>` 按模块名找到后**原地重写内容**，而不是"已经存在就跳过"。早先的写法只按模块名查一次，于是热重载之后页面会跑着最新代码、却仍然被上一次**整页加载**时的样式渲染——表现就是"布局跟代码对不上"。现在换新样式不需要手动刷新页面。

### 不安装的试用方式

profile 支持 `--patch` 覆盖层，里面插入的插件 `name` 可以是相对于该 patch 文件的路径：

```sh
pnpm dsh web --port 8080 --patch ./overlay.yml
```

```yaml
- insert:
    - id: dsh-git
      name: /path/to/dsh-git   # 绝对路径，或相对于该 patch 文件的路径
```

这种方式不去动 profile 的依赖与 bundles。

## 怎么用

1. **右侧栏按 `+`** → 打开 guide（若该 pane 已有 guide 则聚焦它）。
2. 点 **Git log** 胶囊 → guide 原位换成日志页，里面是**改动**（按 冲突/已暂存/未暂存/未跟踪 分组）与**历史**。
3. 点任一条**改动** → 在**同一个 pane 里新开一个标签页**显示这条改动的 diff。
4. 点任一条**提交** → 就在那一行下面**展开它改动的文件列表**（再点一次收起）。点其中一个文件 → 新开一个标签页显示**那个文件在这个提交里**的 diff。再点一条就再开一个，互不覆盖。
5. 标签页可拖动、可分裂到第二个 pane、可浮动——这些都由外壳提供，插件不参与。

展开时才去读那个提交的文件列表：一页历史是 50 条提交，为了画其中一条去读 50 份改动是 50 次白读。收起再展开就是重读一次，这也正好是读失败后的重试方式。

**往返不丢现场。** 外壳一个 pane 只画当前标签页，所以点开 diff 时日志页是被卸载的。为了"点完再回来"不从头开始，日志页把**读过的那一页、展开的那个提交及其文件列表、以及滚动位置**记在一个按会话分键的模块级缓存里（`log-cache.ts`）：回来时立刻照原样画出来，状态与历史还在后台重读（所以看到的不是陈旧的），而**提交的文件列表不重读**——它是不变的，读过就留着。缓存活在页面生命周期里，刷新页面才清。

## 面板行为

- **diff 语义**：未暂存 = index ↔ 工作区；已暂存 = HEAD ↔ index；提交内文件 = 该提交 ↔ 第一个父提交。
- 提交里的每个文件是**一条独立标签页**（地址里带着 rev 与路径），所以同一个文件的两次历史改动可以并排开着比。
- 「整个提交」的地址（`dsh-resource://git/commit?…`）仍然能解析、仍然能画（提交信息 + 逐个文件的双栏 diff 堆在一个滚动区里），只是界面上不再有入口——从旧会话恢复出来的这种标签页照常显示。
- 重命名按旧路径 ↔ 新路径对照；新增/删除的一侧为空；二进制文件只给提示不画行。
- 连续未改动行超过 6 行会折叠成一条可展开的 `⋯ N 行未改动`——点击标签页里则会展开/收起（后端返回的省略行见下）。
- 日志页刷新时机：标签页挂载、切换会话、点刷新按钮。

### 列表照的是 VS Code 的源代码管理视图

一个 pane 里，「改动」与「历史」是两个**分区**：标题吸顶、可折叠、右端带计数胶囊。滚动时后来的标题会把前一个顶掉，所以标题永远属于它下面那些行——这正是两半不再糊在一起的原因。行高 22px，是编辑器里那种密度。

- **改动行**：文件类型图标 + 文件名，路径跟在名字后面以更浅的颜色（空间不够时先让路径）；最右是状态字母：`M` 改动、`A` 新增、`R` 重命名、`C` 复制、`T` 类型变更、`U` 未跟踪、`D` 删除、`!` 冲突。字母颜色取自客户端那套语义 token（改动用琥珀、新增用绿、删除用红），删除的文件名带删除线；重命名的旧路径在 tooltip 里（`旧 → 新`）。
- **历史行**：一行一条提交——最左是**提交节点**（实心点；合并与工作区所在的那条是空心环，后者取它分支胶囊的蓝），然后是 subject、`作者 · 多久以前`、ref 胶囊。工作区所在的那条 subject 加粗，它的分支胶囊是整屏唯一实心的（`solid`）；本地分支蓝、远程分支灰、标签描边；超过两枚折叠成 `+N`，名字进 tooltip。节点是有意只画点、不画连线的：这是提交本身，不是拓扑图。
- **让位顺序**：先让作者（`lengmo…`），再让 subject（省略号），`多久以前` 和胶囊不缩——所以窄 pane 里也总能看清「是哪条提交、多久以前、在哪个分支上」。整行 tooltip 里有完整的 subject、作者、时间、sha 和全部 ref 名，连被切掉的胶囊也在这里。

ref 是用 `--decorate=full` 读的，所以本地分支 `feature/x` 与 `origin/feature/x` 靠前缀区分而不是数斜杠；`origin/HEAD` 这种符号别名不画（它旁边的分支就是它）。

### 对齐用的是 VS Code 的 diff 引擎

行对齐不是自己写的 LCS，而是 [`vscode-diff`](https://www.npmjs.com/package/vscode-diff)——VS Code 编辑器自带的那套 diff computer 的独立打包（MIT，19 KB gzip，作为普通依赖由 host bundle 外部引用）。选它的理由：同样的 Myers + 动态规划核心、同样的行裁剪，diff 读起来就是编辑器里那个味道；而且它比手写对齐多给了字符级 `innerChanges`，将来做行内高亮不用再换引擎。

两个边界由本插件守住：

- **未改动的行绝不会被标成改动**。这是适配层唯一的不变量——位置式回退（已删除）之所以危险，就是会把一行改动涂成整屏红绿。
- computer 报 `hitTimeout` 时（超出 `maxDiffMs` 预算），标签页会显示「对齐超出时间预算，配对为近似结果」，而不是假装精确。

已知坑：`vscode-diff` 的 `toRangeMapping2` 对「某一侧整块为空」的输入会抛内部断言错误（整文件新增/删除经前缀后缀裁剪后正是这个形状）。适配层对空侧直接走平凡对齐、不调 computer，并对 computer 调用保留一个保持上述不变量的最后兜底。

### diff 视图本身

两栏**永远各占面板的一半**，不管两边的内容多宽——同时看不见的两列不算双栏 diff。长行怎么办由**折行开关**决定：

- **自动折行**（默认）：长行在各自半栏里折行。此时整个 body 是一张网格，两侧的行共用行高，所以折出来的多行也永远对得上。
- **不折行**：长行不折，**每一栏各自横向滚动**（像编辑器那样），行号用 `position: sticky` 钉在各自半栏的左边、不跟着滚走；左右两栏不会因为某一侧的行长而互相挤。每一栏自己的几何由那一栏定，**不能由行内容决定**，这一点不是装饰：

- **行高**用 `grid-auto-rows` 固定：某一行在它自己那一侧没有内容时（插入/删除的空半边）什么都画不出来，若行高由内容撑，那一行会塌成 0 高，两栏每遇到一个空行就错开一行，从第一个插入开始两边读起来就是两段不同的代码。
- **列宽**用 `minmax(100%, max-content)`：行的染色带只有它所在轨道那么宽，若轨道只按最长行算，改动块的色带就会在半栏中间断掉，看起来像半栏比实际窄。

这是"内容多宽就多宽、整体横向滚动"和"永远铺满面板"之间的取舍：整体滚动在长行文件上会把另一栏推出视野（README 这种一行 355 字符的文件会宽到 4000px），所以选了后者。

视图本身照的是外壳自己的代码卡片（read 卡片 / 代码块）那套语言，所以它和聊天里的代码不会被认成两个产品：

| 元素 | 取值 |
| --- | --- |
| 卡片 | `--dsw-alias-markdown-code-block` 面 + 12px 圆角（嵌在提交标签页里时每文件一张卡） |
| banner | `--dsw-alias-markdown-code-block-banner`，路径用 12px 代码字（read 卡片的 label 字号） |
| 行 | `--dsw-font-markdown-code-block`（11px/19px）+ 22px 最小行高（read 卡片同值） |
| 行号槽 | 每侧固定 48px，右对齐，`user-select: none`（选中可见行拿到的是代码，不是行号） |
| 计数 / 复制 | `--dsw-font-xs-13`，和 read 卡片右上角一致 |

改动行只**染底**、不改字色：底色说「这行变了」，正文保持阅读色——一整行红字或绿字比它标注的代码更难读。空的一侧露出底色，读作「这里没有内容」。省略行与折叠行的缩进跟着行号槽，和 read 卡片的展开控件对齐。

右上角的**复制**走外壳导出的 `writeClipboard`，复制的是统一格式文本（路径、`← 旧路径`、` ` / `-` / `+` 前缀，省略行写成 `⋯ N / M`），所以粘到别处能直接当 diff 用。

**高亮**走的是 DSH 文件视图那一套：shiki 的 fine-grained core + JavaScript regex engine + css-variables 主题，颜色全部解析成 `--shiki-*` 自定义属性——也就是 `CodeBlock` / `ReadBlock` 用的同一张色板、同一个语法版本（`shiki` 与 `@shikijs/langs` 精确锁在 harness 用的 `4.3.1`），文件扩展名到语言的映射也照抄 read 工具那张表。所以同一行代码在 diff 里和在文件卡片里是同一组 token、同一组颜色；token 色表一改，两边一起变。整段文本一次分词（跨行的块注释、模板字符串读得到上下文），再按行切开给每一行——行号槽、染色、换行都不影响它。

**布局开关**在复制钮左边，照编辑器的做法：图标画的是它将要切到的样子，tooltip 说明动作。不折行时嵌在提交标签页里的卡片自己会横向滚动——卡片的圆角靠 `overflow: hidden` 实现，若不让内层滚，被切掉的右栏就再也够不着了。

- **两栏** / **内联**：两个对齐的列，或一栏按顺序读（旧号、新号两个槽；被替换的行变成「先删后增」两行，因为一栏没法同时显示两侧）。
- **自动折行** / **不折行**：折行时长行在各自半栏里绕行，两栏永远都看得见；不折行时保留整行、两栏一起横向滚动，和编辑器一样。默认折行。

四个选择都是**读者的偏好，而不是这个标签页的状态**：所有 diff 标签页一起切，并且记在浏览器里（`localStorage` 的 `dsh-git:diff-view-mode`、`dsh-git:diff-view-wrap`），刷新、重开标签页都还在。存储不可用（隐私模式等）时退回默认（两栏 + 折行），不报错。

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

`shiki` / `@shikijs/langs` 是**构建期依赖**（devDependencies）：客户端 bundle 把它们内联进去，运行时不解析它们，所以放在 dependencies 反而会被 tsdown 外部化，加载时撞上模块表而报错。版本精确锁 `4.3.1`，与 harness 的文件视图一致。实测的 bundle 规模：

| grammar 集合 | raw | gzip |
| --- | --- | --- |
| 26 个（默认，与文件视图完全对齐） | 3.1 MB | 0.41 MB |
| 14 个（ts/js、sh、json、py、go、rs、c、cpp、java、yaml、md、html、css、sql） | 2.0 MB | 0.26 MB |
| 3 个（ts/js、sh、json） | 0.68 MB | 0.13 MB |

改法是 `src/client/highlight.ts` 里的 import 与 `LANGS` 两处同步删减；`LANG_ALIASES` 留着即可（未知语言走纯文本）。

测试分三层：

- **纯函数单测**：porcelain v2 解析、双栏对齐（含大文件、锚点、诚实回退、hunk 裁剪）、路径围栏、日志与 name-status 解析、资源地址往返、日志页派生状态、face 的请求与失败分类。
- **真实仓库端到端**：在临时目录里建真仓库、造出六类改动，用真实的 `LocalFileSystem` + `LocalSubprocessRuntime` 驱动整个 host 半边，断言 status / history / commit / diff / commit-diff 的实际输出，以及「未知会话身份被拒绝」「非活动会话按持久化 header 解析」。
- **构建产物**：真实 `lib/client.js` 在桩 loader 下求值，校验注册 id、导出面、两个标签页类型的声明与 body 注册、资源 provider、双语字典键一致、diff 能画出单条改动 / 整个提交 / 省略行、CSS 已内联、以及 `require` 的目标全部落在 shell 的模块表内。

## 已知限制

- 合并提交的文件列表取的是「相对第一个父提交」的差异（`-m --first-parent`）。
- 冲突文件的新侧是带冲突标记的工作区内容，旧侧优先用 stage 2（ours）；没有三方合并视图。
- 二进制文件只给提示；不做行内（intraline）高亮。
- 语法高亮是**插件自带的一份**，不是复用外壳的那一份：客户端的模块表只按**包名**播种，子路径（`ui-primitives/src/markdown/highlight.ts`）在运行时解析不到，所以插件拿不到外壳内部的 `highlightLines`。为了一致，插件把外壳那套设置照搬过来并**精确锁版本**，颜色仍走同一张 `--shiki-*` 色板。代价是 client bundle 因为内联了 26 个 grammar 而变大（约 3.1 MB raw / 0.4 MB gzip，按 rev 不可变缓存，本地服务因此只付一次）；砍掉不常用的语言是一处编辑（README 的「开发」一节给了三个规模的实测数字）。
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
    LogBody.tsx       日志页：改动 + 历史；点改动开标签页，点提交展开文件列表
    DiffBody.tsx      diff 标签页：单条改动或整个提交
    Section.tsx       吸顶可折叠的分区头（改动 / 历史共用一个）
    ChangeList.tsx / HistoryList.tsx / FileRow.tsx / RefChips.tsx / SideBySide.tsx / Feedback.tsx
    state.ts          列表派生状态：分组、状态字母、ref 胶囊、内联行、复制文本、折叠、失败描述
    highlight.ts      shiki 设置：语法表、扩展名映射、按行分词（与文件视图同一套色板）
    view-mode.ts      内联/两栏、折行/不折行的选择，存在浏览器里，所有 diff 标签页共用
    log-cache.ts      日志页的往返缓存：读过的一页、展开的提交与文件列表、滚动位置
    format.ts / face.ts / locales.ts / glyphs.tsx
cordis.patch.yml      bundle 补丁：只 insert 一行 dsh-git
tsdown.config.ts      host ESM + client CJS(window.__ModuleLoader__) + CSS Modules 内联
```
