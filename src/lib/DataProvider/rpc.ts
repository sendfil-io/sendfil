import { JsonRpcSuccess, JsonRpcError, RpcSuccess } from './types';
import {
  RpcProviderError,
  type RpcEndpointRole,
  type RpcProviderErrorKind,
} from './RpcProviderError';
import {
  getDefaultNetworkKey,
  resolveLotusRpcConfig,
  type SendFilNetworkKey,
} from '../networks';

let requestId = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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

function raceAgainstAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('RPC timeout'));

    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function normalizeEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim();

  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return parsed.toString();
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isMethodNotFound(code: number): boolean {
  return code === -32601;
}

function createAttemptError({
  detail,
  method,
  networkKey,
  endpointRole,
  kind,
  retryable,
  code,
  data,
  httpStatus,
  originalError,
}: {
  detail: string;
  method: string;
  networkKey: SendFilNetworkKey;
  endpointRole: RpcEndpointRole;
  kind: Exclude<RpcProviderErrorKind, 'failover'>;
  retryable: boolean;
  code?: number;
  data?: unknown;
  httpStatus?: number;
  originalError?: unknown;
}): RpcProviderError {
  return new RpcProviderError(
    `Lotus RPC ${method} failed on ${networkKey} (${endpointRole}): ${detail}`,
    {
      code,
      data,
      httpStatus,
      method,
      networkKey,
      endpointRole,
      kind,
      retryable,
      detail,
      originalError,
    },
  );
}

function parseJsonResponse(text: string): unknown {
  if (text.length === 0) {
    throw new Error('response body was empty');
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`response body was not valid JSON: ${getErrorMessage(error)}`);
  }
}

function parseJsonRpcError(json: unknown): {
  id: string | number;
  code: number;
  message: string;
  data?: unknown;
} | undefined {
  const parsed = JsonRpcError.safeParse(json);
  if (!parsed.success) {
    return undefined;
  }

  return {
    id: parsed.data.id,
    ...parsed.data.error,
  };
}

async function callEndpoint<T>({
  url,
  endpointRole,
  method,
  params,
  networkKey,
  timeout,
  id,
}: {
  url: string;
  endpointRole: RpcEndpointRole;
  method: string;
  params: unknown[];
  networkKey: SendFilNetworkKey;
  timeout: number;
  id: number;
}): Promise<T> {
  const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  let responseHeadersReceived = false;
  let response: Response;
  let text: string;

  try {
    response = await raceAgainstAbort(
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      }),
      controller.signal,
    );
    responseHeadersReceived = true;
    text = await raceAgainstAbort(response.text(), controller.signal);
  } catch (error) {
    const timedOut = controller.signal.aborted;
    const detail = timedOut
      ? `RPC timeout after ${timeout}ms`
      : responseHeadersReceived
        ? `transport error while reading response: ${getErrorMessage(error)}`
        : `transport error: ${getErrorMessage(error)}`;

    throw createAttemptError({
      detail,
      method,
      networkKey,
      endpointRole,
      kind: timedOut ? 'timeout' : 'transport',
      retryable: true,
      originalError: error,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  let json: unknown;

  try {
    json = parseJsonResponse(text);
  } catch (error) {
    if (!response.ok) {
      throw createAttemptError({
        detail: `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
        method,
        networkKey,
        endpointRole,
        kind: 'http',
        retryable: isRetryableHttpStatus(response.status),
        httpStatus: response.status,
        originalError: error,
      });
    }

    throw createAttemptError({
      detail: getErrorMessage(error),
      method,
      networkKey,
      endpointRole,
      kind: 'malformed-response',
      retryable: true,
      originalError: error,
    });
  }

  const jsonRpcError = parseJsonRpcError(json);
  if (jsonRpcError) {
    if (jsonRpcError.id !== id) {
      throw createAttemptError({
        detail: `JSON-RPC response id ${String(jsonRpcError.id)} did not match request id ${id}`,
        method,
        networkKey,
        endpointRole,
        kind: 'malformed-response',
        retryable: true,
      });
    }

    const httpDetail = response.ok
      ? ''
      : `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}; `;
    const detail = `${httpDetail}JSON-RPC ${jsonRpcError.code}: ${jsonRpcError.message}`;
    throw createAttemptError({
      detail,
      method,
      networkKey,
      endpointRole,
      kind: 'json-rpc',
      retryable:
        isMethodNotFound(jsonRpcError.code) ||
        (!response.ok && isRetryableHttpStatus(response.status)),
      code: jsonRpcError.code,
      data: jsonRpcError.data,
      httpStatus: response.ok ? undefined : response.status,
    });
  }

  if (!response.ok) {
    throw createAttemptError({
      detail: `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
      method,
      networkKey,
      endpointRole,
      kind: 'http',
      retryable: isRetryableHttpStatus(response.status),
      httpStatus: response.status,
    });
  }

  const parsed = JsonRpcSuccess.safeParse(json);
  if (
    !parsed.success ||
    !isRecord(json) ||
    !Object.prototype.hasOwnProperty.call(json, 'result')
  ) {
    throw createAttemptError({
      detail: 'malformed JSON-RPC response',
      method,
      networkKey,
      endpointRole,
      kind: 'malformed-response',
      retryable: true,
    });
  }

  if (parsed.data.id !== id) {
    throw createAttemptError({
      detail: `JSON-RPC response id ${String(parsed.data.id)} did not match request id ${id}`,
      method,
      networkKey,
      endpointRole,
      kind: 'malformed-response',
      retryable: true,
    });
  }

  return (parsed.data as RpcSuccess<T>).result;
}

function combineAttemptErrors(
  method: string,
  networkKey: SendFilNetworkKey,
  attempts: readonly RpcProviderError[],
): RpcProviderError {
  const details = attempts
    .map((error) => `${error.endpointRole ?? 'endpoint'}: ${error.detail}`)
    .join('; ');
  const firstCodedError = attempts.find((error) => error.code !== undefined);

  return new RpcProviderError(
    `Lotus RPC ${method} failed on ${networkKey} after ${attempts.length} endpoints: ${details}`,
    {
      code: firstCodedError?.code,
      data: firstCodedError?.data,
      method,
      networkKey,
      kind: 'failover',
      retryable: false,
      detail: details,
      attempts,
    },
  );
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
  const endpoints: Array<{ url: string; endpointRole: RpcEndpointRole }> = [
    { url: primary, endpointRole: 'primary' },
  ];

  if (fallback && normalizeEndpoint(fallback) !== normalizeEndpoint(primary)) {
    endpoints.push({ url: fallback, endpointRole: 'fallback' });
  }

  const id = requestId++;
  const errors: RpcProviderError[] = [];

  for (const endpoint of endpoints) {
    try {
      return await callEndpoint<T>({
        ...endpoint,
        method,
        params,
        networkKey,
        timeout,
        id,
      });
    } catch (error) {
      const rpcError =
        error instanceof RpcProviderError
          ? error
          : createAttemptError({
              detail: `unexpected error: ${getErrorMessage(error)}`,
              method,
              networkKey,
              endpointRole: endpoint.endpointRole,
              kind: 'transport',
              retryable: false,
              originalError: error,
            });
      errors.push(rpcError);

      const hasAnotherEndpoint = errors.length < endpoints.length;
      if (!rpcError.retryable || !hasAnotherEndpoint) {
        break;
      }

      console.warn(`[DataProvider] ${rpcError.message}; trying fallback endpoint.`);
    }
  }

  if (errors.length === 1) {
    throw errors[0];
  }

  throw combineAttemptErrors(method, networkKey, errors);
}
