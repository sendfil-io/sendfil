import { CoinType, Protocol, newFromString } from '@glif/filecoin-address';
import { callRpc } from '../DataProvider/rpc';
import { isCanonicalFilecoinDagCborCid } from '../DataProvider/filecoinMessageCid';
import type { FilecoinMessage } from '../DataProvider/types';
import type { SendFilNetworkKey } from '../networks';
import { validateNoEvmContractRecipients } from '../../utils/contractRecipientGuard';
import type {
  MultisigActorState,
  MultisigPendingProposal,
  MultisigVestingSchedule,
  NativeMultisigAddress,
} from './types';
import { computeProposalHash, paramsBase64ToBytes } from './actorParams';
import {
  decodeMultisigActorCodeCid,
  getBuiltinActorsManifestCid,
  getSystemActorAddress,
} from './actorManifest';
import { validateDecodedBatchFeePolicy, verifyPendingSendFilProposal } from './proposalVerifier';

export interface LotusCid {
  '/': string;
}

export type LotusTipSetKey = readonly [LotusCid, ...LotusCid[]];

export interface LotusActorState {
  Balance: string;
  Code?: LotusCid;
  State: unknown;
}

export interface LotusPendingTransaction {
  ID?: number;
  TxnID?: number;
  To: string;
  Value: string;
  Method: number;
  Params?: string;
  Approved?: string[];
  Approvals?: string[];
  Proposer?: string;
}

export interface MultisigRpc {
  getChainHead: (networkKey: SendFilNetworkKey) => Promise<unknown>;
  readState: (
    address: string,
    networkKey: SendFilNetworkKey,
    tipSetKey: LotusTipSetKey,
  ) => Promise<LotusActorState>;
  lookupID: (
    address: string,
    networkKey: SendFilNetworkKey,
    tipSetKey: LotusTipSetKey,
  ) => Promise<string>;
  getAvailableBalance: (
    address: string,
    networkKey: SendFilNetworkKey,
    tipSetKey: LotusTipSetKey,
  ) => Promise<bigint>;
  getVestingSchedule: (
    address: string,
    networkKey: SendFilNetworkKey,
    tipSetKey: LotusTipSetKey,
  ) => Promise<MultisigVestingSchedule | undefined>;
  getPending: (
    address: string,
    networkKey: SendFilNetworkKey,
    tipSetKey: LotusTipSetKey,
  ) => Promise<LotusPendingTransaction[]>;
  readObject: (cid: LotusCid, networkKey: SendFilNetworkKey) => Promise<string>;
  estimateGas: (
    message: FilecoinMessage,
    networkKey: SendFilNetworkKey,
  ) => Promise<FilecoinMessage>;
  getEvmCode?: (
    address: `0x${string}`,
    networkKey: SendFilNetworkKey,
  ) => Promise<`0x${string}` | undefined>;
}

export function parseEvmCodeResult(value: unknown): `0x${string}` {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error('eth_getCode returned malformed bytecode.');
  }

  return value as `0x${string}`;
}

