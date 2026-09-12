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
    const { registerShutdownHandlers } = await import("./lib/infrastructure/shutdown")
    await registerShutdownHandlers()
  }
}
