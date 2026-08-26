import { MetricsService } from "../monitoring/MetricsService";
import { Logger } from "../logging/Logger";

export class WorkerServer {
    private server: ReturnType<typeof Bun.serve> | null = null;

    constructor(
        private readonly metricsService: MetricsService,
        private readonly port: number,
        private readonly healthCheck: () => boolean,
        private readonly readyCheck: () => boolean | Promise<boolean> = healthCheck
    ) {}

    public start(): void {
        this.server = Bun.serve({
            port: this.port,
            fetch: async (req) => {
                const url = new URL(req.url);

                if (url.pathname === "/health") {
                    return this.booleanResponse(this.healthCheck(), "ok", "error");
                }

                if (url.pathname === "/ready") {
                    return this.booleanResponse(await this.readyCheck(), "ready", "not_ready");
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

    private booleanResponse(healthy: boolean, positive: string, negative: string): Response {
        return new Response(
            JSON.stringify({
                status: healthy ? positive : negative,
                timestamp: new Date().toISOString()
            }),
            {
                status: healthy ? 200 : 503,
                headers: { "Content-Type": "application/json" }
            }
        );
    }
}
