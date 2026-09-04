import { MetricsService } from "../monitoring/MetricsService";
import { Logger } from "../logging/Logger";

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

    private async withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<T>(resolve => { timeout = setTimeout(() => resolve(fallback), ms); });
        // Prevent unhandled rejection if promise rejects after race
        promise.catch(() => {});
        try {
            const result = await Promise.race([promise, timeoutPromise]);
            return result;
        } finally {
            if (timeout) clearTimeout(timeout);
        }
    }

    private normalizeHealthResult(result: HealthResult): { healthy: boolean; checks?: Record<string, unknown> } {
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
                            const raw = await this.withTimeout(Promise.resolve(this.healthCheck()), 3000, false);
                            const { healthy, checks } = this.normalizeHealthResult(raw as HealthResult);
                            return this.booleanResponse(healthy, "ok", "error", checks);
                        } catch (error) {
                            Logger.error("Health check failed", error);
                            return this.booleanResponse(false, "ok", "error", { error: String(error) });
                        }
                    }

                    if (url.pathname === "/ready") {
                        try {
                            const raw = await this.withTimeout(Promise.resolve(this.readyCheck()), 3000, { healthy: false, checks: { timeout: true } });
                            const { healthy, checks } = this.normalizeHealthResult(raw as HealthResult);
                            return this.booleanResponse(healthy, "ready", "not_ready", checks);
                        } catch (error) {
                            Logger.error("Ready check failed", error);
                            return this.booleanResponse(false, "ready", "not_ready", { error: String(error) });
                        }
                    }

                    if (url.pathname === "/metrics") {
                        try {
                            const metrics = await this.metricsService.getMetrics();
                            return new Response(metrics, {
                                headers: { "Content-Type": this.metricsService.getContentType() }
                            });
                        } catch (error) {
                            Logger.error("Failed to generate metrics", error);
                            return new Response("Internal Server Error", { status: 500 });
                        }
                    }

                    return new Response("Not Found", { status: 404 });
                }
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
            // Bun's stop is sync; give a brief pause for in-flight /metrics scrapes before closing
            this.server.stop();
        } catch (e: any) {
            Logger.warn(`Worker server stop error on port ${this.port}`, { error: e instanceof Error ? e.message : String(e) });
        }
        this.server = null;
        Logger.info(`Worker server on port ${this.port} stopped`);
    }

    private booleanResponse(healthy: boolean, positive: string, negative: string, checks?: Record<string, unknown>): Response {
        const body: Record<string, unknown> = {
            status: healthy ? positive : negative,
            timestamp: new Date().toISOString()
        };
        if (checks && Object.keys(checks).length > 0) body.checks = checks;
        return new Response(
            JSON.stringify(body),
            {
                status: healthy ? 200 : 503,
                headers: { "Content-Type": "application/json" }
            }
        );
    }
}
