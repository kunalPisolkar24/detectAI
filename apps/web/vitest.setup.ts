import '@testing-library/jest-dom/vitest';

// src/setupTests.ts (or your chosen setup file name)
import { vi, beforeAll, afterAll } from 'vitest';
import '@testing-library/jest-dom';

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
const originalInfo = console.info;
const originalDebug = console.debug;

beforeAll(() => {
  console.log = vi.fn();
  console.warn = vi.fn();
  console.error = vi.fn();
  console.info = vi.fn();
  console.debug = vi.fn();
});

afterAll(() => {
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
  console.info = originalInfo;
  console.debug = originalDebug;
});
