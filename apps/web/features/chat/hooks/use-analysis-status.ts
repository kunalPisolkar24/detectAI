"use client"

import { useQuery } from "@tanstack/react-query"
import { isPreviewModeClient } from "@/lib/config/preview"

/**
 * Polls the lightweight analysis status endpoint. Preview always reports
 * available (analysis is mocked there). Combined inference + chat-service
 * probe — either down blocks the submit button (STOP still works).
 * 30s poll + focus/online refetch, single upstream pair per 15s via
 * server cache in /api/services/analysis/status.
 */
export function useAnalysisStatus() {
  const isPreview = isPreviewModeClient()

  const query = useQuery({
    queryKey: ["analysis-status"],
    queryFn: async () => {
      const res = await fetch("/api/services/analysis/status", { cache: "no-store" })
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

  return { isDown, isPreview }
}
