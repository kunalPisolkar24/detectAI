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
    public readonly unhandledEventsTotal: Counter;
    public readonly dbPoolStatus: Gauge;
    public readonly expiryLagSeconds: Gauge;
    public readonly expiredBacklog: Gauge;
    public readonly sweepBatchSize: Histogram;
    public readonly staleEventsFilteredTotal: Counter;
    public readonly workerDuplicateEventsTotal: Counter;
    public readonly workerIdempotencyRedisErrorsTotal: Counter;
    public readonly cacheInvalidateDurationSeconds: Histogram;
    public readonly cacheInvalidateRetriesTotal: Counter;
    public readonly dbTransactionDurationSeconds: Histogram;
    public readonly dbLockSkippedTotal: Counter;
    public readonly shutdownAbortsTotal: Counter;
    public readonly loopIterationsTotal: Counter;
    public readonly jitterSeconds: Histogram;
    public readonly subscriptionStatus: Gauge;
    public readonly cronConfig: Gauge;

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

        this.unhandledEventsTotal = new Counter({
            name: "worker_unhandled_events_total",
            help: "Events received with no registered handler",
            labelNames: ["event_type"],
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

        this.expiryLagSeconds = new Gauge({
            name: "worker_cron_expiry_lag_seconds",
            help: "Max lag in seconds between sweepTime and oldest expired endsAt (SLO)",
            registers: [this.registry]
        });

        this.expiredBacklog = new Gauge({
            name: "worker_cron_expired_backlog",
            help: "Number of expired subscriptions pending sweep (backlog)",
            registers: [this.registry]
        });

        this.sweepBatchSize = new Histogram({
            name: "worker_cron_sweep_batch_size",
            help: "Batch size during cron sweep (selected vs updated)",
            labelNames: ["stage"],
            buckets: [10, 50, 100, 250, 500],
            registers: [this.registry]
        });

        this.staleEventsFilteredTotal = new Counter({
            name: "worker_cron_stale_events_filtered_total",
            help: "Total phantom/stale events filtered during sweep",
            labelNames: ["reason"],
            registers: [this.registry]
        });

        this.workerDuplicateEventsTotal = new Counter({
            name: "worker_duplicate_events_total",
            help: "Total duplicate Paddle events filtered by event_id dedup",
            labelNames: ["event_type"],
            registers: [this.registry]
        });

        this.workerIdempotencyRedisErrorsTotal = new Counter({
            name: "worker_idempotency_redis_errors_total",
            help: "Total idempotency Redis errors (fallback to DB)",
            registers: [this.registry]
        });

        this.cacheInvalidateDurationSeconds = new Histogram({
            name: "worker_cron_cache_invalidate_duration_seconds",
            help: "Duration of cache invalidation (per attempt) for cron sweep",
            labelNames: ["attempt"],
            buckets: [0.01, 0.05, 0.1, 0.5, 1],
            registers: [this.registry]
        });

        this.cacheInvalidateRetriesTotal = new Counter({
            name: "worker_cron_cache_invalidate_retries_total",
            help: "Total cache invalidation retries for cron sweep",
            registers: [this.registry]
        });

        this.dbTransactionDurationSeconds = new Histogram({
            name: "worker_cron_db_transaction_duration_seconds",
            help: "Duration of cron DB transaction (expireDueSubscriptions)",
            labelNames: ["result"],
            buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
            registers: [this.registry]
        });

        this.dbLockSkippedTotal = new Counter({
            name: "worker_cron_db_lock_skipped_total",
            help: "Total SKIP LOCKED rows skipped during sweep (lock contention)",
            registers: [this.registry]
        });

        this.shutdownAbortsTotal = new Counter({
            name: "worker_cron_shutdown_aborts_total",
            help: "Total shutdown aborts (sleep_aborted, job_grace_timeout)",
            labelNames: ["reason"],
            registers: [this.registry]
        });

        this.loopIterationsTotal = new Counter({
            name: "worker_cron_loop_iterations_total",
            help: "Total cron loop iterations by result (success, empty, error)",
            labelNames: ["result"],
            registers: [this.registry]
        });

        this.jitterSeconds = new Histogram({
            name: "worker_cron_jitter_seconds",
            help: "Sleep duration with jitter for cron loop (seconds, tight-bucketed around 900s interval)",
            buckets: [1, 10, 60, 300, 700, 800, 850, 900, 950, 1000, 1100],
            registers: [this.registry]
        });

        this.subscriptionStatus = new Gauge({
            name: "worker_cron_subscription_status",
            help: "Subscription status distribution (group by status before sweep)",
            labelNames: ["status"],
            registers: [this.registry]
        });

        this.cronConfig = new Gauge({
            name: "worker_cron_config",
            help: "Cron config values (check_interval_ms, batch_size) for drift detection",
            labelNames: ["param"],
            registers: [this.registry]
        });
    }


    public async getMetrics(): Promise<string> {
        return this.registry.metrics();
    }

    public getContentType(): string {
        return this.registry.contentType;
    }

    public registerPool(name: string, pool: Pick<import("pg").Pool, "totalCount" | "idleCount" | "waitingCount">): void {
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