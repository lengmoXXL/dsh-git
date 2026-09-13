/**
 * Bilingual copy for the git panel.
 *
 * The Chinese dictionary is the key source; the English one is checked against
 * its key set, so a key added to one without the other fails the type check.
 * The panel receives `t` through the standard locale seat, which the shell
 * derives from the namespace registered in {@link NS}.
 *
 * @module dsh-git/client/locales
 */

/** Locale namespace owned by this plugin's Web UI. */
export const NS = 'dsh-git'

/** This namespace's identifier, as the shell's locale and slot seats address it. */
export type GitNamespace = typeof NS

/** Simplified Chinese dictionary and key source. */
export const zh = {
  'panel.label': 'Git',
  'panel.noSession': '没有活动的会话',
  'panel.noRepo': '当前工作区不在 git 仓库中',
  'panel.refresh': '刷新',
  'panel.retry': '重试',
  'loading': '正在加载…',

  'log.title': 'Git 日志',
  'log.guide': '浏览工作区改动与提交历史，点开即在新标签页看 diff',
  'changes.title': '改动',
  'changes.empty': '工作区没有改动',
  'changes.truncated': '仅显示前 {n} 项改动',

  'group.conflicted': '冲突',
  'group.staged': '已暂存',
  'group.unstaged': '未暂存',
  'group.untracked': '未跟踪',

  'history.title': '历史',
  'history.empty': '还没有提交',
  'history.more': '还有更早的提交未显示',
  'history.detached': '游离 HEAD',
  'history.ahead': '领先 {n}',
  'history.behind': '落后 {n}',

  'commit.files': '文件',
  'commit.empty': '这个提交没有改动文件',

  'diff.binary': '二进制文件，不显示文本 diff',
  'diff.truncated': 'diff 不完整（已达到行数或大小上限）',
  'diff.unchanged': '行未改动',
  'diff.omitted': '行未显示',
  'diff.approximate': '对齐超出时间预算，配对为近似结果',
  'diff.old': '旧',
  'diff.new': '新',

  'kind.modified': '修改',
  'kind.added': '新增',
  'kind.deleted': '删除',
  'kind.renamed': '重命名',
  'kind.copied': '复制',
  'kind.typechange': '类型变更',
  'kind.untracked': '未跟踪',
  'kind.conflicted': '冲突',
  'kind.unknown': '变更',

  'error.title': 'git 请求失败',

  'time.now': '刚刚',
  'time.minutes': '{n} 分钟前',
  'time.hours': '{n} 小时前',
  'time.days': '{n} 天前',
  'time.months': '{n} 个月前',
  'time.years': '{n} 年前',
}

/** Every key this namespace owns. */
export type GitKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  'panel.label': 'Git',
  'panel.noSession': 'No active session',
  'panel.noRepo': 'This workspace is not inside a git repository',
  'panel.refresh': 'Refresh',
  'panel.retry': 'Retry',
  'loading': 'Loading…',

  'log.title': 'Git log',
  'log.guide': 'Working-tree changes and history; a click opens the diff in its own tab',
  'changes.title': 'Changes',
  'changes.empty': 'No changes in the working tree',
  'changes.truncated': 'Showing the first {n} changes only',

  'group.conflicted': 'Conflicts',
  'group.staged': 'Staged',
  'group.unstaged': 'Changes',
  'group.untracked': 'Untracked',

  'history.title': 'History',
  'history.empty': 'No commits yet',
  'history.more': 'Older commits are not shown',
  'history.detached': 'detached HEAD',
  'history.ahead': '{n} ahead',
  'history.behind': '{n} behind',

  'commit.files': 'Files',
  'commit.empty': 'This commit changes no files',

  'diff.binary': 'Binary file — no text diff',
  'diff.truncated': 'The diff is incomplete (line or size cap reached)',
  'diff.unchanged': 'unchanged lines',
  'diff.omitted': 'lines not shown',
  'diff.approximate': 'the diff computer hit its time budget; the pairing is approximate',
  'diff.old': 'old',
  'diff.new': 'new',

  'kind.modified': 'modified',
  'kind.added': 'added',
  'kind.deleted': 'deleted',
  'kind.renamed': 'renamed',
  'kind.copied': 'copied',
  'kind.typechange': 'type change',
  'kind.untracked': 'untracked',
  'kind.conflicted': 'conflicted',
  'kind.unknown': 'changed',

  'error.title': 'The git request failed',

  'time.now': 'now',
  'time.minutes': '{n}min ago',
  'time.hours': '{n}h ago',
  'time.days': '{n}d ago',
  'time.months': '{n}mo ago',
  'time.years': '{n}y ago',
} satisfies Record<GitKey, string>
