"use client"

import { useQuery } from "@tanstack/react-query"
import { isPreviewModeClient } from "@/lib/config/preview"

/**
 * Polls the lightweight payment-gateway status endpoint. Preview always
 * reports available (payments are local-mock there).
 * 30s poll + focus/online refetch, single upstream probe per 15s via
 * server cache in /api/services/payment-gateway/status.
 */
export function usePaymentGatewayStatus() {
  const isPreview = isPreviewModeClient()

  const query = useQuery({
    queryKey: ["payment-gateway-status"],
    queryFn: async () => {
      const res = await fetch("/api/services/payment-gateway/status", { cache: "no-store" })
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
