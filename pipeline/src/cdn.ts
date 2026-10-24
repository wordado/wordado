import type { Target } from '@wordado/core'

/** Where a corpus is served on the CDN (spec §5.5), beside English's. */
export interface CdnLayout {
  readonly target: Target
  /** The folder its release is uploaded to: '' for English (the bucket's root), the target code otherwise. */
  readonly dir: string
  /** The URL its manifest is served at; every other file of the release is relative to it. */
  readonly manifestUrl: string
}

/**
 * English's manifest is the one the deploy names (`CONTENT_MANIFEST_URL`); another target's sits in a folder named
 * after it, beside English's. The learner app asks for the same URL (`targetManifestUrl`, web/src/content/packs.ts):
 * the two must agree, or the app finds no German course.
 */
export function cdnLayout(target: Target, englishManifestUrl: string): CdnLayout {
  if (target === 'en') return { target, dir: '', manifestUrl: englishManifestUrl }
  const slash = englishManifestUrl.lastIndexOf('/')
  return { target, dir: target, manifestUrl: `${englishManifestUrl.slice(0, slash + 1)}${target}/${englishManifestUrl.slice(slash + 1)}` }
}

/** The layout as `NAME=value` lines, for a workflow's `$GITHUB_ENV`. */
export function cdnEnv(layout: CdnLayout): string {
  return `CDN_TARGET=${layout.target}\nCDN_DIR=${layout.dir}\nCDN_MANIFEST_URL=${layout.manifestUrl}\n`
}
