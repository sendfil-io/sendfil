import { CoinType, newSecp256k1Address } from '@glif/filecoin-address';
import { describe, expect, it } from 'vitest';
import { validateCreateMultisigValues } from '../useMultisigs';

const SIGNER_F1 = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 10),
  CoinType.MAIN,
).toString();
const SIGNER_T1 = newSecp256k1Address(
  Uint8Array.from({ length: 33 }, (_, index) => index + 40),
  CoinType.TEST,
).toString();

describe('multisig create validation', () => {
  it('accepts exact native secp256k1 signers on the selected network', () => {
    const validated = validateCreateMultisigValues(
      {
        signers: [SIGNER_T1, ''],
        threshold: 1,
        initialDepositFil: '1.25',
        startEpoch: 0,
        unlockDuration: 10,
      },
      't',
    );

    expect(validated).toMatchObject({
      signers: [SIGNER_T1],
      threshold: 1,
      initialDepositAttoFil: 1_250_000_000_000_000_000n,
      startEpoch: 0,
      unlockDuration: 10,
    });
  });

  it('rejects wrong-network, malformed, delegated, and duplicate signers', () => {
    const baseValues = {
      threshold: 1,
      initialDepositFil: '0',
    };

    expect(() =>
      validateCreateMultisigValues({ ...baseValues, signers: [SIGNER_F1] }, 't'),
    ).toThrow('t1');
    expect(() =>
      validateCreateMultisigValues({ ...baseValues, signers: ['t1not-valid'] }, 't'),
    ).toThrow('t1');
    expect(() =>
      validateCreateMultisigValues(
        {
          ...baseValues,
          signers: ['t410fuc7qegj5j6r3iojsum3vodqa5aj2t4pry2bs3fy'],
        },
        't',
      ),
    ).toThrow('t1');
    expect(() =>
      validateCreateMultisigValues(
        {
          ...baseValues,
          signers: [SIGNER_T1, SIGNER_T1],
        },
        't',
      ),
    ).toThrow('Duplicate multisig signers');
  });

  it('rejects non-integer vesting fields', () => {
    expect(() =>
      validateCreateMultisigValues(
        {
          signers: [SIGNER_T1],
          threshold: 1,
          initialDepositFil: '0',
          unlockDuration: 1.5,
        },
        't',
      ),
    ).toThrow('Unlock duration');

    expect(() =>
      validateCreateMultisigValues(
        {
          signers: [SIGNER_T1],
          threshold: 1,
          initialDepositFil: '0',
          startEpoch: -1,
        },
        't',
      ),
    ).toThrow('Start epoch');
  });
});
