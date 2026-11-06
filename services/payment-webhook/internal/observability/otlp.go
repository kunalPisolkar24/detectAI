package observability

// otlp is pure New Relic shaping, no SDK: the three signal paths (/v1/traces,
// /v1/metrics, /v1/logs) off the base endpoint and the api-key header carrying
// the ingest license key — never a user key. Skeleton: lands with the OTel SDK
// wiring.
