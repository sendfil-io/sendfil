import { describe, expect, it } from 'vitest';
import { prepareBatchExecution } from '../batchExecution';

describe('INV-EXEC-001 prepared batch determinism', () => {
  it('produces the same prepared execution config for estimate and submit inputs', () => {
    const recipients = [
      {
        address: '0x1234567890abcdef1234567890abcdef12345678',
        amount: 1.25,
      },
      {
        address: 'f1abjxfbp274xpdqcpuaykwkfb43omjotacm2p3za',
        amount: 2.5,
      },
    ];
    const preparedForEstimate = prepareBatchExecution(recipients, 'PARTIAL');
    const preparedForSubmit = prepareBatchExecution(recipients, 'PARTIAL');

    expect(preparedForEstimate).toEqual(preparedForSubmit);
    expect(preparedForEstimate).toMatchObject({
      errorMode: 'PARTIAL',
      recipients,
      recipientCount: 2,
      totalValueAttoFil: 3_750_000_000_000_000_000n,
      batch: {
        value: 3_750_000_000_000_000_000n,
        recipientCount: 2,
      },
    });
    expect(preparedForEstimate.batch.data).toBe(preparedForSubmit.batch.data);
  });
});
