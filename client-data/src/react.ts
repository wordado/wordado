import { createContext, createElement, useContext, useSyncExternalStore, type ReactNode } from 'react'
import type { Client, ClientSnapshot } from './client'

const ClientContext = createContext<Client | null>(null)

export function ClientProvider(props: { readonly client: Client; readonly children?: ReactNode }) {
  return createElement(ClientContext.Provider, { value: props.client }, props.children)
}

export function useClient(): Client {
  const client = useContext(ClientContext)
  if (!client) throw new Error('useClient must be used inside a ClientProvider')
  return client
}

/** The whole snapshot; re-renders on every change. The narrower hooks below are the usual choice. */
export function useClientSnapshot(): ClientSnapshot {
  const { store } = useClient()
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

export function useSessionPlan(): ClientSnapshot['plan'] {
  return useClientSnapshot().plan
}

export function useProgress(): ClientSnapshot['progress'] {
  return useClientSnapshot().progress
}

export function useSettings(): ClientSnapshot['settings'] {
  return useClientSnapshot().settings
}

export function useSyncStatus(): ClientSnapshot['sync'] {
  return useClientSnapshot().sync
}
