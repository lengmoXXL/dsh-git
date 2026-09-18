/**
 * Build the page the browser tests drive.
 *
 * The plugin's real bundle, React from the shell's own dependency, and a diff written
 * by hand so the test knows exactly what it should be looking at: three lines, a long
 * unchanged middle, and a change. The component under test is the one the page draws
 * diffs with, mounted directly — there is no shell here to hide behind.
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
<style>html,body{margin:0;height:100%;background:#1e1e1e}#host{width:1200px;height:760px}</style>
</head><body><div id="host"></div>
<script src="loader.js"></script>
<script>${react}</script>
<script>${reactDom}</script>
<script>${bundle}</script>
<script>
  const line = (n) => ({ no: n, text: 'line ' + String(n) + ' of a file whose middle is unchanged' })
  const rows = []
  for (let n = 1; n <= 3; n += 1) rows.push({ kind: 'context', left: line(n), right: line(n) })
  for (let n = 4; n <= 60; n += 1) rows.push({ kind: 'context', left: line(n), right: line(n) })
  rows.push({ kind: 'replace', left: { no: 61, text: 'old sixty one' }, right: { no: 61, text: 'new sixty one' } })
  const diff = { path: 'src/example.ts', source: 'worktree', oldLabel: 'index', newLabel: 'working tree',
    binary: false, truncated: false, approximate: false, removed: 1, added: 1, rows }
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
    : name === '@deepseek-ai/dsh-client-ui-primitives' ? { Button: (p) => React.createElement('button', p, p.children), Tag: (p) => React.createElement('span', p, p.children) }
    : (() => { throw new Error('the bundle asked for an unexpected module: ' + name) })()
  window.__exports = entry.factory(require)
  // One root per container: asking React for a second one leaves the page unchanged.
  let root
  window.__render = (props) => {
    root = root ?? ReactDOM.createRoot(document.getElementById('host'))
    root.render(React.createElement(window.__exports.MonacoDiff, Object.assign({
      diff, t: (key) => key, split: true, wrap: true,
    }, props)))
  }
  window.__render({})
</script>
</body></html>
`
await mkdir(out, { recursive: true })
await writeFile(join(out, 'index.html'), page)
await writeFile(join(out, 'loader.js'), 'window.__ModuleLoader__ = { load: (entry) => { window.__pending = entry } };\n')
console.log('page built in', out)
