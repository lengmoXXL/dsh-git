/**
 * The glyph this plugin draws itself.
 *
 * @module dsh-git/client/glyphs
 */

import type { ReactNode } from 'react'

/**
 * Which layout the diff is drawn in: two aligned columns, or one column in reading
 * order. The button offers the other one, and its icon is the one in force, so the
 * reader sees the state rather than working it out from two labels.
 */
export function SplitLayoutGlyph(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
      <rect x="1.5" y="2.75" width="13" height="10.5" rx="2" />
      <path d="M8 2.75v10.5" />
    </svg>
  )
}

/** The same button, for the one-column reading. */
export function InlineLayoutGlyph(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
      <rect x="1.5" y="2.75" width="13" height="10.5" rx="2" />
      <path d="M4 6h8M4 8.5h8M4 11h5" />
    </svg>
  )
}

/**
 * Open the file this diff is about in the shell's own file view: a page with an
 * arrow leaving it, which is the shape every editor uses for the same action.
 */
export function OpenFileGlyph(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
      <path d="M2.5 1.5h3.4L8.5 4.1v6.4h-6z" />
      <path d="M5.9 1.5v2.6h2.6" />
      <path d="M8.6 7.4h3M10.4 6l1.4 1.4-1.4 1.4" strokeLinecap="round" />
    </svg>
  )
}
