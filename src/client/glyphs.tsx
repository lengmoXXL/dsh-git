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
 * Draw the two-column layout: a frame divided down the middle.
 * @param props - the size and an optional class.
 * @returns the split outline.
 */
export function SplitLayoutGlyph({ size = 16, className }: IconProps): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      className={className}
      aria-hidden="true"
    >
      <rect x="1.5" y="2.75" width="13" height="10.5" rx="2" />
      <path d="M8 2.75v10.5" />
    </svg>
  )
}

/**
 * Draw the one-column layout: a frame holding stacked lines, the way a unified
 * diff reads.
 * @param props - the size and an optional class.
 * @returns the inline outline.
 */
export function InlineLayoutGlyph({ size = 16, className }: IconProps): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      className={className}
      aria-hidden="true"
    >
      <rect x="1.5" y="2.75" width="13" height="10.5" rx="2" />
      <path d="M4 6h8M4 8.5h8M4 11h5" />
    </svg>
  )
}

/**
 * Draw a line that turns back on itself: what a long line does when it wraps.
 * @param props - the size and an optional class.
 * @returns the wrap outline.
 */
export function WrapLinesGlyph({ size = 16, className }: IconProps): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M2.5 4.5h9" />
      <path d="M2.5 8h6.75a2.75 2.75 0 0 1 0 5.5H6.75" />
      <path d="M8.75 11.5 6.75 13.5l2 2" />
    </svg>
  )
}

/**
 * Draw lines that run off the right edge: what a long line does when it is left
 * to scroll.
 * @param props - the size and an optional class.
 * @returns the unwrapped outline.
 */
export function ClipLinesGlyph({ size = 16, className }: IconProps): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M2.5 5h11" />
      <path d="M2.5 8h9" />
      <path d="M13.5 8 11.25 5.9M13.5 8 11.25 10.1" />
      <path d="M2.5 11h11" />
    </svg>
  )
}
