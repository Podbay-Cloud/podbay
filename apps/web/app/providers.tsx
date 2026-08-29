"use client";

import { QueryClient, QueryClientProvider, isServer } from "@tanstack/react-query";

/**
 * The web app's data layer (web-data-layer-react-query). Client-only react-query — cache +
 * stale-while-revalidate + bounded retry + polling — so no component hand-rolls a fetch that can get
 * stuck on "Loading…" or clobber good data to "unknown" on a tab switch. See
 * `.claude/rules/ui-patterns.md` (reuse `useQuery`, never a raw useEffect+useState(null) fetch).
 *
 * SSR-safe singleton per the official TanStack Query Next.js guide: a fresh QueryClient per request on
 * the server (never shared across requests), a lazily-created singleton in the browser (so a Suspense
 * suspend during initial render doesn't drop the client).
 */
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Re-navigation within staleTime doesn't even refetch → instant. Beyond it, the cache still
        // paints instantly then refetches in the background (stale window ~1s) — snappy AND
        // near-realtime, never silently minute-old.
        staleTime: 5_000,
        gcTime: 5 * 60_000,
        retry: 2, // bounded — a failed fetch retries then errors, never sticks on loading
        refetchOnWindowFocus: true, // cheap near-realtime nudge when you return to the tab
        // Interval polling pauses while the tab is hidden (default) — fixes the "always-poll" cost.
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (isServer) return makeQueryClient(); // always a fresh client on the server
  // Browser: make it once. (Guard against React suspending before the first render completes.)
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // NB: not useState — getQueryClient already returns the correct instance per environment.
  const queryClient = getQueryClient();
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
