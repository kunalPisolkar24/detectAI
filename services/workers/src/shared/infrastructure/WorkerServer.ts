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
        try {
            const result = await Promise.race([promise, timeoutPromise]);
            return result;
        } finally {
            if (timeout) clearTimeout(timeout);
        }
    }

    private normalizeHealthResult(result: HealthResult): { healthy: boolean; checks?: Record<string, unknown> } {
        if (typeof result === "boolean") return { healthy: result };
        return result;
    }

    public start(): void {
        this.server = Bun.serve({
            port: this.port,
            fetch: async (req) => {
                const url = new URL(req.url);

                if (url.pathname === "/health") {
                    const raw = await this.withTimeout(Promise.resolve(this.healthCheck()), 3000, false);
                    const { healthy, checks } = this.normalizeHealthResult(raw as HealthResult);
                    return this.booleanResponse(healthy, "ok", "error", checks);
                }

                if (url.pathname === "/ready") {
                    const raw = await this.withTimeout(Promise.resolve(this.readyCheck()), 3000, { healthy: false, checks: { timeout: true } });
                    const { healthy, checks } = this.normalizeHealthResult(raw as HealthResult);
                    return this.booleanResponse(healthy, "ready", "not_ready", checks);
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

        Logger.info(`Worker server listening on port ${this.port}`);
    }

    public stop(): void {
        if (!this.server) return;
        this.server.stop();
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
