// Summary helpers. A metric can be absent when its scenario never emitted a
// sample, so every read falls back instead of throwing inside handleSummary.
export function metricValue(data, name, key, fallback = 'n/a') {
    const metric = data.metrics[name];
    if (!metric) return fallback;
    const value = metric.values[key];
    return typeof value === 'number' ? value : fallback;
}

export function metricRate(data, name) {
    const value = metricValue(data, name, 'rate');
    return value === 'n/a' ? value : value.toFixed(4);
}

export function metricCount(data, name) {
    return metricValue(data, name, 'count');
}

export function metricP(data, name, percentile) {
    const value = metricValue(data, name, `p(${percentile})`);
    return value === 'n/a' ? value : value.toFixed(1);
}

export function printSummary(lines) {
    return { stdout: lines.filter(Boolean).join('\n') + '\n' };
}
