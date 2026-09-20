# dsh-git

一个 DSH 插件：给右侧栏加一个 **Git** 页面——左边是工作区改动与最近提交，右边是点开的 diff——只读、带高亮、双栏对齐。列表留在原地，所以两条 diff 可以并排比较。

[English](README.md) | 中文

![Git 页面：左边是改动与提交，点开的 diff 就在它们旁边。点提交展开它改动的文件。](docs/screenshots/zh/01-log.png)

| 双栏 · 折行 | 双栏 · 不折行 | 单栏 |
| --- | --- | --- |
| ![默认：长行在各自半栏里折行](docs/screenshots/zh/02-diff-split.png) | ![每一栏各自横向滚动长行，行号钉住不动](docs/screenshots/zh/03-diff-unwrapped.png) | ![单栏：每条改动先删后增](docs/screenshots/zh/04-diff-inline.png) |

## 安装

需要 Node 22.19+（或 24+）与 DSH CLI。

```sh
dsh plugin --profile web add @lengmoxxl/dsh-git
dsh --profile web
```

## 发布

发布是手动的。在干净的 `main` 上：

```sh
npm version patch --no-git-tag-version   # 或 minor / major
git commit -am "Cut $(node -p "require('./package.json').version")"
npm run release
```

`npm run release` 先跑类型检查和测试，然后把 `@lengmoxxl/dsh-git` 发布到公共 npm registry；检查不过就不会发布。

然后打 tag：

```sh
version="$(node -p "require('./package.json').version")"
git tag -a "v${version}" -m "<发布说明>"
git push --follow-tags
```

## License

MIT
