# dsh-git

一个 DSH 插件：给右侧栏加一个 **Git** 页面——左边是工作区改动与最近提交，右边是点开的 diff——只读、带高亮、双栏对齐。列表留在原地，所以两条 diff 可以并排比较。

[English](README.md) | 中文

![Git 页面：左边是改动与提交，点开的 diff 就在它们旁边。点提交展开它改动的文件。](docs/screenshots/zh/01-log.png)

| 双栏 · 折行 | 双栏 · 不折行 | 单栏 |
| --- | --- | --- |
| ![默认：长行在各自半栏里折行](docs/screenshots/zh/02-diff-split.png) | ![每一栏各自横向滚动长行，行号钉住不动](docs/screenshots/zh/03-diff-unwrapped.png) | ![单栏：每条改动先删后增](docs/screenshots/zh/04-diff-inline.png) |

## 安装

需要 Node 22.19+（或 24+）与 DSH CLI。安装时包会自行构建；pnpm 会打出一个要加进 `~/.dsh/profiles/web/pnpm-workspace.yaml` 的 `allowBuilds` key，加完再跑同一条命令即可。

```sh
dsh plugin --profile web add https://github.com/lengmoXXL/dsh-git
dsh --profile web
```

## License

MIT
