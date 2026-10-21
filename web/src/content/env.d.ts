interface ImportMetaEnv {
  /** The CDN's manifest for signed-in learners (plan 7). Unset in development and the end-to-end runs. */
  readonly VITE_CONTENT_MANIFEST_URL?: string
  /** The manifest a visitor without an account installs from; the bundled sample when unset. */
  readonly VITE_TRIAL_MANIFEST_URL?: string
  /** The courses besides English this build offers, comma-separated targets (`de`); English is always offered. */
  readonly VITE_COURSE_TARGETS?: string
}
