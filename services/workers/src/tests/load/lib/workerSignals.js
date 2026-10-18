import http from 'k6/http';
import { sleep } from 'k6';
import { config } from './config.js';
import { workerMetrics } from './metrics.js';

// Minimal Prometheus text parser: enough for prom-client exposition lines
// (`name{labels} value [timestamp]`). Comments and individual series are kept;
// callers select what they need via seriesValue.
//
// The label group is `(?:\\.|[^{}])*`, not `(?:[^"\\]|\\.)*`: excluding the
// quote character means a quoted label value can never be matched, so the whole
// optional group fails and every labelled series silently drops out of the
// parse. That is invisible in the summary (a dropped series reads as 0) but it
// turns every `exact: 0` assertion into a vacuous pass. The escape alternative
// is listed first so `\"` and `\}` inside a value are consumed as a unit.
const LINE_RE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{(?:\\.|[^{}])*\})?\s+(\S+)/;

export function parsePrometheus(text) {
    const series = [];
    for (const line of text.split('\n')) {
        if (!line || line.startsWith('#')) continue;
        const match = line.match(LINE_RE);
        if (!match) continue;
        const value = Number(match[3]);
        if (!Number.isFinite(value)) continue;
        series.push({ name: match[1], labels: parseLabels(match[2] || ''), value });
    }
    return series;
}

