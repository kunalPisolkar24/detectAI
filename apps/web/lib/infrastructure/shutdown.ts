/**
 * Graceful shutdown and crash handlers for the Next.js server.
 *
 * Registered via Next.js instrumentation hook (see instrumentation.ts).
 * - SIGTERM/SIGINT: disconnect Prisma pools and quit Redis clients, then exit.
 * - unhandledRejection / uncaughtException: log and keep process alive where
 *   possible (Next.js will still crash on unhandled sync throws).
 *
 * Preview mode is a no-op (all clients are in-memory proxies).
 */
export async function registerShutdownHandlers(): Promise<void> {
  if (typeof process === "undefined") return
  // Avoid double-registration in dev HMR.
  const g = globalThis as unknown as { __detectai_shutdown_registered?: boolean }
  if (g.__detectai_shutdown_registered) return
  g.__detectai_shutdown_registered = true

  const shutdown = async (signal: string) => {
    console.log(JSON.stringify({ level: "info", msg: "Shutting down", signal }))
    try {
      const { prisma } = await import("@/lib/infrastructure/prisma")
      await prisma.$disconnect().catch(() => {})
    } catch {}

    try {
      const { redisWriter, redisReader } = await import("@/lib/infrastructure/redis")
      await Promise.allSettled([redisWriter.quit().catch(() => {}), redisReader.quit().catch(() => {})])
    } catch {}

    // usageRedis is an alias of redisWriter (redis-cache) — already quit above.

    // Let Next.js standalone server close; exit after a short grace.
    setTimeout(() => process.exit(0), 500).unref()
  }

  process.once("SIGTERM", () => void shutdown("SIGTERM"))
  process.once("SIGINT", () => void shutdown("SIGINT"))

  process.on("unhandledRejection", (reason) => {
    console.error(JSON.stringify({ level: "error", msg: "Unhandled Rejection", reason: reason instanceof Error ? reason.message : String(reason) }))
  })

  process.on("uncaughtException", (err) => {
    console.error(JSON.stringify({ level: "fatal", msg: "Uncaught Exception", error: err instanceof Error ? err.message : String(err) }))
  })
}
