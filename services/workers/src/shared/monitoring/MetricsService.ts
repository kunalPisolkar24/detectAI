import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from "prom-client";

export class MetricsService {
    private registry: Registry;
    public readonly jobDuration: Histogram;
    public readonly jobTotal: Counter;
    public readonly jobErrors: Counter;
    public readonly cacheOperations: Counter;
    public readonly activeWorkers: Gauge;
    public readonly domainOperationsVolume: Counter;


    constructor(private readonly serviceName: string) {
        this.registry = new Registry();
        this.registry.setDefaultLabels({ service: serviceName });
        
        collectDefaultMetrics({ register: this.registry });

        this.jobDuration = new Histogram({
            name: "worker_job_duration_seconds",
            help: "Duration of worker jobs in seconds",
            labelNames: ["job_type", "status"],
            buckets: [0.1, 0.5, 1, 2, 5, 10],
            registers: [this.registry]
        });

        this.jobTotal = new Counter({
            name: "worker_jobs_processed_total",
            help: "Total number of jobs processed",
            labelNames: ["job_type"],
            registers: [this.registry]
        });

        this.jobErrors = new Counter({
            name: "worker_job_errors_total",
            help: "Total number of failed jobs",
            labelNames: ["job_type", "error_type"],
            registers: [this.registry]
        });

        this.cacheOperations = new Counter({
            name: "cache_operations_total",
            help: "Total cache hits and misses",
            labelNames: ["operation", "cache_type"],
            registers: [this.registry]
        });

        this.activeWorkers = new Gauge({
            name: "worker_active_instances",
            help: "Number of active worker instances",
            registers: [this.registry]
        });

        this.domainOperationsVolume = new Counter({
            name: "worker_domain_operations_volume_total",
            help: "Total volume or monetary value of domain operations",
            labelNames: ["operation_type"],
            registers: [this.registry]
        });
    }


    public async getMetrics(): Promise<string> {
        return this.registry.metrics();
    }

    public getContentType(): string {
        return this.registry.contentType;
    }
}