import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 20 }, // ramp up
    { duration: '1m', target: 20 },  // stay at 20 users
    { duration: '30s', target: 0 },  // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests should be below 500ms
  },
};

export default function () {
  const url = __ENV.BASE_URL || 'http://localhost:3001';
  const res = http.get(url);
  
  check(res, {
    'status is 200': (r) => r.status === 200,
    'contains welcome text': (r) => r.body.includes('AI') || r.body.includes('Detect'),
  });

  sleep(1);
}
