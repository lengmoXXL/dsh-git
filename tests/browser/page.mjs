/**
 * Build the page the browser tests drive.
 *
 * The plugin's real bundle, React from the shell's own dependency, and a diff written by
 * hand so the test knows exactly what it should be looking at: a few lines of a code file,
 * a long unchanged middle, and a change. The component is mounted inside the plugin's own
 * board and pane rather than in a bare box — those classes are read out of the stylesheet
 * the bundle injected, because the hash in front of a local name is this build's — since
 * the box a diff is given is part of what is under test.
 *
 * The page also names the shell's token colours, because the editor paints its tokens from
 * them: without them the component falls back to the editor's own theme, which is a case
 * of its own.
 *
 *   node tests/browser/page.mjs <output-dir>
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const out = process.argv[2]
if (out === undefined) throw new Error('usage: node tests/browser/page.mjs <output-dir>')

const read = async (path) => readFile(join(root, path), 'utf8')
const [bundle, react, reactDom] = await Promise.all([
  read('lib/client.js'),
  read('node_modules/react/umd/react.development.js'),
  read('node_modules/react-dom/umd/react-dom.development.js'),
])

const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>dsh-git browser test</title>
<style>
  html,body{margin:0;height:100%;background:#1e1e1e}
  /* The shell's palette, as its theme package states it for a dark page: the token
     colours the editor paints with, and the surface it and the page behind it share. */
  :root{
    --dsw-alias-markdown-code-block:#1e1e1e;
    --shiki-foreground:#d4d4d4;--shiki-background:#1e1e1e;
    --shiki-token-constant:#4dabf7;--shiki-token-string:#69db7c;
    --shiki-token-comment:#adb5bd;--shiki-token-keyword:#faa2c1;
    --shiki-token-parameter:#ffa94d;--shiki-token-function:#b197fc;
    --shiki-token-string-expression:#8ce99a;--shiki-token-punctuation:#ced4da;
  }
  #board{width:1200px;height:760px}
</style>
</head><body data-ds-dark-theme><div id="board"><section id="pane"></section></div>
<script src="loader.js"></script>
<script>${react}</script>
<script>${reactDom}</script>
<script>${bundle}</script>
<script>
  // The history list reads one commit's files through the plugin's own face, which calls the
  // page's fetch: a commit's answer is canned here so a row can be opened without a host.
  const COMMITS = [
    { sha: 'a'.repeat(40), shortSha: 'aaaaaaa', parents: ['b'.repeat(40)], authorName: 'Ada', authoredAt: 1_700_000_000, refs: ['HEAD -> main'], subject: 'Draw the rail through an open commit' },
    { sha: 'b'.repeat(40), shortSha: 'bbbbbbb', parents: [], authorName: 'Linus', authoredAt: 1_699_000_000, refs: [], subject: 'the commit below the one that is open' },
  ]
  const FILES = [
    { path: 'src/client/List.module.css', kind: 'modified' },
    { path: 'src/client/HistoryList.tsx', kind: 'modified' },
  ]
  const realFetch = window.fetch
  window.fetch = async (input) => {
    const url = String(input)
    if (url.includes('/commit?')) {
      return { ok: true, json: async () => ({ commit: COMMITS[0], files: FILES }) }
    }
    return await realFetch(input)
  }
