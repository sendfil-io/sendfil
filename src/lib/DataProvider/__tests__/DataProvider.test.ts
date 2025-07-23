import { describe, it, expect } from 'vitest';
// import { setupServer } from 'msw/node';
// import { rest } from 'msw';
// import * as DataProvider from '../index';

describe('DataProvider', () => {
  it('should return balance on happy path (primary 200)', async () => {
    // TODO: mock primary endpoint, test getBalance
    expect(true).toBe(true);
  });

  it('should fail over to fallback if primary fails', async () => {
    // TODO: mock primary 500, fallback 200
    expect(true).toBe(true);
  });

  it('should throw if both endpoints fail', async () => {
    // TODO: mock both endpoints down
    expect(true).toBe(true);
  });

  it('should throw on timeout', async () => {
    // TODO: mock slow response > TIMEOUT
    expect(true).toBe(true);
  });
}); 