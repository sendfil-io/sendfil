import { describe, expect, it } from 'vitest';
import { mapBatchExecutionError } from '../errorHandling';

describe('mapBatchExecutionError', () => {
  it('maps wallet rejection errors to USER_REJECTED', () => {
    const error = mapBatchExecutionError(
      { code: 4001, message: 'User rejected the request.' },
      { errorMode: 'PARTIAL', stage: 'execution' },
    );

    expect(error.category).toBe('USER_REJECTED');
    expect(error.title).toBe('Transaction rejected');
  });

  it('maps insufficient funds errors to INSUFFICIENT_FUNDS', () => {
    const error = mapBatchExecutionError(
      new Error('insufficient funds for gas * price + value'),
      { errorMode: 'PARTIAL', stage: 'execution' },
    );

    expect(error.category).toBe('INSUFFICIENT_FUNDS');
  });

  it('maps atomic simulation reverts during preflight', () => {
    const error = mapBatchExecutionError(
      new Error('execution reverted: forward failed'),
      { errorMode: 'ATOMIC', stage: 'preflight' },
    );

    expect(error.category).toBe('SIMULATION_REVERT');
    expect(error.title).toBe('Atomic batch would revert');
  });

  it('maps atomic on-chain reverts after submission', () => {
    const error = mapBatchExecutionError(
      new Error('execution reverted'),
      { errorMode: 'ATOMIC', stage: 'confirmation' },
    );

    expect(error.category).toBe('ONCHAIN_REVERT_ATOMIC');
    expect(error.message).toContain('No transfers were finalized');
  });

  it('maps RPC transport failures to RPC_FAILURE', () => {
    const error = mapBatchExecutionError(
      new Error('Failed to fetch RPC response'),
      { errorMode: 'PARTIAL', stage: 'preflight' },
    );

    expect(error.category).toBe('RPC_FAILURE');
  });
});
