import pRetry from 'p-retry';
import pTimeout from 'p-timeout';
import { JsonRpcSuccess, JsonRpcError, RpcSuccess } from './types';

const [PRIMARY, FALLBACK] = [
  import.meta.env.VITE_GLIF_RPC_URL_PRIMARY,
  import.meta.env.VITE_GLIF_RPC_URL_FALLBACK,
];

const TIMEOUT = Number(import.meta.env.VITE_GLIF_RPC_TIMEOUT_MS) || 10_000;

let requestId = 1;

export async function callRpc<T = unknown>(
  method: string,
  params: unknown[] = [],
): Promise<T> {
  return pRetry(
    async (attempt) => {
      const url = attempt === 1 ? PRIMARY : FALLBACK;
      const body = JSON.stringify({ jsonrpc: '2.0', id: requestId++, method, params });

      const res = await pTimeout(
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        }),
        { milliseconds: TIMEOUT, message: 'RPC timeout' },
      );

      const json = await res.json();

      if (JsonRpcError.safeParse(json).success)
        throw new Error(json.error.message);

      const parsed = JsonRpcSuccess.safeParse(json);
      if (!parsed.success) throw new Error('Malformed RPC response');

      return (parsed.data as RpcSuccess<T>).result;
    },
    {
      retries: 1, // only one fail-over attempt
      onFailedAttempt: (err) => {
        console.warn(`[DataProvider] RPC attempt ${err.attemptNumber} failed: ${err.message}`);
      },
    },
  );
} 