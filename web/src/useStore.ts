import type { Store } from '@wordado/client-data'
import { useSyncExternalStore } from 'react'

/** Subscribes a component to one of client-data's stores. */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}
