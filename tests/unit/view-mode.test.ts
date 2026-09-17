/**
 * The reader's own choices: where the list sits, and how wide it may be.
 *
 * These are the numbers the page lays itself out with, so they are worth pinning:
 * a list dragged to nothing, or to eating the diff it exists to serve, is a page
 * that has to be reloaded to be used again.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { clampRailWidth, RAIL_MIN_WIDTH } from '../../src/client/view-mode.ts'

test('keeps the list between a sliver and a share of the page', () => {
  assert.equal(clampRailWidth(336, 1440), 336)
  // Nothing narrower than the minimum, however hard the pointer is pulled.
  assert.equal(clampRailWidth(40, 1440), RAIL_MIN_WIDTH)
  // On a wide page the absolute maximum binds first…
  assert.equal(clampRailWidth(2000, 1440), 760)
  // …and on a narrower one the diff's reserve binds before that.
  assert.equal(clampRailWidth(2000, 800), 380)
})

test('gives up the reserve rather than the minimum on a narrow window', () => {
  assert.equal(clampRailWidth(500, 500), RAIL_MIN_WIDTH)
  assert.equal(clampRailWidth(500, 300), RAIL_MIN_WIDTH)
})

test('rounds to whole pixels, so a drag cannot leave fractional widths behind', () => {
  assert.equal(clampRailWidth(336.4, 1440), 336)
  assert.equal(clampRailWidth(336.6, 1440), 337)
})
