export async function register() {
  // Server-only: instrumentation hook runs once on Next.js boot.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerShutdownHandlers } = await import("./lib/infrastructure/shutdown")
    await registerShutdownHandlers()
  }
}