export const lotusMultisigRpc: MultisigRpc = {
  getChainHead: (networkKey) => callRpc<unknown>('Filecoin.ChainHead', [], networkKey),
  readState: (address, networkKey, tipSetKey) =>
    callRpc<LotusActorState>(
      'Filecoin.StateReadState',
      [address, tipSetKey],
      networkKey,
    ),
  lookupID: (address, networkKey, tipSetKey) =>
    callRpc<string>('Filecoin.StateLookupID', [address, tipSetKey], networkKey),
  getAvailableBalance: async (address, networkKey, tipSetKey) =>
    BigInt(
      await callRpc<string>(
        'Filecoin.MsigGetAvailableBalance',
        [address, tipSetKey],
        networkKey,
      ),
    ),
  getVestingSchedule: async (address, networkKey, tipSetKey) => {
    const raw = await callRpc<unknown>(
      'Filecoin.MsigGetVestingSchedule',
      [address, tipSetKey],
      networkKey,
    );

    return normalizeVestingSchedule(raw);
  },
  getPending: (address, networkKey, tipSetKey) =>
    callRpc<LotusPendingTransaction[]>(
      'Filecoin.MsigGetPending',
      [address, tipSetKey],
      networkKey,
    ),
  readObject: (cid, networkKey) =>
    callRpc<string>('Filecoin.ChainReadObj', [cid], networkKey),
  estimateGas: (message, networkKey) =>
    callRpc<FilecoinMessage>(
      'Filecoin.GasEstimateMessageGas',
      [message, undefined, []],
      networkKey,
    ),
  getEvmCode: async (address, networkKey) =>
    parseEvmCodeResult(await callRpc<unknown>('eth_getCode', [address, 'latest'], networkKey)),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeChainHeadTipSetKey(raw: unknown): LotusTipSetKey {
  if (!isRecord(raw) || !Array.isArray(raw.Cids)) {
    throw new Error('Lotus returned a malformed chain head for the multisig snapshot.');
  }

  const height = raw.Height;
  if (!Number.isSafeInteger(height) || (height as number) < 0 || raw.Cids.length === 0) {
    throw new Error('Lotus returned a malformed chain head for the multisig snapshot.');
  }

  const seen = new Set<string>();
  const tipSetKey = raw.Cids.map((value) => {
    if (!isRecord(value) || !isCanonicalFilecoinDagCborCid(value['/'])) {
      throw new Error('Lotus returned a malformed chain head for the multisig snapshot.');
    }

    const cid = value['/'];
    if (seen.has(cid)) {
      throw new Error('Lotus returned a duplicate block CID in the multisig snapshot.');
    }

    seen.add(cid);
    return { '/': cid };
  });

  const [firstCid, ...remainingCids] = tipSetKey;

  if (!firstCid) {
    throw new Error('Lotus returned a malformed chain head for the multisig snapshot.');
  }

  return [firstCid, ...remainingCids];
}

export async function getMultisigSnapshotTipSetKey(
  networkKey: SendFilNetworkKey,
  rpc: MultisigRpc = lotusMultisigRpc,
): Promise<LotusTipSetKey> {
  return normalizeChainHeadTipSetKey(await rpc.getChainHead(networkKey));
}

function asStringArray(value: unknown): string[] | undefined {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.trim().length === 0)
  ) {
    return undefined;
  }

  return [...value];
}

function asNonNegativeBigInt(value: unknown): bigint | undefined {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return undefined;
  }

  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function cidValue(value: LotusCid | string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return typeof value === 'string' ? value : value['/'];
}

function normalizeVestingSchedule(raw: unknown): MultisigVestingSchedule | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }

  const initialBalance = asString(raw.InitialBalance) ?? asString(raw.initialBalance);
  const lockedBalance = asString(raw.LockedBalance) ?? asString(raw.lockedBalance);

  return {
    initialBalanceAttoFil: initialBalance ? BigInt(initialBalance) : undefined,
    lockedBalanceAttoFil: lockedBalance ? BigInt(lockedBalance) : undefined,
    startEpoch: asNumber(raw.StartEpoch) ?? asNumber(raw.startEpoch),
    unlockDuration: asNumber(raw.UnlockDuration) ?? asNumber(raw.unlockDuration),
  };
}

function getDecodedState(state: unknown): Record<string, unknown> {
  if (!isRecord(state)) {
    return {};
  }

  const nested = state.State;
  return isRecord(nested) ? nested : state;
}

export function isNativeMultisigAddressForNetwork(
  address: string,
  networkKey: SendFilNetworkKey,
): address is NativeMultisigAddress {
  try {
    const parsed = newFromString(address.trim());
    const expectedCoinType = networkKey === 'mainnet' ? CoinType.MAIN : CoinType.TEST;

    return parsed.protocol() === Protocol.ACTOR && parsed.coinType() === expectedCoinType;
  } catch {
    return false;
  }
}

