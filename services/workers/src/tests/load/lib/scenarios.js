import { config, thresholds } from './config.js';
import { baseThresholds } from './thresholds.js';

// Scenario matrix shared by the queue-backed workers (payments/analytics):
// - smoke:  short sanity run; VUS/DURATION overrides honoured.
// - load:   steady constant-arrival-rate at RPS for DURATION.
// - stress: ramps to 3x RPS (floor: peakFloor) then back to 0.
// - soak:   long low-rate run; defaults to 5 rps for 10m unless overridden.
// - edge:   invalid-payload battery only, with its own thresholds so the
//           intentional 400s never touch the happy-path SLOs.
export function buildOptions({ vus, duration, rps, peakFloor }) {
    if (config.scenario === 'edge') {
        return {
            vus: config.vusOverride || 2,
            duration: config.durationOverride || '1m',
            thresholds: {
                checks: [`rate>=${thresholds.successRate}`],
                worker_negative_check: [`rate>=${thresholds.negativeRate}`],
                // Edge publishes nothing, so the per-iteration gates do not
                // apply, but teardown still runs and still proves the rig did
                // not quietly skip it or ignore the worker's own state.
                worker_health_check: ['rate==1'],
                worker_teardown_runs: ['count>0'],
            },
        };
    }

    if (config.scenario === 'invalid') {
        return {
            vus: config.vusOverride || 2,
            duration: config.durationOverride || '30s',
            thresholds: {
                checks: [`rate>=${thresholds.successRate}`],
                // rate==1, not >=: every payload here must get through the proxy
                // so it can reach the worker. One silent proxy rejection would
                // mean the run exercised worker validation with zero samples.
                worker_invalid_check: ['rate==1'],
                worker_health_check: ['rate==1'],
                worker_teardown_runs: ['count>0'],
            },
        };
    }

    if (config.scenario === 'smoke') {
        return {
            vus: config.vusOverride || 2,
            duration: config.durationOverride || '30s',
            thresholds: baseThresholds(),
        };
    }

    if (config.scenario === 'soak') {
        return {
            scenarios: {
                soak: {
                    executor: 'constant-arrival-rate',
                    rate: config.rpsOverride || 5,
                    timeUnit: '1s',
                    // A soak that inherits the 30s load default is not a soak.
                    duration: config.durationOverride || '10m',
                    preAllocatedVUs: Math.min(vus, 10),
                    // Derived like the other executors rather than pinned to 50:
                    // a soak at 5 it/s with a long verify budget can need more
                    // than a hardcoded ceiling, and one that needs fewer should
                    // not be told to allocate 50 up front.
                    maxVUs: Math.min(Math.max(vus * 4, 50), 200),
                },
            },
            thresholds: baseThresholds(),
        };
    }

    if (config.scenario === 'stress') {
        const peak = Math.max(rps * 3, peakFloor);
        return {
            scenarios: {
                stress: {
                    executor: 'ramping-arrival-rate',
                    // Must not exceed the first stage's target, or the ramp
                    // starts above where it is supposed to be going.
                    startRate: Math.min(5, rps),
                    timeUnit: '1s',
                    preAllocatedVUs: vus,
                    maxVUs: Math.min(Math.max(vus * 4, 50), 200),
                    stages: [
                        { duration: '1m', target: rps },
                        { duration: '2m', target: peak },
                        { duration: '1m', target: 0 },
                    ],
                },
            },
            thresholds: baseThresholds(),
        };
    }

    return {
        scenarios: {
            constant_request_rate: {
                executor: 'constant-arrival-rate',
                rate: rps,
                timeUnit: '1s',
                duration,
                preAllocatedVUs: vus,
                maxVUs: Math.min(Math.max(vus * 4, 50), 200),
            },
        },
        thresholds: baseThresholds(),
    };
}
