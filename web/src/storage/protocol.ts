import type { SqlValue } from '@wordado/client-data'

/** In order of preference (spec §9.1). */
export const BACKENDS = ['opfs', 'idb', 'memory'] as const
export type Backend = (typeof BACKENDS)[number]

export type WorkerCall =
  | { readonly op: 'open'; readonly file: string; readonly backends: readonly Backend[] }
  | { readonly op: 'exec'; readonly sql: string }
  | { readonly op: 'run'; readonly sql: string; readonly params: readonly SqlValue[] }
  | { readonly op: 'all'; readonly sql: string; readonly params: readonly SqlValue[] }
  | { readonly op: 'close' }

export type WorkerRequest = WorkerCall & { readonly id: number }

export type WorkerResponse =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly id: number; readonly ok: false; readonly error: string }

export interface OpenResult {
  readonly backend: Backend
  /** Why each storage before it was skipped. */
  readonly failures: readonly string[]
}
