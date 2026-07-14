import { describe, expect, it, vi } from 'vitest';
import { RpcProviderError } from '../../DataProvider/RpcProviderError';
import type { SignedMessage } from '../../DataProvider/types';
import {
  NativeFilecoinSubmissionUncertainError,
  computeSignedMessageCid,
  submitSignedNativeFilecoinMessage,
} from '../nativeFilecoinSubmission';

const SECP_SIGNED_MESSAGE: SignedMessage = {
  Message: {
    Version: 0,
    To: 'f1h4ssetvnj2vpugsuzptl4swlgfunw7oa3eik54a',
    From: 'f1aevmq7tjmunenlo3ozsewaqulc2agaxasacqmsa',
    Nonce: 153,
    Value: '19999988655800000000000',
    GasLimit: 6_000_000,
    GasFeeCap: '1890700000',
    GasPremium: '150000',
    Method: 0,
    Params: '',
  },
  Signature: {
    Type: 1,
    Data: 'mWiSB8cI1E1635er9sypX1l88jKszlJwBb24hT+PaVwdNP7NZnWfymPfPwpjtLlTTgnDgB2TZ2MsutDm5OpL2QE=',
  },
};

const SECP_SIGNED_MESSAGE_CID =
  'bafy2bzacebcodbmrjkfrr63lms3wevg2nmceh2666bd3x76lwtsa7iygj7beo';

const BLS_SIGNED_MESSAGE: SignedMessage = {
  Message: {
    Version: 0,
    To: 'f01081394',
    From: 'f3xh2d6xgxemrse4kx4np47tc5tn3ol7eiavsl7dcvdpn2dgjnhtmoahn6aq6ubfijiy525csraldsgizk4fkq',
    Nonce: 18_372,
    Value: '0',
    GasLimit: 25_622_528,
    GasFeeCap: '195140776117',
    GasPremium: '101002',
    Method: 5,
    Params:
      'hRgngYIAQIGCDVjAuGc/JHySqwPkGj9LDBs3iPkIYQCKmTPet4u79W2najh+owo4kD7LPLIunxSSiFfniVJm++MePpbJDJFsgQsVf28ZV6x8pHpKvh2HWDG03vylzZH4MuTBDDCwlv0WzDYuEZcvbm81uj0iB0aFhFtMyo6BnA7wwDKl9NZ66VrVFQtR0nzQQJ0YM8488Pr6D6dip62ftLEbwd0ZeHFQ/yJ1iNhsKxUzFgmdlPn0ONgmdIDEbKxab/ZyiOMDVYrYVKMiGgBeXzVYIJfi4oDKxSNMTz0/mz+K93O9p+/YUZ1ke7EsCqaN6o5o',
  },
  Signature: {
    Type: 2,
    Data: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  },
};

const BLS_UNSIGNED_MESSAGE_CID =
  'bafy2bzacecltcibo6i2aewv7b3fz4f7cie26c5jminwhxs7iuttgzbtaptvui';

