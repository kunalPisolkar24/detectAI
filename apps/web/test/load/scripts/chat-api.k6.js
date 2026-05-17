import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: __ENV.VUS || 15,
  duration: __ENV.DURATION || '1m',
  thresholds: {
    'http_req_duration': ['p(95)<1000'],
  },
};

export default function () {
  const url = `${__ENV.BASE_URL || 'http://localhost:3001'}/api/chat/analyze/stream`;
  
  const payload = JSON.stringify({
    chatId: 'mock-chat-id',
    content: 'This is a sample text to be analyzed by the AI service during a load test.',
    model: 'spark'
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Key': 'load-test-key',
    },
  };

  const res = http.post(url, payload, params);
  
  check(res, {
    'status is 200': (r) => r.status === 200,
    'is ndjson': (r) => r.headers['Content-Type'] && r.headers['Content-Type'].includes('application/x-ndjson'),
  });

  sleep(1);
}
