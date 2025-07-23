import { z } from 'zod';

export const JsonRpcSuccess = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.number(),
  result: z.any(),
});

export const JsonRpcError = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.number(),
  error: z.object({
    code: z.number(),
    message: z.string(),
  }),
});

export type RpcSuccess<T = unknown> = z.infer<typeof JsonRpcSuccess> & { result: T };
export type RpcError = z.infer<typeof JsonRpcError>; 