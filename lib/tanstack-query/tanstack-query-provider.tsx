"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ReactNode, useState } from "react"

// Tuned defaults based on P1 audit:
//  - staleTime: 5 min — prevents refetching the same data on every focus / mount.
//    Most app data (chat list, machines, billing) is safe to consider fresh for
//    a few minutes; explicit invalidations (e.g. after a mutation) still bypass.
//  - gcTime:    10 min — keeps recently-unmounted query data hot for back/forward
//    navigation without re-querying.
//  - refetchOnWindowFocus: false — we already revalidate on mutation; window-focus
//    refetches were a major source of redundant Supabase round-trips.
//  - retry: 1 — most transient failures (network blip) recover; we don't want
//    aggressive retries hammering an already-degraded backend.
const DEFAULT_STALE_TIME_MS = 5 * 60 * 1000
const DEFAULT_GC_TIME_MS = 10 * 60 * 1000

export function TanstackQueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: DEFAULT_STALE_TIME_MS,
            gcTime: DEFAULT_GC_TIME_MS,
            refetchOnWindowFocus: false,
            retry: 1,
          },
          mutations: {
            retry: 0,
          },
        },
      })
  )
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}