</script>
<script>
  const line = (n) => 'const value' + String(n) + ' = compute(' + String(n) + ')'
  // Both sides of one small change, as a host sends them: a line gone, a line added, a line
  // changed, and a long unchanged middle for the editor to fold away. All four are here
  // because what the editor draws for each is one of the things under test.
  const common = []
  for (let n = 4; n <= 60; n += 1) common.push(line(n))
  const diff = { path: 'src/example.ts', source: 'worktree', oldLabel: 'index', newLabel: 'working tree',
    binary: false, truncated: false,
    oldText: [line(1), 'const gone = true', 'const answer = 41', ...common].join('\\n'),
    newText: [line(1), 'const added = compute(2)', 'const answer = 42', ...common].join('\\n') }
  const entry = window.__pending
  // The bundle is compiled with React's automatic JSX runtime, which is an entry of its
  // own that the UMD build does not carry: three names are all it asks for.
  const toElement = (type, props, key) => {
    const { children, ...config } = props ?? {}
    const withKey = key === undefined ? config : Object.assign({ key }, config)
    return Array.isArray(children)
      ? React.createElement(type, withKey, ...children)
      : React.createElement(type, withKey, children)
  }
  const jsxRuntime = {
    Fragment: React.Fragment,
    // React 18's createElement takes the key inside its config and its children as the
    // arguments after it. Handing the runtime's children through as a config property
    // instead leaves React looking at an unkeyed array, which is the warning this
    // folding exists to avoid.
    jsx: toElement,
    jsxs: toElement,
  }
  const require = (name) => name === 'react' ? React
    : name === 'react/jsx-runtime' ? jsxRuntime
    : name === 'react-dom' ? ReactDOM
    : name === '@deepseek-ai/dsh-client-ui-primitives' ? {
        // Only what the components on this page draw with: a missing name would reach
        // React as an element type it cannot render.
        Button: (p) => React.createElement('button', p, p.children),
        Tag: (p) => React.createElement('span', p, p.children),
        FileTypeIcon: () => React.createElement('span', null, null),
        // Sized, or an svg with no size of its own is 300 by 150 and covers the rows.
        IconBranchOutline16: () => React.createElement('svg', { width: 16, height: 16 }),
        IconChevronDownOutline14: () => React.createElement('svg', { width: 14, height: 14 }),
        IconChevronRightOutline14: () => React.createElement('svg', { width: 14, height: 14 }),
        // The shell's own reading of a timestamp, which a commit row's age is built from.
        relativeTime: (at, now) => ({ unit: 'minutes', n: Math.max(1, Math.floor((now - at * 1000) / 60_000)) }),
      }
    : (() => { throw new Error('the bundle asked for an unexpected module: ' + name) })()
  window.__exports = entry.factory(require)

  /**
   * The class the plugin's own stylesheet gives one of its local names.
   *
   * Every local name is hashed by the build, so the plugin's own boxes are reached through
   * the sheet it injected rather than through a name written down here. The sheet is found
   * by the name it ends with, since the tag it is keyed by is the stylesheet's path.
   */
  const classOf = (sheet, local) => {
    const tag = document.querySelector('style[data-plugin-css$="/' + sheet + '"]')
    if (tag === null) throw new Error('the bundle injected no ' + sheet)
    const pattern = new RegExp('\\\\.([A-Za-z0-9_-]+)_' + local + '(?![A-Za-z0-9_-])')
    for (const rule of tag.sheet.cssRules) {
      const found = pattern.exec(rule.selectorText ?? '')
      if (found !== null) return found[1] + '_' + local
    }
    throw new Error(sheet + ' has no ' + local)
  }
  const board = document.getElementById('board')
  const pane = document.getElementById('pane')
  board.className = classOf('GitBoard.module.css', 'board')
  pane.className = classOf('GitBoard.module.css', 'pane')

  // One root per container: asking React for a second one leaves the page unchanged.
  let root
  window.__render = (props) => {
    if (props.width !== undefined) board.style.width = String(props.width) + 'px'
    root = root ?? ReactDOM.createRoot(pane)
    root.render(React.createElement(window.__exports.DiffView, Object.assign({
      diff, t: (key) => key, split: true, wrap: true,
    }, props)))
  }

  /**
   * What the page can say about what was drawn, for the test to assert on: the colours the
   * editor gave a line's tokens, every box it took over forty frames, and whether the
   * editor on screen is the one a mark was taken of.
   */
  let marked
  window.__probe = {
    markEditor: () => { marked = document.querySelector('.monaco-diff-editor') },
    editorIsMarked: () => {
      const editor = document.querySelector('.monaco-diff-editor')
      if (marked === null || editor === null) return 'no editor'
      return marked === editor ? 'same' : 'replaced'
    },
    /**
     * How the editor painted the lines it added and removed, and the text it changed within
     * a line. Each is an overlay it draws, and each takes its colour from the stylesheet it
     * ships.
     */
    marks: () => {
      const background = (selector) => {
        const overlay = document.querySelector(selector)
        return overlay === null ? undefined : getComputedStyle(overlay).backgroundColor
      }
      return {
        addedLine: background('.line-insert'),
        removedLine: background('.line-delete'),
        addedText: background('.char-insert'),
        removedText: background('.char-delete'),
      }
    },
    /**
     * Where each column begins its line numbers, and how wide the strip before them is: a strip
     * on one side only is what starts that side's numbers somewhere else.
     */
    gutters: () => [...document.querySelectorAll('.monaco-editor')]
      .filter(editor => editor.getBoundingClientRect().width > 20)
      .map((editor) => {
        const box = editor.getBoundingClientRect()
        const numbers = editor.querySelector('.line-numbers')
        const glyph = editor.querySelector('.glyph-margin')
        return {
          offset: numbers === null ? null : Math.round(numbers.getBoundingClientRect().x - box.x),
          glyph: glyph === null ? 0 : Math.round(glyph.getBoundingClientRect().width),
        }
      }),
    /**
     * The rail through an open commit's files and the space the group is given: the rail's own
     * box is the group's, moved by the offsets the stylesheet asks for.
     */
    history: () => {
      const files = document.querySelector('#historyHost [class*=_files]')
      if (files === null) return null
      const style = getComputedStyle(files)
      const rail = getComputedStyle(files, '::before')
      const box = files.getBoundingClientRect()
      const shift = (value) => parseFloat(value) || 0
      const centre = (row) => {
        const node = row === null ? null : row.querySelector('[class*=_node]')
        if (node === null) return null
        const rect = node.getBoundingClientRect()
        return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }
      }
      return {
        paddingTop: shift(style.paddingTop),
        paddingBottom: shift(style.paddingBottom),
        centre: Math.round(box.x + shift(rail.left) + shift(rail.width) / 2),
        top: Math.round(box.y + shift(rail.top)),
        // A negative bottom is an offset past the group's own edge, so it is subtracted.
        bottom: Math.round(box.y + box.height - shift(rail.bottom)),
        width: shift(rail.width),
        above: centre(files.previousElementSibling),
        below: centre(files.nextElementSibling),
      }
    },
    /** Whether the editor's icon font is loaded, and whether the band draws a glyph with it. */
    icons: async () => {
      await document.fonts.load('16px codicon')
      const glyph = document.querySelector('.diff-hidden-lines .center > div:first-child a .codicon')
      const content = glyph === null ? 'none' : getComputedStyle(glyph, '::before').content
      return { font: document.fonts.check('16px codicon'), content: String(content) }
    },
    /**
     * Where each column draws the band's unfold control, as an offset from that column's own
     * left edge: the same control should land in the same place on both sides.
     */
    columns: () => {
      const seen = []
      for (const editor of document.querySelectorAll('.monaco-editor')) {
        const box = editor.getBoundingClientRect()
        if (box.width <= 20) continue
        const unfold = editor.querySelector('.diff-hidden-lines .center > div:first-child a')
        if (unfold === null) continue
        seen.push(Math.round(unfold.getBoundingClientRect().x - box.x))
      }
      return seen
    },
    /**
     * Which number the gutter gives the changed line on each side, joined as text and
     * number. The number is drawn in its own column beside the line, so the two are matched
     * by where they are drawn rather than by an offset either of them may round.
     */
    numbering: () => {
      const seen = []
      for (const editor of document.querySelectorAll('.monaco-editor')) {
        const gutter = [...editor.querySelectorAll('.line-numbers')]
          .map(element => ({ top: element.getBoundingClientRect().top, text: String(element.textContent).trim() }))
        for (const line of editor.querySelectorAll('.view-lines .view-line')) {
          // The editor renders a space as a non-breaking one, so a line is compared as its
          // own text rather than as the source written here.
          const text = String(line.textContent ?? '').replace(/\\u00a0/g, ' ').trim()
          if (!/^const answer = 4\\d$/.test(text)) continue
          const top = line.getBoundingClientRect().top
          const number = gutter.find(entry => Math.abs(entry.top - top) < 3)
          seen.push(text + '@' + (number === undefined ? '?' : number.text))
        }
      }
      return seen
    },
    colours: () => {
      const spans = [...document.querySelectorAll('.view-lines span span')]
      const colourOf = (matches) => {
        const span = spans.find(element => matches((element.textContent ?? '').trim()))
        return span === undefined ? undefined : getComputedStyle(span).color
      }
      return {
        keyword: colourOf(text => text === 'const'),
        identifier: colourOf(text => /^value\\d+$/.test(text)),
        distinct: new Set(spans.map(element => getComputedStyle(element).color)).size,
      }
    },
    settle: async () => {
      const editor = document.querySelector('.monaco-diff-editor')
      const sizes = new Set()
      for (let frame = 0; frame < 40; frame += 1) {
        await new Promise(resolve => requestAnimationFrame(resolve))
        const box = editor.getBoundingClientRect()
        sizes.add(Math.round(box.width) + 'x' + Math.round(box.height))
      }
      // Every editor the diff drew wide enough to see: two of them is two columns.
      const columns = [...document.querySelectorAll('.monaco-editor')]
        .map(element => Math.round(element.getBoundingClientRect().width))
        .filter(width => width > 1)
      return { sizes: [...sizes], columns, width: pane.clientWidth, overflow: pane.scrollWidth - pane.clientWidth }
    },
  }
  window.__render({})

  // A second page for the history list, mounted the same way: its own host, and one root for it.
  const historyHost = document.createElement('div')
  historyHost.id = 'historyHost'
  historyHost.style.cssText = 'width:420px;height:400px;background:#1e1e1e'
  // Ahead of the diff board, so nothing the editor overlays can cover a row.
  document.body.prepend(historyHost)
  let historyRoot
  window.__renderHistory = () => {
    historyRoot = historyRoot ?? ReactDOM.createRoot(historyHost)
    historyRoot.render(React.createElement(window.__exports.HistoryList, {
      commits: COMMITS,
      hasMore: false,
      sessionId: 'session-1',
      now: 1_700_000_600_000,
      t: (key) => key,
      onSelectFile: () => {},
      viewport: { current: historyHost },
      onLoadOlder: () => {},
    }))
  }
</script>
</body></html>
`
await mkdir(out, { recursive: true })
await writeFile(join(out, 'index.html'), page)
await writeFile(join(out, 'loader.js'), 'window.__ModuleLoader__ = { load: (entry) => { window.__pending = entry } };\n')
console.log('page built in', out)
