export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initConfig } = await import("./lib/config/provider")
    try {
      await initConfig()
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "fatal",
          msg: "Failed to initialize config",
          error: err instanceof Error ? err.message : String(err),
        }),
      )
      if (process.env.ENV_TYPE === "prod") throw err
    }
    try {
      const { initTracing } = await import("./lib/infrastructure/tracing")
      await initTracing("web")
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          msg: "Failed to initialize tracing",
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    }
    const { registerShutdownHandlers } = await import("./lib/infrastructure/shutdown")
    await registerShutdownHandlers()
  }
}
