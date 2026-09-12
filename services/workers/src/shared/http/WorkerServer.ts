import { MetricsService } from "../monitoring/MetricsService";
import { Logger } from "../logging/Logger";
import { withTimeout } from "../utils/withTimeout";

type HealthResult = boolean | { healthy: boolean; checks?: Record<string, unknown> };
type HealthCheck = () => HealthResult | Promise<HealthResult>;

export class WorkerServer {
  private server: ReturnType<typeof Bun.serve> | null = null;

  constructor(
    private readonly metricsService: MetricsService,
    private readonly port: number,
    private readonly healthCheck: HealthCheck,
    private readonly readyCheck: HealthCheck = healthCheck
  ) {}

  private normalize(result: HealthResult): { healthy: boolean; checks?: Record<string, unknown> } {
    if (typeof result === "boolean") return { healthy: result };
    if (!result || typeof result !== "object" || typeof (result as any).healthy !== "boolean") {
      return { healthy: false, checks: { invalid: true } };
    }
    return result as { healthy: boolean; checks?: Record<string, unknown> };
  }

  public start(): void {
    try {
      this.server = Bun.serve({
        port: this.port,
        fetch: async (req) => {
          const url = new URL(req.url);
          if (url.pathname === "/health") {
            try {
              const raw = await withTimeout(Promise.resolve(this.healthCheck()), 3000, false);
              const { healthy, checks } = this.normalize(raw as HealthResult);
              return this.jsonResponse(healthy, "ok", "error", checks);
            } catch (error) {
              Logger.error("Health check failed", error);
              return this.jsonResponse(false, "ok", "error", { error: String(error) });
            }
          }
          if (url.pathname === "/ready") {
            try {
              const raw = await withTimeout(Promise.resolve(this.readyCheck()), 3000, { healthy: false, checks: { timeout: true } });
              const { healthy, checks } = this.normalize(raw as HealthResult);
              return this.jsonResponse(healthy, "ready", "not_ready", checks);
            } catch (error) {
              Logger.error("Ready check failed", error);
              return this.jsonResponse(false, "ready", "not_ready", { error: String(error) });
            }
          }
          if (url.pathname === "/metrics") {
            try {
              const metrics = await this.metricsService.getMetrics();
              return new Response(metrics, { headers: { "Content-Type": this.metricsService.getContentType() } });
            } catch (error) {
              Logger.error("Failed to generate metrics", error);
              return new Response("Internal Server Error", { status: 500 });
            }
          }
          return new Response("Not Found", { status: 404 });
        },
      });
    } catch (error: any) {
      if (String(error?.message ?? "").includes("EADDRINUSE")) {
        Logger.error(`Worker server port ${this.port} already in use`, error);
        throw error;
      }
      throw error;
    }
    Logger.info(`Worker server listening on port ${this.port}`);
  }

  public stop(): void {
    if (!this.server) return;
    try {
      this.server.stop();
    } catch (e: any) {
      Logger.warn(`Worker server stop error on port ${this.port}`, { error: e instanceof Error ? e.message : String(e) });
    }
    this.server = null;
    Logger.info(`Worker server on port ${this.port} stopped`);
  }

  private jsonResponse(healthy: boolean, positive: string, negative: string, checks?: Record<string, unknown>): Response {
    const body: Record<string, unknown> = { status: healthy ? positive : negative, timestamp: new Date().toISOString() };
    if (checks && Object.keys(checks).length > 0) body.checks = checks;
    return new Response(JSON.stringify(body), { status: healthy ? 200 : 503, headers: { "Content-Type": "application/json" } });
  }
}
