/**
 * Build-time substitutions the client bundle is compiled with.
 *
 * The token is replaced by `tsdown.config.ts` with the moment the bundle was
 * built. It is a diagnostic, not a feature: a page can be running an older
 * bundle while the diff's *content* — which the host reads fresh — is current,
 * and then new content is drawn by old layout. Reading the stamp off the view
 * settles which build a page is running without guessing.
 *
 */

/** ISO timestamp of the build that produced the bundle. */
declare const __DSH_GIT_BUILD__: string
