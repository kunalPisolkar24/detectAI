#!/usr/bin/env node

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardsRoot = path.resolve(__dirname, "../dashboards");
const datasource = {
  type: "prometheus",
  uid: "prometheus",
};

const appJobs = "frontend|worker-analytics|worker-cron|worker-payments|inference|chat-service|chat-worker|document-parser|payment-gateway";
const infraJobs = "cadvisor|node|postgres-primary|postgres-replica|rabbitmq|redis-.*|mongodb";
const httpJobs = "frontend|document-parser|payment-gateway";
const workerJobs = "worker-analytics|worker-cron|worker-payments";
const cadvisorServiceFilter = 'job="cadvisor",container_label_com_docker_compose_service!="",id!="/"';
const nodeDeviceFilter = 'job="node",device!~"lo|docker0|br-.*|veth.*"';

let panelId = 1;

const availabilityThresholds = {
  mode: "absolute",
  steps: [
    { color: "red", value: 0 },
    { color: "orange", value: 90 },
    { color: "green", value: 99 },
  ],
};

const saturationThresholds = {
  mode: "absolute",
  steps: [
    { color: "green", value: 0 },
    { color: "orange", value: 70 },
    { color: "red", value: 85 },
  ],
};

function resetPanelIds() {
  panelId = 1;
}

function nextPanelId() {
  const value = panelId;
  panelId += 1;
  return value;
}

function query(expr, legendFormat = "", refId = "A") {
  return {
    editorMode: "code",
    expr,
    legendFormat,
    range: true,
    refId,
  };
}

function thresholds(mode, steps) {
  return { mode, steps };
}

function timeseries({
  title,
  gridPos,
  targets,
  unit,
  legendMode = "table",
  tooltipMode = "multi",
  min,
  max,
  thresholds: panelThresholds,
}) {
  const defaults = {
    color: {
      mode: "palette-classic",
    },
    mappings: [],
  };

  if (unit) {
    defaults.unit = unit;
  }
  if (min !== undefined) {
    defaults.min = min;
  }
  if (max !== undefined) {
    defaults.max = max;
  }
  if (panelThresholds) {
    defaults.thresholds = panelThresholds;
  }

  return {
    datasource,
    fieldConfig: {
      defaults,
      overrides: [],
    },
    gridPos,
    id: nextPanelId(),
    options: {
      legend: {
        displayMode: legendMode,
        placement: "bottom",
        showLegend: true,
      },
      tooltip: {
        mode: tooltipMode,
        sort: "desc",
      },
    },
    targets,
    title,
    type: "timeseries",
  };
}

function stat({
  title,
  expr,
  gridPos,
  unit = "short",
  decimals = 0,
  min,
  max,
  panelThresholds = saturationThresholds,
}) {
  const defaults = {
    color: {
      mode: "thresholds",
    },
    decimals,
    mappings: [],
    thresholds: panelThresholds,
    unit,
  };

  if (min !== undefined) {
    defaults.min = min;
  }
  if (max !== undefined) {
    defaults.max = max;
  }

  return {
    datasource,
    fieldConfig: {
      defaults,
      overrides: [],
    },
    gridPos,
    id: nextPanelId(),
    options: {
      colorMode: "value",
      graphMode: "none",
      justifyMode: "auto",
      orientation: "auto",
      reduceOptions: {
        calcs: ["lastNotNull"],
        fields: "",
        values: false,
      },
      textMode: "auto",
    },
    targets: [query(expr)],
    title,
    type: "stat",
  };
}

function dashboard({ title, uid, tags, panels }) {
  return {
    annotations: {
      list: [
        {
          builtIn: 1,
          datasource: {
            type: "grafana",
            uid: "-- Grafana --",
          },
          enable: true,
          hide: true,
          iconColor: "rgba(0, 211, 255, 1)",
          name: "Annotations & Alerts",
          type: "dashboard",
        },
      ],
    },
    editable: true,
    fiscalYearStartMonth: 0,
    graphTooltip: 0,
    id: null,
    links: [],
    panels,
    refresh: "30s",
    schemaVersion: 39,
    style: "dark",
    tags,
    templating: {
      list: [],
    },
    time: {
      from: "now-6h",
      to: "now",
    },
    timepicker: {},
    timezone: "browser",
    title,
    uid,
    version: 1,
    weekStart: "",
  };
}

