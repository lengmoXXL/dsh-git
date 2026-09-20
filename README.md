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

Needs Node 22.19+ (or 24+) and the DSH CLI.

```sh
dsh plugin --profile web add @lengmoxxl/dsh-git
dsh --profile web
```

## Requirements, permissions, and limits

- A `git` executable on `PATH`, and a Git working tree as the session's working directory.
- Reads that repository through the Harness filesystem and runs `git` through the Harness subprocess: no network, no credentials, no other path.
- Writes nothing — not the tree, not the index. Commands run with the DSH process's own privileges, and a large repository or diff takes time to gather and draw.

## Release

From a clean `main`:

```sh
npm version patch -m "Cut %s"   # or minor / major
npm publish
```

## License

MIT