const DELEGATED_SIGNED_MESSAGE: SignedMessage = {
  Message: {
    Version: 0,
    To: 'f410fxloqxewby4oqfz6ved3eycdwkoh2evl7wlysraq',
    From: 'f410f2litvrgmnwli2qcgen3iyjm4vz72iwyhnkazccy',
    Nonce: 8_839,
    Value: '0',
    GasLimit: 185_819_578,
    GasFeeCap: '2895382',
    GasPremium: '199184',
    Method: 3_844_450_837,
    Params:
      'WIRFwLktAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABUUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAF5qTgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  },
  Signature: {
    Type: 3,
    Data: 'woU+Bl56xZTXsJXXqJ41G2FCMr3CaWEStStSWjfc8DNvg1SIl7bIsrNRhQ9qrk7jNs8j/AdquYXsS3CFfZ5xpwA=',
  },
};

const DELEGATED_SIGNED_MESSAGE_CID =
  'bafy2bzacebpekbxp7qyk4xx5r7es3t77sqcgdq5c7osfow4ayvbyyafwl4sxk';

// Immutable vectors above come from Filecoin Mainnet block
// bafy2bzacedpk7crcxfy5y4eyy34hqduvuliwjcblm3gervekqkjucfgknb7e2 via
// Filecoin.ChainGetBlockMessages. Lotus defines the CID and CBOR behavior here:
// https://github.com/filecoin-project/lotus/blob/v1.36.0/chain/types/signedmessage.go
// https://github.com/filecoin-project/lotus/blob/v1.36.0/chain/types/cbor_gen.go

describe('native Filecoin signed-message CID computation', () => {
  it('matches a Lotus secp256k1 SignedMessage CID vector', () => {
    expect(computeSignedMessageCid(SECP_SIGNED_MESSAGE)).toBe(SECP_SIGNED_MESSAGE_CID);
  });

  it('uses the unsigned Message CID for a Lotus BLS vector', () => {
    expect(computeSignedMessageCid(BLS_SIGNED_MESSAGE)).toBe(BLS_UNSIGNED_MESSAGE_CID);
  });

  it('matches a Lotus delegated SignedMessage CID vector', () => {
    expect(computeSignedMessageCid(DELEGATED_SIGNED_MESSAGE)).toBe(
      DELEGATED_SIGNED_MESSAGE_CID,
    );
  });

  it('rejects noncanonical signature data before producing a CID', () => {
    expect(() =>
      computeSignedMessageCid({
        ...SECP_SIGNED_MESSAGE,
        Signature: { Type: 1, Data: 'not base64' },
      }),
    ).toThrow('canonical padded base64');
  });
});

describe('native Filecoin MpoolPush uncertainty', () => {
  it('accepts only a matching node CID and returns the locally derived CID', async () => {
    const submit = vi.fn(async () => ({ '/': SECP_SIGNED_MESSAGE_CID }));

    await expect(
      submitSignedNativeFilecoinMessage(SECP_SIGNED_MESSAGE, 'mainnet', submit),
    ).resolves.toEqual({ cid: SECP_SIGNED_MESSAGE_CID });
    expect(submit).toHaveBeenCalledWith(SECP_SIGNED_MESSAGE, 'mainnet');
  });

  it('awaits the local-CID safety callback before MpoolPush', async () => {
    const order: string[] = [];
    const submit = vi.fn(async () => {
      order.push('submit');
      return { '/': SECP_SIGNED_MESSAGE_CID };
    });

    await submitSignedNativeFilecoinMessage(
      SECP_SIGNED_MESSAGE,
      'mainnet',
      submit,
      {
        async onCidComputed(cid) {
          expect(cid).toBe(SECP_SIGNED_MESSAGE_CID);
          await Promise.resolve();
          order.push('persist');
        },
      },
    );

    expect(order).toEqual(['persist', 'submit']);
  });

  it('does not call MpoolPush when durable CID persistence fails', async () => {
    const submit = vi.fn(async () => ({ '/': SECP_SIGNED_MESSAGE_CID }));
    const persistenceFailure = new Error('local storage unavailable');

    await expect(
      submitSignedNativeFilecoinMessage(
        SECP_SIGNED_MESSAGE,
        'mainnet',
        submit,
        {
          onCidComputed() {
            throw persistenceFailure;
          },
        },
      ),
    ).rejects.toBe(persistenceFailure);
    expect(submit).not.toHaveBeenCalled();
  });

  it('retains the deterministic CID when a node may accept the message but loses its response', async () => {
    const transportFailure = new RpcProviderError('response lost', {
      method: 'Filecoin.MpoolPush',
      networkKey: 'mainnet',
      endpointRole: 'primary',
      kind: 'transport',
      retryable: true,
      detail: 'transport error while reading response',
    });
    const submit = vi.fn(async () => {
      throw transportFailure;
    });

    const submission = submitSignedNativeFilecoinMessage(
      SECP_SIGNED_MESSAGE,
      'mainnet',
      submit,
    );

    await expect(submission).rejects.toMatchObject({
      name: 'NativeFilecoinSubmissionUncertainError',
      cid: SECP_SIGNED_MESSAGE_CID,
      networkKey: 'mainnet',
      cause: transportFailure,
    });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('retains the deterministic CID when both failover responses are lost', async () => {
    const primaryFailure = new RpcProviderError('primary response lost', {
      method: 'Filecoin.MpoolPush',
      networkKey: 'mainnet',
      endpointRole: 'primary',
      kind: 'timeout',
      retryable: true,
      detail: 'RPC timeout',
    });
    const fallbackFailure = new RpcProviderError('fallback response lost', {
      method: 'Filecoin.MpoolPush',
      networkKey: 'mainnet',
      endpointRole: 'fallback',
      kind: 'transport',
      retryable: true,
      detail: 'transport error while reading response',
    });
    const failoverFailure = new RpcProviderError('both endpoints failed', {
      method: 'Filecoin.MpoolPush',
      networkKey: 'mainnet',
      kind: 'failover',
      retryable: false,
      detail: 'primary and fallback responses were unavailable',
      attempts: [primaryFailure, fallbackFailure],
    });
    const submit = vi.fn(async () => {
      throw failoverFailure;
    });

    await expect(
      submitSignedNativeFilecoinMessage(SECP_SIGNED_MESSAGE, 'mainnet', submit),
    ).rejects.toMatchObject({
      name: 'NativeFilecoinSubmissionUncertainError',
      cid: SECP_SIGNED_MESSAGE_CID,
      cause: failoverFailure,
    });
  });

  it('keeps the CID locked for nonretryable Lotus application errors', async () => {
    const rejected = new RpcProviderError('bad nonce', {
      code: 1,
      method: 'Filecoin.MpoolPush',
      networkKey: 'mainnet',
      endpointRole: 'primary',
      kind: 'json-rpc',
      retryable: false,
      detail: 'JSON-RPC 1: message nonce is invalid',
    });
    const submit = vi.fn(async () => {
      throw rejected;
    });

    await expect(
      submitSignedNativeFilecoinMessage(SECP_SIGNED_MESSAGE, 'mainnet', submit),
    ).rejects.toMatchObject({
      name: 'NativeFilecoinSubmissionUncertainError',
      cid: SECP_SIGNED_MESSAGE_CID,
      cause: rejected,
    });
  });

  it('preserves a protocol-level invalid-params rejection as definitive', async () => {
    const rejected = new RpcProviderError('invalid params', {
      code: -32602,
      method: 'Filecoin.MpoolPush',
      networkKey: 'mainnet',
      endpointRole: 'primary',
      kind: 'json-rpc',
      retryable: false,
      detail: 'JSON-RPC -32602: invalid params',
    });
    const submit = vi.fn(async () => {
      throw rejected;
    });

    await expect(
      submitSignedNativeFilecoinMessage(SECP_SIGNED_MESSAGE, 'mainnet', submit),
    ).rejects.toBe(rejected);
  });

  it('treats a retryable HTTP JSON-RPC failure as ambiguous after signing', async () => {
    const retryableServerFailure = new RpcProviderError('internal server error', {
      code: -32603,
      httpStatus: 500,
      method: 'Filecoin.MpoolPush',
      networkKey: 'mainnet',
      endpointRole: 'primary',
      kind: 'json-rpc',
      retryable: true,
      detail: 'HTTP 500; JSON-RPC -32603: internal server error',
    });
    const submit = vi.fn(async () => {
      throw retryableServerFailure;
    });

    await expect(
      submitSignedNativeFilecoinMessage(SECP_SIGNED_MESSAGE, 'mainnet', submit),
    ).rejects.toMatchObject({
      name: 'NativeFilecoinSubmissionUncertainError',
      cid: SECP_SIGNED_MESSAGE_CID,
      cause: retryableServerFailure,
    });
  });

  it('fails closed with both CIDs when MpoolPush returns a mismatched CID', async () => {
    const returnedCid = 'bafy2bzacewrongcid';
    const submit = vi.fn(async () => ({ '/': returnedCid }));

    const submission = submitSignedNativeFilecoinMessage(
      SECP_SIGNED_MESSAGE,
      'mainnet',
      submit,
    );

    await expect(submission).rejects.toEqual(
      expect.objectContaining<Partial<NativeFilecoinSubmissionUncertainError>>({
        cid: SECP_SIGNED_MESSAGE_CID,
        networkKey: 'mainnet',
        returnedCid,
      }),
    );
  });
});
