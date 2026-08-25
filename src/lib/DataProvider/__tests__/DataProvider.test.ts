import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { http, HttpResponse, delay } from 'msw';
import { setupServer } from 'msw/node';
const PRIMARY = 'http://primary';
const FALLBACK = 'http://fallback';
const STATE_READ_FALLBACK = 'http://state-read-fallback';
const RETIRED_MAINNET_FALLBACK = 'https://rpc.node.glif.io/rpc/v1';
const CALIBRATION_PRIMARY = 'http://calibration-primary';
const CALIBRATION_FALLBACK = 'http://calibration-fallback';

vi.stubEnv('VITE_LOTUS_RPC_URL_MAINNET', PRIMARY);
vi.stubEnv('VITE_LOTUS_RPC_FALLBACK_MAINNET', FALLBACK);
vi.stubEnv('VITE_LOTUS_RPC_STATE_READ_FALLBACK_MAINNET', FALLBACK);
vi.stubEnv('VITE_LOTUS_RPC_URL_CALIBRATION', CALIBRATION_PRIMARY);
vi.stubEnv('VITE_LOTUS_RPC_FALLBACK_CALIBRATION', CALIBRATION_FALLBACK);
vi.stubEnv(
  'VITE_LOTUS_RPC_STATE_READ_FALLBACK_CALIBRATION',
  CALIBRATION_FALLBACK,
);
vi.stubEnv('VITE_LOTUS_RPC_TIMEOUT_MS', '50');

import * as DataProvider from '../index';
import { callRpc, getRpcConfig } from '../rpc';
import { RpcProviderError } from '../RpcProviderError';

const server = setupServer();

async function jsonRpcResult(request: Request, result: unknown) {
  const body = (await request.json()) as { id: string | number };
  return HttpResponse.json({ jsonrpc: '2.0', id: body.id, result });
}

async function jsonRpcError(
  request: Request,
  code: number,
  message: string,
  options: { data?: unknown; status?: number } = {},
) {
  const body = (await request.json()) as { id: string | number };
  return HttpResponse.json(
    {
      jsonrpc: '2.0',
      id: body.id,
      error: { code, message, data: options.data },
    },
    { status: options.status ?? 200 },
  );
}

async function captureRpcError(promise: Promise<unknown>): Promise<RpcProviderError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(RpcProviderError);
    return error as RpcProviderError;
  }

  throw new Error('Expected the RPC call to fail');
}

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  vi.stubEnv('VITE_LOTUS_RPC_FALLBACK_MAINNET', FALLBACK);
  vi.stubEnv('VITE_LOTUS_RPC_STATE_READ_FALLBACK_MAINNET', FALLBACK);
  vi.stubEnv('VITE_LOTUS_RPC_FALLBACK_CALIBRATION', CALIBRATION_FALLBACK);
  vi.stubEnv(
    'VITE_LOTUS_RPC_STATE_READ_FALLBACK_CALIBRATION',
    CALIBRATION_FALLBACK,
  );
});
afterAll(() => server.close());