export function validateNativeMultisigAddress(
  address: string,
  networkKey: SendFilNetworkKey,
): NativeMultisigAddress {
  const trimmed = address.trim();

  if (!isNativeMultisigAddressForNetwork(trimmed, networkKey)) {
    const expected = networkKey === 'mainnet' ? 'f2' : 't2';
    throw new Error(`Enter a ${expected} native Filecoin multisig address.`);
  }

  return trimmed as NativeMultisigAddress;
}

function isMultisigActorCode(
  actorCodeCid: LotusCid | string | undefined,
  multisigCodeCid: string,
): boolean {
  const actorCode = cidValue(actorCodeCid);

  return Boolean(actorCode && actorCode === multisigCodeCid);
}

function validateNativeActorIdAddress(
  address: unknown,
  networkKey: SendFilNetworkKey,
): string {
  const expectedCoinType = networkKey === 'mainnet' ? CoinType.MAIN : CoinType.TEST;

  try {
    if (typeof address !== 'string') {
      throw new Error('Actor ID address is not a string');
    }

    const trimmed = address.trim();
    const parsed = newFromString(trimmed);

    if (parsed.protocol() !== Protocol.ID || parsed.coinType() !== expectedCoinType) {
      throw new Error('Wrong actor ID protocol or network');
    }

    return parsed.toString();
  } catch {
    const expected = networkKey === 'mainnet' ? 'f0' : 't0';
    throw new Error(`Lotus returned an invalid ${expected} ID address for the selected multisig.`);
  }
}

export async function getCurrentMultisigActorCodeCid(
  networkKey: SendFilNetworkKey,
  rpc: MultisigRpc = lotusMultisigRpc,
  tipSetKey?: LotusTipSetKey,
): Promise<string> {
  const snapshotTipSetKey =
    tipSetKey ?? (await getMultisigSnapshotTipSetKey(networkKey, rpc));
  const systemActorState = await rpc.readState(
    getSystemActorAddress(networkKey),
    networkKey,
    snapshotTipSetKey,
  );
  const manifestCid = getBuiltinActorsManifestCid(systemActorState);
  const manifestBase64 = await rpc.readObject({ '/': manifestCid }, networkKey);

  return decodeMultisigActorCodeCid(manifestBase64);
}

export async function loadMultisigActorState({
  address,
  connectedSignerAddress,
  networkKey,
  rpc = lotusMultisigRpc,
  tipSetKey,
}: {
  address: string;
  connectedSignerAddress?: string;
  networkKey: SendFilNetworkKey;
  rpc?: MultisigRpc;
  tipSetKey?: LotusTipSetKey;
}): Promise<MultisigActorState> {
  const multisigAddress = validateNativeMultisigAddress(address, networkKey);
  const snapshotTipSetKey =
    tipSetKey ?? (await getMultisigSnapshotTipSetKey(networkKey, rpc));
  const lookupID = (value: string) =>
    rpc.lookupID(value, networkKey, snapshotTipSetKey);
  const idAddress = validateNativeActorIdAddress(
    await lookupID(multisigAddress),
    networkKey,
  );
  const [actorState, availableBalance, multisigCodeCid] = await Promise.all([
    rpc.readState(idAddress, networkKey, snapshotTipSetKey),
    rpc.getAvailableBalance(idAddress, networkKey, snapshotTipSetKey),
    getCurrentMultisigActorCodeCid(networkKey, rpc, snapshotTipSetKey),
  ]);
  const balance = asNonNegativeBigInt(actorState.Balance);
  const decodedState = getDecodedState(actorState.State);
  const signers = asStringArray(decodedState.Signers ?? decodedState.signers);
  const threshold =
    asNumber(decodedState.NumApprovalsThreshold) ??
    asNumber(decodedState.numApprovalsThreshold) ??
    asNumber(decodedState.Threshold) ??
    0;

  if (!isMultisigActorCode(actorState.Code, multisigCodeCid)) {
    throw new Error('The selected actor does not appear to be a Filecoin native multisig.');
  }

  if (
    !signers ||
    signers.length === 0 ||
    !Number.isSafeInteger(threshold) ||
    threshold < 1 ||
    threshold > signers.length ||
    balance === undefined ||
    availableBalance < 0n ||
    availableBalance > balance
  ) {
    throw new Error('The selected multisig actor state is malformed.');
  }

  const [vesting, signerIdLookups, connectedSignerIdAddress] = await Promise.all([
    rpc
      .getVestingSchedule(idAddress, networkKey, snapshotTipSetKey)
      .catch(() => undefined),
    Promise.all(signers.map((signer) => lookupID(signer).catch(() => signer))),
    connectedSignerAddress
      ? lookupID(connectedSignerAddress).catch(() => undefined)
      : Promise.resolve(undefined),
  ]);
  const connectedSignerCanApprove = Boolean(
    connectedSignerIdAddress &&
    signerIdLookups.some((signerId) => signerId === connectedSignerIdAddress),
  );

  return {
    address: multisigAddress,
    networkKey,
    idAddress,
    robustAddress: multisigAddress,
    balanceAttoFil: balance,
    availableBalanceAttoFil: availableBalance,
    lockedBalanceAttoFil: vesting?.lockedBalanceAttoFil,
    threshold,
    signers,
    signerIdAddresses: signerIdLookups,
    connectedSignerIdAddress,
    connectedSignerCanApprove,
    startEpoch: vesting?.startEpoch ?? asNumber(decodedState.StartEpoch),
    unlockDuration: vesting?.unlockDuration ?? asNumber(decodedState.UnlockDuration),
  };
}

