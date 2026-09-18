# dsh-git

A DSH plugin that adds a **Git** page to the right sidebar: the working tree's changes and the
recent commits on one side, and the diff a click opens on the other — read-only, highlighted,
side by side. The list stays where it is, so two diffs can be put beside each other.

English | [中文](README.zh.md)

![The Git page: changes and commits on the left, the diff a click opens beside them. Click a commit to expand its files.](docs/screenshots/en/01-log.png)

| Two columns, wrapped | Two columns, unwrapped | One column |
| --- | --- | --- |
| ![The default: long lines wrap inside their half](docs/screenshots/en/02-diff-split.png) | ![Each half scrolls its own long lines; line numbers stay put](docs/screenshots/en/03-diff-unwrapped.png) | ![One column, each change as its removal then its insertion](docs/screenshots/en/04-diff-inline.png) |

## Install

Needs Node 22.19+ (or 24+) and the DSH CLI. Every release is a tarball of the built package, so
installing one compiles nothing and has no build for pnpm to allow.

```sh
dsh plugin --profile web add https://github.com/lengmoXXL/dsh-git/releases/latest/download/dsh-git.tgz
dsh --profile web
```

## License

MIT