describe('DataProvider', () => {
  it('should return balance on happy path (primary 200)', async () => {
    server.use(
      http.post(PRIMARY, ({ request }) => jsonRpcResult(request, '123')),
    );
    const result = await DataProvider.getBalance('f1');
    expect(result).toBe('123');
  });

  it('should fail over to fallback if primary fails', async () => {
    server.use(
      http.post(PRIMARY, () => HttpResponse.text('error', { status: 500 })),
      http.post(FALLBACK, ({ request }) => jsonRpcResult(request, 'abc')),
    );
    const result = await DataProvider.getBalance('f1');
    expect(result).toBe('abc');
  });

  it('fails over a retryable HTTP response with a JSON-RPC error body', async () => {
    server.use(
      http.post(PRIMARY, ({ request }) =>
        jsonRpcError(request, -32000, 'upstream temporarily unavailable', {
          data: { provider: 'primary', reason: 'overloaded' },
          status: 503,
        }),
      ),
      http.post(FALLBACK, ({ request }) => jsonRpcResult(request, 'fallback-ok')),
    );

    await expect(DataProvider.getBalance('f1')).resolves.toBe('fallback-ok');
  });

  it('preserves HTTP and JSON-RPC diagnostics when both endpoints fail', async () => {
    server.use(
      http.post(PRIMARY, ({ request }) =>
        jsonRpcError(request, -32000, 'primary upstream failed', {
          data: { provider: 'primary' },
          status: 503,
        }),
      ),
      http.post(FALLBACK, ({ request }) =>
        jsonRpcError(request, -32001, 'fallback upstream failed', {
          data: { provider: 'fallback' },
          status: 502,
        }),
      ),
    );

    const error = await captureRpcError(DataProvider.getBalance('f1'));

    expect(error).toMatchObject({
      code: -32000,
      data: { provider: 'primary' },
      kind: 'failover',
      method: 'Filecoin.WalletBalance',
      networkKey: 'mainnet',
      retryable: false,
    });
    expect(error.message).toContain(
      'primary: HTTP 503 Service Unavailable; JSON-RPC -32000: primary upstream failed',
    );
    expect(error.message).toContain(
      'fallback: HTTP 502 Bad Gateway; JSON-RPC -32001: fallback upstream failed',
    );
    expect(error.attempts?.[0]).toMatchObject({
      code: -32000,
      data: { provider: 'primary' },
      httpStatus: 503,
      retryable: true,
    });
    expect(error.attempts?.[1]).toMatchObject({
      code: -32001,
      data: { provider: 'fallback' },
      httpStatus: 502,
      retryable: true,
    });
  });

  it('should throw if both endpoints fail', async () => {
    server.use(
      http.post(PRIMARY, () => HttpResponse.text('error', { status: 500 })),
      http.post(FALLBACK, () => HttpResponse.text('error', { status: 500 })),
    );
    const error = await captureRpcError(DataProvider.getBalance('f1'));

    expect(error).toMatchObject({
      kind: 'failover',
      method: 'Filecoin.WalletBalance',
      networkKey: 'mainnet',
    });
    expect(error.message).toContain('primary: HTTP 500');
    expect(error.message).toContain('fallback: HTTP 500');
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

  it('times out a stalled primary response body and uses the fallback', async () => {
    server.use(
      http.post(PRIMARY, () => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('{"jsonrpc":"2.0","id":'),
            );
          },
        });

        return new HttpResponse(body, {
          headers: { 'Content-Type': 'application/json' },
        });
      }),
      http.post(FALLBACK, ({ request }) =>
        jsonRpcResult(request, 'fallback-after-body-timeout'),
      ),
    );

    await expect(DataProvider.getBalance('f1')).resolves.toBe(
      'fallback-after-body-timeout',
    );
  });

  it('searches for the exact CID without allowing nonce replacements', async () => {
    let capturedParams: unknown[] | undefined;
    server.use(
      http.post(PRIMARY, async ({ request }) => {
        const body = (await request.json()) as {
          id: string | number;
          params: unknown[];
        };
        capturedParams = body.params;
        return HttpResponse.json({
          jsonrpc: '2.0',
          id: body.id,
          result: null,
        });
      }),
    );

    await expect(
      DataProvider.getTransactionStatus('bafy-requested'),
    ).resolves.toMatchObject({ status: 'pending' });
    expect(capturedParams).toEqual([
      null,
      { '/': 'bafy-requested' },
      -1,
      false,
    ]);
  });

  it('keeps polling after a retryable confirmation-read failure', async () => {
    vi.stubEnv('VITE_LOTUS_RPC_FALLBACK_MAINNET', `${PRIMARY}/`);
    let primaryRequests = 0;

    server.use(
      http.post(PRIMARY, async ({ request }) => {
        primaryRequests += 1;

        if (primaryRequests === 1) {
          return HttpResponse.text('temporarily unavailable', { status: 503 });
        }

        const body = (await request.json()) as { id: string | number };
        return HttpResponse.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            Message: { '/': 'bafy-requested' },
            Receipt: { ExitCode: 0, Return: '', GasUsed: 100 },
            ReturnDec: null,
            TipSet: { '/': 'bafy-tipset' },
            Height: 123,
          },
        });
      }),
    );

    await expect(
      DataProvider.pollTransactionStatus('bafy-requested', 2, 0),
    ).resolves.toMatchObject({
      cid: 'bafy-requested',
      status: 'confirmed',
      receipt: { ExitCode: 0 },
    });
    expect(primaryRequests).toBe(2);
  });

  it('stops polling on a deterministic confirmation-read rejection', async () => {
    let primaryRequests = 0;

    server.use(
      http.post(PRIMARY, ({ request }) => {
        primaryRequests += 1;
        return jsonRpcError(request, 1, 'invalid message CID');
      }),
    );

    await expect(
      DataProvider.pollTransactionStatus('bafy-invalid', 3, 0),
    ).resolves.toMatchObject({
      cid: 'bafy-invalid',
      status: 'failed',
      error: expect.stringContaining('invalid message CID'),
    });
    expect(primaryRequests).toBe(1);
  });

  it('returns an uncertain terminal result after retryable confirmation reads exhaust the poll', async () => {
    vi.stubEnv('VITE_LOTUS_RPC_FALLBACK_MAINNET', `${PRIMARY}/`);
    let primaryRequests = 0;

    server.use(
      http.post(PRIMARY, () => {
        primaryRequests += 1;
        return HttpResponse.text('temporarily unavailable', { status: 503 });
      }),
    );

    const status = await DataProvider.pollTransactionStatus('bafy-unavailable', 2, 0);

    expect(status).toMatchObject({
      cid: 'bafy-unavailable',
      status: 'failed',
      error: expect.stringContaining(
        'Transaction confirmation remained unavailable after 2 attempts',
      ),
    });
    expect(status.receipt).toBeUndefined();
    expect(primaryRequests).toBe(2);
  });

  it('never treats a replacement CID receipt as proof for the requested CID', async () => {
    server.use(
      http.post(PRIMARY, async ({ request }) => {
        const body = (await request.json()) as { id: string | number };
        return HttpResponse.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            Message: { '/': 'bafy-replacement' },
            Receipt: { ExitCode: 0, Return: '', GasUsed: 100 },
            ReturnDec: null,
            TipSet: { '/': 'bafy-tipset' },
            Height: 123,
          },
        });
      }),
    );

    const status = await DataProvider.getTransactionStatus('bafy-requested');

    expect(status).toMatchObject({
      cid: 'bafy-requested',
      status: 'failed',
    });
    expect(status.receipt).toBeUndefined();
    expect(status.error).toContain('replacement CID bafy-replacement');
    expect(status.error).toContain('requested message outcome is uncertain');
  });

  it.each([
    ['a string exit code', { ExitCode: '0', Return: '', GasUsed: 100 }],
    ['an object return value', { ExitCode: 0, Return: {}, GasUsed: 100 }],
    [
      'an unsafe gas value',
      { ExitCode: 0, Return: '', GasUsed: Number.MAX_SAFE_INTEGER + 1 },
    ],
  ])('never exposes malformed StateSearchMsg receipts with %s', async (_label, receipt) => {
    server.use(
      http.post(PRIMARY, async ({ request }) => {
        const body = (await request.json()) as { id: string | number };
        return HttpResponse.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            Message: { '/': 'bafy-requested' },
            Receipt: receipt,
            ReturnDec: null,
            TipSet: { '/': 'bafy-tipset' },
            Height: 123,
          },
        });
      }),
    );

    const status = await DataProvider.getTransactionStatus('bafy-requested');

    expect(status).toMatchObject({
      cid: 'bafy-requested',
      status: 'failed',
    });
    expect(status.receipt).toBeUndefined();
    expect(status.error).toContain('malformed message or receipt');
    expect(status.error).toContain('outcome is uncertain');
  });

  it('accepts and normalizes the null receipt fields returned by live Lotus nodes', async () => {
    const liveMessageCid =
      'bafy2bzaceb26suh563fr5pyketjsujrbjdwyjnvhrz2o6rlya2h3jtj3dathy';
    server.use(
      http.post(PRIMARY, async ({ request }) => {
        const body = (await request.json()) as { id: string | number };
        return HttpResponse.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            Message: { '/': liveMessageCid },
            // Live Mainnet StateSearchMsg receipts use null for an empty Return
            // and for an absent FIP-0049 events root.
            Receipt: {
              ExitCode: 0,
              Return: null,
              GasUsed: 1_232_763,
              EventsRoot: null,
            },
            ReturnDec: null,
            TipSet: { '/': 'bafy-tipset' },
            Height: 5_000_000,
          },
        });
      }),
    );

    await expect(
      DataProvider.getTransactionStatus(liveMessageCid),
    ).resolves.toMatchObject({
      cid: liveMessageCid,
      status: 'confirmed',
      receipt: {
        ExitCode: 0,
        Return: '',
        GasUsed: 1_232_763,
        EventsRoot: null,
      },
    });
  });

  it('accepts the CID-shaped EventsRoot and actor return from a live Lotus receipt', async () => {
    const liveMessageCid =
      'bafy2bzacedv27b73da5f65p5rh7h7whgxctbj5aipnbqkmq3ydc2pshfyseam';
    const liveEventsRoot =
      'bafy2bzacedbwigp4jl3yz5drvvngp354ccn7wh7arx7l26aoo35mu6htentqs';
    server.use(
      http.post(PRIMARY, async ({ request }) => {
        const body = (await request.json()) as { id: string | number };
        return HttpResponse.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            Message: { '/': liveMessageCid },
            Receipt: {
              ExitCode: 0,
              Return: 'ggKA',
              GasUsed: 1_232_763,
              EventsRoot: { '/': liveEventsRoot },
            },
            ReturnDec: null,
            TipSet: { '/': 'bafy-tipset' },
            Height: 5_000_000,
          },
        });
      }),
    );

    await expect(
      DataProvider.getTransactionStatus(liveMessageCid),
    ).resolves.toMatchObject({
      cid: liveMessageCid,
      status: 'confirmed',
      receipt: {
        ExitCode: 0,
        Return: 'ggKA',
        GasUsed: 1_232_763,
        EventsRoot: { '/': liveEventsRoot },
      },
    });
  });

  it('preserves a primary method error when the fallback transport fails', async () => {
    server.use(
      http.post(PRIMARY, ({ request }) =>
        jsonRpcError(request, -32601, 'method Filecoin.StateActorCodeCIDs not found'),
      ),
      http.post(FALLBACK, () => HttpResponse.error()),
    );

    const error = await captureRpcError(
      callRpc('Filecoin.StateActorCodeCIDs', [[]], 'mainnet'),
    );

    expect(error).toMatchObject({
      code: -32601,
      kind: 'failover',
      method: 'Filecoin.StateActorCodeCIDs',
      networkKey: 'mainnet',
      retryable: false,
    });
    expect(error.message).toContain('primary: JSON-RPC -32601');
    expect(error.message).toContain('method Filecoin.StateActorCodeCIDs not found');
    expect(error.message).toContain('fallback: transport error');
    expect(error.attempts).toHaveLength(2);
  });

  it('does not fail over deterministic JSON-RPC application errors', async () => {
    let fallbackRequests = 0;
    server.use(
      http.post(PRIMARY, ({ request }) =>
        jsonRpcError(request, 1, 'actor not found'),
      ),
      http.post(FALLBACK, ({ request }) => {
        fallbackRequests += 1;
        return jsonRpcResult(request, { Balance: '0' });
      }),
    );

    const error = await captureRpcError(
      callRpc('Filecoin.StateGetActor', ['f01234', []], 'mainnet'),
    );

    expect(error).toMatchObject({
      code: 1,
      kind: 'json-rpc',
      method: 'Filecoin.StateGetActor',
      networkKey: 'mainnet',
      endpointRole: 'primary',
      retryable: false,
    });
    expect(error.message).toContain('actor not found');
    expect(fallbackRequests).toBe(0);
  });

  it('retries a stale load-balanced state read once on the same endpoint', async () => {
    let primaryRequests = 0;
    let fallbackRequests = 0;

    server.use(
      http.post(PRIMARY, ({ request }) => {
        primaryRequests += 1;

        if (primaryRequests === 1) {
          return jsonRpcError(
            request,
            1,
            'RPC error (-32603): Failed to load actor with addr=f2new, state_cid=bafy-stale',
          );
        }

        return jsonRpcResult(request, {
          Balance: '500000000000000000',
          Code: { '/': 'bafk-multisig' },
          State: { Signers: ['f0100', 'f0101'], NumApprovalsThreshold: 2 },
        });
      }),
      http.post(FALLBACK, ({ request }) => {
        fallbackRequests += 1;
        return jsonRpcResult(request, { shouldNotBeUsed: true });
      }),
    );

    await expect(
      callRpc('Filecoin.StateReadState', ['f2new', []], 'mainnet'),
    ).resolves.toMatchObject({
      Balance: '500000000000000000',
      Code: { '/': 'bafk-multisig' },
    });
    expect(primaryRequests).toBe(2);
    expect(fallbackRequests).toBe(0);
  });

  it('uses the independent state-read fallback after stale primary and broken configured fallback', async () => {
    vi.stubEnv(
      'VITE_LOTUS_RPC_STATE_READ_FALLBACK_MAINNET',
      STATE_READ_FALLBACK,
    );
    let primaryRequests = 0;
    let configuredFallbackRequests = 0;
    let stateReadFallbackRequests = 0;

    server.use(
      http.post(PRIMARY, ({ request }) => {
        primaryRequests += 1;
        return jsonRpcError(
          request,
          1,
          'RPC error (-32603): Failed to load actor with addr=f03810106, state_cid=bafy-stale',
        );
      }),
      http.post(FALLBACK, () => {
        configuredFallbackRequests += 1;
        return HttpResponse.error();
      }),
      http.post(STATE_READ_FALLBACK, ({ request }) => {
        stateReadFallbackRequests += 1;
        return jsonRpcResult(request, {
          Balance: '500000000000000000',
          Code: { '/': 'bafk-multisig' },
          State: { Signers: ['f0100', 'f0101'], NumApprovalsThreshold: 2 },
        });
      }),
    );

    await expect(
      callRpc('Filecoin.StateReadState', ['f03810106', []], 'mainnet'),
    ).resolves.toMatchObject({ Balance: '500000000000000000' });
    expect(primaryRequests).toBe(2);
    expect(configuredFallbackRequests).toBe(1);
    expect(stateReadFallbackRequests).toBe(1);
  });

  it('treats actor-not-found from a pinned multisig read as transient provider state', async () => {
    vi.stubEnv(
      'VITE_LOTUS_RPC_STATE_READ_FALLBACK_MAINNET',
      STATE_READ_FALLBACK,
    );
    let primaryRequests = 0;
    let stateReadFallbackRequests = 0;

    server.use(
      http.post(PRIMARY, ({ request }) => {
        primaryRequests += 1;
        return jsonRpcError(request, 1, 'Actor not found');
      }),
      http.post(FALLBACK, () => HttpResponse.error()),
      http.post(STATE_READ_FALLBACK, ({ request }) => {
        stateReadFallbackRequests += 1;
        return jsonRpcResult(request, []);
      }),
    );

    await expect(
      callRpc(
        'Filecoin.MsigGetPending',
        ['f03810106', [{ '/': 'bafy-pinned-head' }]],
        'mainnet',
      ),
    ).resolves.toEqual([]);
    expect(primaryRequests).toBe(2);
    expect(stateReadFallbackRequests).toBe(1);
  });

  it('retries a stale load-balanced ID lookup once on the same endpoint', async () => {
    let primaryRequests = 0;
    let fallbackRequests = 0;

    server.use(
      http.post(PRIMARY, ({ request }) => {
        primaryRequests += 1;

        if (primaryRequests === 1) {
          return jsonRpcError(
            request,
            1,
            'RPC error (-32603): Failed to lookup the id address f2new',
          );
        }

        return jsonRpcResult(request, 'f03810106');
      }),
      http.post(FALLBACK, ({ request }) => {
        fallbackRequests += 1;
        return jsonRpcResult(request, 'f09999999');
      }),
    );

    await expect(
      callRpc('Filecoin.StateLookupID', ['f2new', []], 'mainnet'),
    ).resolves.toBe('f03810106');
    expect(primaryRequests).toBe(2);
    expect(fallbackRequests).toBe(0);
  });

  it('never applies the stale-state same-endpoint retry to MpoolPush', async () => {
    let primaryRequests = 0;
    let fallbackRequests = 0;

    server.use(
      http.post(PRIMARY, ({ request }) => {
        primaryRequests += 1;
        return jsonRpcError(
          request,
          1,
          'RPC error (-32603): Failed to load actor with addr=f2new, state_cid=bafy-stale',
        );
      }),
      http.post(FALLBACK, ({ request }) => {
        fallbackRequests += 1;
        return jsonRpcResult(request, { '/': 'bafy-should-not-submit' });
      }),
    );

    await expect(
      callRpc('Filecoin.MpoolPush', [{ Message: {}, Signature: {} }], 'mainnet'),
    ).rejects.toThrow('Failed to load actor');
    expect(primaryRequests).toBe(1);
    expect(fallbackRequests).toBe(0);
  });

  it('never sends MpoolPush to the independent state-read fallback', async () => {
    vi.stubEnv(
      'VITE_LOTUS_RPC_STATE_READ_FALLBACK_MAINNET',
      STATE_READ_FALLBACK,
    );
    let stateReadFallbackRequests = 0;

    server.use(
      http.post(PRIMARY, () => HttpResponse.error()),
      http.post(FALLBACK, () => HttpResponse.error()),
      http.post(STATE_READ_FALLBACK, ({ request }) => {
        stateReadFallbackRequests += 1;
        return jsonRpcResult(request, { '/': 'bafy-should-not-submit' });
      }),
    );

    await expect(
      callRpc('Filecoin.MpoolPush', [{ Message: {}, Signature: {} }], 'mainnet'),
    ).rejects.toThrow('transport error');
    expect(stateReadFallbackRequests).toBe(0);
  });

  it('routes reads around a retired configured fallback to the independent read lane', async () => {
    vi.stubEnv('VITE_LOTUS_RPC_FALLBACK_MAINNET', RETIRED_MAINNET_FALLBACK);
    vi.stubEnv(
      'VITE_LOTUS_RPC_STATE_READ_FALLBACK_MAINNET',
      STATE_READ_FALLBACK,
    );
    let retiredFallbackRequests = 0;
    let stateReadFallbackRequests = 0;

    server.use(
      http.post(PRIMARY, () => HttpResponse.text('unavailable', { status: 503 })),
      http.post(RETIRED_MAINNET_FALLBACK, () => {
        retiredFallbackRequests += 1;
        return HttpResponse.error();
      }),
      http.post(STATE_READ_FALLBACK, ({ request }) => {
        stateReadFallbackRequests += 1;
        return jsonRpcResult(request, { Balance: '500000000000000000' });
      }),
    );

    await expect(
      callRpc('Filecoin.StateReadState', ['f03810106', []], 'mainnet'),
    ).resolves.toMatchObject({ Balance: '500000000000000000' });
    expect(retiredFallbackRequests).toBe(0);
    expect(stateReadFallbackRequests).toBe(1);
  });

  it('never submits MpoolPush to a retired fallback or the read-only lane', async () => {
    vi.stubEnv('VITE_LOTUS_RPC_FALLBACK_MAINNET', RETIRED_MAINNET_FALLBACK);
    vi.stubEnv(
      'VITE_LOTUS_RPC_STATE_READ_FALLBACK_MAINNET',
      STATE_READ_FALLBACK,
    );
    let retiredFallbackRequests = 0;
    let stateReadFallbackRequests = 0;

    server.use(
      http.post(PRIMARY, () => HttpResponse.error()),
      http.post(RETIRED_MAINNET_FALLBACK, () => {
        retiredFallbackRequests += 1;
        return HttpResponse.error();
      }),
      http.post(STATE_READ_FALLBACK, () => {
        stateReadFallbackRequests += 1;
        return HttpResponse.error();
      }),
    );

    await expect(
      callRpc('Filecoin.MpoolPush', [{ Message: {}, Signature: {} }], 'mainnet'),
    ).rejects.toThrow('transport error');
    expect(retiredFallbackRequests).toBe(0);
    expect(stateReadFallbackRequests).toBe(0);
  });

  it('deduplicates primary, configured fallback, and state-read fallback URL variants', async () => {
    vi.stubEnv('VITE_LOTUS_RPC_FALLBACK_MAINNET', `${PRIMARY}/`);
    vi.stubEnv('VITE_LOTUS_RPC_STATE_READ_FALLBACK_MAINNET', `${PRIMARY}/`);
    let primaryRequests = 0;
    server.use(
      http.post(PRIMARY, () => {
        primaryRequests += 1;
        return HttpResponse.text('unavailable', { status: 503 });
      }),
    );

    const error = await captureRpcError(
      callRpc('Filecoin.StateReadState', ['f0100', []], 'mainnet'),
    );

    expect(error).toMatchObject({
      kind: 'http',
      httpStatus: 503,
      endpointRole: 'primary',
    });
    expect(primaryRequests).toBe(1);
  });

  it('does not fail over non-retryable HTTP client errors', async () => {
    let fallbackRequests = 0;
    server.use(
      http.post(PRIMARY, () => HttpResponse.text('unauthorized', { status: 401 })),
      http.post(FALLBACK, ({ request }) => {
        fallbackRequests += 1;
        return jsonRpcResult(request, 'should-not-be-used');
      }),
    );

    const error = await captureRpcError(DataProvider.getBalance('f1'));

    expect(error).toMatchObject({
      kind: 'http',
      httpStatus: 401,
      method: 'Filecoin.WalletBalance',
      networkKey: 'mainnet',
      retryable: false,
    });
    expect(error.message).toContain('HTTP 401');
    expect(fallbackRequests).toBe(0);
  });

  it('fails over a malformed successful response', async () => {
    server.use(
      http.post(PRIMARY, () => HttpResponse.text('not-json')),
      http.post(FALLBACK, ({ request }) => jsonRpcResult(request, '789')),
    );

    await expect(DataProvider.getBalance('f1')).resolves.toBe('789');
  });

  it('rejects a mismatched JSON-RPC response id and uses the fallback', async () => {
    server.use(
      http.post(PRIMARY, async ({ request }) => {
        const body = (await request.json()) as { id: number };
        return HttpResponse.json({
          jsonrpc: '2.0',
          id: body.id + 1,
          result: 'wrong-request-result',
        });
      }),
      http.post(FALLBACK, ({ request }) => jsonRpcResult(request, 'matched-result')),
    );

    await expect(DataProvider.getBalance('f1')).resolves.toBe('matched-result');
  });

  it('fails closed when every success envelope is missing result', async () => {
    const missingResultResponse = async (request: Request) => {
      const body = (await request.json()) as { id: string | number };
      return HttpResponse.json({ jsonrpc: '2.0', id: body.id });
    };
    server.use(
      http.post(PRIMARY, ({ request }) => missingResultResponse(request)),
      http.post(FALLBACK, ({ request }) => missingResultResponse(request)),
    );

    const error = await captureRpcError(DataProvider.getBalance('f1'));

    expect(error).toMatchObject({
      kind: 'failover',
      method: 'Filecoin.WalletBalance',
      networkKey: 'mainnet',
      retryable: false,
    });
    expect(error.attempts).toHaveLength(2);
    expect(error.attempts?.[0]).toMatchObject({
      kind: 'malformed-response',
      endpointRole: 'primary',
    });
    expect(error.attempts?.[1]).toMatchObject({
      kind: 'malformed-response',
      endpointRole: 'fallback',
    });
    expect(error.message).toContain('primary: malformed JSON-RPC response');
    expect(error.message).toContain('fallback: malformed JSON-RPC response');
  });

  it('should resolve calibration-specific rpc config', () => {
    expect(getRpcConfig('calibration')).toEqual({
      primary: CALIBRATION_PRIMARY,
      fallback: CALIBRATION_FALLBACK,
      stateReadFallback: CALIBRATION_FALLBACK,
      timeout: 50,
    });
  });

  it('should read balances from the requested network rpc lane', async () => {
    server.use(
      http.post(CALIBRATION_PRIMARY, ({ request }) =>
        jsonRpcResult(request, '456'),
      ),
    );

    const result = await DataProvider.getBalance('t1sender', 'calibration');

    expect(result).toBe('456');
  });
});
