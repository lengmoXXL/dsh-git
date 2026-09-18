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

/**
 * Whether long lines wrap inside their half or run on, read by scrolling.
 * @returns the glyph for lines that turn.
 */
export function WrapGlyph(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
      <path d="M2.5 3.5h11M2.5 7.5h8a2 2 0 0 1 0 4H8" strokeLinecap="round" />
      <path d="M9.5 10l-1.5 1.5L9.5 13" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.5 13h3" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Opening a folded run: fifteen lines up, fifteen down, or all that is left. Each
 * carries its own size, as every glyph here does.
 * @returns the glyph for opening upward.
 */
export function ExpandUpGlyph(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
      <path d="M8 12.5V4" strokeLinecap="round" />
      <path d="M4.5 7.5L8 4l3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 14h10" strokeLinecap="round" />
    </svg>
  )
}

/** The same control, opening downward. */
export function ExpandDownGlyph(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
      <path d="M8 3.5V12" strokeLinecap="round" />
      <path d="M4.5 8.5L8 12l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 2h10" strokeLinecap="round" />
    </svg>
  )
}

/** The page's one way back: fold every run the reader has opened. */
export function FoldAllGlyph(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
      <path d="M3 2h10M3 14h10" strokeLinecap="round" />
      <path d="M8 4.5v7" strokeLinecap="round" />
      <path d="M5.5 7L8 9.5 10.5 7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 9L8 6.5 10.5 9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** The same control, opening the whole run. */
export function ExpandAllGlyph(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
      <path d="M8 12.5V3.5" strokeLinecap="round" />
      <path d="M4.5 7L8 3.5 11.5 7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 9L8 12.5 11.5 9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** The same button, for lines that keep their length. */
export function ClipGlyph(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
      <path d="M2.5 3.5h4M8.5 3.5h5M2.5 8h11M2.5 12.5h4M8.5 12.5h5" strokeLinecap="round" />
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