function parseLabels(raw) {
    const labels = {};
    const re = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;
    let match;
    while ((match = re.exec(raw)) !== null) {
        labels[match[1]] = match[2].replace(/\\(["\\])/g, '$1');
    }
    return labels;
}

// Sums every series with this name whose labels are a superset of expectedLabels.
// A missing series sums to 0, which is the correct reading for counters that
// were never incremented.
export function seriesValue(series, name, expectedLabels = {}) {
    let sum = 0;
    for (const sample of series) {
        if (sample.name !== name) continue;
        let matches = true;
        for (const [key, value] of Object.entries(expectedLabels)) {
            if (sample.labels[key] !== value) { matches = false; break; }
        }
        if (matches) sum += sample.value;
    }
    return sum;
}

// Scrapes and health probes run outside the measured ingest/verify traffic.
// Tagging them `probe` keeps them out of the phase-scoped http_req_* thresholds
// in thresholds.js (a dropped /metrics read is a rig problem, not a worker SLO).
const PROBE_PARAMS = { tags: { phase: 'probe' } };

export function fetchWorkerSeries(url) {
    try {
        const res = http.get(url, PROBE_PARAMS);
        if (res.status !== 200) return null;
        return parsePrometheus(res.body);
    } catch (e) {
        return null;
    }
}

// Unix seconds the worker process booted. CollectsDefaultMetrics always exposes
// this, so it is the cheapest restart detector available: a container that
// restarts mid-run resets every in-process counter, which otherwise makes a
// partially-observed run indistinguishable from a clean one.
export function processStartTime(url) {
    const series = fetchWorkerSeries(url);
    if (!series) return null;
    for (const sample of series) {
        if (sample.name === 'process_start_time_seconds') return sample.value;
    }
    return null;
}

// Teardown assertions land on worker_health_check instead of check() so a
// failed signal cannot be diluted by thousands of in-run checks.
export function recordHealth(label, ok, detail = '') {
    workerMetrics.healthCheck.add(ok);
    const suffix = detail ? ` (${detail})` : '';
    if (ok) console.log(`worker signal ok: ${label}${suffix}`);
    else console.error(`worker signal FAILED: ${label}${suffix}`);
    return ok;
}

// Asserts a single worker-side value: exact match, lower bound, or both.
export function assertSeries(series, label, name, { labels = {}, exact, min } = {}) {
    if (!series) return recordHealth(label, false, 'no /metrics response');
    const value = seriesValue(series, name, labels);
    let ok = true;
    if (exact !== undefined) ok = value === exact;
    if (min !== undefined) ok = ok && value >= min;
    const where = Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',');
    return recordHealth(label, ok, `${name}${where ? `{${where}}` : ''}=${value}`);
}

// Polls /metrics until predicate(series) holds. The cron gauge that reports
// "backlog drained" is only reset by the next empty sweep, so a one-shot read
// right after the drain check races that sweep.
// Inverse of assertQueueEmpty. The invalid-payload scenario needs messages to
// land in the DLQ, so "non-empty" is the passing state there. Polls because a
// message is dead-lettered when it is rejected, which is after the publish that
// scheduled it.
export function assertQueueNotEmpty(queue) {
    const deadline = Date.now() + config.signalTimeoutMs;
    let depth = null;
    while (Date.now() < deadline) {
        depth = queueDepth(queue);
        if (depth && depth.messageCount > 0) break;
        sleep(config.signalPollMs / 1000);
    }
    const ok = !!depth && depth.messageCount > 0;
    return recordHealth(`${queue} received dead letters`, ok, depth ? `messageCount=${depth.messageCount}` : 'no /queue-depth response');
}

export function waitForWorkerSignal(url, predicate) {
    const deadline = Date.now() + config.signalTimeoutMs;
    let series = null;
    while (Date.now() < deadline) {
        series = fetchWorkerSeries(url);
        if (series && predicate(series)) return series;
        sleep(config.signalPollMs / 1000);
    }
    return series;
}

export function queueDepth(queue) {
    try {
        const res = http.get(`${config.proxyUrl}/queue-depth?queue=${queue}`, PROBE_PARAMS);
        if (res.status !== 200) return null;
        return res.json();
    } catch (e) {
        return null;
    }
}

// Events the proxy got a broker confirm for. Teardown reconciles this against
// the worker's own counters; null means the stats endpoint is unreachable.
export function publishedCounts() {
    try {
        const res = http.get(`${config.proxyUrl}/stats`, PROBE_PARAMS);
        if (res.status !== 200) return null;
        const body = res.json();
        return (body && typeof body.published === 'object' && body.published) ? body.published : null;
    } catch (e) {
        return null;
    }
}

// A failed message sits in the retry queue for its TTL before it is dead-lettered
// or returns to the main queue, so "drained" is only meaningful after retries land.
export function assertQueueDrained(queue) {
    const deadline = Date.now() + config.signalTimeoutMs;
    let depth = null;
    while (Date.now() < deadline) {
        depth = queueDepth(queue);
        if (depth && depth.messageCount === 0) break;
        sleep(config.signalPollMs / 1000);
    }
    const ok = !!depth && depth.messageCount === 0;
    return recordHealth(`${queue} drained`, ok, depth ? `messageCount=${depth.messageCount}` : 'no /queue-depth response');
}

// Same retry loop as assertQueueDrained: a message dead-lettering at the moment
// teardown starts would otherwise be missed by a single-shot read.
export function assertQueueEmpty(queue) {
    const deadline = Date.now() + config.signalTimeoutMs;
    let depth = null;
    while (Date.now() < deadline) {
        depth = queueDepth(queue);
        if (depth && depth.messageCount === 0) break;
        sleep(config.signalPollMs / 1000);
    }
    const ok = !!depth && depth.messageCount === 0;
    return recordHealth(`${queue} empty`, ok, depth ? `messageCount=${depth.messageCount}` : 'no /queue-depth response');
}

// Polls /metrics until accountedFor(series) covers every event the proxy
// published. Draining the queue proves the broker is empty, not that the last
// in-flight message has been counted, so a one-shot read would under-report.
export function waitForAccounted(url, published, accountedFor) {
    const deadline = Date.now() + config.signalTimeoutMs;
    let series = null;
    let accounted = 0;
    while (Date.now() < deadline) {
        series = fetchWorkerSeries(url);
        if (series) {
            accounted = accountedFor(series);
            if (accounted >= published) break;
        }
        sleep(config.signalPollMs / 1000);
    }
    return { series, accounted };
}
