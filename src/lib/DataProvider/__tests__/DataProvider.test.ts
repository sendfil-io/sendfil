import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { http, HttpResponse, delay } from 'msw';
import { setupServer } from 'msw/node';
const PRIMARY = 'http://primary';
const FALLBACK = 'http://fallback';

vi.stubEnv('VITE_GLIF_RPC_URL_PRIMARY', PRIMARY);
vi.stubEnv('VITE_GLIF_RPC_URL_FALLBACK', FALLBACK);
vi.stubEnv('VITE_GLIF_RPC_TIMEOUT_MS', '50');

import * as DataProvider from '../index';

const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('DataProvider', () => {
  it('should return balance on happy path (primary 200)', async () => {
    server.use(
      http.post(PRIMARY, async () =>
        HttpResponse.json({ jsonrpc: '2.0', id: 1, result: '123' }),
      ),
    );
    const result = await DataProvider.getBalance('f1');
    expect(result).toBe('123');
  });

  it('should fail over to fallback if primary fails', async () => {
    server.use(
      http.post(PRIMARY, () => HttpResponse.text('error', { status: 500 })),
      http.post(FALLBACK, () =>
        HttpResponse.json({ jsonrpc: '2.0', id: 1, result: 'abc' }),
      ),
    );
    const result = await DataProvider.getBalance('f1');
    expect(result).toBe('abc');
  });

  it('should throw if both endpoints fail', async () => {
    server.use(
      http.post(PRIMARY, () => HttpResponse.text('error', { status: 500 })),
      http.post(FALLBACK, () => HttpResponse.text('error', { status: 500 })),
    );
    await expect(DataProvider.getBalance('f1')).rejects.toThrow();
  });

  it('should throw on timeout', async () => {
    const slow = 100;
    server.use(
      http.post(PRIMARY, async () => {
        await delay(slow);
        return HttpResponse.json({});
      }),
      http.post(FALLBACK, async () => {
        await delay(slow);
        return HttpResponse.json({});
      }),
    );
    await expect(DataProvider.getBalance('f1')).rejects.toThrow('RPC timeout');
  });
});
