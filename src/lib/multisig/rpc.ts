import {
  CoinType,
  Protocol,
  newFromString,
} from '@glif/filecoin-address';
import { callRpc } from '../DataProvider/rpc';
import type { FilecoinMessage } from '../DataProvider/types';
import type { SendFilNetworkKey } from '../networks';
import { normalizeToEvmAddress } from '../../utils/addressEncoder';
import { toF4 } from '../../utils/toF4';
import type {
  MultisigActorState,
  MultisigPendingProposal,
  MultisigVestingSchedule,
  NativeMultisigAddress,
} from './types';
import {
  computeProposalHash,
  paramsBase64ToBytes,
} from './actorParams';

export interface LotusCid {
  '/': string;
}

export interface LotusActor {
  Code: LotusCid;
  Head: LotusCid;
  Nonce: number;
  Balance: string;
}

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
  getActor: (address: string, networkKey: SendFilNetworkKey) => Promise<LotusActor>;
  readState: (address: string, networkKey: SendFilNetworkKey) => Promise<LotusActorState>;
  lookupID: (address: string, networkKey: SendFilNetworkKey) => Promise<string>;
  lookupRobustAddress: (address: string, networkKey: SendFilNetworkKey) => Promise<string>;
  getBalance: (address: string, networkKey: SendFilNetworkKey) => Promise<bigint>;
  getAvailableBalance: (address: string, networkKey: SendFilNetworkKey) => Promise<bigint>;
  getVestingSchedule: (
    address: string,
    networkKey: SendFilNetworkKey,
  ) => Promise<MultisigVestingSchedule | undefined>;
  getPending: (
    address: string,
    networkKey: SendFilNetworkKey,
  ) => Promise<LotusPendingTransaction[]>;
  getNetworkVersion: (networkKey: SendFilNetworkKey) => Promise<number>;
  getActorCodeCids: (
    networkVersion: number,
    networkKey: SendFilNetworkKey,
  ) => Promise<Record<string, LotusCid | string>>;
  estimateGas: (
    message: FilecoinMessage,
    networkKey: SendFilNetworkKey,
  ) => Promise<FilecoinMessage>;
}

