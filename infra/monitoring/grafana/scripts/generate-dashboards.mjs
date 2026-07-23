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

const appJobs = ".*(frontend|web|worker-analytics|worker-cron|worker-payments|inference|chat-service|chats-api|chat-worker|chats-worker|document-parser|payment-gateway|payments-gateway).*";
const infraJobs = ".*(cadvisor|node|postgres|rabbitmq|redis|mongodb).*";
const httpJobs = ".*(frontend|web|document-parser|payment-gateway|payments-gateway).*";
const workerJobs = ".*(worker-analytics|worker-cron|worker-payments).*";
const redisJobs = ".*redis.*";
const mongoContainerJobs = ".*mongo.*";
const cadvisorServiceFilter = 'container_label_com_docker_compose_service!="",id!="/"';
const nodeDeviceFilter = 'device!~"lo|docker0|br-.*|veth.*"';

function jobSelector(job) {
  if (job === "frontend") return `job=~".*(frontend|web).*"`;
  if (job === "chat-service") return `job=~".*(chat-service|chats-api).*"`;
  if (job === "chat-worker") return `job=~".*(chat-worker|chats-worker).*"`;
  if (job === "payment-gateway") return `job=~".*(payment-gateway|payments-gateway).*"`;
  if (job === "inference") return `job=~".*inference.*"`;
  if (job === "document-parser") return `job=~".*document-parser.*"`;
  if (job === "rabbitmq") return `job=~".*rabbitmq.*"`;
  if (job === "mongodb") return `job=~".*mongodb.*"`;
  if (job === "node") return `job=~".*node.*"`;
  if (job === "cadvisor") return `job=~".*(cadvisor|kubelet).*"`;
  return `job=~".*${job}.*"`;
}

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

