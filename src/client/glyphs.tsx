/**
 * The glyphs this plugin draws itself.
 *
 * The guide's entry takes a component rather than an element, so the branch
 * outline is wrapped in something with the `IconProps` shape. The two layout
 * glyphs are drawn here because the shared icon set has no split/inline pair:
 * the diff's view toggle is the one control whose icon has to say which layout
 * it offers, and borrowing an unrelated outline would say nothing.
 *
 * @module dsh-git/client/glyphs
 */

import type { ReactNode } from 'react'
import { IconBranchOutline16, type IconProps } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Draw the git glyph at the size the guide asks for.
 * @param props - the guide's icon seat: size and an optional class.
 * @returns the branch outline.
 */
export function GitGlyph({ size, className }: IconProps): ReactNode {
  return <IconBranchOutline16 size={size} className={className} />
}

/**
 * Open the file this diff is about in the shell's own file view: a page with an
 * arrow leaving it, which is the shape every editor uses for the same action.
 * @returns the glyph.
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
