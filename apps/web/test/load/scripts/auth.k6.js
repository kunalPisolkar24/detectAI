import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: __ENV.VUS || 10,
  duration: __ENV.DURATION || '1m',
  thresholds: {
    http_req_duration: ['p(99)<1000'], // Auth is slow (Bcrypt), so we allow up to 1s
  },
};

export default function () {
  const url = `${__ENV.BASE_URL || 'http://localhost:3001'}/api/register`; // Assuming an endpoint exists or we hit the action route
  
  // Since we don't want to pollute with real emails, we use random ones
  const payload = JSON.stringify({
    firstName: 'Load',
    lastName: 'Test',
    email: `test-${Math.random()}@example.com`,
    password: 'Password123!',
    confirmPassword: 'Password123!',
    token: 'valid-token' // Mock server will handle turnstile
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const res = http.post(url, payload, params);
  
  // Even if it fails (e.g. no endpoint), we measure the latency of the server response
  check(res, {
    'is not 500': (r) => r.status < 500,
  });

  sleep(1);
}
