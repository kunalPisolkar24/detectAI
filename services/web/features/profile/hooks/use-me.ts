"use client"

import { useQuery } from "@tanstack/react-query"

type MeResponse = {
  user: {
    id: string
    name: string
    email: string
    image: string | null
  }
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    staleTime: 60_000,
    queryFn: async (): Promise<MeResponse["user"]> => {
      const response = await fetch("/api/me")
      if (!response.ok) throw new Error("Unable to load profile")
      const data = (await response.json()) as MeResponse
      return data.user
    },
  })
}
