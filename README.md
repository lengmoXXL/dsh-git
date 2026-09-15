# dsh-git

A DSH plugin that adds a **Git** tab to the right sidebar — the working tree's changes and the recent commits — and
opens a read-only, highlighted, side-by-side diff in its own tab when you click a change, or a file inside a commit.

English | [中文](README.zh.md)

![The Git tab: changes above, commits below. Click a commit to expand its files, a file to open its diff.](docs/screenshots/en/01-log.png)

| Two columns, wrapped | Two columns, unwrapped | One column |
| --- | --- | --- |
| ![The default: long lines wrap inside their half](docs/screenshots/en/02-diff-split.png) | ![Each half scrolls its own long lines; line numbers stay put](docs/screenshots/en/03-diff-unwrapped.png) | ![One column, each change as its removal then its insertion](docs/screenshots/en/04-diff-inline.png) |

## Install

Needs Node 22.19+ (or 24+) and the DSH CLI. The package builds itself on install; pnpm will print an `allowBuilds` key
to add to `~/.dsh/profiles/web/pnpm-workspace.yaml`, and the same command works once you have.

```sh
dsh plugin --profile web add https://github.com/lengmoXXL/dsh-git
dsh --profile web
```

## License

MIT