export const lotusMultisigRpc: MultisigRpc = {
  getActor: (address, networkKey) =>
    callRpc<LotusActor>('Filecoin.StateGetActor', [address, []], networkKey),
  readState: (address, networkKey) =>
    callRpc<LotusActorState>('Filecoin.StateReadState', [address, []], networkKey),
  lookupID: (address, networkKey) =>
    callRpc<string>('Filecoin.StateLookupID', [address, []], networkKey),
  lookupRobustAddress: (address, networkKey) =>
    callRpc<string>('Filecoin.StateLookupRobustAddress', [address, []], networkKey),
  getBalance: async (address, networkKey) =>
    BigInt(await callRpc<string>('Filecoin.WalletBalance', [address], networkKey)),
  getAvailableBalance: async (address, networkKey) =>
    BigInt(
      await callRpc<string>('Filecoin.MsigGetAvailableBalance', [address, []], networkKey),
    ),
  getVestingSchedule: async (address, networkKey) => {
    const raw = await callRpc<unknown>(
      'Filecoin.MsigGetVestingSchedule',
      [address, []],
      networkKey,
    );

    return normalizeVestingSchedule(raw);
  },
  getPending: (address, networkKey) =>
    callRpc<LotusPendingTransaction[]>(
      'Filecoin.MsigGetPending',
      [address, []],
      networkKey,
    ),
  getNetworkVersion: (networkKey) =>
    callRpc<number>('Filecoin.StateNetworkVersion', [[]], networkKey),
  getActorCodeCids: (networkVersion, networkKey) =>
    callRpc<Record<string, LotusCid | string>>(
      'Filecoin.StateActorCodeCIDs',
      [networkVersion],
      networkKey,
    ),
  estimateGas: (message, networkKey) =>
    callRpc<FilecoinMessage>('Filecoin.GasEstimateMessageGas', [message, undefined, []], networkKey),
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

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
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

  const initialBalance =
    asString(raw.InitialBalance) ?? asString(raw.initialBalance);
  const lockedBalance =
    asString(raw.LockedBalance) ?? asString(raw.lockedBalance);

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

function parsePendingCountFromState(state: Record<string, unknown>): number {
  const pending = state.PendingTxns ?? state.pendingTxns;

  if (Array.isArray(pending)) {
    return pending.length;
  }

  if (isRecord(pending)) {
    return Object.keys(pending).length;
  }

  return 0;
}

export function isNativeMultisigAddressForNetwork(
  address: string,
  networkKey: SendFilNetworkKey,
): address is NativeMultisigAddress {
  try {
    const parsed = newFromString(address.trim());
    const expectedCoinType =
      networkKey === 'mainnet' ? CoinType.MAIN : CoinType.TEST;

    return (
      parsed.protocol() === Protocol.ACTOR &&
      parsed.coinType() === expectedCoinType
    );
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

export function getMultisigCodeCid(
  actorCodeCids: Record<string, LotusCid | string>,
): string | undefined {
  for (const [name, cid] of Object.entries(actorCodeCids)) {
    if (name.toLowerCase().includes('multisig')) {
      return cidValue(cid);
    }
  }

  return undefined;
}

function isMultisigActorCode(
  actor: LotusActor,
  actorCodeCids: Record<string, LotusCid | string>,
): boolean {
  const actorCode = cidValue(actor.Code);
  const multisigCode = getMultisigCodeCid(actorCodeCids);

  return Boolean(actorCode && multisigCode && actorCode === multisigCode);
}

export async function getCurrentMultisigActorCodeCid(
  networkKey: SendFilNetworkKey,
  rpc: MultisigRpc = lotusMultisigRpc,
): Promise<string> {
  const version = await rpc.getNetworkVersion(networkKey);
  const codeCids = await rpc.getActorCodeCids(version, networkKey);
  const multisigCodeCid = getMultisigCodeCid(codeCids);

  if (!multisigCodeCid) {
    throw new Error('Could not resolve the current Filecoin multisig actor code CID.');
  }

  return multisigCodeCid;
}

export async function loadMultisigActorState({
  address,
  connectedSignerAddress,
  networkKey,
  rpc = lotusMultisigRpc,
}: {
  address: string;
  connectedSignerAddress?: string;
  networkKey: SendFilNetworkKey;
  rpc?: MultisigRpc;
}): Promise<MultisigActorState> {
  const multisigAddress = validateNativeMultisigAddress(address, networkKey);
  const [actor, actorState, balance, availableBalance, networkVersion] =
    await Promise.all([
      rpc.getActor(multisigAddress, networkKey),
      rpc.readState(multisigAddress, networkKey),
      rpc.getBalance(multisigAddress, networkKey),
      rpc.getAvailableBalance(multisigAddress, networkKey),
      rpc.getNetworkVersion(networkKey),
    ]);
  const actorCodeCids = await rpc.getActorCodeCids(networkVersion, networkKey);
  const decodedState = getDecodedState(actorState.State);
  const signers = asStringArray(decodedState.Signers ?? decodedState.signers);
  const threshold =
    asNumber(decodedState.NumApprovalsThreshold) ??
    asNumber(decodedState.numApprovalsThreshold) ??
    asNumber(decodedState.Threshold) ??
    0;

  if (!isMultisigActorCode(actor, actorCodeCids) && signers.length === 0) {
    throw new Error('The selected actor does not appear to be a Filecoin native multisig.');
  }

  const [idAddress, robustAddress, vesting, signerIdLookups, connectedSignerIdAddress] =
    await Promise.all([
      rpc.lookupID(multisigAddress, networkKey).catch(() => undefined),
      rpc.lookupRobustAddress(multisigAddress, networkKey).catch(() => multisigAddress),
      rpc.getVestingSchedule(multisigAddress, networkKey).catch(() => undefined),
      Promise.all(
        signers.map((signer) => rpc.lookupID(signer, networkKey).catch(() => signer)),
      ),
      connectedSignerAddress
        ? rpc.lookupID(connectedSignerAddress, networkKey).catch(() => undefined)
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
    robustAddress: isNativeMultisigAddressForNetwork(robustAddress, networkKey)
      ? robustAddress
      : multisigAddress,
    balanceAttoFil: balance,
    availableBalanceAttoFil: availableBalance,
    lockedBalanceAttoFil: vesting?.lockedBalanceAttoFil,
    threshold,
    signers,
    signerIdAddresses: signerIdLookups,
    connectedSignerIdAddress,
    connectedSignerCanApprove,
    pendingProposalCount: parsePendingCountFromState(decodedState),
    startEpoch: vesting?.startEpoch ?? asNumber(decodedState.StartEpoch),
    unlockDuration: vesting?.unlockDuration ?? asNumber(decodedState.UnlockDuration),
  };
}

function isKnownSendFilTarget(
  to: string,
  network: Pick<
    import('../networks').SendFilNetworkConfig,
    'multicall3Address' | 'thinBatchAddress' | 'nativePrefix'
  >,
): boolean {
  const normalizedTo =
    normalizeToEvmAddress(to)?.toLowerCase() ?? to.toLowerCase();
  const knownTargets = [
    network.multicall3Address,
    network.thinBatchAddress,
  ]
    .filter((address): address is `0x${string}` => Boolean(address))
    .flatMap((address) => [
      address.toLowerCase(),
      toF4(address, network.nativePrefix).toLowerCase(),
    ]);

  return knownTargets.includes(normalizedTo);
}

export async function loadMultisigPendingProposals({
  multisig,
  network,
  connectedSignerAddress,
  rpc = lotusMultisigRpc,
}: {
  multisig: MultisigActorState;
  network: import('../networks').SendFilNetworkConfig;
  connectedSignerAddress?: string;
  rpc?: MultisigRpc;
}): Promise<MultisigPendingProposal[]> {
  const pending = await rpc.getPending(multisig.address, multisig.networkKey);
  const connectedSignerIdAddress =
    multisig.connectedSignerIdAddress ??
    (connectedSignerAddress
      ? await rpc.lookupID(connectedSignerAddress, multisig.networkKey).catch(() => undefined)
      : undefined);

  return Promise.all(
    pending.map(async (proposal, index) => {
      const approvals = asStringArray(proposal.Approved ?? proposal.Approvals);
      const approvalIdAddresses = await Promise.all(
        approvals.map((approval) =>
          rpc.lookupID(approval, multisig.networkKey).catch(() => approval),
        ),
      );
      const proposer = proposal.Proposer ?? approvals[0] ?? '';
      const proposerIdAddress = proposer
        ? await rpc.lookupID(proposer, multisig.networkKey).catch(() => proposer)
        : undefined;
      const paramsBase64 = proposal.Params ?? '';
      const paramsBytes = paramsBase64 ? paramsBase64ToBytes(paramsBase64) : new Uint8Array();
      const isSendFilCompatible =
        proposal.Method === 3_844_450_837 &&
        isKnownSendFilTarget(proposal.To, network);
      const connectedSignerHasApproved = Boolean(
        connectedSignerIdAddress &&
          approvalIdAddresses.some((approvalId) => approvalId === connectedSignerIdAddress),
      );
      const proposalHash =
        isSendFilCompatible && proposerIdAddress
          ? computeProposalHash({
              requesterIdAddress: proposerIdAddress,
              to: proposal.To,
              valueAttoFil: BigInt(proposal.Value),
              method: proposal.Method,
              params: paramsBytes,
            })
          : undefined;

      return {
        id: proposal.ID ?? proposal.TxnID ?? index,
        proposer,
        proposerIdAddress,
        to: proposal.To,
        valueAttoFil: BigInt(proposal.Value),
        method: proposal.Method,
        paramsBase64,
        paramsBytes,
        approvals,
        approvalIdAddresses,
        connectedSignerHasApproved,
        isSendFilCompatible,
        compatibilityReason: isSendFilCompatible
          ? undefined
          : 'Only SendFIL proposals targeting this network are enabled here.',
        proposalHash,
        canApprove: Boolean(
          isSendFilCompatible &&
            proposalHash &&
            multisig.connectedSignerCanApprove &&
            !connectedSignerHasApproved,
        ),
        canCancel: Boolean(
          isSendFilCompatible &&
            proposalHash &&
            connectedSignerIdAddress &&
            proposerIdAddress === connectedSignerIdAddress,
        ),
      };
    }),
  );
}
