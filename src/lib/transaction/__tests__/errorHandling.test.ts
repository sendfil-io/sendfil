import { describe, expect, it } from 'vitest';
import { mapBatchExecutionError } from '../errorHandling';

describe('mapBatchExecutionError', () => {
  function createStatusError(message: string, statusCode: number): Error {
    const error = new Error(message) as Error & { statusCode: number };
    error.statusCode = statusCode;
    return error;
  }

  it('maps wallet rejection errors to USER_REJECTED', () => {
    const error = mapBatchExecutionError(
      { code: 4001, message: 'User rejected the request.' },
      { errorMode: 'PARTIAL', stage: 'execution' },
    );

    expect(error.category).toBe('USER_REJECTED');
    expect(error.title).toBe('Transaction rejected');
  });

  it('maps Ledger device rejection status to USER_REJECTED', () => {
    const error = mapBatchExecutionError(
      createStatusError('Filecoin App: Command rejected (0x6986)', 0x6986),
      { errorMode: 'ATOMIC', stage: 'execution' },
    );

    expect(error.category).toBe('USER_REJECTED');
    expect(error.details).toContain('0x6986');
  });

  it('reads nested Ledger status codes from normalized wallet errors', () => {
    const cause = createStatusError('Filecoin App: APDU failure', 0x6986);
    const wrapper = new Error(
      'Ledger could not sign the Filecoin message',
    ) as Error & { cause?: unknown };
    wrapper.cause = cause;

    const error = mapBatchExecutionError(wrapper, {
      errorMode: 'ATOMIC',
      stage: 'execution',
    });

    expect(error.category).toBe('USER_REJECTED');
    expect(error.details).toContain('APDU failure');
  });

  it('keeps ambiguous Ledger 0x6985 failures neutral', () => {
    const error = mapBatchExecutionError(
      createStatusError(
        'Ledger device: Condition of use not satisfied (denied by the user?) (0x6985)',
        0x6985,
      ),
      { errorMode: 'ATOMIC', stage: 'execution' },
    );

    expect(error.category).toBe('WALLET_FAILURE');
  });

  it('maps explicit Ledger 0x5501 refusal to USER_REJECTED', () => {
    const error = mapBatchExecutionError(
      createStatusError('Ledger device: User refused on device (0x5501)', 0x5501),
      { errorMode: 'ATOMIC', stage: 'execution' },
    );

    expect(error.category).toBe('USER_REJECTED');
  });

  it('maps normalized native signature cancellation to USER_REJECTED', () => {
    const cause = new Error('Request cancelled');
    const wrapper = new Error(
      'FilSnap signature request was rejected in MetaMask. No Filecoin message was submitted.',
    ) as Error & { cause?: unknown };
    wrapper.cause = cause;

    const error = mapBatchExecutionError(wrapper, {
      errorMode: 'ATOMIC',
      stage: 'execution',
    });

    expect(error.category).toBe('USER_REJECTED');
    expect(error.details).toContain('Request cancelled');
  });

  it('does not treat an unrelated RPC diagnostic containing 0x6986 as rejection', () => {
    const error = mapBatchExecutionError(
      new Error('RPC response included calldata fragment 0x6986'),
      { errorMode: 'ATOMIC', stage: 'preflight' },
    );

    expect(error.category).toBe('RPC_FAILURE');
  });

  it('does not treat an upstream RPC request rejection as wallet rejection', () => {
    const error = mapBatchExecutionError(
      new Error('Lotus RPC request rejected by upstream'),
      { errorMode: 'ATOMIC', stage: 'preflight' },
    );

    expect(error.category).toBe('RPC_FAILURE');
  });

  it('maps other native wallet signing errors to WALLET_FAILURE', () => {
    const error = mapBatchExecutionError(
      new Error(
        'Ledger could not sign the Filecoin message: Filecoin App: Bad key handle (0x6a80)',
      ),
      { errorMode: 'ATOMIC', stage: 'execution' },
    );

    expect(error.category).toBe('WALLET_FAILURE');
    expect(error.title).toBe('Wallet signing failed');
    expect(error.message).toContain('was not submitted');
  });

  it('keeps a Ledger signing transport timeout in WALLET_FAILURE', () => {
    const error = mapBatchExecutionError(
      new Error(
        'Ledger could not sign the Filecoin message: TransportExchangeTimeoutError: timeout',
      ),
      { errorMode: 'ATOMIC', stage: 'execution' },
    );

    expect(error.category).toBe('WALLET_FAILURE');
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

  it('preserves nested wallet and RPC diagnostics while prioritizing RPC_FAILURE', () => {
    const cause = new Error(
      'Lotus RPC Filecoin.GasEstimateMessageGas failed: timeout after 10000ms',
    );
    const wrapper = new Error(
      'Ledger could not sign the Filecoin message',
    ) as Error & { cause?: unknown };
    wrapper.cause = cause;
    const error = mapBatchExecutionError(wrapper, {
      errorMode: 'ATOMIC',
      stage: 'execution',
    });

    expect(error.category).toBe('RPC_FAILURE');
    expect(error.details).toContain('Ledger could not sign the Filecoin message');
    expect(error.details).toContain('Filecoin.GasEstimateMessageGas');
    expect(error.details).toContain('timeout after 10000ms');
  });

  it('does not classify WalletConnect connection errors as native signing failures', () => {
    const error = mapBatchExecutionError(
      new Error('WalletConnect connector not connected'),
      { errorMode: 'ATOMIC', stage: 'preflight' },
    );

    expect(error.category).toBe('RPC_FAILURE');
  });
});
