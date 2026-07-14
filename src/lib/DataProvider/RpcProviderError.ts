import type { SendFilNetworkKey } from '../networks';

export type RpcProviderErrorKind =
  | 'transport'
  | 'timeout'
  | 'http'
  | 'json-rpc'
  | 'malformed-response'
  | 'failover';

export type RpcEndpointRole = 'primary' | 'fallback';

export interface RpcProviderErrorOptions {
  code?: number;
  data?: unknown;
  httpStatus?: number;
  method?: string;
  networkKey?: SendFilNetworkKey;
  endpointRole?: RpcEndpointRole;
  kind?: RpcProviderErrorKind;
  retryable?: boolean;
  detail?: string;
  originalError?: unknown;
  attempts?: readonly RpcProviderError[];
}

/**
 * A contextual Lotus JSON-RPC failure.
 *
 * The numeric second argument is retained for compatibility with the previous
 * constructor. New callers should pass an options object so transport and
 * application failures remain distinguishable.
 */
export class RpcProviderError extends Error {
  readonly code?: number;
  readonly data?: unknown;
  readonly httpStatus?: number;
  readonly method?: string;
  readonly networkKey?: SendFilNetworkKey;
  readonly endpointRole?: RpcEndpointRole;
  readonly kind?: RpcProviderErrorKind;
  readonly retryable: boolean;
  readonly detail: string;
  readonly originalError?: unknown;
  readonly attempts?: readonly RpcProviderError[];

  constructor(message: string, optionsOrCode: RpcProviderErrorOptions | number = {}) {
    super(message);
    this.name = 'RpcProviderError';

    const options =
      typeof optionsOrCode === 'number' ? { code: optionsOrCode } : optionsOrCode;

    this.code = options.code;
    this.data = options.data;
    this.httpStatus = options.httpStatus;
    this.method = options.method;
    this.networkKey = options.networkKey;
    this.endpointRole = options.endpointRole;
    this.kind = options.kind;
    this.retryable = options.retryable ?? false;
    this.detail = options.detail ?? message;
    this.originalError = options.originalError;
    this.attempts = options.attempts;
  }
}
