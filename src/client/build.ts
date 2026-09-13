/**
 * Which build this bundle is.
 *
 * @module dsh-git/client/build
 */

/** ISO timestamp of the build that produced this bundle, or `dev` outside one. */
export const BUILD_STAMP: string =
  typeof __DSH_GIT_BUILD__ === 'string' ? __DSH_GIT_BUILD__ : 'dev'
