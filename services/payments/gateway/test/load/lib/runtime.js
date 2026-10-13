import http from 'k6/http';

// Go runtime sampling for soak leak detection. Scrapes the gateway
// /metrics endpoint and extracts goroutine and RSS gauges.
export function sampleRuntime(baseUrl) {
    const res = http.get(`${baseUrl}/metrics`, { timeout: '10s' });
    if (res.status !== 200) {
        return null;
    }
    return {
        goroutines: parseGauge(res.body, 'go_goroutines'),
        rssBytes: parseGauge(res.body, 'process_resident_memory_bytes'),
    };
}

function parseGauge(body, name) {
    const m = body.match(new RegExp('^' + name + '(\\{[^}]*\\})?\\s+([0-9.eE+-]+)', 'm'));
    return m ? parseFloat(m[2]) : null;
}

// Sum of payment_events_published_total{status="success"} across event types.
export function publishedSuccessTotal(baseUrl) {
    const res = http.get(`${baseUrl}/metrics`, { timeout: '10s' });
    if (res.status !== 200) {
        return null;
    }
    let total = 0;
    const re = /^payment_events_published_total\{[^}]*status="success"[^}]*\}\s+([0-9.eE+-]+)/gm;
    let m;
    while ((m = re.exec(res.body)) !== null) {
        total += parseFloat(m[1]);
    }
    return total;
}

// Sum of http_request_errors_total for one status code (e.g. "503").
export function errorTotal(baseUrl, code) {
    const res = http.get(`${baseUrl}/metrics`, { timeout: '10s' });
    if (res.status !== 200) {
        return null;
    }
    let total = 0;
    const re = new RegExp('^http_request_errors_total\\{[^}]*status_code="' + code + '"[^}]*\\}\\s+([0-9.eE+-]+)', 'gm');
    let m;
    while ((m = re.exec(res.body)) !== null) {
        total += parseFloat(m[1]);
    }
    return total;
}

export function checkRuntimeStable(baseline, current) {
    if (baseline == null || current == null) {
        return [{ name: 'runtime samples readable', ok: false }];
    }
    if (baseline.goroutines == null || current.goroutines == null || baseline.rssBytes == null || current.rssBytes == null) {
        return [{ name: 'runtime gauges present', ok: false }];
    }
    const maxGoroutineGrowth = parseInt(__ENV.SOAK_MAX_GOROUTINE_GROWTH || '100');
    const maxRssGrowthPct = parseFloat(__ENV.SOAK_MAX_RSS_GROWTH_PCT || '50');
    const goroutineGrowth = current.goroutines - baseline.goroutines;
    const rssGrowthPct = baseline.rssBytes > 0 ? ((current.rssBytes - baseline.rssBytes) / baseline.rssBytes) * 100 : 0;
    return [
        { name: `goroutine growth ${goroutineGrowth} <= ${maxGoroutineGrowth}`, ok: goroutineGrowth <= maxGoroutineGrowth },
        { name: `rss growth ${rssGrowthPct.toFixed(1)}% <= ${maxRssGrowthPct}%`, ok: rssGrowthPct <= maxRssGrowthPct },
    ];
}
