import pRetry from 'p-retry';
import pTimeout from 'p-timeout';
import { JsonRpcSuccess, JsonRpcError, RpcSuccess } from './types';

let requestId = 1;

function getRpcConfig() {
  const primary = import.meta.env.VITE_GLIF_RPC_URL_PRIMARY as string | undefined;
  const fallback =
    (import.meta.env.VITE_GLIF_RPC_URL_FALLBACK as string | undefined) || primary;
  const timeout = Number(import.meta.env.VITE_GLIF_RPC_TIMEOUT_MS) || 10_000;

  if (!primary) {
    throw new Error('Missing VITE_GLIF_RPC_URL_PRIMARY');
  }

  return { primary, fallback, timeout };
}

export async function callRpc<T = unknown>(
  method: string,
  params: unknown[] = [],
): Promise<T> {
  const { primary, fallback, timeout } = getRpcConfig();

  return pRetry(
    async (attempt) => {
      const url = (attempt === 1 ? primary : fallback) as string;
      const body = JSON.stringify({ jsonrpc: '2.0', id: requestId++, method, params });

      const res = await pTimeout(
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        }),
        { milliseconds: timeout, message: 'RPC timeout' },
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
        console.warn(
          `[DataProvider] RPC attempt ${err.attemptNumber} failed: ${err.error.message}`,
        );
      },
    },
  );
} 
