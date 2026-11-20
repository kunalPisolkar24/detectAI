"use client"

import { useQuery } from "@tanstack/react-query"
import { isPreviewModeClient } from "@/lib/config/preview"

/**
 * Polls the lightweight parser status endpoint. Preview always reports
 * available (preview disables the button for its own reason).
 * 30s poll + focus/online refetch, single upstream probe per 15s via
 * server cache in /api/services/document-parser/status.
 */
export function useDocumentParserStatus() {
  const isPreview = isPreviewModeClient()

  const query = useQuery({
    queryKey: ["document-parser-status"],
    queryFn: async () => {
      const res = await fetch("/api/services/document-parser/status", { cache: "no-store" })
      if (!res.ok) throw new Error(`status ${res.status}`)
      return (await res.json()) as { status: "ok" | "skipped" | "error" }
    },
    enabled: !isPreview,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 1,
    staleTime: 10_000,
  })

  const isDown = !isPreview && query.data?.status === "error"
  // While loading, don't disable — avoid flicker on first mount.
  const isLoading = !isPreview && query.isLoading && !query.data

  return { isDown, isLoading, isPreview }
}
