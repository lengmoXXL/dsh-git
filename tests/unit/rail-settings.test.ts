/**
 * The reader's own arrangements of the page.
 *
 * Where the list sits, how wide it is and whether it is showing are choices the
 * reader makes once and expects to find again, so they are held in a store the page
 * reads — and a store that forgets, or that reports a value it was never given, is a
 * page that rearranges itself between visits.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  railSettings,
  RAIL_DEFAULT_WIDTH,
  setRailOpen,
  setRailSide,
  setRailWidth,
} from '../../src/client/view-mode.ts'

test('remembers where the list was put, how wide, and whether it is showing', () => {
  const before = railSettings()
  assert.equal(before.side, 'left')
  assert.equal(before.width, RAIL_DEFAULT_WIDTH)
  assert.equal(before.open, true)

  setRailSide('right')
  setRailWidth(500)
  setRailOpen(false)
  assert.deepEqual(
    { side: railSettings().side, width: railSettings().width, open: railSettings().open },
    { side: 'right', width: 500, open: false },
  )

  // Back to what the page opens with, so the rest of the suite starts where it did.
  setRailSide('left')
  setRailWidth(RAIL_DEFAULT_WIDTH)
  setRailOpen(true)
  assert.deepEqual(railSettings(), before)
})
