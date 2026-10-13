import http from 'k6/http';
import { check, sleep } from 'k6';
import encoding from 'k6/encoding';

// RabbitMQ Management API helpers for end-to-end delivery assertions.
// The load stack runs no consumer, so every accepted request must add
// exactly one message: queue depth grows by the published count, nothing
// is lost. Management API lives on the container port (15672), not the
// host-published one.
const QUEUE = __ENV.RABBITMQ_QUEUE || 'payment_events';

function mgmtBase() {
    return __ENV.RABBITMQ_MGMT_URL || 'http://rabbitmq:15672';
}

function mgmtAuthHeader() {
    const user = __ENV.RABBITMQ_USER || 'guest';
    const pass = __ENV.RABBITMQ_PASS || 'guest';
    return { Authorization: 'Basic ' + encoding.b64encode(`${user}:${pass}`) };
}

export function queueDepth() {
    const res = http.get(`${mgmtBase()}/api/queues/%2F/${QUEUE}`, {
        headers: mgmtAuthHeader(),
        timeout: '10s',
    });
    if (res.status !== 200) {
        return -1;
    }
    return res.json().messages;
}

export function readBaseline() {
    // The broker is AMQP-healthy before k6 starts, but the management plugin
    // and queue topology can lag behind on a cold stack: retry up to a
    // minute so setup does not fail before first boot settles.
    for (let i = 0; i < 12; i++) {
        const depth = queueDepth();
        if (depth >= 0) {
            return { depth: depth };
        }
        sleep(5);
    }
    return { depth: -1 };
}

// Call from teardown(): every accepted publish added exactly one message.
// Compares broker-side numbers only (k6 VU counters are invisible here):
// queue depth growth must equal the gateway published-success growth.
// baseline is the setup() object {queue: {depth}, published}; current has
// the same shape minus the wrapper ({depth, published}).
export function checkNoLoss(baseline, current) {
    const baseDepth = baseline.queue ? baseline.queue.depth : baseline.depth;
    if (!(current.depth >= 0 && baseDepth >= 0 && current.published != null && baseline.published != null)) {
        return check(null, { 'delivery proof readable': () => false });
    }
    // Both counters are monotonic; the management stats can lag the publish
    // counter by seconds under load, so settle before judging.
    for (let i = 0; i < 12; i++) {
        const depthGrowth = current.depth - baseDepth;
        const publishedGrowth = current.published - baseline.published;
        if (depthGrowth === publishedGrowth) {
            return check(null, { [`no messages lost (${publishedGrowth} published)`]: () => true });
        }
        if (depthGrowth > publishedGrowth) {
            return check(null, {
                [`queue growth ${depthGrowth} <= published growth ${publishedGrowth}`]: () => false,
            });
        }
        sleep(5);
        current = { depth: queueDepth(), published: current.published };
    }
    const depthGrowth = current.depth - baseDepth;
    const publishedGrowth = current.published - baseline.published;
    return check(null, {
        [`queue growth ${depthGrowth} == published growth ${publishedGrowth}`]: () => false,
    });
}
