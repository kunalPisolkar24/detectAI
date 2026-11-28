type ConnectErrorPayload = {
  code?: string
  message?: string
}

export class ConnectError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "ConnectError"
  }
}

export type ConnectClient = {
  call<T>(procedure: string, body: object, headers?: Record<string, string>): Promise<T>
}

export function createConnectClient({
  baseUrl,
  headers = {},
}: {
  baseUrl: string
  headers?: Record<string, string>
}): ConnectClient {
  const root = baseUrl.replace(/\/$/, "")

  return {
    async call<T>(
      procedure: string,
      body: object,
      extraHeaders: Record<string, string> = {},
    ): Promise<T> {
      const response = await fetch(`${root}${procedure}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Connect-Protocol-Version": "1",
          ...headers,
          ...extraHeaders,
        },
        body: JSON.stringify(body),
        cache: "no-store",
      })

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as ConnectErrorPayload | null
        throw new ConnectError(
          payload?.code ?? "unknown",
          payload?.message ?? `service returned ${response.status}`,
          response.status,
        )
      }

      return (await response.json()) as T
    },
  }
}
