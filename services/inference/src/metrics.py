from prometheus_client import Counter, Histogram, Gauge

GRPC_REQUESTS_TOTAL = Counter(
    'grpc_requests_total',
    'Total number of gRPC requests',
    ['method', 'code', 'model']
)

GRPC_LATENCY_SECONDS = Histogram(
    'grpc_latency_seconds',
    'Request latency in seconds',
    ['method', 'model'],
    buckets=[0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1.0, 2.5, 5.0, 10.0]
)

BATCH_SIZE_DISTRIBUTION = Histogram(
    'model_batch_size',
    'Distribution of batch sizes processed',
    ['model'],
    buckets=[1, 2, 4, 8, 16, 32, 64]
)

BATCH_QUEUE_SIZE = Gauge(
    'model_batch_queue_size',
    'Current number of items waiting in the batch queue',
    ['model']
)

BATCH_PROCESSING_TIME = Histogram(
    'model_batch_processing_seconds',
    'Time taken to process the actual batch on hardware',
    ['model']
)

AI_CONFIDENCE_SCORE = Histogram(
    'model_ai_confidence_score',
    'Distribution of AI probability scores',
    ['model'],
    buckets=[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
)