function buildPlatformOverview() {
  resetPanelIds();

  return dashboard({
    title: "Detect AI Platform Overview",
    uid: "detect-ai-platform-overview",
    tags: ["detect-ai", "overview", "platform"],
    panels: [
      stat({
        title: "App Availability",
        expr: `100 * avg(up{job=~"${appJobs}"})`,
        gridPos: { h: 4, w: 6, x: 0, y: 0 },
        unit: "percent",
        decimals: 1,
        min: 0,
        max: 100,
        panelThresholds: availabilityThresholds,
      }),
      stat({
        title: "Infra Availability",
        expr: `100 * avg(up{job=~"${infraJobs}"})`,
        gridPos: { h: 4, w: 6, x: 6, y: 0 },
        unit: "percent",
        decimals: 1,
        min: 0,
        max: 100,
        panelThresholds: availabilityThresholds,
      }),
      stat({
        title: "Host CPU Busy",
        expr: '100 - (avg(rate(node_cpu_seconds_total{job="node",mode="idle"}[5m])) * 100)',
        gridPos: { h: 4, w: 6, x: 12, y: 0 },
        unit: "percent",
        decimals: 1,
        min: 0,
        max: 100,
      }),
      stat({
        title: "Host Memory Used",
        expr: '100 * (1 - (node_memory_MemAvailable_bytes{job="node"} / node_memory_MemTotal_bytes{job="node"}))',
        gridPos: { h: 4, w: 6, x: 18, y: 0 },
        unit: "percent",
        decimals: 1,
        min: 0,
        max: 100,
      }),
      timeseries({
        title: "Service Availability",
        gridPos: { h: 8, w: 12, x: 0, y: 4 },
        targets: [
          query(`up{job=~"${appJobs}"}`, "{{job}}"),
        ],
        legendMode: "list",
        tooltipMode: "single",
        thresholds: thresholds("absolute", [
          { color: "red", value: 0 },
          { color: "green", value: 1 },
        ]),
      }),
      timeseries({
        title: "HTTP Request Rate",
        gridPos: { h: 8, w: 12, x: 12, y: 4 },
        targets: [
          query(
            `sum(rate(http_request_duration_seconds_count{job=~"${httpJobs}"}[5m])) by (job)`,
            "{{job}}"
          ),
        ],
        unit: "reqps",
      }),
      timeseries({
        title: "HTTP p95 Latency",
        gridPos: { h: 8, w: 12, x: 0, y: 12 },
        targets: [
          query(
            `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{job=~"${httpJobs}"}[5m])) by (job, le))`,
            "{{job}}"
          ),
        ],
        unit: "s",
      }),
      timeseries({
        title: "Worker Throughput",
        gridPos: { h: 8, w: 12, x: 12, y: 12 },
        targets: [
          query(
            "sum(rate(worker_jobs_processed_total[5m])) by (service, job_type)",
            "{{service}} {{job_type}}"
          ),
        ],
        unit: "ops",
      }),
      timeseries({
        title: "RabbitMQ Queue Depth",
        gridPos: { h: 8, w: 12, x: 0, y: 20 },
        targets: [
          query("sum(rabbitmq_queue_messages_ready) by (queue)", "{{queue}}"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Top Container CPU Usage",
        gridPos: { h: 8, w: 12, x: 12, y: 20 },
        targets: [
          query(
            `topk(10, 100 * sum by (container_label_com_docker_compose_service) (rate(container_cpu_usage_seconds_total{${cadvisorServiceFilter}}[5m])))`,
            "{{container_label_com_docker_compose_service}}"
          ),
        ],
        unit: "percent",
      }),
      timeseries({
        title: "Top Container Memory Usage",
        gridPos: { h: 8, w: 12, x: 0, y: 28 },
        targets: [
          query(
            `topk(10, sum by (container_label_com_docker_compose_service) (container_memory_working_set_bytes{${cadvisorServiceFilter}}))`,
            "{{container_label_com_docker_compose_service}}"
          ),
        ],
        unit: "bytes",
      }),
      timeseries({
        title: "Inference Batch Queue Size",
        gridPos: { h: 8, w: 12, x: 12, y: 28 },
        targets: [
          query("sum(model_batch_queue_size{job=\"inference\"}) by (model)", "{{model}}"),
        ],
        unit: "short",
      }),
    ],
  });
}

function buildServiceOverview() {
  resetPanelIds();

  return dashboard({
    title: "Detect AI Service Overview",
    uid: "detect-ai-app-overview",
    tags: ["detect-ai", "overview", "services"],
    panels: [
      timeseries({
        title: "Service Availability",
        gridPos: { h: 8, w: 12, x: 0, y: 0 },
        targets: [
          query(`up{job=~"${appJobs}"}`, "{{job}}"),
        ],
        legendMode: "list",
        tooltipMode: "single",
        thresholds: thresholds("absolute", [
          { color: "red", value: 0 },
          { color: "green", value: 1 },
        ]),
      }),
      timeseries({
        title: "HTTP Request Rate",
        gridPos: { h: 8, w: 12, x: 12, y: 0 },
        targets: [
          query(
            `sum(rate(http_request_duration_seconds_count{job=~"${httpJobs}"}[5m])) by (job)`,
            "{{job}}"
          ),
        ],
        unit: "reqps",
      }),
      timeseries({
        title: "HTTP Error Rate",
        gridPos: { h: 8, w: 12, x: 0, y: 8 },
        targets: [
          query(
            `100 * sum(rate(http_request_duration_seconds_count{job=~"${httpJobs}",status_code=~"4..|5.."}[5m])) by (job) / clamp_min(sum(rate(http_request_duration_seconds_count{job=~"${httpJobs}"}[5m])) by (job), 0.001)`,
            "{{job}}"
          ),
        ],
        unit: "percent",
        min: 0,
        max: 100,
      }),
      timeseries({
        title: "HTTP p95 Latency",
        gridPos: { h: 8, w: 12, x: 12, y: 8 },
        targets: [
          query(
            `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{job=~"${httpJobs}"}[5m])) by (job, le))`,
            "{{job}}"
          ),
        ],
        unit: "s",
      }),
      timeseries({
        title: "Worker Throughput",
        gridPos: { h: 8, w: 12, x: 0, y: 16 },
        targets: [
          query(
            "sum(rate(worker_jobs_processed_total[5m])) by (service, job_type)",
            "{{service}} {{job_type}}"
          ),
        ],
        unit: "ops",
      }),
      timeseries({
        title: "Chat Messages Ingested",
        gridPos: { h: 8, w: 12, x: 12, y: 16 },
        targets: [
          query("sum(rate(chat_messages_ingested_total[5m]))", "ingested"),
        ],
        unit: "ops",
      }),
      timeseries({
        title: "Chat Redis Stream Lag",
        gridPos: { h: 8, w: 12, x: 0, y: 24 },
        targets: [
          query("sum(chat_redis_stream_lag) by (partition)", "{{partition}}"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Inference gRPC Request Rate",
        gridPos: { h: 8, w: 12, x: 12, y: 24 },
        targets: [
          query(
            'sum(rate(grpc_requests_total{job="inference"}[5m])) by (method, code, model)',
            "{{method}} {{code}} {{model}}"
          ),
        ],
        unit: "reqps",
      }),
      timeseries({
        title: "Inference gRPC p95",
        gridPos: { h: 8, w: 12, x: 0, y: 32 },
        targets: [
          query(
            'histogram_quantile(0.95, sum(rate(grpc_latency_seconds_bucket{job="inference"}[5m])) by (method, model, le))',
            "{{method}} {{model}}"
          ),
        ],
        unit: "s",
      }),
      timeseries({
        title: "Web DB Query p95",
        gridPos: { h: 8, w: 12, x: 12, y: 32 },
        targets: [
          query(
            'histogram_quantile(0.95, sum(rate(db_query_duration_seconds_bucket{job="frontend"}[5m])) by (operation, le))',
            "{{operation}}"
          ),
        ],
        unit: "s",
      }),
      timeseries({
        title: "Web AI Inference p95",
        gridPos: { h: 8, w: 24, x: 0, y: 40 },
        targets: [
          query(
            'histogram_quantile(0.95, sum(rate(ai_inference_duration_seconds_bucket{job="frontend"}[5m])) by (model, le))',
            "{{model}}"
          ),
        ],
        unit: "s",
      }),
    ],
  });
}

function buildFrontendOverview() {
  resetPanelIds();

  return dashboard({
    title: "Detect AI Frontend Overview",
    uid: "detect-ai-frontend-overview",
    tags: ["detect-ai", "service", "frontend"],
    panels: [
      timeseries({
        title: "Request Rate by Route",
        gridPos: { h: 8, w: 12, x: 0, y: 0 },
        targets: [
          query(
            'sum(rate(http_request_duration_seconds_count{job="frontend"}[5m])) by (route, status_code)',
            "{{route}} {{status_code}}"
          ),
        ],
        unit: "reqps",
      }),
      timeseries({
        title: "Error Rate by Route",
        gridPos: { h: 8, w: 12, x: 12, y: 0 },
        targets: [
          query(
            '100 * sum(rate(http_request_duration_seconds_count{job="frontend",status_code=~"4..|5.."}[5m])) by (route) / clamp_min(sum(rate(http_request_duration_seconds_count{job="frontend"}[5m])) by (route), 0.001)',
            "{{route}}"
          ),
        ],
        unit: "percent",
        min: 0,
        max: 100,
      }),
      timeseries({
        title: "p95 Latency by Route",
        gridPos: { h: 8, w: 12, x: 0, y: 8 },
        targets: [
          query(
            'histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{job="frontend"}[5m])) by (route, le))',
            "{{route}}"
          ),
        ],
        unit: "s",
      }),
      timeseries({
        title: "DB Query p95",
        gridPos: { h: 8, w: 12, x: 12, y: 8 },
        targets: [
          query(
            'histogram_quantile(0.95, sum(rate(db_query_duration_seconds_bucket{job="frontend"}[5m])) by (operation, le))',
            "{{operation}}"
          ),
        ],
        unit: "s",
      }),
      timeseries({
        title: "AI Inference p95",
        gridPos: { h: 8, w: 12, x: 0, y: 16 },
        targets: [
          query(
            'histogram_quantile(0.95, sum(rate(ai_inference_duration_seconds_bucket{job="frontend"}[5m])) by (model, le))',
            "{{model}}"
          ),
        ],
        unit: "s",
      }),
      timeseries({
        title: "Cache Operations",
        gridPos: { h: 8, w: 12, x: 12, y: 16 },
        targets: [
          query(
            'sum(rate(cache_operations_total{job="frontend"}[5m])) by (operation, status)',
            "{{operation}} {{status}}"
          ),
        ],
        unit: "ops",
      }),
      timeseries({
        title: "Rate Limit Hits",
        gridPos: { h: 8, w: 12, x: 0, y: 24 },
        targets: [
          query('sum(rate(rate_limit_hits_total{job="frontend"}[5m])) by (tier)', "{{tier}}"),
        ],
        unit: "ops",
      }),
      timeseries({
        title: "Container CPU Usage",
        gridPos: { h: 8, w: 12, x: 12, y: 24 },
        targets: [
          query(
            '100 * sum(rate(container_cpu_usage_seconds_total{job="cadvisor",container_label_com_docker_compose_service="frontend",id!="/"}[5m]))',
            "frontend"
          ),
        ],
        unit: "percent",
      }),
      timeseries({
        title: "Container Memory Usage",
        gridPos: { h: 8, w: 12, x: 0, y: 32 },
        targets: [
          query(
            'sum(container_memory_working_set_bytes{job="cadvisor",container_label_com_docker_compose_service="frontend",id!="/"})',
            "frontend"
          ),
        ],
        unit: "bytes",
      }),
      timeseries({
        title: "Node.js Event Loop Lag p99",
        gridPos: { h: 8, w: 12, x: 12, y: 32 },
        targets: [
          query('nodejs_eventloop_lag_p99_seconds{job="frontend"}', "frontend"),
        ],
        unit: "s",
      }),
    ],
  });
}

function buildPaymentsOverview() {
  resetPanelIds();

  return dashboard({
    title: "Detect AI Payment Gateway Overview",
    uid: "detect-ai-payments-overview",
    tags: ["detect-ai", "service", "payments"],
    panels: [
      timeseries({
        title: "Request Rate by Route",
        gridPos: { h: 8, w: 12, x: 0, y: 0 },
        targets: [
          query(
            'sum(rate(http_request_duration_seconds_count{job="payment-gateway"}[5m])) by (route, status_code)',
            "{{route}} {{status_code}}"
          ),
        ],
        unit: "reqps",
      }),
      timeseries({
        title: "Error Rate by Route",
        gridPos: { h: 8, w: 12, x: 12, y: 0 },
        targets: [
          query(
            '100 * sum(rate(http_request_duration_seconds_count{job="payment-gateway",status_code=~"4..|5.."}[5m])) by (route) / clamp_min(sum(rate(http_request_duration_seconds_count{job="payment-gateway"}[5m])) by (route), 0.001)',
            "{{route}}"
          ),
        ],
        unit: "percent",
        min: 0,
        max: 100,
      }),
      timeseries({
        title: "p95 Latency by Route",
        gridPos: { h: 8, w: 12, x: 0, y: 8 },
        targets: [
          query(
            'histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{job="payment-gateway"}[5m])) by (route, le))',
            "{{route}}"
          ),
        ],
        unit: "s",
      }),
      timeseries({
        title: "Container CPU Usage",
        gridPos: { h: 8, w: 12, x: 12, y: 8 },
        targets: [
          query(
            '100 * sum(rate(container_cpu_usage_seconds_total{job="cadvisor",container_label_com_docker_compose_service="payment-gateway",id!="/"}[5m]))',
            "payment-gateway"
          ),
        ],
        unit: "percent",
      }),
      timeseries({
        title: "Container Memory Usage",
        gridPos: { h: 8, w: 12, x: 0, y: 16 },
        targets: [
          query(
            'sum(container_memory_working_set_bytes{job="cadvisor",container_label_com_docker_compose_service="payment-gateway",id!="/"})',
            "payment-gateway"
          ),
        ],
        unit: "bytes",
      }),
      timeseries({
        title: "Go Goroutines",
        gridPos: { h: 8, w: 12, x: 12, y: 16 },
        targets: [
          query('go_goroutines{job="payment-gateway"}', "payment-gateway"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Process Open File Descriptors",
        gridPos: { h: 8, w: 12, x: 0, y: 24 },
        targets: [
          query('process_open_fds{job="payment-gateway"}', "payment-gateway"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Process Resident Memory",
        gridPos: { h: 8, w: 12, x: 12, y: 24 },
        targets: [
          query('process_resident_memory_bytes{job="payment-gateway"}', "payment-gateway"),
        ],
        unit: "bytes",
      }),
    ],
  });
}

function buildInferenceOverview() {
  resetPanelIds();

  return dashboard({
    title: "Detect AI Inference Overview",
    uid: "detect-ai-inference-overview",
    tags: ["detect-ai", "service", "inference"],
    panels: [
      timeseries({
        title: "gRPC Request Rate",
        gridPos: { h: 8, w: 12, x: 0, y: 0 },
        targets: [
          query(
            'sum(rate(grpc_requests_total{job="inference"}[5m])) by (method, model, code)',
            "{{method}} {{model}} {{code}}"
          ),
        ],
        unit: "reqps",
      }),
      timeseries({
        title: "gRPC Error Rate",
        gridPos: { h: 8, w: 12, x: 12, y: 0 },
        targets: [
          query(
            '100 * sum(rate(grpc_requests_total{job="inference",code!="OK"}[5m])) by (method, model) / clamp_min(sum(rate(grpc_requests_total{job="inference"}[5m])) by (method, model), 0.001)',
            "{{method}} {{model}}"
          ),
        ],
        unit: "percent",
        min: 0,
        max: 100,
      }),
      timeseries({
        title: "gRPC p95 Latency",
        gridPos: { h: 8, w: 12, x: 0, y: 8 },
        targets: [
          query(
            'histogram_quantile(0.95, sum(rate(grpc_latency_seconds_bucket{job="inference"}[5m])) by (method, model, le))',
            "{{method}} {{model}}"
          ),
        ],
        unit: "s",
      }),
      timeseries({
        title: "Batch Queue Size",
        gridPos: { h: 8, w: 12, x: 12, y: 8 },
        targets: [
          query('sum(model_batch_queue_size{job="inference"}) by (model)', "{{model}}"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Batch Size p95",
        gridPos: { h: 8, w: 12, x: 0, y: 16 },
        targets: [
          query(
            'histogram_quantile(0.95, sum(rate(model_batch_size_bucket{job="inference"}[5m])) by (model, le))',
            "{{model}}"
          ),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Batch Processing p95",
        gridPos: { h: 8, w: 12, x: 12, y: 16 },
        targets: [
          query(
            'histogram_quantile(0.95, sum(rate(model_batch_processing_seconds_bucket{job="inference"}[5m])) by (model, le))',
            "{{model}}"
          ),
        ],
        unit: "s",
      }),
      timeseries({
        title: "AI Confidence Distribution",
        gridPos: { h: 8, w: 12, x: 0, y: 24 },
        targets: [
          query(
            'histogram_quantile(0.50, sum(rate(model_ai_confidence_score_bucket{job="inference"}[5m])) by (model, le))',
            "{{model}} p50",
            "A"
          ),
          query(
            'histogram_quantile(0.95, sum(rate(model_ai_confidence_score_bucket{job="inference"}[5m])) by (model, le))',
            "{{model}} p95",
            "B"
          ),
        ],
        unit: "percentunit",
        min: 0,
        max: 1,
      }),
      timeseries({
        title: "Container CPU Usage",
        gridPos: { h: 8, w: 12, x: 12, y: 24 },
        targets: [
          query(
            '100 * sum(rate(container_cpu_usage_seconds_total{job="cadvisor",container_label_com_docker_compose_service="ai-service",id!="/"}[5m]))',
            "ai-service"
          ),
        ],
        unit: "percent",
      }),
      timeseries({
        title: "Container Memory Usage",
        gridPos: { h: 8, w: 12, x: 0, y: 32 },
        targets: [
          query(
            'sum(container_memory_working_set_bytes{job="cadvisor",container_label_com_docker_compose_service="ai-service",id!="/"})',
            "ai-service"
          ),
        ],
        unit: "bytes",
      }),
      timeseries({
        title: "Process Resident Memory",
        gridPos: { h: 8, w: 12, x: 12, y: 32 },
        targets: [
          query('process_resident_memory_bytes{job="inference"}', "inference"),
        ],
        unit: "bytes",
      }),
    ],
  });
}

function buildWorkersOverview() {
  resetPanelIds();

  return dashboard({
    title: "Detect AI Workers Overview",
    uid: "detect-ai-workers-overview",
    tags: ["detect-ai", "service", "workers"],
    panels: [
      timeseries({
        title: "Throughput by Job Type",
        gridPos: { h: 8, w: 12, x: 0, y: 0 },
        targets: [
          query(
            `sum(rate(worker_jobs_processed_total{job=~"${workerJobs}"}[5m])) by (service, job_type)`,
            "{{service}} {{job_type}}"
          ),
        ],
        unit: "ops",
      }),
      timeseries({
        title: "Job Duration p95",
        gridPos: { h: 8, w: 12, x: 12, y: 0 },
        targets: [
          query(
            `histogram_quantile(0.95, sum(rate(worker_job_duration_seconds_bucket{job=~"${workerJobs}"}[5m])) by (service, job_type, le))`,
            "{{service}} {{job_type}}"
          ),
        ],
        unit: "s",
      }),
      timeseries({
        title: "Worker Errors",
        gridPos: { h: 8, w: 12, x: 0, y: 8 },
        targets: [
          query(
            `sum(rate(worker_job_errors_total{job=~"${workerJobs}"}[5m])) by (service, job_type, error_type)`,
            "{{service}} {{job_type}} {{error_type}}"
          ),
        ],
        unit: "ops",
      }),
      timeseries({
        title: "Active Worker Instances",
        gridPos: { h: 8, w: 12, x: 12, y: 8 },
        targets: [
          query(
            `sum(worker_active_instances{job=~"${workerJobs}"}) by (service)`,
            "{{service}}"
          ),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Cache Operations",
        gridPos: { h: 8, w: 12, x: 0, y: 16 },
        targets: [
          query(
            `sum(rate(cache_operations_total{job=~"${workerJobs}"}[5m])) by (service, cache_type, operation)`,
            "{{service}} {{cache_type}} {{operation}}"
          ),
        ],
        unit: "ops",
      }),
      timeseries({
        title: "Container CPU Usage",
        gridPos: { h: 8, w: 12, x: 12, y: 16 },
        targets: [
          query(
            '100 * sum by (container_label_com_docker_compose_service) (rate(container_cpu_usage_seconds_total{job="cadvisor",container_label_com_docker_compose_service=~"worker-analytics|worker-cron|worker-payments",id!="/"}[5m]))',
            "{{container_label_com_docker_compose_service}}"
          ),
        ],
        unit: "percent",
      }),
      timeseries({
        title: "Container Memory Usage",
        gridPos: { h: 8, w: 12, x: 0, y: 24 },
        targets: [
          query(
            'sum by (container_label_com_docker_compose_service) (container_memory_working_set_bytes{job="cadvisor",container_label_com_docker_compose_service=~"worker-analytics|worker-cron|worker-payments",id!="/"})',
            "{{container_label_com_docker_compose_service}}"
          ),
        ],
        unit: "bytes",
      }),
      timeseries({
        title: "Node.js Event Loop Lag p99",
        gridPos: { h: 8, w: 12, x: 12, y: 24 },
        targets: [
          query(
            `nodejs_eventloop_lag_p99_seconds{job=~"${workerJobs}"}`,
            "{{job}}"
          ),
        ],
        unit: "s",
      }),
    ],
  });
}

function buildInfrastructureOverview() {
  resetPanelIds();

  return dashboard({
    title: "Detect AI Infrastructure Overview",
    uid: "detect-ai-infra-overview",
    tags: ["detect-ai", "overview", "infrastructure"],
    panels: [
      timeseries({
        title: "Infra Availability",
        gridPos: { h: 8, w: 12, x: 0, y: 0 },
        targets: [
          query(`up{job=~"${infraJobs}"}`, "{{job}}"),
        ],
        legendMode: "list",
        tooltipMode: "single",
        thresholds: thresholds("absolute", [
          { color: "red", value: 0 },
          { color: "green", value: 1 },
        ]),
      }),
      timeseries({
        title: "Postgres Connections",
        gridPos: { h: 8, w: 12, x: 12, y: 0 },
        targets: [
          query("sum(pg_stat_database_numbackends) by (instance)", "{{instance}}"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Postgres Replication Lag",
        gridPos: { h: 8, w: 12, x: 0, y: 8 },
        targets: [
          query("max(pg_replication_lag_seconds) by (instance)", "{{instance}}"),
        ],
        unit: "s",
      }),
      timeseries({
        title: "Postgres Database Size",
        gridPos: { h: 8, w: 12, x: 12, y: 8 },
        targets: [
          query("sum(pg_database_size_bytes) by (instance)", "{{instance}}"),
        ],
        unit: "bytes",
      }),
      timeseries({
        title: "RabbitMQ Queue Depth",
        gridPos: { h: 8, w: 12, x: 0, y: 16 },
        targets: [
          query("sum(rabbitmq_queue_messages_ready) by (queue)", "{{queue}}"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "RabbitMQ Consumers",
        gridPos: { h: 8, w: 12, x: 12, y: 16 },
        targets: [
          query("sum(rabbitmq_queue_consumers) by (queue)", "{{queue}}"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Redis Memory Used",
        gridPos: { h: 8, w: 12, x: 0, y: 24 },
        targets: [
          query("sum(redis_memory_used_bytes) by (job)", "{{job}}"),
        ],
        unit: "bytes",
      }),
      timeseries({
        title: "Redis Connected Clients",
        gridPos: { h: 8, w: 12, x: 12, y: 24 },
        targets: [
          query("sum(redis_connected_clients) by (job)", "{{job}}"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Redis Command Rate",
        gridPos: { h: 8, w: 12, x: 0, y: 32 },
        targets: [
          query("sum(rate(redis_commands_processed_total[5m])) by (job)", "{{job}}"),
        ],
        unit: "ops",
      }),
      timeseries({
        title: "Mongo Availability",
        gridPos: { h: 8, w: 12, x: 12, y: 32 },
        targets: [
          query("mongodb_up", "{{instance}}"),
        ],
        legendMode: "list",
        tooltipMode: "single",
        thresholds: thresholds("absolute", [
          { color: "red", value: 0 },
          { color: "green", value: 1 },
        ]),
      }),
    ],
  });
}

function buildHostOverview() {
  resetPanelIds();

  return dashboard({
    title: "Detect AI Host Overview",
    uid: "detect-ai-host-overview",
    tags: ["detect-ai", "infrastructure", "host"],
    panels: [
      stat({
        title: "CPU Busy",
        expr: '100 - (avg(rate(node_cpu_seconds_total{job="node",mode="idle"}[5m])) * 100)',
        gridPos: { h: 4, w: 6, x: 0, y: 0 },
        unit: "percent",
        decimals: 1,
        min: 0,
        max: 100,
      }),
      stat({
        title: "Load per Core",
        expr: 'node_load1{job="node"} / scalar(count(count(node_cpu_seconds_total{job="node",mode="system"}) by (cpu)))',
        gridPos: { h: 4, w: 6, x: 6, y: 0 },
        unit: "short",
        decimals: 2,
      }),
      stat({
        title: "Memory Used",
        expr: '100 * (1 - (node_memory_MemAvailable_bytes{job="node"} / node_memory_MemTotal_bytes{job="node"}))',
        gridPos: { h: 4, w: 6, x: 12, y: 0 },
        unit: "percent",
        decimals: 1,
        min: 0,
        max: 100,
      }),
      stat({
        title: "Most Full Disk",
        expr: 'max(100 * (1 - (max by (device) (node_filesystem_avail_bytes{job="node",fstype=~"ext4|xfs"}) / max by (device) (node_filesystem_size_bytes{job="node",fstype=~"ext4|xfs"}))))',
        gridPos: { h: 4, w: 6, x: 18, y: 0 },
        unit: "percent",
        decimals: 1,
        min: 0,
        max: 100,
      }),
      timeseries({
        title: "CPU by Mode",
        gridPos: { h: 8, w: 12, x: 0, y: 4 },
        targets: [
          query(
            'sum(rate(node_cpu_seconds_total{job="node",mode!~"idle|guest.*"}[5m])) by (mode)',
            "{{mode}}"
          ),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Load Averages",
        gridPos: { h: 8, w: 12, x: 12, y: 4 },
        targets: [
          query('node_load1{job="node"}', "load1", "A"),
          query('node_load5{job="node"}', "load5", "B"),
          query('node_load15{job="node"}', "load15", "C"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Memory Usage",
        gridPos: { h: 8, w: 12, x: 0, y: 12 },
        targets: [
          query(
            'node_memory_MemTotal_bytes{job="node"} - node_memory_MemAvailable_bytes{job="node"}',
            "used",
            "A"
          ),
          query('node_memory_MemAvailable_bytes{job="node"}', "available", "B"),
        ],
        unit: "bytes",
      }),
      timeseries({
        title: "Filesystem Used by Device",
        gridPos: { h: 8, w: 12, x: 12, y: 12 },
        targets: [
          query(
            '100 * (1 - (max by (device) (node_filesystem_avail_bytes{job="node",fstype=~"ext4|xfs"}) / max by (device) (node_filesystem_size_bytes{job="node",fstype=~"ext4|xfs"})))',
            "{{device}}"
          ),
        ],
        unit: "percent",
        min: 0,
        max: 100,
      }),
      timeseries({
        title: "Disk Read Throughput",
        gridPos: { h: 8, w: 12, x: 0, y: 20 },
        targets: [
          query(
            'sum(rate(node_disk_read_bytes_total{job="node",device!~"loop.*|ram.*"}[5m])) by (device)',
            "{{device}}"
          ),
        ],
        unit: "Bps",
      }),
      timeseries({
        title: "Disk Write Throughput",
        gridPos: { h: 8, w: 12, x: 12, y: 20 },
        targets: [
          query(
            'sum(rate(node_disk_written_bytes_total{job="node",device!~"loop.*|ram.*"}[5m])) by (device)',
            "{{device}}"
          ),
        ],
        unit: "Bps",
      }),
      timeseries({
        title: "Network Receive",
        gridPos: { h: 8, w: 12, x: 0, y: 28 },
        targets: [
          query(
            `sum(rate(node_network_receive_bytes_total{${nodeDeviceFilter}}[5m])) by (device)`,
            "{{device}}"
          ),
        ],
        unit: "Bps",
      }),
      timeseries({
        title: "Network Transmit",
        gridPos: { h: 8, w: 12, x: 12, y: 28 },
        targets: [
          query(
            `sum(rate(node_network_transmit_bytes_total{${nodeDeviceFilter}}[5m])) by (device)`,
            "{{device}}"
          ),
        ],
        unit: "Bps",
      }),
    ],
  });
}

function buildContainerOverview() {
  resetPanelIds();

  return dashboard({
    title: "Detect AI Container Overview",
    uid: "detect-ai-container-overview",
    tags: ["detect-ai", "infrastructure", "containers"],
    panels: [
      stat({
        title: "Running Containers",
        expr: `count(container_start_time_seconds{${cadvisorServiceFilter}})`,
        gridPos: { h: 4, w: 6, x: 0, y: 0 },
      }),
      stat({
        title: "Total Container CPU",
        expr: `100 * sum(rate(container_cpu_usage_seconds_total{${cadvisorServiceFilter}}[5m]))`,
        gridPos: { h: 4, w: 6, x: 6, y: 0 },
        unit: "percent",
        decimals: 1,
      }),
      stat({
        title: "Total Container Memory",
        expr: `sum(container_memory_working_set_bytes{${cadvisorServiceFilter}})`,
        gridPos: { h: 4, w: 6, x: 12, y: 0 },
        unit: "bytes",
        decimals: 0,
      }),
      stat({
        title: "Container OOM Events",
        expr: `sum(container_oom_events_total{${cadvisorServiceFilter}})`,
        gridPos: { h: 4, w: 6, x: 18, y: 0 },
      }),
      timeseries({
        title: "Container Count by Service",
        gridPos: { h: 8, w: 12, x: 0, y: 4 },
        targets: [
          query(
            `count by (container_label_com_docker_compose_service) (container_start_time_seconds{${cadvisorServiceFilter}})`,
            "{{container_label_com_docker_compose_service}}"
          ),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Top Container CPU Usage",
        gridPos: { h: 8, w: 12, x: 12, y: 4 },
        targets: [
          query(
            `topk(10, 100 * sum by (container_label_com_docker_compose_service) (rate(container_cpu_usage_seconds_total{${cadvisorServiceFilter}}[5m])))`,
            "{{container_label_com_docker_compose_service}}"
          ),
        ],
        unit: "percent",
      }),
      timeseries({
        title: "Top Container Memory Usage",
        gridPos: { h: 8, w: 12, x: 0, y: 12 },
        targets: [
          query(
            `topk(10, sum by (container_label_com_docker_compose_service) (container_memory_working_set_bytes{${cadvisorServiceFilter}}))`,
            "{{container_label_com_docker_compose_service}}"
          ),
        ],
        unit: "bytes",
      }),
      timeseries({
        title: "Top Container Filesystem Usage",
        gridPos: { h: 8, w: 12, x: 12, y: 12 },
        targets: [
          query(
            `topk(10, sum by (container_label_com_docker_compose_service) (container_fs_usage_bytes{${cadvisorServiceFilter}}))`,
            "{{container_label_com_docker_compose_service}}"
          ),
        ],
        unit: "bytes",
      }),
      timeseries({
        title: "Top Container Network Receive",
        gridPos: { h: 8, w: 12, x: 0, y: 20 },
        targets: [
          query(
            `topk(10, sum by (container_label_com_docker_compose_service) (rate(container_network_receive_bytes_total{${cadvisorServiceFilter}}[5m])))`,
            "{{container_label_com_docker_compose_service}}"
          ),
        ],
        unit: "Bps",
      }),
      timeseries({
        title: "Top Container Network Transmit",
        gridPos: { h: 8, w: 12, x: 12, y: 20 },
        targets: [
          query(
            `topk(10, sum by (container_label_com_docker_compose_service) (rate(container_network_transmit_bytes_total{${cadvisorServiceFilter}}[5m])))`,
            "{{container_label_com_docker_compose_service}}"
          ),
        ],
        unit: "Bps",
      }),
    ],
  });
}

async function writeDashboard(folder, filename, spec) {
  const dir = path.join(dashboardsRoot, folder);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), `${JSON.stringify(spec, null, 2)}\n`);
}

async function main() {
  await mkdir(dashboardsRoot, { recursive: true });
  await rm(path.join(dashboardsRoot, "app-overview.json"), { force: true });
  await rm(path.join(dashboardsRoot, "infra-overview.json"), { force: true });

  const dashboards = [
    ["overview", "01-platform-overview.json", buildPlatformOverview()],
    ["services", "01-service-overview.json", buildServiceOverview()],
    ["services", "02-frontend-overview.json", buildFrontendOverview()],
    ["services", "03-payments-overview.json", buildPaymentsOverview()],
    ["services", "04-inference-overview.json", buildInferenceOverview()],
    ["services", "05-workers-overview.json", buildWorkersOverview()],
    ["infrastructure", "01-infrastructure-overview.json", buildInfrastructureOverview()],
    ["infrastructure", "02-host-overview.json", buildHostOverview()],
    ["infrastructure", "03-container-overview.json", buildContainerOverview()],
  ];

  for (const [folder, filename, spec] of dashboards) {
    await writeDashboard(folder, filename, spec);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