const zeroToleranceThresholds = {
  mode: "absolute",
  steps: [
    { color: "green", value: 0 },
    { color: "orange", value: 0.01 },
    { color: "red", value: 0.1 },
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
  panelThresholds,
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

function availabilityStat(title, expr, gridPos) {
  return stat({
    title,
    expr,
    gridPos,
    unit: "percent",
    decimals: 1,
    min: 0,
    max: 100,
    panelThresholds: availabilityThresholds,
  });
}

function containerCpuExpr(service) {
  return `100 * (sum(rate(container_cpu_usage_seconds_total{container_label_com_docker_compose_service="${service}",id!="/"}[5m])) or sum(rate(container_cpu_usage_seconds_total{container=~"(detect-ai-)?${service}",id!="/"}[5m])))`;
}

function containerMemoryExpr(service) {
  return `(sum(container_memory_working_set_bytes{container_label_com_docker_compose_service="${service}",id!="/"}) or sum(container_memory_working_set_bytes{container=~"(detect-ai-)?${service}",id!="/"}))`;
}

function containerFsExpr(service) {
  return `(sum(container_fs_usage_bytes{container_label_com_docker_compose_service="${service}",id!="/"}) or sum(container_fs_usage_bytes{container=~"(detect-ai-)?${service}",id!="/"}))`;
}

function containerRxExpr(service) {
  return `(sum(rate(container_network_receive_bytes_total{container_label_com_docker_compose_service="${service}",id!="/"}[5m])) or sum(rate(container_network_receive_bytes_total{container=~"(detect-ai-)?${service}",id!="/"}[5m])))`;
}

function containerTxExpr(service) {
  return `(sum(rate(container_network_transmit_bytes_total{container_label_com_docker_compose_service="${service}",id!="/"}[5m])) or sum(rate(container_network_transmit_bytes_total{container=~"(detect-ai-)?${service}",id!="/"}[5m])))`;
}

function httpRateExpr(job) {
  return `sum(rate(http_request_duration_seconds_count{${jobSelector(job)}}[5m]))`;
}

function httpErrorRateExpr(job) {
  return `100 * sum(rate(http_request_duration_seconds_count{${jobSelector(job)},status_code=~"4..|5.."}[5m])) / clamp_min(sum(rate(http_request_duration_seconds_count{${jobSelector(job)}}[5m])), 0.001)`;
}

function httpP95Expr(job) {
  return `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{${jobSelector(job)}}[5m])) by (le))`;
}

function buildPlatformOverview() {
  resetPanelIds();

  return dashboard({
    title: "Detect AI Platform Overview",
    uid: "detect-ai-platform-overview",
    tags: ["detect-ai", "overview", "platform"],
    panels: [
      availabilityStat("App Availability", `100 * avg(up{job=~"${appJobs}"})`, { h: 4, w: 6, x: 0, y: 0 }),
      availabilityStat("Infra Availability", `100 * avg(up{job=~"${infraJobs}"})`, { h: 4, w: 6, x: 6, y: 0 }),
      stat({
        title: "Host CPU Busy",
        expr: `100 - (avg(rate(node_cpu_seconds_total{${jobSelector("node")},mode="idle"}[5m])) * 100)`,
        gridPos: { h: 4, w: 6, x: 12, y: 0 },
        unit: "percent",
        decimals: 1,
        min: 0,
        max: 100,
      }),
      stat({
        title: "Host Memory Used",
        expr: `100 * (1 - (node_memory_MemAvailable_bytes{${jobSelector("node")}} / node_memory_MemTotal_bytes{${jobSelector("node")}}))`,
        gridPos: { h: 4, w: 6, x: 18, y: 0 },
        unit: "percent",
        decimals: 1,
        min: 0,
        max: 100,
      }),
      timeseries({
        title: "Service Availability",
        gridPos: { h: 8, w: 12, x: 0, y: 4 },
        targets: [query(`up{job=~"${appJobs}"}`, "{{job}}")],
        legendMode: "list",
        tooltipMode: "single",
        panelThresholds: thresholds("absolute", [
          { color: "red", value: 0 },
          { color: "green", value: 1 },
        ]),
      }),
      timeseries({
        title: "HTTP Request Rate",
        gridPos: { h: 8, w: 12, x: 12, y: 4 },
        targets: [query(`sum(rate(http_request_duration_seconds_count{job=~"${httpJobs}"}[5m])) by (job)`, "{{job}}")],
        unit: "reqps",
      }),
      timeseries({
        title: "Top Container CPU Usage",
        gridPos: { h: 8, w: 12, x: 0, y: 12 },
        targets: [query(`topk(10, 100 * sum by (container_label_com_docker_compose_service) (rate(container_cpu_usage_seconds_total{${cadvisorServiceFilter}}[5m])))`, "{{container_label_com_docker_compose_service}}")],
        unit: "percent",
      }),
      timeseries({
        title: "Top Container Memory Usage",
        gridPos: { h: 8, w: 12, x: 12, y: 12 },
        targets: [query(`topk(10, sum by (container_label_com_docker_compose_service) (container_memory_working_set_bytes{${cadvisorServiceFilter}}))`, "{{container_label_com_docker_compose_service}}")],
        unit: "bytes",
      }),
      timeseries({
        title: "Worker Throughput",
        gridPos: { h: 8, w: 12, x: 0, y: 20 },
        targets: [query("sum(rate(worker_jobs_processed_total[5m])) by (service, job_type)", "{{service}} {{job_type}}")],
        unit: "ops",
      }),
      timeseries({
        title: "Inference Batch Queue Size",
        gridPos: { h: 8, w: 12, x: 12, y: 20 },
        targets: [query(`sum(model_batch_queue_size{${jobSelector("inference")}}) by (model)`, "{{model}}")],
        unit: "short",
      }),
      timeseries({
        title: "Postgres Connections",
        gridPos: { h: 8, w: 12, x: 0, y: 28 },
        targets: [query("sum(pg_stat_database_numbackends) by (instance)", "{{instance}}")],
        unit: "short",
      }),
      timeseries({
        title: "RabbitMQ Queue Depth",
        gridPos: { h: 8, w: 12, x: 12, y: 28 },
        targets: [query("sum(rabbitmq_queue_messages_ready) by (queue)", "{{queue}}")],
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
      availabilityStat("Service Availability", `100 * avg(up{job=~"${appJobs}"})`, { h: 4, w: 6, x: 0, y: 0 }),
      stat({
        title: "HTTP Throughput",
        expr: `sum(rate(http_request_duration_seconds_count{job=~"${httpJobs}"}[5m]))`,
        gridPos: { h: 4, w: 6, x: 6, y: 0 },
        unit: "reqps",
        decimals: 2,
      }),
      stat({
        title: "HTTP Error Rate",
        expr: `100 * sum(rate(http_request_duration_seconds_count{job=~"${httpJobs}",status_code=~"4..|5.."}[5m])) / clamp_min(sum(rate(http_request_duration_seconds_count{job=~"${httpJobs}"}[5m])), 0.001)`,
        gridPos: { h: 4, w: 6, x: 12, y: 0 },
        unit: "percent",
        decimals: 2,
        min: 0,
        max: 100,
      }),
      stat({
        title: "Inference gRPC Rate",
        expr: `sum(rate(grpc_requests_total{${jobSelector("inference")}}[5m]))`,
        gridPos: { h: 4, w: 6, x: 18, y: 0 },
        unit: "reqps",
        decimals: 2,
      }),
      timeseries({
        title: "Service Availability",
        gridPos: { h: 8, w: 12, x: 0, y: 4 },
        targets: [query(`up{job=~"${appJobs}"}`, "{{job}}")],
        legendMode: "list",
        tooltipMode: "single",
        panelThresholds: thresholds("absolute", [
          { color: "red", value: 0 },
          { color: "green", value: 1 },
        ]),
      }),
      timeseries({
        title: "HTTP Request Rate by Service",
        gridPos: { h: 8, w: 12, x: 12, y: 4 },
        targets: [query(`sum(rate(http_request_duration_seconds_count{job=~"${httpJobs}"}[5m])) by (job)`, "{{job}}")],
        unit: "reqps",
      }),
      timeseries({
        title: "HTTP Error Rate by Service",
        gridPos: { h: 8, w: 12, x: 0, y: 12 },
        targets: [query(`100 * sum(rate(http_request_duration_seconds_count{job=~"${httpJobs}",status_code=~"4..|5.."}[5m])) by (job) / clamp_min(sum(rate(http_request_duration_seconds_count{job=~"${httpJobs}"}[5m])) by (job), 0.001)`, "{{job}}")],
        unit: "percent",
        min: 0,
        max: 100,
      }),
      timeseries({
        title: "HTTP p95 Latency by Service",
        gridPos: { h: 8, w: 12, x: 12, y: 12 },
        targets: [query(`histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{job=~"${httpJobs}"}[5m])) by (job, le))`, "{{job}}")],
        unit: "s",
      }),
      timeseries({
        title: "Chat gRPC Rate",
        gridPos: { h: 8, w: 12, x: 0, y: 20 },
        targets: [query(`sum(rate(grpc_request_duration_seconds_count{${jobSelector("chat-service")}}[5m])) by (method, status)`, "{{method}} {{status}}")],
        unit: "reqps",
      }),
      timeseries({
        title: "Inference gRPC Rate",
        gridPos: { h: 8, w: 12, x: 12, y: 20 },
        targets: [query(`sum(rate(grpc_requests_total{${jobSelector("inference")}}[5m])) by (method, model, code)`, "{{method}} {{model}} {{code}}")],
        unit: "reqps",
      }),
      timeseries({
        title: "Worker Throughput",
        gridPos: { h: 8, w: 12, x: 0, y: 28 },
        targets: [query("sum(rate(worker_jobs_processed_total[5m])) by (service, job_type)", "{{service}} {{job_type}}")],
        unit: "ops",
      }),
      timeseries({
        title: "Top Application Containers by Memory",
        gridPos: { h: 8, w: 12, x: 12, y: 28 },
        targets: [query(`topk(10, sum by (container_label_com_docker_compose_service) (container_memory_working_set_bytes{${jobSelector("cadvisor")},container_label_com_docker_compose_service=~"frontend|worker-analytics|worker-cron|worker-payments|ai-service|chat-service|chat-worker|document-parser|payment-gateway",id!="/"}))`, "{{container_label_com_docker_compose_service}}")],
        unit: "bytes",
      }),
    ],
  });
}

function buildFrontendOverview() {
  resetPanelIds();

  return dashboard({
    title: "Detect AI Frontend Overview",
    uid: "detect-ai-frontend-overview",
    tags: ["detect-ai", "service", "frontend", "detailed"],
    panels: [
      availabilityStat("Availability", `100 * avg(up{${jobSelector("frontend")}})`, { h: 4, w: 6, x: 0, y: 0 }),
      stat({ title: "Request Rate", expr: httpRateExpr("frontend"), gridPos: { h: 4, w: 6, x: 6, y: 0 }, unit: "reqps", decimals: 2 }),
      stat({ title: "Error Rate", expr: httpErrorRateExpr("frontend"), gridPos: { h: 4, w: 6, x: 12, y: 0 }, unit: "percent", decimals: 2, min: 0, max: 100 }),
      stat({ title: "p95 Latency", expr: httpP95Expr("frontend"), gridPos: { h: 4, w: 6, x: 18, y: 0 }, unit: "s", decimals: 3 }),
      timeseries({
        title: "Request Rate by Route",
        gridPos: { h: 8, w: 12, x: 0, y: 4 },
        targets: [query(`sum(rate(http_request_duration_seconds_count{${jobSelector("frontend")}}[5m])) by (route, status_code)`, "{{route}} {{status_code}}")],
        unit: "reqps",
      }),
      timeseries({
        title: "p95 Latency by Route",
        gridPos: { h: 8, w: 12, x: 12, y: 4 },
        targets: [query(`histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{${jobSelector("frontend")}}[5m])) by (route, le))`, "{{route}}")],
        unit: "s",
      }),
      timeseries({
        title: "DB Query Throughput",
        gridPos: { h: 8, w: 12, x: 0, y: 12 },
        targets: [query(`sum(rate(db_query_duration_seconds_count{${jobSelector("frontend")}}[5m])) by (operation, status)`, "{{operation}} {{status}}")],
        unit: "ops",
      }),
      timeseries({
        title: "DB Query p95",
        gridPos: { h: 8, w: 12, x: 12, y: 12 },
        targets: [query(`histogram_quantile(0.95, sum(rate(db_query_duration_seconds_bucket{${jobSelector("frontend")}}[5m])) by (operation, le))`, "{{operation}}")],
        unit: "s",
      }),
      timeseries({
        title: "AI Inference Throughput",
        gridPos: { h: 8, w: 12, x: 0, y: 20 },
        targets: [query(`sum(rate(ai_inference_duration_seconds_count{${jobSelector("frontend")}}[5m])) by (model, status)`, "{{model}} {{status}}")],
        unit: "ops",
      }),
      timeseries({
        title: "AI Inference p95",
        gridPos: { h: 8, w: 12, x: 12, y: 20 },
        targets: [query(`histogram_quantile(0.95, sum(rate(ai_inference_duration_seconds_bucket{${jobSelector("frontend")}}[5m])) by (model, le))`, "{{model}}")],
        unit: "s",
      }),
      timeseries({
        title: "Cache Operations",
        gridPos: { h: 8, w: 8, x: 0, y: 28 },
        targets: [query(`sum(rate(cache_operations_total{${jobSelector("frontend")}}[5m])) by (operation, status)`, "{{operation}} {{status}}")],
        unit: "ops",
      }),
      timeseries({
        title: "Rate Limit Hits",
        gridPos: { h: 8, w: 8, x: 8, y: 28 },
        targets: [query(`sum(rate(rate_limit_hits_total{${jobSelector("frontend")}}[5m])) by (tier)`, "{{tier}}")],
        unit: "ops",
      }),
      timeseries({
        title: "Node.js Runtime",
        gridPos: { h: 8, w: 8, x: 16, y: 28 },
        targets: [
          query(`nodejs_eventloop_lag_p99_seconds{${jobSelector("frontend")}}`, "event loop p99", "A"),
          query(`nodejs_heap_size_used_bytes{${jobSelector("frontend")}}`, "heap used", "B"),
          query(`nodejs_active_handles{${jobSelector("frontend")}}`, "active handles", "C"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Container CPU and Memory",
        gridPos: { h: 8, w: 12, x: 0, y: 36 },
        targets: [
          query(containerCpuExpr("frontend"), "cpu %", "A"),
          query(containerMemoryExpr("frontend"), "memory", "B"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Container Filesystem and Network",
        gridPos: { h: 8, w: 12, x: 12, y: 36 },
        targets: [
          query(containerFsExpr("frontend"), "fs used", "A"),
          query(containerRxExpr("frontend"), "net rx", "B"),
          query(containerTxExpr("frontend"), "net tx", "C"),
        ],
        unit: "short",
      }),
    ],
  });
}

function buildPaymentsOverview() {
  resetPanelIds();

  return dashboard({
    title: "Detect AI Payment Gateway Overview",
    uid: "detect-ai-payments-overview",
    tags: ["detect-ai", "service", "payments", "detailed"],
    panels: [
      availabilityStat("Availability", `100 * avg(up{${jobSelector("payment-gateway")}})`, { h: 4, w: 6, x: 0, y: 0 }),
      stat({ title: "Request Rate", expr: httpRateExpr("payment-gateway"), gridPos: { h: 4, w: 6, x: 6, y: 0 }, unit: "reqps", decimals: 2 }),
      stat({ title: "Error Rate", expr: httpErrorRateExpr("payment-gateway"), gridPos: { h: 4, w: 6, x: 12, y: 0 }, unit: "percent", decimals: 2, min: 0, max: 100 }),
      stat({ title: "p95 Latency", expr: httpP95Expr("payment-gateway"), gridPos: { h: 4, w: 6, x: 18, y: 0 }, unit: "s", decimals: 3 }),
      timeseries({
        title: "Request Rate by Route",
        gridPos: { h: 8, w: 12, x: 0, y: 4 },
        targets: [query(`sum(rate(http_request_duration_seconds_count{${jobSelector("payment-gateway")}}[5m])) by (route, status_code)`, "{{route}} {{status_code}}")],
        unit: "reqps",
      }),
      timeseries({
        title: "p95 Latency by Route",
        gridPos: { h: 8, w: 12, x: 12, y: 4 },
        targets: [query(`histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{${jobSelector("payment-gateway")}}[5m])) by (route, le))`, "{{route}}")],
        unit: "s",
      }),
      timeseries({
        title: "Go Runtime",
        gridPos: { h: 8, w: 12, x: 0, y: 12 },
        targets: [
          query(`go_goroutines{${jobSelector("payment-gateway")}}`, "goroutines", "A"),
          query(`go_memstats_heap_alloc_bytes{${jobSelector("payment-gateway")}}`, "heap alloc", "B"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Process Runtime",
        gridPos: { h: 8, w: 12, x: 12, y: 12 },
        targets: [
          query(`rate(process_cpu_seconds_total{${jobSelector("payment-gateway")}}[5m])`, "cpu cores", "A"),
          query(`process_resident_memory_bytes{${jobSelector("payment-gateway")}}`, "resident memory", "B"),
          query(`process_open_fds{${jobSelector("payment-gateway")}}`, "open fds", "C"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Container CPU and Memory",
        gridPos: { h: 8, w: 12, x: 0, y: 20 },
        targets: [
          query(containerCpuExpr("payment-gateway"), "cpu %", "A"),
          query(containerMemoryExpr("payment-gateway"), "memory", "B"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Container Filesystem and Network",
        gridPos: { h: 8, w: 12, x: 12, y: 20 },
        targets: [
          query(containerFsExpr("payment-gateway"), "fs used", "A"),
          query(containerRxExpr("payment-gateway"), "net rx", "B"),
          query(containerTxExpr("payment-gateway"), "net tx", "C"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Payment Events & Webhook Validity",
        gridPos: { h: 8, w: 12, x: 0, y: 28 },
        targets: [
          query(`sum(rate(payment_events_published_total{${jobSelector("payment-gateway")}}[5m])) by (event_type, status)`, "Event published {{event_type}} {{status}}", "A"),
          query(`sum(rate(payment_webhook_signatures_invalid_total{${jobSelector("payment-gateway")}}[5m]))`, "Invalid Signatures Rate", "B"),
        ],
        unit: "ops",
      }),
      timeseries({
        title: "RabbitMQ Broker Connection & Publish Latency",
        gridPos: { h: 8, w: 12, x: 12, y: 28 },
        targets: [
          query(`rabbitmq_connection_status{${jobSelector("payment-gateway")}}`, "Connection Status (1=Connected)", "A"),
          query(`sum(rate(rabbitmq_reconnections_total{${jobSelector("payment-gateway")}}[5m]))`, "Reconnections Rate", "B"),
          query(`histogram_quantile(0.95, sum(rate(rabbitmq_publish_duration_seconds_bucket{${jobSelector("payment-gateway")}}[5m])) by (le))`, "Publish Latency p95", "C"),
        ],
        unit: "short",
      }),
    ],
  });
}

function buildInferenceOverview() {
  resetPanelIds();

  return dashboard({
    title: "Detect AI Inference Overview",
    uid: "detect-ai-inference-overview",
    tags: ["detect-ai", "service", "inference", "detailed"],
    panels: [
      availabilityStat("Availability", `100 * avg(up{${jobSelector("inference")}})`, { h: 4, w: 6, x: 0, y: 0 }),
      stat({ title: "gRPC Rate", expr: `sum(rate(grpc_requests_total{${jobSelector("inference")}}[5m]))`, gridPos: { h: 4, w: 6, x: 6, y: 0 }, unit: "reqps", decimals: 2 }),
      stat({ title: "Error Rate", expr: `100 * sum(rate(grpc_requests_total{${jobSelector("inference")},code!="OK"}[5m])) / clamp_min(sum(rate(grpc_requests_total{${jobSelector("inference")}}[5m])), 0.001)`, gridPos: { h: 4, w: 6, x: 12, y: 0 }, unit: "percent", decimals: 2, min: 0, max: 100 }),
      stat({ title: "gRPC p95", expr: `histogram_quantile(0.95, sum(rate(grpc_latency_seconds_bucket{${jobSelector("inference")}}[5m])) by (le))`, gridPos: { h: 4, w: 6, x: 18, y: 0 }, unit: "s", decimals: 3 }),
      timeseries({
        title: "gRPC Request Rate",
        gridPos: { h: 8, w: 12, x: 0, y: 4 },
        targets: [query(`sum(rate(grpc_requests_total{${jobSelector("inference")}}[5m])) by (method, model, code)`, "{{method}} {{model}} {{code}}")],
        unit: "reqps",
      }),
      timeseries({
        title: "gRPC p95 Latency",
        gridPos: { h: 8, w: 12, x: 12, y: 4 },
        targets: [query(`histogram_quantile(0.95, sum(rate(grpc_latency_seconds_bucket{${jobSelector("inference")}}[5m])) by (method, model, le))`, "{{method}} {{model}}")],
        unit: "s",
      }),
      timeseries({
        title: "Batch Queue Size",
        gridPos: { h: 8, w: 12, x: 0, y: 12 },
        targets: [query(`sum(model_batch_queue_size{${jobSelector("inference")}}) by (model)`, "{{model}}")],
        unit: "short",
      }),
      timeseries({
        title: "Batch Size and Processing p95",
        gridPos: { h: 8, w: 12, x: 12, y: 12 },
        targets: [
          query(`histogram_quantile(0.95, sum(rate(model_batch_size_bucket{${jobSelector("inference")}}[5m])) by (model, le))`, "{{model}} size p95", "A"),
          query(`histogram_quantile(0.95, sum(rate(model_batch_processing_seconds_bucket{${jobSelector("inference")}}[5m])) by (model, le))`, "{{model}} processing p95", "B"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "AI Confidence Distribution",
        gridPos: { h: 8, w: 12, x: 0, y: 20 },
        targets: [
          query(`histogram_quantile(0.50, sum(rate(model_ai_confidence_score_bucket{${jobSelector("inference")}}[5m])) by (model, le))`, "{{model}} p50", "A"),
          query(`histogram_quantile(0.95, sum(rate(model_ai_confidence_score_bucket{${jobSelector("inference")}}[5m])) by (model, le))`, "{{model}} p95", "B"),
        ],
        unit: "percentunit",
        min: 0,
        max: 1,
      }),
      timeseries({
        title: "Process Runtime",
        gridPos: { h: 8, w: 12, x: 12, y: 20 },
        targets: [
          query(`rate(process_cpu_seconds_total{${jobSelector("inference")}}[5m])`, "cpu cores", "A"),
          query(`process_resident_memory_bytes{${jobSelector("inference")}}`, "resident memory", "B"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Container CPU and Memory",
        gridPos: { h: 8, w: 12, x: 0, y: 28 },
        targets: [
          query(containerCpuExpr("ai-service"), "cpu %", "A"),
          query(containerMemoryExpr("ai-service"), "memory", "B"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Container Filesystem and Network",
        gridPos: { h: 8, w: 12, x: 12, y: 28 },
        targets: [
          query(containerFsExpr("ai-service"), "fs used", "A"),
          query(containerRxExpr("ai-service"), "net rx", "B"),
          query(containerTxExpr("ai-service"), "net tx", "C"),
        ],
        unit: "short",
      }),
    ],
  });
}

function buildWorkersOverview() {
  resetPanelIds();

  return dashboard({
    title: "Detect AI Workers Overview",
    uid: "detect-ai-workers-overview",
    tags: ["detect-ai", "service", "workers", "detailed"],
    panels: [
      availabilityStat("Availability", `100 * avg(up{job=~"${workerJobs}"})`, { h: 4, w: 6, x: 0, y: 0 }),
      stat({ title: "Throughput", expr: `sum(rate(worker_jobs_processed_total{job=~"${workerJobs}"}[5m]))`, gridPos: { h: 4, w: 6, x: 6, y: 0 }, unit: "ops", decimals: 2 }),
      stat({
        title: "Job Duration p95",
        expr: `histogram_quantile(0.95, sum(rate(worker_job_duration_seconds_bucket{job=~"${workerJobs}"}[5m])) by (le))`,
        gridPos: { h: 4, w: 6, x: 12, y: 0 },
        unit: "s",
        decimals: 2,
      }),
      stat({ title: "Active Instances", expr: `sum(worker_active_instances{job=~"${workerJobs}"})`, gridPos: { h: 4, w: 6, x: 18, y: 0 }, unit: "short", decimals: 0 }),
      timeseries({
        title: "Throughput by Service and Job Type",
        gridPos: { h: 8, w: 12, x: 0, y: 4 },
        targets: [query(`sum(rate(worker_jobs_processed_total{job=~"${workerJobs}"}[5m])) by (service, job_type)`, "{{service}} {{job_type}}")],
        unit: "ops",
      }),
      timeseries({
        title: "Job Duration p95",
        gridPos: { h: 8, w: 12, x: 12, y: 4 },
        targets: [query(`histogram_quantile(0.95, sum(rate(worker_job_duration_seconds_bucket{job=~"${workerJobs}"}[5m])) by (service, job_type, le))`, "{{service}} {{job_type}}")],
        unit: "s",
      }),
      timeseries({
        title: "Active Instances by Service",
        gridPos: { h: 8, w: 12, x: 0, y: 12 },
        targets: [query(`sum(worker_active_instances{job=~"${workerJobs}"}) by (service, job)`, "{{service}} {{job}}")],
        unit: "short",
      }),
      timeseries({
        title: "Cache Operations",
        gridPos: { h: 8, w: 12, x: 12, y: 12 },
        targets: [query(`sum(rate(cache_operations_total{job=~"${workerJobs}"}[5m])) by (service, cache_type, operation)`, "{{service}} {{cache_type}} {{operation}}")],
        unit: "ops",
      }),
      timeseries({
        title: "Node.js Runtime",
        gridPos: { h: 8, w: 12, x: 0, y: 20 },
        targets: [
          query(`nodejs_eventloop_lag_p99_seconds{job=~"${workerJobs}"}`, "{{job}} lag", "A"),
          query(`nodejs_heap_size_used_bytes{job=~"${workerJobs}"}`, "{{job}} heap", "B"),
          query(`nodejs_active_handles{job=~"${workerJobs}"}`, "{{job}} handles", "C"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Container CPU",
        gridPos: { h: 8, w: 12, x: 12, y: 20 },
        targets: [query('100 * (sum by (container_label_com_docker_compose_service) (rate(container_cpu_usage_seconds_total{container_label_com_docker_compose_service=~"worker-analytics|worker-cron|worker-payments",id!="/"}[5m])) or sum by (container) (rate(container_cpu_usage_seconds_total{container=~"(detect-ai-)?(worker-analytics|worker-cron|worker-payments)",id!="/"}[5m])))', "{{container_label_com_docker_compose_service}} {{container}}")],
        unit: "percent",
      }),
      timeseries({
        title: "Container Memory",
        gridPos: { h: 8, w: 12, x: 0, y: 28 },
        targets: [query('(sum by (container_label_com_docker_compose_service) (container_memory_working_set_bytes{container_label_com_docker_compose_service=~"worker-analytics|worker-cron|worker-payments",id!="/"}) or sum by (container) (container_memory_working_set_bytes{container=~"(detect-ai-)?(worker-analytics|worker-cron|worker-payments)",id!="/"}))', "{{container_label_com_docker_compose_service}} {{container}}")],
        unit: "bytes",
      }),
      timeseries({
        title: "Container Network",
        gridPos: { h: 8, w: 12, x: 12, y: 28 },
        targets: [
          query('(sum by (container_label_com_docker_compose_service) (rate(container_network_receive_bytes_total{container_label_com_docker_compose_service=~"worker-analytics|worker-cron|worker-payments",id!="/"}[5m])) or sum by (container) (rate(container_network_receive_bytes_total{container=~"(detect-ai-)?(worker-analytics|worker-cron|worker-payments)",id!="/"}[5m])))', "{{container_label_com_docker_compose_service}} {{container}} rx", "A"),
          query('(sum by (container_label_com_docker_compose_service) (rate(container_network_transmit_bytes_total{container_label_com_docker_compose_service=~"worker-analytics|worker-cron|worker-payments",id!="/"}[5m])) or sum by (container) (rate(container_network_transmit_bytes_total{container=~"(detect-ai-)?(worker-analytics|worker-cron|worker-payments)",id!="/"}[5m])))', "{{container_label_com_docker_compose_service}} {{container}} tx", "B"),
        ],
        unit: "Bps",
      }),
      timeseries({
        title: "Broker & Cache Connection Reliability",
        gridPos: { h: 8, w: 12, x: 0, y: 36 },
        targets: [
          query('rabbitmq_connection_status{job=~"${workerJobs}"}', "{{job}} RabbitMQ status", "A"),
          query('sum(rate(rabbitmq_reconnections_total{job=~"${workerJobs}"}[5m])) by (job)', "{{job}} RabbitMQ reconns", "B"),
          query('redis_connection_status{job=~"${workerJobs}"}', "{{job}} Redis status", "C"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Database Connection Pool Status",
        gridPos: { h: 8, w: 12, x: 12, y: 36 },
        targets: [
          query('db_pool_connections{job=~"${workerJobs}"}', "{{job}} pool {{pool_name}} {{state}}", "A"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Active Jobs & Message Payload Size p95",
        gridPos: { h: 8, w: 12, x: 0, y: 44 },
        targets: [
          query('sum(worker_active_jobs{job=~"${workerJobs}"}) by (job_type)', "{{job_type}} active", "A"),
          query('histogram_quantile(0.95, sum(rate(worker_message_size_bytes_bucket{job=~"${workerJobs}"}[5m])) by (job_type, le))', "{{job_type}} size p95 bytes", "B"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Job Failure Errors & DLQ Messages",
        gridPos: { h: 8, w: 12, x: 12, y: 44 },
        targets: [
          query('sum(rate(worker_job_errors_total{job=~"${workerJobs}"}[5m])) by (job_type, error_type)', "{{job_type}} error {{error_type}}", "A"),
          query('sum(rate(worker_dead_lettered_total{job=~"${workerJobs}"}[5m])) by (job_type)', "{{job_type}} dead lettered", "B"),
          query('sum(rate(worker_domain_operations_volume_total{job=~"${workerJobs}"}[5m])) by (domain_op)', "Domain op {{domain_op}}", "C"),
        ],
        unit: "ops",
      }),
    ],
  });
}

function buildInferenceOperationsOverview() {
  resetPanelIds();

  return dashboard({
    title: "Detect AI Inference Operations",
    uid: "detect-ai-inference-operations-overview",
    tags: ["detect-ai", "service", "inference", "operations"],
    panels: [
      availabilityStat("Service Health", `100 * max(inference_service_health_status{${jobSelector("inference")},status="serving"})`, { h: 4, w: 6, x: 0, y: 0 }),
      availabilityStat("Engines Serving", `100 * avg(inference_engine_health_status{${jobSelector("inference")},status="serving"})`, { h: 4, w: 6, x: 6, y: 0 }),
      stat({
        title: "Max Queue Fill",
        expr: `100 * max(model_batch_queue_size{${jobSelector("inference")}} / clamp_min(inference_engine_queue_capacity{${jobSelector("inference")}}, 1))`,
        gridPos: { h: 4, w: 6, x: 12, y: 0 },
        unit: "percent",
        decimals: 1,
        min: 0,
        max: 100,
      }),
      stat({
        title: "Max Circuit Open",
        expr: `max(inference_engine_circuit_open_seconds{${jobSelector("inference")}})`,
        gridPos: { h: 4, w: 6, x: 18, y: 0 },
        unit: "s",
        decimals: 1,
        min: 0,
        panelThresholds: thresholds("absolute", [
          { color: "green", value: 0 },
          { color: "orange", value: 1 },
          { color: "red", value: 15 },
        ]),
      }),
      timeseries({
        title: "Service Health State",
        gridPos: { h: 8, w: 12, x: 0, y: 4 },
        targets: [query(`inference_service_health_status{${jobSelector("inference")}}`, "{{status}}")],
        unit: "short",
        legendMode: "list",
        tooltipMode: "single",
        panelThresholds: thresholds("absolute", [
          { color: "red", value: 0 },
          { color: "green", value: 1 },
        ]),
      }),
      timeseries({
        title: "Service Health Reason",
        gridPos: { h: 8, w: 12, x: 12, y: 4 },
        targets: [query(`inference_service_health_reason{${jobSelector("inference")},reason!="none"}`, "{{reason}}")],
        unit: "short",
        legendMode: "list",
        tooltipMode: "single",
        panelThresholds: thresholds("absolute", [
          { color: "green", value: 0 },
          { color: "red", value: 1 },
        ]),
      }),
      timeseries({
        title: "Engine Health State",
        gridPos: { h: 8, w: 12, x: 0, y: 12 },
        targets: [query(`inference_engine_health_status{${jobSelector("inference")}}`, "{{model}} {{status}}")],
        unit: "short",
        legendMode: "list",
        tooltipMode: "single",
        panelThresholds: thresholds("absolute", [
          { color: "red", value: 0 },
          { color: "green", value: 1 },
        ]),
      }),
      timeseries({
        title: "Queue Depth and Capacity",
        gridPos: { h: 8, w: 12, x: 12, y: 12 },
        targets: [
          query(`model_batch_queue_size{${jobSelector("inference")}}`, "{{model}} queued", "A"),
          query(`inference_engine_queue_capacity{${jobSelector("inference")}}`, "{{model}} capacity", "B"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Queue Utilization",
        gridPos: { h: 8, w: 12, x: 0, y: 20 },
        targets: [query(`100 * model_batch_queue_size{${jobSelector("inference")}} / clamp_min(inference_engine_queue_capacity{${jobSelector("inference")}}, 1)`, "{{model}}")],
        unit: "percent",
        min: 0,
        max: 100,
        panelThresholds: saturationThresholds,
      }),
      timeseries({
        title: "Circuit Open Seconds",
        gridPos: { h: 8, w: 12, x: 12, y: 20 },
        targets: [query(`inference_engine_circuit_open_seconds{${jobSelector("inference")}}`, "{{model}}")],
        unit: "s",
        min: 0,
      }),
      timeseries({
        title: "Process Runtime",
        gridPos: { h: 8, w: 12, x: 0, y: 28 },
        targets: [
          query(`rate(process_cpu_seconds_total{${jobSelector("inference")}}[5m])`, "cpu cores", "A"),
          query(`process_resident_memory_bytes{${jobSelector("inference")}}`, "resident memory", "B"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Container CPU and Memory",
        gridPos: { h: 8, w: 12, x: 12, y: 28 },
        targets: [
          query(containerCpuExpr("ai-service"), "cpu %", "A"),
          query(containerMemoryExpr("ai-service"), "memory", "B"),
        ],
        unit: "short",
      }),
    ],
  });
}

function buildInferenceTrafficOverview() {
  resetPanelIds();

  return dashboard({
    title: "Detect AI Inference Traffic and Documents",
    uid: "detect-ai-inference-traffic-overview",
    tags: ["detect-ai", "service", "inference", "traffic"],
    panels: [
      stat({ title: "gRPC Rate", expr: `sum(rate(grpc_requests_total{${jobSelector("inference")}}[5m]))`, gridPos: { h: 4, w: 6, x: 0, y: 0 }, unit: "reqps", decimals: 2 }),
      stat({
        title: "Auth Reject Rate",
        expr: `sum(rate(grpc_auth_failures_total{${jobSelector("inference")}}[5m]))`,
        gridPos: { h: 4, w: 6, x: 6, y: 0 },
        unit: "reqps",
        decimals: 2,
        min: 0,
        panelThresholds: zeroToleranceThresholds,
      }),
      stat({
        title: "p95 Input Size",
        expr: `histogram_quantile(0.95, sum(rate(inference_document_input_chars_bucket{${jobSelector("inference")}}[5m])) by (le))`,
        gridPos: { h: 4, w: 6, x: 12, y: 0 },
        unit: "short",
        decimals: 0,
        min: 0,
      }),
      stat({
        title: "p95 Chunk Count",
        expr: `histogram_quantile(0.95, sum(rate(inference_document_chunk_count_bucket{${jobSelector("inference")}}[5m])) by (le))`,
        gridPos: { h: 4, w: 6, x: 18, y: 0 },
        unit: "short",
        decimals: 1,
        min: 0,
      }),
      timeseries({
        title: "gRPC Response Rate",
        gridPos: { h: 8, w: 12, x: 0, y: 4 },
        targets: [query(`sum(rate(grpc_requests_total{${jobSelector("inference")}}[5m])) by (code, method, model)`, "{{code}} {{method}} {{model}}")],
        unit: "reqps",
      }),
      timeseries({
        title: "Auth Failures",
        gridPos: { h: 8, w: 12, x: 12, y: 4 },
        targets: [query(`sum(rate(grpc_auth_failures_total{${jobSelector("inference")}}[5m])) by (method, reason)`, "{{method}} {{reason}}")],
        unit: "reqps",
      }),
      timeseries({
        title: "Document Request Rate",
        gridPos: { h: 8, w: 12, x: 0, y: 12 },
        targets: [query(`sum(rate(inference_document_input_chars_count{${jobSelector("inference")}}[5m])) by (operation, model)`, "{{operation}} {{model}}")],
        unit: "reqps",
      }),
      timeseries({
        title: "Chunk Throughput",
        gridPos: { h: 8, w: 12, x: 12, y: 12 },
        targets: [query(`sum(rate(inference_document_chunks_processed_total{${jobSelector("inference")}}[5m])) by (operation, model)`, "{{operation}} {{model}}")],
        unit: "ops",
      }),
      timeseries({
        title: "Input Size Distribution",
        gridPos: { h: 8, w: 12, x: 0, y: 20 },
        targets: [
          query(`histogram_quantile(0.50, sum(rate(inference_document_input_chars_bucket{${jobSelector("inference")}}[5m])) by (operation, model, le))`, "{{operation}} {{model}} p50", "A"),
          query(`histogram_quantile(0.95, sum(rate(inference_document_input_chars_bucket{${jobSelector("inference")}}[5m])) by (operation, model, le))`, "{{operation}} {{model}} p95", "B"),
        ],
        unit: "short",
        min: 0,
      }),
      timeseries({
        title: "Chunk Count Distribution",
        gridPos: { h: 8, w: 12, x: 12, y: 20 },
        targets: [
          query(`histogram_quantile(0.50, sum(rate(inference_document_chunk_count_bucket{${jobSelector("inference")}}[5m])) by (operation, model, le))`, "{{operation}} {{model}} p50", "A"),
          query(`histogram_quantile(0.95, sum(rate(inference_document_chunk_count_bucket{${jobSelector("inference")}}[5m])) by (operation, model, le))`, "{{operation}} {{model}} p95", "B"),
        ],
        unit: "short",
        min: 0,
      }),
      timeseries({
        title: "In-Flight Chunk Concurrency",
        gridPos: { h: 8, w: 12, x: 0, y: 28 },
        targets: [query(`sum(inference_document_inflight_chunks{${jobSelector("inference")}}) by (operation, model)`, "{{operation}} {{model}}")],
        unit: "short",
        min: 0,
      }),
      timeseries({
        title: "Cancelled and Failure Rate",
        gridPos: { h: 8, w: 12, x: 12, y: 28 },
        targets: [query(`sum(rate(grpc_requests_total{${jobSelector("inference")},code=~"CANCELLED|INTERNAL|RESOURCE_EXHAUSTED|INVALID_ARGUMENT|UNKNOWN"}[5m])) by (code, method, model)`, "{{code}} {{method}} {{model}}")],
        unit: "reqps",
      }),
    ],
  });
}

function buildDocumentParserOverview() {
  resetPanelIds();

  return dashboard({
    title: "Detect AI Document Parser Overview",
    uid: "detect-ai-document-parser-overview",
    tags: ["detect-ai", "service", "document-parser", "detailed"],
    panels: [
      availabilityStat("Availability", `100 * avg(up{${jobSelector("document-parser")}})`, { h: 4, w: 6, x: 0, y: 0 }),
      stat({ title: "Request Rate", expr: httpRateExpr("document-parser"), gridPos: { h: 4, w: 6, x: 6, y: 0 }, unit: "reqps", decimals: 2 }),
      stat({ title: "Error Rate", expr: httpErrorRateExpr("document-parser"), gridPos: { h: 4, w: 6, x: 12, y: 0 }, unit: "percent", decimals: 2, min: 0, max: 100 }),
      stat({ title: "p95 Latency", expr: httpP95Expr("document-parser"), gridPos: { h: 4, w: 6, x: 18, y: 0 }, unit: "s", decimals: 3 }),
      timeseries({
        title: "Request Rate by Route",
        gridPos: { h: 8, w: 12, x: 0, y: 4 },
        targets: [query(`sum(rate(http_request_duration_seconds_count{${jobSelector("document-parser")}}[5m])) by (route, status_code)`, "{{route}} {{status_code}}")],
        unit: "reqps",
      }),
      timeseries({
        title: "p95 Latency by Route",
        gridPos: { h: 8, w: 12, x: 12, y: 4 },
        targets: [query(`histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{${jobSelector("document-parser")}}[5m])) by (route, le))`, "{{route}}")],
        unit: "s",
      }),
      timeseries({
        title: "Request Volume by Status",
        gridPos: { h: 8, w: 12, x: 0, y: 12 },
        targets: [query(`sum(rate(http_request_duration_seconds_count{${jobSelector("document-parser")}}[5m])) by (status_code)`, "{{status_code}}")],
        unit: "reqps",
      }),
      timeseries({
        title: "Container CPU and Memory",
        gridPos: { h: 8, w: 12, x: 12, y: 12 },
        targets: [
          query(containerCpuExpr("document-parser"), "cpu %", "A"),
          query(containerMemoryExpr("document-parser"), "memory", "B"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Container Filesystem",
        gridPos: { h: 8, w: 12, x: 0, y: 20 },
        targets: [query(containerFsExpr("document-parser"), "fs used")],
        unit: "bytes",
      }),
      timeseries({
        title: "Container Network",
        gridPos: { h: 8, w: 12, x: 12, y: 20 },
        targets: [
          query(containerRxExpr("document-parser"), "net rx", "A"),
          query(containerTxExpr("document-parser"), "net tx", "B"),
        ],
        unit: "Bps",
      }),
      timeseries({
        title: "Parsed Documents Status by MIME-Type",
        gridPos: { h: 8, w: 12, x: 0, y: 28 },
        targets: [query(`sum(rate(parsed_documents_total{${jobSelector("document-parser")}}[5m])) by (mime_type, status)`, "{{mime_type}} {{status}}")],
        unit: "ops",
      }),
      timeseries({
        title: "Extracted Text Volume & Ingested File Size p95",
        gridPos: { h: 8, w: 12, x: 12, y: 28 },
        targets: [
          query(`sum(rate(extracted_text_bytes_total{${jobSelector("document-parser")}}[5m])) by (mime_type)`, "{{mime_type}} text bytes/s", "A"),
          query(`histogram_quantile(0.95, sum(rate(parsed_file_size_bytes_bucket{${jobSelector("document-parser")}}[5m])) by (mime_type, le))`, "{{mime_type}} size p95 bytes", "B"),
        ],
        unit: "bytes",
      }),
    ],
  });
}

function buildChatServiceOverview() {
  resetPanelIds();

  return dashboard({
    title: "Detect AI Chat Service Overview",
    uid: "detect-ai-chat-service-overview",
    tags: ["detect-ai", "service", "chat-service", "detailed"],
    panels: [
      availabilityStat("Availability", `100 * avg(up{${jobSelector("chat-service")}})`, { h: 4, w: 6, x: 0, y: 0 }),
      stat({ title: "gRPC Rate", expr: `sum(rate(grpc_request_duration_seconds_count{${jobSelector("chat-service")}}[5m]))`, gridPos: { h: 4, w: 6, x: 6, y: 0 }, unit: "reqps", decimals: 2 }),
      stat({ title: "Error Rate", expr: `100 * sum(rate(grpc_request_duration_seconds_count{${jobSelector("chat-service")},status!="OK"}[5m])) / clamp_min(sum(rate(grpc_request_duration_seconds_count{${jobSelector("chat-service")}}[5m])), 0.001)`, gridPos: { h: 4, w: 6, x: 12, y: 0 }, unit: "percent", decimals: 2, min: 0, max: 100 }),
      stat({ title: "gRPC p95", expr: `histogram_quantile(0.95, sum(rate(grpc_request_duration_seconds_bucket{${jobSelector("chat-service")}}[5m])) by (le))`, gridPos: { h: 4, w: 6, x: 18, y: 0 }, unit: "s", decimals: 3 }),
      timeseries({
        title: "gRPC Request Rate by Method",
        gridPos: { h: 8, w: 12, x: 0, y: 4 },
        targets: [query(`sum(rate(grpc_request_duration_seconds_count{${jobSelector("chat-service")}}[5m])) by (method, status)`, "{{method}} {{status}}")],
        unit: "reqps",
      }),
      timeseries({
        title: "gRPC p95 by Method",
        gridPos: { h: 8, w: 12, x: 12, y: 4 },
        targets: [query(`histogram_quantile(0.95, sum(rate(grpc_request_duration_seconds_bucket{${jobSelector("chat-service")}}[5m])) by (method, le))`, "{{method}}")],
        unit: "s",
      }),
      timeseries({
        title: "Chat Cache Activity",
        gridPos: { h: 8, w: 12, x: 0, y: 12 },
        targets: [
          query(`rate(chat_cache_hits_total{${jobSelector("chat-service")}}[5m])`, "hits", "A"),
          query(`rate(chat_cache_misses_total{${jobSelector("chat-service")}}[5m])`, "misses", "B"),
        ],
        unit: "ops",
      }),
      timeseries({
        title: "Cache Hit Ratio",
        gridPos: { h: 8, w: 12, x: 12, y: 12 },
        targets: [query(`100 * rate(chat_cache_hits_total{${jobSelector("chat-service")}}[5m]) / clamp_min(rate(chat_cache_hits_total{${jobSelector("chat-service")}}[5m]) + rate(chat_cache_misses_total{${jobSelector("chat-service")}}[5m]), 0.001)`, "hit ratio")],
        unit: "percent",
        min: 0,
        max: 100,
      }),
      timeseries({
        title: "Go Runtime",
        gridPos: { h: 8, w: 12, x: 0, y: 20 },
        targets: [
          query(`go_goroutines{${jobSelector("chat-service")}}`, "goroutines", "A"),
          query(`go_memstats_heap_alloc_bytes{${jobSelector("chat-service")}}`, "heap alloc", "B"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Process Runtime",
        gridPos: { h: 8, w: 12, x: 12, y: 20 },
        targets: [
          query(`rate(process_cpu_seconds_total{${jobSelector("chat-service")}}[5m])`, "cpu cores", "A"),
          query(`process_resident_memory_bytes{${jobSelector("chat-service")}}`, "resident memory", "B"),
          query(`process_open_fds{${jobSelector("chat-service")}}`, "open fds", "C"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Container CPU and Memory",
        gridPos: { h: 8, w: 12, x: 0, y: 28 },
        targets: [
          query(containerCpuExpr("chat-service"), "cpu %", "A"),
          query(containerMemoryExpr("chat-service"), "memory", "B"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Container Network and Filesystem",
        gridPos: { h: 8, w: 12, x: 12, y: 28 },
        targets: [
          query(containerFsExpr("chat-service"), "fs used", "A"),
          query(containerRxExpr("chat-service"), "net rx", "B"),
          query(containerTxExpr("chat-service"), "net tx", "C"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Database Errors & DLQ",
        gridPos: { h: 8, w: 12, x: 0, y: 36 },
        targets: [
          query(`sum(rate(chat_dlq_messages_total{${jobSelector("chat-service")}}[5m]))`, "DLQ Messages", "A"),
          query(`sum(rate(chat_database_errors_total{${jobSelector("chat-service")}}[5m])) by (operation)`, "DB Errors {{operation}}", "B"),
        ],
        unit: "ops",
      }),
    ],
  });
}

function buildChatWorkerOverview() {
  resetPanelIds();

  return dashboard({
    title: "Detect AI Chat Worker Overview",
    uid: "detect-ai-chat-worker-overview",
    tags: ["detect-ai", "service", "chat-worker", "detailed"],
    panels: [
      availabilityStat("Availability", `100 * avg(up{${jobSelector("chat-worker")}})`, { h: 4, w: 6, x: 0, y: 0 }),
      stat({ title: "Ingest Rate", expr: `sum(rate(chat_messages_ingested_total{${jobSelector("chat-worker")}}[5m]))`, gridPos: { h: 4, w: 6, x: 6, y: 0 }, unit: "ops", decimals: 2 }),
      stat({ title: "Max Stream Lag", expr: `max(chat_redis_stream_lag{${jobSelector("chat-worker")}})`, gridPos: { h: 4, w: 6, x: 12, y: 0 }, unit: "short", decimals: 0 }),
      stat({ title: "CPU Cores", expr: `rate(process_cpu_seconds_total{${jobSelector("chat-worker")}}[5m])`, gridPos: { h: 4, w: 6, x: 18, y: 0 }, unit: "short", decimals: 3 }),
      timeseries({
        title: "Messages Ingested",
        gridPos: { h: 8, w: 12, x: 0, y: 4 },
        targets: [query(`rate(chat_messages_ingested_total{${jobSelector("chat-worker")}}[5m])`, "ingested")],
        unit: "ops",
      }),
      timeseries({
        title: "Redis Stream Lag by Partition",
        gridPos: { h: 8, w: 12, x: 12, y: 4 },
        targets: [query(`chat_redis_stream_lag{${jobSelector("chat-worker")}}`, "{{partition}}")],
        unit: "short",
      }),
      timeseries({
        title: "Go Runtime",
        gridPos: { h: 8, w: 12, x: 0, y: 12 },
        targets: [
          query(`go_goroutines{${jobSelector("chat-worker")}}`, "goroutines", "A"),
          query(`go_memstats_heap_alloc_bytes{${jobSelector("chat-worker")}}`, "heap alloc", "B"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Process Runtime",
        gridPos: { h: 8, w: 12, x: 12, y: 12 },
        targets: [
          query(`rate(process_cpu_seconds_total{${jobSelector("chat-worker")}}[5m])`, "cpu cores", "A"),
          query(`process_resident_memory_bytes{${jobSelector("chat-worker")}}`, "resident memory", "B"),
          query(`process_open_fds{${jobSelector("chat-worker")}}`, "open fds", "C"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Container CPU and Memory",
        gridPos: { h: 8, w: 12, x: 0, y: 20 },
        targets: [
          query(containerCpuExpr("chat-worker"), "cpu %", "A"),
          query(containerMemoryExpr("chat-worker"), "memory", "B"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Container Network and Filesystem",
        gridPos: { h: 8, w: 12, x: 12, y: 20 },
        targets: [
          query(containerFsExpr("chat-worker"), "fs used", "A"),
          query(containerRxExpr("chat-worker"), "net rx", "B"),
          query(containerTxExpr("chat-worker"), "net tx", "C"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Stream Errors, DB Errors & DLQ",
        gridPos: { h: 8, w: 12, x: 0, y: 28 },
        targets: [
          query(`sum(rate(chat_stream_errors_total{${jobSelector("chat-worker")}}[5m])) by (operation)`, "Stream Errors {{operation}}", "A"),
          query(`sum(rate(chat_database_errors_total{${jobSelector("chat-worker")}}[5m])) by (operation)`, "DB Errors {{operation}}", "B"),
          query(`sum(rate(chat_dlq_messages_total{${jobSelector("chat-worker")}}[5m]))`, "DLQ Messages", "C"),
        ],
        unit: "ops",
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
      availabilityStat("Infra Availability", `100 * avg(up{job=~"${infraJobs}"})`, { h: 4, w: 6, x: 0, y: 0 }),
      stat({ title: "Postgres Connections", expr: "sum(pg_stat_database_numbackends)", gridPos: { h: 4, w: 6, x: 6, y: 0 }, unit: "short" }),
      stat({ title: "Redis Memory Used", expr: `sum(redis_memory_used_bytes{job=~"${redisJobs}"})`, gridPos: { h: 4, w: 6, x: 12, y: 0 }, unit: "bytes" }),
      stat({ title: "RabbitMQ Ready Messages", expr: "sum(rabbitmq_queue_messages_ready)", gridPos: { h: 4, w: 6, x: 18, y: 0 }, unit: "short" }),
      timeseries({
        title: "Infra Availability",
        gridPos: { h: 8, w: 12, x: 0, y: 4 },
        targets: [query(`up{job=~"${infraJobs}"}`, "{{job}}")],
        legendMode: "list",
        tooltipMode: "single",
        panelThresholds: thresholds("absolute", [
          { color: "red", value: 0 },
          { color: "green", value: 1 },
        ]),
      }),
      timeseries({
        title: "Postgres Connections",
        gridPos: { h: 8, w: 12, x: 12, y: 4 },
        targets: [query("sum(pg_stat_database_numbackends) by (instance)", "{{instance}}")],
        unit: "short",
      }),
      timeseries({
        title: "Redis Memory by Instance",
        gridPos: { h: 8, w: 12, x: 0, y: 12 },
        targets: [query(`sum(redis_memory_used_bytes{job=~"${redisJobs}"}) by (job)`, "{{job}}")],
        unit: "bytes",
      }),
      timeseries({
        title: "RabbitMQ Queue Depth",
        gridPos: { h: 8, w: 12, x: 12, y: 12 },
        targets: [
          query("sum(rabbitmq_queue_messages_ready) by (queue)", "{{queue}} ready", "A"),
          query("sum(rabbitmq_queue_messages_unacknowledged) by (queue)", "{{queue}} unacked", "B"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Host CPU and Memory",
        gridPos: { h: 8, w: 12, x: 0, y: 20 },
        targets: [
          query(`100 - (avg(rate(node_cpu_seconds_total{${jobSelector("node")},mode="idle"}[5m])) * 100)`, "cpu busy", "A"),
          query(`100 * (1 - (node_memory_MemAvailable_bytes{${jobSelector("node")}} / node_memory_MemTotal_bytes{${jobSelector("node")}}))`, "memory used", "B"),
        ],
        unit: "percent",
      }),
      timeseries({
        title: "Top Container Resource Usage",
        gridPos: { h: 8, w: 12, x: 12, y: 20 },
        targets: [
          query(`topk(8, 100 * sum by (container_label_com_docker_compose_service) (rate(container_cpu_usage_seconds_total{${cadvisorServiceFilter}}[5m])))`, "{{container_label_com_docker_compose_service}} cpu", "A"),
          query(`topk(8, sum by (container_label_com_docker_compose_service) (container_memory_working_set_bytes{${cadvisorServiceFilter}}))`, "{{container_label_com_docker_compose_service}} mem", "B"),
        ],
        unit: "short",
      }),
    ],
  });
}

function buildHostOverview() {
  resetPanelIds();

  return dashboard({
    title: "Detect AI Host Overview",
    uid: "detect-ai-host-overview",
    tags: ["detect-ai", "infrastructure", "host", "detailed"],
    panels: [
      stat({ title: "CPU Busy", expr: `100 - (avg(rate(node_cpu_seconds_total{${jobSelector("node")},mode="idle"}[5m])) * 100)`, gridPos: { h: 4, w: 6, x: 0, y: 0 }, unit: "percent", decimals: 1, min: 0, max: 100 }),
      stat({ title: "Load per Core", expr: `node_load1{${jobSelector("node")}} / scalar(count(count(node_cpu_seconds_total{${jobSelector("node")},mode="system"}) by (cpu)))`, gridPos: { h: 4, w: 6, x: 6, y: 0 }, unit: "short", decimals: 2 }),
      stat({ title: "Memory Used", expr: `100 * (1 - (node_memory_MemAvailable_bytes{${jobSelector("node")}} / node_memory_MemTotal_bytes{${jobSelector("node")}}))`, gridPos: { h: 4, w: 6, x: 12, y: 0 }, unit: "percent", decimals: 1, min: 0, max: 100 }),
      stat({ title: "Most Full Disk", expr: `max(100 * (1 - (max by (device) (node_filesystem_avail_bytes{${jobSelector("node")},fstype=~"ext4|xfs"}) / max by (device) (node_filesystem_size_bytes{${jobSelector("node")},fstype=~"ext4|xfs"}))))`, gridPos: { h: 4, w: 6, x: 18, y: 0 }, unit: "percent", decimals: 1, min: 0, max: 100 }),
      timeseries({
        title: "CPU by Mode",
        gridPos: { h: 8, w: 12, x: 0, y: 4 },
        targets: [query(`sum(rate(node_cpu_seconds_total{${jobSelector("node")},mode!~"idle|guest.*"}[5m])) by (mode)`, "{{mode}}")],
        unit: "short",
      }),
      timeseries({
        title: "Load Averages",
        gridPos: { h: 8, w: 12, x: 12, y: 4 },
        targets: [
          query(`node_load1{${jobSelector("node")}}`, "load1", "A"),
          query(`node_load5{${jobSelector("node")}}`, "load5", "B"),
          query(`node_load15{${jobSelector("node")}}`, "load15", "C"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Memory Used vs Available",
        gridPos: { h: 8, w: 12, x: 0, y: 12 },
        targets: [
          query(`node_memory_MemTotal_bytes{${jobSelector("node")}} - node_memory_MemAvailable_bytes{${jobSelector("node")}}`, "used", "A"),
          query(`node_memory_MemAvailable_bytes{${jobSelector("node")}}`, "available", "B"),
        ],
        unit: "bytes",
      }),
      timeseries({
        title: "Filesystem Used by Device",
        gridPos: { h: 8, w: 12, x: 12, y: 12 },
        targets: [query(`100 * (1 - (max by (device) (node_filesystem_avail_bytes{${jobSelector("node")},fstype=~"ext4|xfs"}) / max by (device) (node_filesystem_size_bytes{${jobSelector("node")},fstype=~"ext4|xfs"})))`, "{{device}}")],
        unit: "percent",
        min: 0,
        max: 100,
      }),
      timeseries({
        title: "Disk Read and Write Throughput",
        gridPos: { h: 8, w: 12, x: 0, y: 20 },
        targets: [
          query(`sum(rate(node_disk_read_bytes_total{${jobSelector("node")},device!~"loop.*|ram.*"}[5m])) by (device)`, "{{device}} read", "A"),
          query(`sum(rate(node_disk_written_bytes_total{${jobSelector("node")},device!~"loop.*|ram.*"}[5m])) by (device)`, "{{device}} write", "B"),
        ],
        unit: "Bps",
      }),
      timeseries({
        title: "Network Throughput",
        gridPos: { h: 8, w: 12, x: 12, y: 20 },
        targets: [
          query(`sum(rate(node_network_receive_bytes_total{${nodeDeviceFilter}}[5m])) by (device)`, "{{device}} rx", "A"),
          query(`sum(rate(node_network_transmit_bytes_total{${nodeDeviceFilter}}[5m])) by (device)`, "{{device}} tx", "B"),
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
    tags: ["detect-ai", "infrastructure", "containers", "detailed"],
    panels: [
      stat({ title: "Running Containers", expr: `count(container_start_time_seconds{${cadvisorServiceFilter}})`, gridPos: { h: 4, w: 6, x: 0, y: 0 } }),
      stat({ title: "Total Container CPU", expr: `100 * sum(rate(container_cpu_usage_seconds_total{${cadvisorServiceFilter}}[5m]))`, gridPos: { h: 4, w: 6, x: 6, y: 0 }, unit: "percent", decimals: 1 }),
      stat({ title: "Total Container Memory", expr: `sum(container_memory_working_set_bytes{${cadvisorServiceFilter}})`, gridPos: { h: 4, w: 6, x: 12, y: 0 }, unit: "bytes" }),
      stat({ title: "OOM Events", expr: `sum(container_oom_events_total{${cadvisorServiceFilter}})`, gridPos: { h: 4, w: 6, x: 18, y: 0 } }),
      timeseries({
        title: "Container Count by Service",
        gridPos: { h: 8, w: 12, x: 0, y: 4 },
        targets: [query(`count by (container_label_com_docker_compose_service) (container_start_time_seconds{${cadvisorServiceFilter}})`, "{{container_label_com_docker_compose_service}}")],
        unit: "short",
      }),
      timeseries({
        title: "Top Container CPU",
        gridPos: { h: 8, w: 12, x: 12, y: 4 },
        targets: [query(`topk(12, 100 * sum by (container_label_com_docker_compose_service) (rate(container_cpu_usage_seconds_total{${cadvisorServiceFilter}}[5m])))`, "{{container_label_com_docker_compose_service}}")],
        unit: "percent",
      }),
      timeseries({
        title: "Top Container Memory",
        gridPos: { h: 8, w: 12, x: 0, y: 12 },
        targets: [query(`topk(12, sum by (container_label_com_docker_compose_service) (container_memory_working_set_bytes{${cadvisorServiceFilter}}))`, "{{container_label_com_docker_compose_service}}")],
        unit: "bytes",
      }),
      timeseries({
        title: "Top Container Filesystem Usage",
        gridPos: { h: 8, w: 12, x: 12, y: 12 },
        targets: [query(`topk(12, sum by (container_label_com_docker_compose_service) (container_fs_usage_bytes{${cadvisorServiceFilter}}))`, "{{container_label_com_docker_compose_service}}")],
        unit: "bytes",
      }),
      timeseries({
        title: "Top Container Network Receive",
        gridPos: { h: 8, w: 12, x: 0, y: 20 },
        targets: [query(`topk(12, sum by (container_label_com_docker_compose_service) (rate(container_network_receive_bytes_total{${cadvisorServiceFilter}}[5m])))`, "{{container_label_com_docker_compose_service}}")],
        unit: "Bps",
      }),
      timeseries({
        title: "Top Container Network Transmit",
        gridPos: { h: 8, w: 12, x: 12, y: 20 },
        targets: [query(`topk(12, sum by (container_label_com_docker_compose_service) (rate(container_network_transmit_bytes_total{${cadvisorServiceFilter}}[5m])))`, "{{container_label_com_docker_compose_service}}")],
        unit: "Bps",
      }),
    ],
  });
}

function buildPostgresOverview() {
  resetPanelIds();

  return dashboard({
    title: "Detect AI Postgres Overview",
    uid: "detect-ai-postgres-overview",
    tags: ["detect-ai", "infrastructure", "postgres", "detailed"],
    panels: [
      availabilityStat("Availability", '100 * avg(up{job=~"postgres-primary|postgres-replica"})', { h: 4, w: 6, x: 0, y: 0 }),
      stat({ title: "Connections", expr: "sum(pg_stat_database_numbackends)", gridPos: { h: 4, w: 6, x: 6, y: 0 }, unit: "short" }),
      stat({ title: "Connection Saturation", expr: "100 * max(sum by (instance) (pg_stat_database_numbackends) / on(instance) pg_settings_max_connections)", gridPos: { h: 4, w: 6, x: 12, y: 0 }, unit: "percent", decimals: 1, min: 0, max: 100 }),
      stat({ title: "Replication Lag", expr: "max(pg_replication_lag_seconds)", gridPos: { h: 4, w: 6, x: 18, y: 0 }, unit: "s", decimals: 2 }),
      timeseries({
        title: "Connections by Instance",
        gridPos: { h: 8, w: 12, x: 0, y: 4 },
        targets: [query("sum(pg_stat_database_numbackends) by (instance)", "{{instance}}")],
        unit: "short",
      }),
      timeseries({
        title: "Connection Saturation",
        gridPos: { h: 8, w: 12, x: 12, y: 4 },
        targets: [query("100 * sum by (instance) (pg_stat_database_numbackends) / on(instance) pg_settings_max_connections", "{{instance}}")],
        unit: "percent",
        min: 0,
        max: 100,
      }),
      timeseries({
        title: "Transactions",
        gridPos: { h: 8, w: 12, x: 0, y: 12 },
        targets: [
          query("sum(rate(pg_stat_database_xact_commit[5m])) by (instance)", "{{instance}} commit", "A"),
          query("sum(rate(pg_stat_database_xact_rollback[5m])) by (instance)", "{{instance}} rollback", "B"),
        ],
        unit: "ops",
      }),
      timeseries({
        title: "Cache Hit Ratio",
        gridPos: { h: 8, w: 12, x: 12, y: 12 },
        targets: [query("100 * sum by (instance) (rate(pg_stat_database_blks_hit[5m])) / clamp_min(sum by (instance) (rate(pg_stat_database_blks_hit[5m]) + rate(pg_stat_database_blks_read[5m])), 0.001)", "{{instance}}")],
        unit: "percent",
        min: 0,
        max: 100,
      }),
      timeseries({
        title: "Database Size",
        gridPos: { h: 8, w: 12, x: 0, y: 20 },
        targets: [query("sum(pg_database_size_bytes) by (instance)", "{{instance}}")],
        unit: "bytes",
      }),
      timeseries({
        title: "Deadlocks and Temp Bytes",
        gridPos: { h: 8, w: 12, x: 12, y: 20 },
        targets: [
          query("sum(rate(pg_stat_database_deadlocks[5m])) by (instance)", "{{instance}} deadlocks", "A"),
          query("sum(rate(pg_stat_database_temp_bytes[5m])) by (instance)", "{{instance}} temp bytes", "B"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Replication Lag",
        gridPos: { h: 8, w: 12, x: 0, y: 28 },
        targets: [query("max(pg_replication_lag_seconds) by (instance)", "{{instance}}")],
        unit: "s",
      }),
      timeseries({
        title: "WAL and Activity",
        gridPos: { h: 8, w: 12, x: 12, y: 28 },
        targets: [
          query("pg_wal_size_bytes", "{{instance}} wal size", "A"),
          query("sum(pg_stat_activity_count) by (instance)", "{{instance}} activity", "B"),
        ],
        unit: "short",
      }),
    ],
  });
}

function buildRedisOverview() {
  resetPanelIds();

  return dashboard({
    title: "Detect AI Redis Overview",
    uid: "detect-ai-redis-overview",
    tags: ["detect-ai", "infrastructure", "redis", "detailed"],
    panels: [
      availabilityStat("Availability", `100 * avg(up{job=~"${redisJobs}"})`, { h: 4, w: 6, x: 0, y: 0 }),
      stat({ title: "Memory Used", expr: `sum(redis_memory_used_bytes{job=~"${redisJobs}"})`, gridPos: { h: 4, w: 6, x: 6, y: 0 }, unit: "bytes" }),
      stat({ title: "Connected Clients", expr: `sum(redis_connected_clients{job=~"${redisJobs}"})`, gridPos: { h: 4, w: 6, x: 12, y: 0 }, unit: "short" }),
      stat({ title: "Commands/sec", expr: `sum(rate(redis_commands_processed_total{job=~"${redisJobs}"}[5m]))`, gridPos: { h: 4, w: 6, x: 18, y: 0 }, unit: "ops", decimals: 2 }),
      timeseries({
        title: "Memory Used",
        gridPos: { h: 8, w: 12, x: 0, y: 4 },
        targets: [query(`sum(redis_memory_used_bytes{job=~"${redisJobs}"}) by (job)`, "{{job}}")],
        unit: "bytes",
      }),
      timeseries({
        title: "Memory Fragmentation Ratio",
        gridPos: { h: 8, w: 12, x: 12, y: 4 },
        targets: [query(`avg(redis_mem_fragmentation_ratio{job=~"${redisJobs}"}) by (job)`, "{{job}}")],
        unit: "short",
      }),
      timeseries({
        title: "Connected Clients and Blocked Clients",
        gridPos: { h: 8, w: 12, x: 0, y: 12 },
        targets: [
          query(`sum(redis_connected_clients{job=~"${redisJobs}"}) by (job)`, "{{job}} connected", "A"),
          query(`sum(redis_blocked_clients{job=~"${redisJobs}"}) by (job)`, "{{job}} blocked", "B"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Commands Processed Rate",
        gridPos: { h: 8, w: 12, x: 12, y: 12 },
        targets: [query(`sum(rate(redis_commands_processed_total{job=~"${redisJobs}"}[5m])) by (job)`, "{{job}}")],
        unit: "ops",
      }),
      timeseries({
        title: "Keyspace Hit Ratio",
        gridPos: { h: 8, w: 12, x: 0, y: 20 },
        targets: [query(`100 * sum by (job) (rate(redis_keyspace_hits_total{job=~"${redisJobs}"}[5m])) / clamp_min(sum by (job) (rate(redis_keyspace_hits_total{job=~"${redisJobs}"}[5m]) + rate(redis_keyspace_misses_total{job=~"${redisJobs}"}[5m])), 0.001)`, "{{job}}")],
        unit: "percent",
        min: 0,
        max: 100,
      }),
      timeseries({
        title: "Expired and Evicted Keys",
        gridPos: { h: 8, w: 12, x: 12, y: 20 },
        targets: [
          query(`sum(rate(redis_expired_keys_total{job=~"${redisJobs}"}[5m])) by (job)`, "{{job}} expired", "A"),
          query(`sum(rate(redis_evicted_keys_total{job=~"${redisJobs}"}[5m])) by (job)`, "{{job}} evicted", "B"),
        ],
        unit: "ops",
      }),
      timeseries({
        title: "Network I/O",
        gridPos: { h: 8, w: 12, x: 0, y: 28 },
        targets: [
          query(`sum(rate(redis_net_input_bytes_total{job=~"${redisJobs}"}[5m])) by (job)`, "{{job}} in", "A"),
          query(`sum(rate(redis_net_output_bytes_total{job=~"${redisJobs}"}[5m])) by (job)`, "{{job}} out", "B"),
        ],
        unit: "Bps",
      }),
      timeseries({
        title: "Replication and Cluster Health",
        gridPos: { h: 8, w: 12, x: 12, y: 28 },
        targets: [
          query('redis_master_link_up{job=~"redis-slave-1|redis-slave-2"}', "{{job}} master link", "A"),
          query('redis_cluster_state{job=~"redis-usage-0|redis-usage-1|redis-usage-2"}', "{{job}} cluster state", "B"),
        ],
        unit: "short",
      }),
    ],
  });
}

function buildRabbitmqOverview() {
  resetPanelIds();

  return dashboard({
    title: "Detect AI RabbitMQ Overview",
    uid: "detect-ai-rabbitmq-overview",
    tags: ["detect-ai", "infrastructure", "rabbitmq", "detailed"],
    panels: [
      availabilityStat("Availability", `100 * avg(up{${jobSelector("rabbitmq")}})`, { h: 4, w: 6, x: 0, y: 0 }),
      stat({ title: "Ready Messages", expr: "sum(rabbitmq_queue_messages_ready)", gridPos: { h: 4, w: 6, x: 6, y: 0 }, unit: "short" }),
      stat({ title: "Consumers", expr: "sum(rabbitmq_queue_consumers)", gridPos: { h: 4, w: 6, x: 12, y: 0 }, unit: "short" }),
      stat({ title: "Connections", expr: "sum(rabbitmq_connections)", gridPos: { h: 4, w: 6, x: 18, y: 0 }, unit: "short" }),
      timeseries({
        title: "Queue Depth",
        gridPos: { h: 8, w: 12, x: 0, y: 4 },
        targets: [
          query("sum(rabbitmq_queue_messages_ready) by (queue)", "{{queue}} ready", "A"),
          query("sum(rabbitmq_queue_messages_unacknowledged) by (queue)", "{{queue}} unacked", "B"),
          query("sum(rabbitmq_queue_messages) by (queue)", "{{queue}} total", "C"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Publish, Deliver, Ack Rates",
        gridPos: { h: 8, w: 12, x: 12, y: 4 },
        targets: [
          query("sum(rate(rabbitmq_queue_messages_published_total[5m])) by (queue)", "{{queue}} published", "A"),
          query("sum(rate(rabbitmq_queue_messages_delivered_total[5m])) by (queue)", "{{queue}} delivered", "B"),
          query("sum(rate(rabbitmq_queue_messages_ack_total[5m])) by (queue)", "{{queue}} ack", "C"),
        ],
        unit: "ops",
      }),
      timeseries({
        title: "Consumers and Utilization",
        gridPos: { h: 8, w: 12, x: 0, y: 12 },
        targets: [
          query("sum(rabbitmq_queue_consumers) by (queue)", "{{queue}} consumers", "A"),
          query("avg(rabbitmq_queue_consumer_utilisation) by (queue)", "{{queue}} utilisation", "B"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Connections and Channels",
        gridPos: { h: 8, w: 12, x: 12, y: 12 },
        targets: [
          query("rabbitmq_connections", "connections", "A"),
          query("rabbitmq_channels", "channels", "B"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Node Memory",
        gridPos: { h: 8, w: 12, x: 0, y: 20 },
        targets: [
          query("rabbitmq_node_mem_used", "used", "A"),
          query("rabbitmq_node_mem_limit", "limit", "B"),
        ],
        unit: "bytes",
      }),
      timeseries({
        title: "Disk Free and FD Usage",
        gridPos: { h: 8, w: 12, x: 12, y: 20 },
        targets: [
          query("rabbitmq_node_disk_free", "disk free", "A"),
          query("rabbitmq_node_disk_free_limit", "disk free limit", "B"),
          query("rabbitmq_fd_used", "fd used", "C"),
          query("rabbitmq_fd_available", "fd available", "D"),
        ],
        unit: "short",
      }),
    ],
  });
}

function buildMongodbOverview() {
  resetPanelIds();

  return dashboard({
    title: "Detect AI MongoDB Overview",
    uid: "detect-ai-mongodb-overview",
    tags: ["detect-ai", "infrastructure", "mongodb", "detailed"],
    panels: [
      availabilityStat("Availability", '100 * avg(mongodb_up)', { h: 4, w: 6, x: 0, y: 0 }),
      stat({ title: "Chat DB Data Size", expr: `sum(mongodb_dbstats_dataSize{${jobSelector("mongodb")},database="chat_db"})`, gridPos: { h: 4, w: 6, x: 6, y: 0 }, unit: "bytes" }),
      stat({ title: "Chat DB Index Size", expr: `sum(mongodb_dbstats_indexSize{${jobSelector("mongodb")},database="chat_db"})`, gridPos: { h: 4, w: 6, x: 12, y: 0 }, unit: "bytes" }),
      stat({ title: "Chat DB Objects", expr: `sum(mongodb_dbstats_objects{${jobSelector("mongodb")},database="chat_db"})`, gridPos: { h: 4, w: 6, x: 18, y: 0 }, unit: "short" }),
      timeseries({
        title: "Data Size by Database",
        gridPos: { h: 8, w: 12, x: 0, y: 4 },
        targets: [query(`sum(mongodb_dbstats_dataSize{${jobSelector("mongodb")}}) by (database)`, "{{database}}")],
        unit: "bytes",
      }),
      timeseries({
        title: "Storage and Index Size by Database",
        gridPos: { h: 8, w: 12, x: 12, y: 4 },
        targets: [
          query(`sum(mongodb_dbstats_storageSize{${jobSelector("mongodb")}}) by (database)`, "{{database}} storage", "A"),
          query(`sum(mongodb_dbstats_indexSize{${jobSelector("mongodb")}}) by (database)`, "{{database}} index", "B"),
        ],
        unit: "bytes",
      }),
      timeseries({
        title: "Objects and Index Count by Database",
        gridPos: { h: 8, w: 12, x: 0, y: 12 },
        targets: [
          query(`sum(mongodb_dbstats_objects{${jobSelector("mongodb")}}) by (database)`, "{{database}} objects", "A"),
          query(`sum(mongodb_dbstats_indexes{${jobSelector("mongodb")}}) by (database)`, "{{database}} indexes", "B"),
        ],
        unit: "short",
      }),
      timeseries({
        title: "Average Object Size",
        gridPos: { h: 8, w: 12, x: 12, y: 12 },
        targets: [query(`avg(mongodb_dbstats_avgObjSize{${jobSelector("mongodb")}}) by (database)`, "{{database}}")],
        unit: "bytes",
      }),
      timeseries({
        title: "Mongo Cluster Containers CPU",
        gridPos: { h: 8, w: 12, x: 0, y: 20 },
        targets: [query(`100 * sum by (container_label_com_docker_compose_service) (rate(container_cpu_usage_seconds_total{${jobSelector("cadvisor")},container_label_com_docker_compose_service=~"${mongoContainerJobs}",id!="/"}[5m]))`, "{{container_label_com_docker_compose_service}}")],
        unit: "percent",
      }),
      timeseries({
        title: "Mongo Cluster Containers Memory",
        gridPos: { h: 8, w: 12, x: 12, y: 20 },
        targets: [query(`sum by (container_label_com_docker_compose_service) (container_memory_working_set_bytes{${jobSelector("cadvisor")},container_label_com_docker_compose_service=~"${mongoContainerJobs}",id!="/"})`, "{{container_label_com_docker_compose_service}}")],
        unit: "bytes",
      }),
      timeseries({
        title: "Mongo Cluster Containers Filesystem",
        gridPos: { h: 8, w: 12, x: 0, y: 28 },
        targets: [query(`sum by (container_label_com_docker_compose_service) (container_fs_usage_bytes{${jobSelector("cadvisor")},container_label_com_docker_compose_service=~"${mongoContainerJobs}",id!="/"})`, "{{container_label_com_docker_compose_service}}")],
        unit: "bytes",
      }),
      timeseries({
        title: "Mongo Cluster Containers Network",
        gridPos: { h: 8, w: 12, x: 12, y: 28 },
        targets: [
          query(`sum by (container_label_com_docker_compose_service) (rate(container_network_receive_bytes_total{${jobSelector("cadvisor")},container_label_com_docker_compose_service=~"${mongoContainerJobs}",id!="/"}[5m]))`, "{{container_label_com_docker_compose_service}} rx", "A"),
          query(`sum by (container_label_com_docker_compose_service) (rate(container_network_transmit_bytes_total{${jobSelector("cadvisor")},container_label_com_docker_compose_service=~"${mongoContainerJobs}",id!="/"}[5m]))`, "{{container_label_com_docker_compose_service}} tx", "B"),
        ],
        unit: "Bps",
      }),
    ],
  });
}

const k8sDashboardsRoot = path.resolve(__dirname, "../../../k8s/charts/detect-ai/templates/observability/dashboards");

async function writeDashboard(folder, filename, spec) {
  const dir = path.join(dashboardsRoot, folder);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), `${JSON.stringify(spec, null, 2)}\n`);
  
  const cleanName = filename.replace(/\.json$/, "").replace(/^\d+-/, "");
  const yamlFilename = `detect-ai-dashboard-${cleanName}.yaml`;
  const specJsonStr = JSON.stringify(spec, null, 2);
  const indentedJson = specJsonStr.split("\n").map(line => `    ${line}`).join("\n");
  
  const content = `{{- if and .Values.monitoring.enabled (index .Values.monitoring "kube-prometheus-stack" "enabled") }}
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "detect-ai.fullname" . }}-db-${cleanName}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "detect-ai.labels" . | nindent 4 }}
    grafana_dashboard: "1"
  annotations:
    grafana_dashboard_folder: "${folder.charAt(0).toUpperCase() + folder.slice(1)}"
data:
  ${filename}: |
${indentedJson}
{{- end }}
`;
  
  await mkdir(k8sDashboardsRoot, { recursive: true });
  await writeFile(path.join(k8sDashboardsRoot, yamlFilename), content);
}

async function main() {
  await mkdir(dashboardsRoot, { recursive: true });
  await rm(path.join(dashboardsRoot, "app-overview.json"), { force: true });
  await rm(path.join(dashboardsRoot, "infra-overview.json"), { force: true });
  await rm(k8sDashboardsRoot, { recursive: true, force: true });

  const dashboards = [
    ["overview", "01-platform-overview.json", buildPlatformOverview()],
    ["services", "01-service-overview.json", buildServiceOverview()],
    ["services", "02-frontend-overview.json", buildFrontendOverview()],
    ["services", "03-payments-overview.json", buildPaymentsOverview()],
    ["services", "04-inference-overview.json", buildInferenceOverview()],
    ["services", "05-workers-overview.json", buildWorkersOverview()],
    ["services", "06-document-parser-overview.json", buildDocumentParserOverview()],
    ["services", "07-chat-service-overview.json", buildChatServiceOverview()],
    ["services", "08-chat-worker-overview.json", buildChatWorkerOverview()],
    ["services", "09-inference-operations-overview.json", buildInferenceOperationsOverview()],
    ["services", "10-inference-traffic-overview.json", buildInferenceTrafficOverview()],
    ["infrastructure", "01-infrastructure-overview.json", buildInfrastructureOverview()],
    ["infrastructure", "02-host-overview.json", buildHostOverview()],
    ["infrastructure", "03-container-overview.json", buildContainerOverview()],
    ["infrastructure", "04-postgres-overview.json", buildPostgresOverview()],
    ["infrastructure", "05-redis-overview.json", buildRedisOverview()],
    ["infrastructure", "06-rabbitmq-overview.json", buildRabbitmqOverview()],
    ["infrastructure", "07-mongodb-overview.json", buildMongodbOverview()],
  ];

  for (const [folder, filename, spec] of dashboards) {
    await writeDashboard(folder, filename, spec);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
