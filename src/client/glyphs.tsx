/**
 * The glyph the guide draws for this plugin's entry.
 *
 * A guide entry's `icon` is a component, not an element, so the branch outline
 * is wrapped in something with the `IconProps` shape the guide renders.
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
