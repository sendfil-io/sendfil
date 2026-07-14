import { Buffer as BrowserBuffer } from 'buffer';
import { Message } from 'iso-filecoin/message';
import { lotusCid } from 'iso-filecoin/utils';
import { submitTransaction } from '../DataProvider';
import { RpcProviderError } from '../DataProvider/RpcProviderError';
import type { SignedMessage } from '../DataProvider/types';
import type { SendFilNetworkKey } from '../networks';
import type { NativeFilecoinSendResult } from './types';
import type { NativeFilecoinSubmissionOptions } from './types';

const FILECOIN_SIGNATURE_MAX_LENGTH = 200;
const BASE32_LOWER_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

type SubmitSignedMessage = (
  signedMessage: SignedMessage,
  networkKey?: SendFilNetworkKey,
) => Promise<{ '/': string }>;

export interface NativeFilecoinSubmissionUncertainErrorOptions {
  cid: string;
  networkKey: SendFilNetworkKey;
  cause: unknown;
  returnedCid?: string;
}

/**
 * The message was signed and an MpoolPush request was attempted, but its
 * acceptance could not be proved. The CID is derived locally from the exact
 * signed payload; it identifies what may have reached the network without
 * claiming that the node accepted it.
 */
export class NativeFilecoinSubmissionUncertainError extends Error {
  readonly cid: string;
  readonly networkKey: SendFilNetworkKey;
  readonly returnedCid?: string;
  override readonly cause: unknown;

  constructor({
    cid,
    networkKey,
    cause,
    returnedCid,
  }: NativeFilecoinSubmissionUncertainErrorOptions) {
    const mismatchDetail = returnedCid
      ? ` The node returned a different CID (${returnedCid}).`
      : '';

    super(
      `SendFIL could not verify whether Filecoin.MpoolPush accepted the signed message ` +
        `with CID ${cid} on ${networkKey}.${mismatchDetail} ` +
        'Do not sign or submit it again until you inspect that CID.',
    );
    this.name = 'NativeFilecoinSubmissionUncertainError';
    this.cid = cid;
    this.networkKey = networkKey;
    this.returnedCid = returnedCid;
    this.cause = cause;
  }
}

export function isNativeFilecoinSubmissionUncertainError(
  error: unknown,
): error is NativeFilecoinSubmissionUncertainError {
  return error instanceof NativeFilecoinSubmissionUncertainError;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result;
}

function encodeBase32Lower(bytes: Uint8Array): string {
  let value = 0;
  let bitCount = 0;
  let encoded = 'b';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bitCount += 8;

    while (bitCount >= 5) {
      bitCount -= 5;
      encoded += BASE32_LOWER_ALPHABET[(value >>> bitCount) & 31];
      value &= (1 << bitCount) - 1;
    }
  }

  if (bitCount > 0) {
    encoded += BASE32_LOWER_ALPHABET[(value << (5 - bitCount)) & 31];
  }

  return encoded;
}

function encodeCborByteStringHeader(length: number): Uint8Array {
  if (length < 24) {
    return Uint8Array.from([0x40 + length]);
  }

  if (length <= 0xff) {
    return Uint8Array.from([0x58, length]);
  }

  return Uint8Array.from([0x59, length >>> 8, length & 0xff]);
}

function decodeSignatureBytes(signature: SignedMessage['Signature']): Uint8Array {
  if (signature.Type !== 1 && signature.Type !== 2 && signature.Type !== 3) {
    throw new Error(`Unsupported Filecoin signature type ${signature.Type}.`);
  }

  const data = BrowserBuffer.from(signature.Data, 'base64');

  if (data.length === 0 || data.toString('base64') !== signature.Data) {
    throw new Error('Filecoin signature data is not canonical padded base64.');
  }

  const bytes = concatBytes(Uint8Array.from([signature.Type]), data);

  if (bytes.length > FILECOIN_SIGNATURE_MAX_LENGTH) {
    throw new Error('Filecoin signature exceeds the protocol maximum length.');
  }

  return bytes;
}

function serializeUnsignedMessage(signedMessage: SignedMessage): Message {
  const message = signedMessage.Message;

  if (message.Version !== 0) {
    throw new Error(`Unsupported Filecoin message version ${message.Version}.`);
  }

  return new Message({
    version: 0,
    to: message.To,
    from: message.From,
    nonce: message.Nonce,
    value: message.Value,
    gasLimit: message.GasLimit,
    gasFeeCap: message.GasFeeCap,
    gasPremium: message.GasPremium,
    method: message.Method,
    params: message.Params ?? '',
  });
}

/**
 * Reproduces Lotus SignedMessage.Cid(): BLS messages use the unsigned Message
 * CID; secp256k1 and delegated messages hash the canonical SignedMessage CBOR.
 */
export function computeSignedMessageCid(signedMessage: SignedMessage): string {
  const message = serializeUnsignedMessage(signedMessage);
  const signatureBytes = decodeSignatureBytes(signedMessage.Signature);

  if (signedMessage.Signature.Type === 2) {
    return encodeBase32Lower(message.cidBytes());
  }

  const signedMessageBytes = concatBytes(
    Uint8Array.from([0x82]),
    message.serialize(),
    encodeCborByteStringHeader(signatureBytes.length),
    signatureBytes,
  );

  return encodeBase32Lower(lotusCid(signedMessageBytes));
}

function isDefinitiveRpcRejection(error: RpcProviderError): boolean {
  if (error.kind === 'json-rpc') {
    // Only protocol-level dispatch/parameter errors prove that MpoolPush could
    // not have reached Lotus's side-effecting message-pool path. Lotus
    // application errors (commonly code 1) can be returned after the exact CID
    // was added, while publishing it, or when it already exists in the pool.
    return error.code === -32601 || error.code === -32602;
  }

  return Boolean(
    error.kind === 'failover' &&
      error.attempts?.length &&
      error.attempts.every(isDefinitiveRpcRejection),
  );
}

function isAmbiguousMpoolFailure(error: unknown): boolean {
  return error instanceof RpcProviderError && !isDefinitiveRpcRejection(error);
}

export async function submitSignedNativeFilecoinMessage(
  signedMessage: SignedMessage,
  networkKey: SendFilNetworkKey,
  submit: SubmitSignedMessage = submitTransaction,
  options: NativeFilecoinSubmissionOptions = {},
): Promise<NativeFilecoinSendResult> {
  const cid = computeSignedMessageCid(signedMessage);
  await options.onCidComputed?.(cid);
  let response: { '/': string };

  try {
    response = await submit(signedMessage, networkKey);
  } catch (cause) {
    if (isAmbiguousMpoolFailure(cause)) {
      throw new NativeFilecoinSubmissionUncertainError({
        cid,
        networkKey,
        cause,
      });
    }

    throw cause;
  }

  const returnedCid = response?.['/'];

  if (returnedCid !== cid) {
    throw new NativeFilecoinSubmissionUncertainError({
      cid,
      networkKey,
      cause: new Error(
        returnedCid
          ? `MpoolPush returned ${returnedCid}, expected ${cid}.`
          : 'MpoolPush returned no CID.',
      ),
      ...(returnedCid ? { returnedCid } : {}),
    });
  }

  return { cid };
}
