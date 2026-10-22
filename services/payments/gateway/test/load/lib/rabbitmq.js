import http from 'k6/http';
import { check, sleep } from 'k6';
import encoding from 'k6/encoding';
import { publishedSuccessTotal, publishedErrorTotal } from './runtime.js';

// RabbitMQ Management API helpers for end-to-end delivery assertions.
//
// The load stack runs no consumer, so every accepted request must add
// exactly one message: queue depth grows by the published count, nothing
// is lost. Management API lives on the container port (15672), not the
// host-published one.
//
// GATEWAY_LOAD_QUEUE_PROOF selects how the delivery is proved:
//   exact    - queue depth growth must equal the gateway's publish growth.
//              Needs an idle queue that nothing consumes.
//   at_least - queue depth growth must be at least the publish growth.
//              Tolerates other producers writing to the same queue.
//   off      - the broker is not read at all; the gateway's own publish
//              counters are used instead. For a broker with a live consumer,
//              where the queue drains as fast as the test publishes and a
//              depth proof can only produce false failures.
const QUEUE = __ENV.RABBITMQ_QUEUE || 'payment_events';
const PROOF = (__ENV.GATEWAY_LOAD_QUEUE_PROOF || 'exact').toLowerCase();

function mgmtBase() {
    return __ENV.RABBITMQ_MGMT_URL || 'http://rabbitmq:15672';
}

function mgmtAuthHeader() {
    const user = __ENV.RABBITMQ_USER || 'guest';
    const pass = __ENV.RABBITMQ_PASS || 'guest';
    return { Authorization: 'Basic ' + encoding.b64encode(`${user}:${pass}`) };
}

export function queueDepth() {
    if (PROOF === 'off') {
        // The broker is deliberately not read in this mode.
        return -1;
    }
    const res = http.get(`${mgmtBase()}/api/queues/%2F/${QUEUE}`, {
        headers: mgmtAuthHeader(),
        timeout: '10s',
    });
    if (res.status !== 200) {
        return -1;
    }
    return res.json().messages;
}

function growth(current, baseline) {
    if (current == null || baseline == null) {
        return null;
    }
    return current - baseline;
}

// The delivery counters before the run.
export function readBaseline(baseUrl) {
    let depth = null;
    if (PROOF !== 'off') {
        // The broker is AMQP-healthy before k6 starts, but the management
        // plugin and queue topology can lag behind on a cold stack: retry up
        // to a minute so setup does not fail before first boot settles.
        depth = -1;
        for (let i = 0; i < 12; i++) {
            depth = queueDepth();
            if (depth >= 0) {
                break;
            }
            sleep(5);
        }
    }
    // Read the gateway counters last, so the baseline is as close to the run
    // as it can be.
    return {
        depth: depth,
        published: publishedSuccessTotal(baseUrl),
        publishErrors: publishedErrorTotal(baseUrl),
    };
}

// The delivery counters after the run.
export function readCurrent(baseUrl) {
    return {
        depth: queueDepth(),
        published: publishedSuccessTotal(baseUrl),
        publishErrors: publishedErrorTotal(baseUrl),
    };
}

// Call from teardown(): every accepted request must have reached the broker.
//
// In "exact" and "at_least" modes the proof is broker-side: the queue depth
// growth must match the gateway's publish growth. Both counters are
// monotonic; the management stats can lag the publish counter by seconds
// under load, so settle before judging.
//
// In "off" mode the proof comes from the gateway's own counters: "success"
// is recorded only after the broker acked the message, and a flat "error"
// count means nothing failed to publish.
export function checkNoLoss(baseline, current) {
    if (PROOF === 'off') {
        const publishedGrowth = growth(current.published, baseline.published);
        const errorGrowth = growth(current.publishErrors, baseline.publishErrors);
        if (publishedGrowth === null || errorGrowth === null) {
            return check(null, { 'publish counters readable': () => false });
        }
        return check(null, {
            [`published ${publishedGrowth} events (broker acked)`]: () => publishedGrowth > 0,
            [`no publish errors (${errorGrowth})`]: () => errorGrowth === 0,
        });
    }

    if (!(current.depth >= 0 && baseline.depth >= 0 && current.published != null && baseline.published != null)) {
        return check(null, { 'delivery proof readable': () => false });
    }
    for (let i = 0; i < 12; i++) {
        const depthGrowth = current.depth - baseline.depth;
        const publishedGrowth = current.published - baseline.published;
        if (PROOF === 'at_least') {
            if (depthGrowth >= publishedGrowth) {
                return check(null, { [`no messages lost (${publishedGrowth} published, ${depthGrowth} queued)`]: () => true });
            }
        } else if (depthGrowth === publishedGrowth) {
            return check(null, { [`no messages lost (${publishedGrowth} published)`]: () => true });
        } else if (depthGrowth > publishedGrowth) {
            // More messages arrived than the gateway published: something
            // else is writing to this queue.
            return check(null, {
                [`queue growth ${depthGrowth} <= published growth ${publishedGrowth}`]: () => false,
            });
        }
        sleep(5);
        current = { depth: queueDepth(), published: current.published };
    }
    const depthGrowth = current.depth - baseline.depth;
    const publishedGrowth = current.published - baseline.published;
    return check(null, {
        [`queue growth ${depthGrowth} == published growth ${publishedGrowth}`]: () => false,
    });
}
