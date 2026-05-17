import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from "prom-client";

export class MetricsService {
    private registry: Registry;
    public readonly jobDuration: Histogram;
    public readonly jobTotal: Counter;
    public readonly jobErrors: Counter;
    public readonly cacheOperations: Counter;
    public readonly activeWorkers: Gauge;
    public readonly domainOperationsVolume: Counter;
    public readonly rabbitmqConnectionStatus: Gauge;
    public readonly rabbitmqReconnections: Counter;
    public readonly redisConnectionStatus: Gauge;
    public readonly activeJobs: Gauge;
    public readonly messageSizeBytes: Histogram;
    public readonly deadLetteredTotal: Counter;
    public readonly dbPoolStatus: Gauge;

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

        this.rabbitmqConnectionStatus = new Gauge({
            name: "rabbitmq_connection_status",
            help: "Status of RabbitMQ connection (1 = connected, 0 = disconnected)",
            registers: [this.registry]
        });

        this.rabbitmqReconnections = new Counter({
            name: "rabbitmq_reconnections_total",
            help: "Total number of RabbitMQ reconnection attempts",
            registers: [this.registry]
        });

        this.redisConnectionStatus = new Gauge({
            name: "redis_connection_status",
            help: "Status of Redis connection (1 = connected, 0 = disconnected)",
            labelNames: ["client_name"],
            registers: [this.registry]
        });

        this.activeJobs = new Gauge({
            name: "worker_active_jobs",
            help: "Number of jobs currently being processed",
            labelNames: ["job_type"],
            registers: [this.registry]
        });

        this.messageSizeBytes = new Histogram({
            name: "worker_message_size_bytes",
            help: "Size of incoming messages in bytes",
            labelNames: ["job_type"],
            buckets: [128, 512, 1024, 4096, 16384, 65536, 262144],
            registers: [this.registry]
        });

        this.deadLetteredTotal = new Counter({
            name: "worker_dead_lettered_total",
            help: "Total number of messages sent to Dead Letter Queue",
            labelNames: ["job_type"],
            registers: [this.registry]
        });

        this.dbPoolStatus = new Gauge({
            name: "db_pool_connections",
            help: "Current status of database connection pool",
            labelNames: ["pool_name", "state"],
            registers: [this.registry]
        });
    }


    public async getMetrics(): Promise<string> {
        return this.registry.metrics();
    }

    public getContentType(): string {
        return this.registry.contentType;
    }

    public registerPool(name: string, pool: any): void {
        this.registry.registerMetric(new Gauge({
            name: `db_pool_${name}_connections`,
            help: `Connections in ${name} pool`,
            labelNames: ["state"],
            registers: [this.registry],
            collect: () => {
                this.dbPoolStatus.set({ pool_name: name, state: "total" }, pool.totalCount);
                this.dbPoolStatus.set({ pool_name: name, state: "idle" }, pool.idleCount);
                this.dbPoolStatus.set({ pool_name: name, state: "waiting" }, pool.waitingCount);
            }
        }));
    }
}