function parsePendingValue(value: unknown): bigint | undefined {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) {
    return undefined;
  }

  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function parsePendingId(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export async function loadMultisigPendingProposals({
  multisig,
  network,
  connectedSignerAddress,
  rpc = lotusMultisigRpc,
  tipSetKey,
}: {
  multisig: MultisigActorState;
  network: import('../networks').SendFilNetworkConfig;
  connectedSignerAddress?: string;
  rpc?: MultisigRpc;
  tipSetKey: LotusTipSetKey;
}): Promise<MultisigPendingProposal[]> {
  const lookupID = (value: string) =>
    rpc.lookupID(value, multisig.networkKey, tipSetKey);
  const idAddress = multisig.idAddress
    ? validateNativeActorIdAddress(multisig.idAddress, multisig.networkKey)
    : validateNativeActorIdAddress(
        await lookupID(multisig.address),
        multisig.networkKey,
      );
  const pending = await rpc.getPending(idAddress, multisig.networkKey, tipSetKey);
  const connectedSignerIdAddress =
    multisig.connectedSignerIdAddress ??
    (connectedSignerAddress
      ? await lookupID(connectedSignerAddress).catch(() => undefined)
      : undefined);
  const evmCodeRequests = new Map<`0x${string}`, Promise<`0x${string}` | undefined>>();
  const getEvmCode = rpc.getEvmCode;
  const contractCodeClient = getEvmCode
    ? {
        getCode: ({ address }: { address: `0x${string}` }) => {
          const existing = evmCodeRequests.get(address);

          if (existing) {
            return existing;
          }

          const request = getEvmCode(address, multisig.networkKey);
          evmCodeRequests.set(address, request);
          return request;
        },
      }
    : undefined;

  return Promise.all(
    pending.map(async (proposal, index) => {
      const parsedApprovals = asStringArray(proposal.Approved ?? proposal.Approvals);
      const approvals = parsedApprovals ?? [];
      const approvalIdAddresses = await Promise.all(
        approvals.map((approval) =>
          lookupID(approval).catch(() => approval),
        ),
      );
      const proposer = asString(proposal.Proposer) ?? approvals[0] ?? '';
      const proposerIdAddress = proposer
        ? await lookupID(proposer).catch(() => undefined)
        : undefined;
      const proposalId = parsePendingId(proposal.ID ?? proposal.TxnID);
      const to = asString(proposal.To) ?? '';
      const valueAttoFil = parsePendingValue(proposal.Value);
      const method = asNumber(proposal.Method);
      const paramsBase64 = asString(proposal.Params) ?? '';
      let paramsBytes = new Uint8Array();
      let proposalMetadataError: string | undefined;

      if (proposalId === undefined) {
        proposalMetadataError = 'Proposal ID is missing or invalid.';
      } else if (!to) {
        proposalMetadataError = 'Proposal target is missing or invalid.';
      } else if (valueAttoFil === undefined || valueAttoFil < 0n) {
        proposalMetadataError = 'Proposal value is missing or invalid.';
      } else if (method === undefined || !Number.isSafeInteger(method) || method < 0) {
        proposalMetadataError = 'Proposal method is missing or invalid.';
      }

      if (!proposalMetadataError) {
        try {
          paramsBytes = new Uint8Array(paramsBase64ToBytes(paramsBase64));
        } catch {
          proposalMetadataError = 'Proposal params are not valid base64.';
        }
      }

      const compatibilityMetadataError =
        proposalMetadataError ??
        (!parsedApprovals ? 'Proposal approvals are missing or invalid.' : undefined);
      const verification = compatibilityMetadataError
        ? { compatible: false as const, reason: compatibilityMetadataError }
        : verifyPendingSendFilProposal({
            to,
            valueAttoFil: valueAttoFil!,
            method: method!,
            paramsBytes,
            network,
          });
      const contractRecipientErrors = verification.compatible
        ? await validateNoEvmContractRecipients(
            verification.decodedBatch.payments.map((payment) => ({
              address: payment.recipient,
            })),
            contractCodeClient,
          )
        : [];
      const feePolicyError = verification.compatible
        ? validateDecodedBatchFeePolicy(verification.decodedBatch, network)
        : undefined;
      const connectedSignerHasApproved = Boolean(
        connectedSignerIdAddress &&
        approvalIdAddresses.some((approvalId) => approvalId === connectedSignerIdAddress),
      );
      let compatibilityReason = verification.compatible
        ? (feePolicyError ?? contractRecipientErrors[0])
        : verification.reason;
      let proposalHash: Uint8Array | undefined;

      if (!proposalMetadataError && proposerIdAddress) {
        try {
          proposalHash = computeProposalHash({
            requesterIdAddress: proposerIdAddress,
            to,
            valueAttoFil: valueAttoFil!,
            method: method!,
            params: paramsBytes,
          });
        } catch {
          if (verification.compatible) {
            compatibilityReason = 'Could not compute the proposal safety hash.';
          }
        }
      } else if (verification.compatible && !proposerIdAddress) {
        compatibilityReason = 'Could not resolve the proposal requester to an ID address.';
      }

      if (
        verification.compatible &&
        !feePolicyError &&
        contractRecipientErrors.length === 0 &&
        !proposalHash
      ) {
        if (!proposerIdAddress) {
          compatibilityReason = 'Could not resolve the proposal requester to an ID address.';
        } else {
          compatibilityReason = 'Could not compute the proposal safety hash.';
        }
      }

      const isSendFilCompatible =
        verification.compatible &&
        !feePolicyError &&
        contractRecipientErrors.length === 0 &&
        Boolean(proposalHash);

      return {
        id: proposalId ?? index,
        proposer,
        proposerIdAddress,
        to,
        valueAttoFil: valueAttoFil ?? 0n,
        method: method ?? 0,
        paramsBase64,
        paramsBytes,
        approvals,
        approvalIdAddresses,
        connectedSignerHasApproved,
        isSendFilCompatible,
        compatibilityReason,
        decodedBatch: verification.compatible ? verification.decodedBatch : undefined,
        proposalHash,
        canApprove: Boolean(
          isSendFilCompatible &&
          proposalHash &&
          multisig.connectedSignerCanApprove &&
          !connectedSignerHasApproved,
        ),
        canCancel: Boolean(
          proposalHash &&
          connectedSignerIdAddress &&
          proposerIdAddress === connectedSignerIdAddress,
        ),
      };
    }),
  );
}
