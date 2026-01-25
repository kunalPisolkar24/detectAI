import { MetricsService } from "../monitoring/MetricsService";
import { Logger } from "../logger";

export class WorkerServer {
    constructor(
        private readonly metricsService: MetricsService,
        private readonly port: number,
        private readonly healthCheck: () => boolean
    ) {}

    public start(): void {
        Bun.serve({
            port: this.port,
            fetch: async (req) => {
                const url = new URL(req.url);

                if (url.pathname === "/health") {
                    const isHealthy = this.healthCheck();
                    return new Response(
                        JSON.stringify({
                            status: isHealthy ? "ok" : "error",
                            timestamp: new Date().toISOString()
                        }),
                        {
                            status: isHealthy ? 200 : 503,
                            headers: { "Content-Type": "application/json" }
                        }
                    );
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
}