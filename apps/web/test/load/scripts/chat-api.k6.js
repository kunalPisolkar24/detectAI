import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 15 },
    { duration: '1m', target: 15 },
    { duration: '30s', target: 0 },
  ],
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
      // In a real scenario, we'd need a Session cookie here.
      // For this isolated test, we can configure the server to allow a "test-session" cookie
      'Cookie': 'next-auth.session-token=mock-token',
    },
  };

  const res = http.post(url, payload, params);
  
  check(res, {
    'status is 200': (r) => r.status === 200,
    'is ndjson': (r) => r.headers['Content-Type'] && r.headers['Content-Type'].includes('application/x-ndjson'),
  });

  sleep(1);
}
