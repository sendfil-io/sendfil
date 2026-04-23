import pRetry from 'p-retry';
import pTimeout from 'p-timeout';
import { JsonRpcSuccess, JsonRpcError, RpcSuccess } from './types';
import {
  getDefaultNetworkKey,
  resolveLotusRpcConfig,
  type SendFilNetworkKey,
} from '../networks';

let requestId = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getRetryAttemptNumber(context: unknown): number | undefined {
  if (!isRecord(context) || typeof context.attemptNumber !== 'number') {
    return undefined;
  }

  return context.attemptNumber;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (isRecord(error) && typeof error.message === 'string') {
    return error.message;
  }

  return String(error);
}

function getRetryErrorMessage(context: unknown): string {
  if (isRecord(context) && 'error' in context) {
    return getErrorMessage(context.error);
  }

  return getErrorMessage(context);
}

export function getRpcConfig(
  networkKey: SendFilNetworkKey = getDefaultNetworkKey(),
) {
  const { primary, fallback, timeout } = resolveLotusRpcConfig(networkKey);

  if (!primary) {
    throw new Error(`Missing Lotus RPC configuration for ${networkKey}`);
  }

  return { primary, fallback, timeout };
}

export async function callRpc<T = unknown>(
  method: string,
  params: unknown[] = [],
  networkKey: SendFilNetworkKey = getDefaultNetworkKey(),
): Promise<T> {
  const { primary, fallback, timeout } = getRpcConfig(networkKey);

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
      onFailedAttempt: (context: unknown) => {
        console.warn(
          `[DataProvider] RPC attempt ${getRetryAttemptNumber(context) ?? 'unknown'} failed: ${getRetryErrorMessage(context)}`,
        );
      },
    },
  );
}
