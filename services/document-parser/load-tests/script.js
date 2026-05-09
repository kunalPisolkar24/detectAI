import http from 'k6/http';
import { check, sleep } from 'k6';
import { FormData } from 'https://jslib.k6.io/formdata/0.0.2/index.js';
import { Trend, Rate } from 'k6/metrics';

// Custom metrics
const extractionTime = new Trend('extraction_duration');
const errorRate = new Rate('errors');

// Test Configuration
const targetVUs = parseInt(__ENV.VUS) || 20;
const holdDuration = __ENV.DURATION || '1m';
const rampTime = __ENV.RAMP_TIME || '30s';

export const options = {
  scenarios: {
    health_check: {
      executor: 'constant-vus',
      vus: 5,
      duration: '30s',
      exec: 'health',
    },
    extraction_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: rampTime, target: targetVUs },   // Ramp up
        { duration: holdDuration, target: targetVUs },// Hold peak load
        { duration: rampTime, target: 0 },           // Ramp down
      ],
      exec: 'extract',
    },
  },
  thresholds: {
    // 95% of requests must complete under 1.5s
    'http_req_duration': ['p(95)<1500'],
    // 99% of requests must complete under 3s
    'http_req_duration': ['p(99)<3000'],
    // 0% errors allowed
    'errors': ['rate==0'],
  },
};

// Load test files into memory once per VU
const pdfFile = open('./fixtures/sample.pdf', 'b');
const txtFile = open('./fixtures/sample.txt', 'b');
const docxFile = open('./fixtures/sample.docx', 'b');

const BASE_URL = __ENV.API_URL || 'http://localhost:8000';

export function health() {
  const res = http.get(`${BASE_URL}/health`);
  const success = check(res, {
    'status is 200': (r) => r.status === 200,
    'status is ok': (r) => r.json('status') === 'ok',
  });
  if (!success) errorRate.add(1);
  sleep(1);
}

export function extract() {
  // Randomly select a file type to simulate mixed traffic
  const fileTypes = [
    { name: 'sample.pdf', data: pdfFile, type: 'application/pdf' },
    { name: 'sample.txt', data: txtFile, type: 'text/plain' },
    { name: 'sample.docx', data: docxFile, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  ];
  
  const fileToUpload = fileTypes[Math.floor(Math.random() * fileTypes.length)];

  const fd = new FormData();
  fd.append('file', {
    data: new Uint8Array(fileToUpload.data).buffer,
    filename: fileToUpload.name,
    content_type: fileToUpload.type,
  });

  const res = http.post(`${BASE_URL}/extract`, fd.body(), {
    headers: { 'Content-Type': `multipart/form-data; boundary=${fd.boundary}` },
  });

  const success = check(res, {
    'status is 200': (r) => r.status === 200,
    'has text content': (r) => r.json('text') !== undefined,
  });

  if (success) {
    extractionTime.add(res.timings.duration);
  } else {
    errorRate.add(1);
  }

  // Add realistic sleep between requests
  sleep(Math.random() * 2 + 1); // 1-3 seconds
}
