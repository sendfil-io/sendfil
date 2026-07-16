import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CoinType, Protocol, newFromString } from '@glif/filecoin-address';
import {
  isNativeFilecoinSubmissionUncertainError,
  type NativeFilecoinConnectedSender,
  type NativeFilecoinWalletProvider,
} from '../senders';
import { withNativeSignerLock } from '../senders/nativeSignerLock';
import { pollTransactionStatus } from '../DataProvider';
import type { TransactionStatus } from '../DataProvider/types';
import type { SendFilNetworkConfig, SendFilNetworkKey } from '../networks';
import type {
  MultisigActorState,
  MultisigPendingProposal,
  NativeMultisigAddress,
  SavedMultisig,
} from './types';
import {
  MAX_MULTISIG_SIGNERS,
  decodeApproveReturn,
  decodeCancelReturn,
  decodeExecReturn,
  filStringToAttoFil,
} from './actorParams';
import {
  getMultisigSnapshotTipSetKey,
  loadMultisigActorState,
  loadMultisigPendingProposals,
  lotusMultisigRpc,
  validateNativeMultisigAddress,
  type MultisigRpc,
} from './rpc';
import {
  preflightCreateMultisig,
  preflightProposalAction,
  type MultisigPreflightRpc,
} from './preflight';
import {
  getCreateUncertainActionIdentity,
  getProposalUncertainActionIdentity,
  readUncertainMultisigActions,
  removeUncertainCreateAction,
  removeUncertainProposalAction,
  upsertUncertainCreateAction,
  upsertUncertainProposalAction,
  verifyUncertainMultisigActionStorage,
} from './actionStorage';
import { readSavedMultisigsResult, removeSavedMultisigResult, saveMultisigResult } from './storage';

export interface CreateMultisigFormValues {
  signers: string[];
  threshold: number;
  initialDepositFil: string;
  startEpoch?: number;
  unlockDuration?: number;
}

export type CreateMultisigResult =
  | {
      outcome: 'confirmed';
      cid: string;
      createdAddress: NativeMultisigAddress;
      savedMultisig?: SavedMultisig;
      warning?: string;
    }
  | {
      outcome: 'uncertain';
      cid: string;
      warning: string;
    };

export interface MultisigCreateActionState {
  networkKey: SendFilNetworkKey;
  chainId: SendFilNetworkConfig['chainId'];
  networkLabel: string;
  signerAddress: string;
  status:
    | 'preparing'
    | 'signing'
    | 'submitting'
    | 'pending'
    | 'rechecking'
    | 'confirmed'
    | 'uncertain'
    | 'failed';
  cid?: string;
  createdAddress?: NativeMultisigAddress;
  warning?: string;
  error?: string;
}

export type MultisigProposalActionOutcome = 'queued' | 'applied-success' | 'cancelled';

export interface MultisigProposalActionState {
  action: 'approve' | 'cancel';
  proposalId: number;
  multisigAddress: NativeMultisigAddress;
  networkKey: SendFilNetworkKey;
  chainId: SendFilNetworkConfig['chainId'];
  networkLabel: string;
  signerAddress: string;
  status:
    | 'preparing'
    | 'signing'
    | 'submitting'
    | 'pending'
    | 'rechecking'
    | 'confirmed'
    | 'uncertain'
    | 'failed';
  cid?: string;
  outcome?: MultisigProposalActionOutcome;
  error?: string;
}

export interface UseMultisigsOptions {
  sender?: NativeFilecoinConnectedSender;
  provider?: NativeFilecoinWalletProvider;
  network?: SendFilNetworkConfig;
  storage?: Storage;
  rpc?: MultisigPreflightRpc;
  pollMessageStatus?: typeof pollTransactionStatus;
}

export interface UseMultisigsReturn {
  savedMultisigs: SavedMultisig[];
  selectedAddress?: NativeMultisigAddress;
  selectedMultisig?: MultisigActorState;
  pendingProposals: MultisigPendingProposal[];
  isLoadingSelected: boolean;
  selectedError?: string;
  uncertaintyStorageError?: string;
  createActionState?: MultisigCreateActionState;
  isCreateActionInFlight: boolean;
  isCreateRetryBlocked: boolean;
  proposalActionState?: MultisigProposalActionState;
  isProposalActionInFlight: boolean;
  isProposalRetryBlocked: boolean;
  selectMultisig: (address?: NativeMultisigAddress) => void;
  addMultisig: (address: string, label?: string) => Promise<SavedMultisig>;
  removeMultisig: (address: NativeMultisigAddress) => void;
  refreshSelected: () => Promise<MultisigActorState | undefined>;
  createMultisig: (values: CreateMultisigFormValues) => Promise<CreateMultisigResult>;
  recheckCreateAction: () => Promise<void>;
  approveProposal: (
    proposal: MultisigPendingProposal,
    acknowledgeDuplicatePayments?: boolean,
  ) => Promise<string>;
  cancelProposal: (proposal: MultisigPendingProposal) => Promise<string>;
  recheckProposalAction: () => Promise<void>;
}

type SignAndSubmitNativeProvider = NativeFilecoinWalletProvider & {
  signAndSubmitMessage: NonNullable<NativeFilecoinWalletProvider['signAndSubmitMessage']>;
};

interface SelectedMultisigIdentity {
  address: NativeMultisigAddress;
  networkKey: SendFilNetworkKey;
}

interface SelectedMultisigSnapshot {
  identity: string;
  status: 'loading' | 'loaded' | 'error';
  multisig?: MultisigActorState;
  pendingProposals: MultisigPendingProposal[];
  error?: string;
}

interface SavedMultisigSnapshot {
  networkKey: SendFilNetworkKey;
  multisigs: SavedMultisig[];
}

function getSelectedMultisigIdentityKey(
  selection: SelectedMultisigIdentity | undefined,
  signerAddress: string | undefined,
): string | undefined {
  if (!selection) {
    return undefined;
  }

  return `${selection.networkKey}:${selection.address}:${signerAddress ?? 'read-only'}`;
}

function getNativeExecutionProvider(
  provider: NativeFilecoinWalletProvider | undefined,
): SignAndSubmitNativeProvider {
  if (!provider) {
    throw new Error('Connect a native Filecoin wallet before using multisig actions.');
  }

  if (!provider.signAndSubmitMessage) {
    throw new Error(`${provider.metadata.name} cannot sign and submit Filecoin messages.`);
  }

  return provider as SignAndSubmitNativeProvider;
}

function validateSignerAddress(address: string, nativePrefix: 'f' | 't'): string {
  const trimmed = address.trim();
  const expected = `${nativePrefix}1`;
  const expectedCoinType = nativePrefix === 'f' ? CoinType.MAIN : CoinType.TEST;

  try {
    const parsed = newFromString(trimmed);

    if (parsed.protocol() !== Protocol.SECP256K1 || parsed.coinType() !== expectedCoinType) {
      throw new Error('Wrong signer protocol or network');
    }

    return parsed.toString();
  } catch {
    throw new Error(`Multisig signers must be ${expected} Filecoin f1/t1 addresses.`);
  }
}

function validateOptionalEpochValue(value: number | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative whole number.`);
  }

  return value;
}

export function validateCreateMultisigValues(
  values: CreateMultisigFormValues,
  nativePrefix: 'f' | 't',
): {
  signers: string[];
  threshold: number;
  initialDepositAttoFil: bigint;
  startEpoch?: number;
  unlockDuration?: number;
} {
  const signers = values.signers
    .map((signer) => signer.trim())
    .filter((signer) => signer.length > 0)
    .map((signer) => validateSignerAddress(signer, nativePrefix));
  const uniqueSigners = new Set(signers);

  if (signers.length === 0) {
    throw new Error('Add at least one Filecoin signer.');
  }

  if (signers.length > MAX_MULTISIG_SIGNERS) {
    throw new Error(`Filecoin native multisigs support at most ${MAX_MULTISIG_SIGNERS} signers.`);
  }

  if (uniqueSigners.size !== signers.length) {
    throw new Error('Duplicate multisig signers are not allowed.');
  }

  if (!Number.isInteger(values.threshold)) {
    throw new Error('Threshold must be a whole number.');
  }

  if (values.threshold < 1 || values.threshold > signers.length) {
    throw new Error('Threshold must be between 1 and the number of signers.');
  }

  const initialDepositAttoFil = filStringToAttoFil(values.initialDepositFil || '0');
  const startEpoch = validateOptionalEpochValue(values.startEpoch, 'Start epoch');
  const unlockDuration = validateOptionalEpochValue(values.unlockDuration, 'Unlock duration');

  return {
    signers,
    threshold: values.threshold,
    initialDepositAttoFil,
    startEpoch,
    unlockDuration,
  };
}

function getMultisigRpc(rpc?: MultisigPreflightRpc): MultisigRpc {
  return rpc?.multisig ?? lotusMultisigRpc;
}

function getCreateMultisigIdentityKey(
  networkKey: SendFilNetworkKey,
  signerAddress: string,
): string {
  return `${networkKey}:${signerAddress}`;
}

function getCreateActionStateIdentity(state: MultisigCreateActionState): string {
  return getCreateMultisigIdentityKey(state.networkKey, state.signerAddress);
}

function getProposalActionStateIdentity(state: MultisigProposalActionState): string {
  return getSelectedMultisigIdentityKey(
    {
      address: state.multisigAddress,
      networkKey: state.networkKey,
    },
    state.signerAddress,
  )!;
}

function findUncertainProposalForSigner(
  states: Iterable<MultisigProposalActionState>,
  networkKey: SendFilNetworkKey,
  signerAddress: string,
): MultisigProposalActionState | undefined {
  return Array.from(states).find(
    (state) => state.networkKey === networkKey && state.signerAddress === signerAddress,
  );
}

function findUncertainProposalForDisplay(
  states: Iterable<MultisigProposalActionState>,
  preferredNetworkKey?: SendFilNetworkKey,
): MultisigProposalActionState | undefined {
  let fallback: MultisigProposalActionState | undefined;

  for (const state of states) {
    fallback ??= state;

    if (state.networkKey === preferredNetworkKey) {
      return state;
    }
  }

  return fallback;
}

function findUncertainCreateForDisplay(
  states: Iterable<MultisigCreateActionState>,
  preferredNetworkKey?: SendFilNetworkKey,
): MultisigCreateActionState | undefined {
  let fallback: MultisigCreateActionState | undefined;

  for (const state of states) {
    fallback ??= state;

    if (state.networkKey === preferredNetworkKey) {
      return state;
    }
  }

  return fallback;
}

function createUncertainMultisigWarning(
  cid: string,
  detail?: string,
): Extract<CreateMultisigResult, { outcome: 'uncertain' }> {
  return {
    cid,
    outcome: 'uncertain',
    warning:
      'SendFIL could not confirm the result of the signed multisig creation. ' +
      `Inspect ${cid} before trying again to avoid creating a duplicate multisig${
        detail ? `: ${detail}` : '.'
      }`,
  };
}

class MultisigActionTerminalFailureError extends Error {}
class MultisigSafetyLockPersistenceError extends Error {}

function decodeConfirmedProposalAction(
  status: TransactionStatus,
  action: 'approve' | 'cancel',
): MultisigProposalActionOutcome {
  if (status.status !== 'confirmed') {
    throw new Error(status.error ?? `Multisig ${action} message failed on-chain.`);
  }

  if (!status.receipt) {
    throw new Error(`Confirmed multisig ${action} message is missing its receipt.`);
  }

  if (status.receipt.ExitCode !== 0) {
    throw new MultisigActionTerminalFailureError(
      `Multisig ${action} message failed with outer exit code ${status.receipt.ExitCode}.`,
    );
  }

  if (action === 'cancel') {
    decodeCancelReturn(status.receipt.Return);
    return 'cancelled';
  }

  const result = decodeApproveReturn(status.receipt.Return);

  if (!result.applied) {
    if (result.code !== 0 || result.ret.length !== 0) {
      throw new Error('Queued multisig approval returned an inconsistent actor result.');
    }

    return 'queued';
  }

  if (result.code !== 0) {
    throw new MultisigActionTerminalFailureError(
      `The approval reached threshold, but the proposed batch failed with inner exit code ${result.code}.`,
    );
  }

  return 'applied-success';
}

function equalBytes(left: Uint8Array | undefined, right: Uint8Array | undefined): boolean {
  return Boolean(
    left &&
    right &&
    left.length === right.length &&
    left.every((byte, index) => byte === right[index]),
  );
}

function hasDuplicateProposalPayments(proposal: MultisigPendingProposal): boolean {
  const seenRecipients = new Set<string>();

  return Boolean(
    proposal.decodedBatch?.payments.some((payment) => {
      const identity = payment.recipient.toLowerCase();
      const isDuplicate = seenRecipients.has(identity);
      seenRecipients.add(identity);
      return isDuplicate;
    }),
  );
}

export function useMultisigs({
  sender,
  provider,
  network,
  storage,
  rpc,
  pollMessageStatus = pollTransactionStatus,
}: UseMultisigsOptions = {}): UseMultisigsReturn {
  const multisigRpc = useMemo(() => getMultisigRpc(rpc), [rpc]);
  const persistedUncertainActions = useMemo(() => readUncertainMultisigActions(storage), [storage]);
  const [uncertaintyStorageError, setUncertaintyStorageError] = useState(
    persistedUncertainActions.error,
  );
  const [savedSnapshot, setSavedSnapshot] = useState<SavedMultisigSnapshot>();
  const [selection, setSelection] = useState<SelectedMultisigIdentity>();
  const [selectedSnapshot, setSelectedSnapshot] = useState<SelectedMultisigSnapshot>();
  const [storageError, setStorageError] = useState<string>();
  const [createActionState, setCreateActionState] = useState<MultisigCreateActionState>();
  const [proposalActionState, setProposalActionState] = useState<MultisigProposalActionState>();
  const selectionRequestSequence = useRef(0);
  const createActionSequence = useRef(0);
  const createActionInFlight = useRef(false);
  const uncertainCreateIdentities = useRef(
    new Map(
      persistedUncertainActions.creates.map(
        (state) => [getCreateActionStateIdentity(state), state] as const,
      ),
    ),
  );
  const proposalActionSequence = useRef(0);
  const proposalActionInFlight = useRef(false);
  const uncertainProposalActionIdentities = useRef(
    new Map(
      persistedUncertainActions.proposals.map(
        (state) => [getProposalActionStateIdentity(state), state] as const,
      ),
    ),
  );
  const selectedAddress =
    selection && network && selection.networkKey === network.key ? selection.address : undefined;
  const selectedIdentity =
    selectedAddress && network
      ? getSelectedMultisigIdentityKey(
          {
            address: selectedAddress,
            networkKey: network.key,
          },
          sender?.address,
        )
      : undefined;
  const currentSelectedSnapshot =
    selectedSnapshot?.identity === selectedIdentity ? selectedSnapshot : undefined;
  const selectedMultisig = currentSelectedSnapshot?.multisig;
  const pendingProposals = currentSelectedSnapshot?.pendingProposals ?? [];
  const isLoadingSelected = Boolean(
    selectedIdentity && (!currentSelectedSnapshot || currentSelectedSnapshot.status === 'loading'),
  );
  const selectedError = currentSelectedSnapshot?.error ?? storageError;
  const savedMultisigs =
    savedSnapshot && network && savedSnapshot.networkKey === network.key
      ? savedSnapshot.multisigs
      : [];
  const selectedIdentityRef = useRef(selectedIdentity);
  const currentNetworkKeyRef = useRef(network?.key);
  const currentSignerAddressRef = useRef(sender?.address);
  const currentCreateIdentity =
    sender && network ? getCreateMultisigIdentityKey(sender.networkKey, sender.address) : undefined;
  const currentCreateIdentityRef = useRef(currentCreateIdentity);

  selectedIdentityRef.current = selectedIdentity;
  currentNetworkKeyRef.current = network?.key;
  currentSignerAddressRef.current = sender?.address;
  currentCreateIdentityRef.current = currentCreateIdentity;

  const isCreateActionInFlight = Boolean(
    createActionState?.status === 'preparing' ||
    createActionState?.status === 'signing' ||
    createActionState?.status === 'submitting' ||
    createActionState?.status === 'pending' ||
    createActionState?.status === 'rechecking',
  );
  const currentCreateUncertainState = currentCreateIdentity
    ? uncertainCreateIdentities.current.get(currentCreateIdentity)
    : undefined;
  const globalCreateUncertainState = findUncertainCreateForDisplay(
    uncertainCreateIdentities.current.values(),
    network?.key,
  );
  const currentSignerProposalUncertainState =
    sender && network
      ? findUncertainProposalForSigner(
          uncertainProposalActionIdentities.current.values(),
          network.key,
          sender.address,
        )
      : undefined;
  const globalProposalUncertainState = findUncertainProposalForDisplay(
    uncertainProposalActionIdentities.current.values(),
    network?.key,
  );
  const isCreateRetryBlocked = Boolean(
    uncertaintyStorageError || currentCreateUncertainState || currentSignerProposalUncertainState,
  );
  const displayedCreateActionState = isCreateActionInFlight
    ? createActionState
    : currentCreateIdentity
      ? (uncertainCreateIdentities.current.get(currentCreateIdentity) ??
        (createActionState &&
        getCreateActionStateIdentity(createActionState) === currentCreateIdentity
          ? createActionState
          : globalCreateUncertainState))
      : globalCreateUncertainState;
  const isProposalActionInFlight = Boolean(
    proposalActionState?.status === 'preparing' ||
    proposalActionState?.status === 'signing' ||
    proposalActionState?.status === 'submitting' ||
    proposalActionState?.status === 'pending' ||
    proposalActionState?.status === 'rechecking',
  );
  const isProposalRetryBlocked = Boolean(
    uncertaintyStorageError || currentCreateUncertainState || currentSignerProposalUncertainState,
  );
  const displayedProposalActionState = isProposalActionInFlight
    ? proposalActionState
    : selectedIdentity
      ? (uncertainProposalActionIdentities.current.get(selectedIdentity) ??
        (proposalActionState &&
        getProposalActionStateIdentity(proposalActionState) === selectedIdentity
          ? proposalActionState
          : (currentSignerProposalUncertainState ?? globalProposalUncertainState)))
      : (currentSignerProposalUncertainState ?? globalProposalUncertainState);

  const mergeUncertainActionSnapshot = useCallback(
    (snapshot: ReturnType<typeof readUncertainMultisigActions>): string | undefined => {
      for (const state of snapshot.creates) {
        const identity = getCreateUncertainActionIdentity(state);
        const existing = uncertainCreateIdentities.current.get(identity);

        if (existing?.cid && existing.cid !== state.cid) {
          return 'Different unresolved multisig creation CIDs exist for the same identity. Inspect all submitted messages before continuing.';
        }

        uncertainCreateIdentities.current.set(identity, state);
      }

      for (const state of snapshot.proposals) {
        const identity = getProposalUncertainActionIdentity(state);
        const existing = uncertainProposalActionIdentities.current.get(identity);

        if (existing?.cid && existing.cid !== state.cid) {
          return 'Different unresolved multisig action CIDs exist for the same identity. Inspect all submitted messages before continuing.';
        }

        uncertainProposalActionIdentities.current.set(identity, state);
      }

      return undefined;
    },
    [],
  );

  const syncUncertainActionsFromStorage = useCallback((): string | undefined => {
    const snapshot = readUncertainMultisigActions(storage);
    const error = snapshot.error ?? mergeUncertainActionSnapshot(snapshot);
    setUncertaintyStorageError(error);
    return error;
  }, [mergeUncertainActionSnapshot, storage]);

  const verifyUncertaintyStorage = useCallback((): string | undefined => {
    const error = verifyUncertainMultisigActionStorage(storage);
    setUncertaintyStorageError(error);
    return error;
  }, [storage]);

  const persistCreateSafetyState = useCallback(
    (state: MultisigCreateActionState): string | undefined => {
      const result = upsertUncertainCreateAction(state, storage);
      const error = result.error ?? mergeUncertainActionSnapshot(result.snapshot);
      setUncertaintyStorageError(error);
      return error;
    },
    [mergeUncertainActionSnapshot, storage],
  );

  const persistProposalSafetyState = useCallback(
    (state: MultisigProposalActionState): string | undefined => {
      const result = upsertUncertainProposalAction(state, storage);
      const error = result.error ?? mergeUncertainActionSnapshot(result.snapshot);
      setUncertaintyStorageError(error);
      return error;
    },
    [mergeUncertainActionSnapshot, storage],
  );

  const clearCreateSafetyState = useCallback(
    (state: MultisigCreateActionState): string | undefined => {
      const result = removeUncertainCreateAction(state, storage);
      const error = result.error ?? mergeUncertainActionSnapshot(result.snapshot);

      if (!error) {
        const identity = getCreateUncertainActionIdentity(state);
        const existing = uncertainCreateIdentities.current.get(identity);

        if (existing?.cid === state.cid) {
          uncertainCreateIdentities.current.delete(identity);
        }
      }

      setUncertaintyStorageError(error);
      return error;
    },
    [mergeUncertainActionSnapshot, storage],
  );

  const clearProposalSafetyState = useCallback(
    (state: MultisigProposalActionState): string | undefined => {
      const result = removeUncertainProposalAction(state, storage);
      const error = result.error ?? mergeUncertainActionSnapshot(result.snapshot);

      if (!error) {
        const identity = getProposalUncertainActionIdentity(state);
        const existing = uncertainProposalActionIdentities.current.get(identity);

        if (existing?.cid === state.cid) {
          uncertainProposalActionIdentities.current.delete(identity);
        }
      }

      setUncertaintyStorageError(error);
      return error;
    },
    [mergeUncertainActionSnapshot, storage],
  );

  const invalidateSelectedSnapshot = useCallback(() => {
    selectionRequestSequence.current += 1;
    setSelectedSnapshot(undefined);
  }, []);

  const selectMultisig = useCallback(
    (address?: NativeMultisigAddress) => {
      invalidateSelectedSnapshot();
      setSelection(address && network ? { address, networkKey: network.key } : undefined);
    },
    [invalidateSelectedSnapshot, network],
  );

  useEffect(() => {
    if (!network) {
      setSavedSnapshot(undefined);
      setStorageError(undefined);
      invalidateSelectedSnapshot();
      setSelection(undefined);
      return;
    }

    const result = readSavedMultisigsResult(network.key, storage);
    setSavedSnapshot({
      networkKey: network.key,
      multisigs: result.multisigs,
    });
    setStorageError(result.error);

    if (
      !result.error &&
      selection &&
      (selection.networkKey !== network.key ||
        (!result.multisigs.some((item) => item.address === selection.address) &&
          !uncertainProposalActionIdentities.current.has(
            getSelectedMultisigIdentityKey(selection, sender?.address)!,
          )))
    ) {
      invalidateSelectedSnapshot();
      setSelection(undefined);
    }
  }, [invalidateSelectedSnapshot, network, selection, sender?.address, storage]);

  const refreshSelected = useCallback(async (): Promise<MultisigActorState | undefined> => {
    const identity = selectedIdentity;

    if (!identity || !selectedAddress || !network) {
      invalidateSelectedSnapshot();
      return undefined;
    }

    if (selectedIdentityRef.current !== identity) {
      return undefined;
    }

    const requestId = selectionRequestSequence.current + 1;
    selectionRequestSequence.current = requestId;
    setSelectedSnapshot({
      identity,
      status: 'loading',
      pendingProposals: [],
    });

    const isCurrentRequest = () =>
      selectionRequestSequence.current === requestId && selectedIdentityRef.current === identity;

    try {
      const tipSetKey = await getMultisigSnapshotTipSetKey(network.key, multisigRpc);
      const actorState = await loadMultisigActorState({
        address: selectedAddress,
        connectedSignerAddress: sender?.address,
        networkKey: network.key,
        rpc: multisigRpc,
        tipSetKey,
      });

      if (!isCurrentRequest()) {
        return undefined;
      }

      const proposals = await loadMultisigPendingProposals({
        multisig: actorState,
        network,
        connectedSignerAddress: sender?.address,
        rpc: multisigRpc,
        tipSetKey,
      });

      if (!isCurrentRequest()) {
        return undefined;
      }

      setSelectedSnapshot({
        identity,
        status: 'loaded',
        multisig: actorState,
        pendingProposals: proposals,
      });
      return actorState;
    } catch (error) {
      if (!isCurrentRequest()) {
        return undefined;
      }

      setSelectedSnapshot({
        identity,
        status: 'error',
        pendingProposals: [],
        error: error instanceof Error ? error.message : 'Failed to load selected multisig.',
      });
      return undefined;
    }
  }, [
    invalidateSelectedSnapshot,
    multisigRpc,
    network,
    selectedAddress,
    selectedIdentity,
    sender?.address,
  ]);

  useEffect(() => {
    void refreshSelected();

    return () => {
      selectionRequestSequence.current += 1;
    };
  }, [refreshSelected]);

  const addMultisig = useCallback(
    async (address: string, label?: string): Promise<SavedMultisig> => {
      if (!network) {
        throw new Error('Connect to Filecoin Mainnet or Calibration before adding a multisig.');
      }

      const multisigAddress = validateNativeMultisigAddress(address, network.key);
      const actorState = await loadMultisigActorState({
        address: multisigAddress,
        connectedSignerAddress: sender?.address,
        networkKey: network.key,
        rpc: multisigRpc,
      });
      const result = saveMultisigResult(
        {
          address: multisigAddress,
          networkKey: network.key,
          robustAddress: actorState.robustAddress,
          idAddress: actorState.idAddress,
          label,
        },
        storage,
      );
      const savedItem = result.multisigs.find((item) => item.address === multisigAddress);

      if (result.error) {
        if (
          currentNetworkKeyRef.current === network.key &&
          currentSignerAddressRef.current === sender?.address
        ) {
          setStorageError(result.error);
        }

        throw new Error(result.error);
      }

      if (!savedItem) {
        throw new Error('Failed to save multisig locally.');
      }

      if (
        currentNetworkKeyRef.current === network.key &&
        currentSignerAddressRef.current === sender?.address
      ) {
        setStorageError(undefined);
        setSavedSnapshot({ networkKey: network.key, multisigs: result.multisigs });
        invalidateSelectedSnapshot();
        setSelection({ address: multisigAddress, networkKey: network.key });
      }

      return savedItem;
    },
    [invalidateSelectedSnapshot, multisigRpc, network, sender?.address, storage],
  );

  const removeMultisig = useCallback(
    (address: NativeMultisigAddress) => {
      if (!network) {
        return;
      }

      const unresolvedAction = Array.from(uncertainProposalActionIdentities.current.values()).find(
        (state) => state.networkKey === network.key && state.multisigAddress === address,
      );

      if (unresolvedAction) {
        setStorageError(
          'Reconcile the unresolved multisig action CID before removing this actor from saved multisigs.',
        );
        return;
      }

      const result = removeSavedMultisigResult(network.key, address, storage);

      if (result.error) {
        setStorageError(result.error);
        return;
      }

      setStorageError(undefined);
      setSavedSnapshot({ networkKey: network.key, multisigs: result.multisigs });

      if (selectedAddress === address) {
        selectMultisig(undefined);
      }
    },
    [network, selectMultisig, selectedAddress, storage],
  );

  const createMultisig = useCallback(
    async (values: CreateMultisigFormValues): Promise<CreateMultisigResult> => {
      if (!sender || !network) {
        throw new Error('Connect a native Filecoin signer before creating a multisig.');
      }

      if (sender.networkKey !== network.key || sender.chainId !== network.chainId) {
        throw new Error(
          'The connected signer network does not match the multisig network. Review the network before creating.',
        );
      }

      const actionIdentity = getCreateMultisigIdentityKey(sender.networkKey, sender.address);

      if (createActionInFlight.current) {
        throw new Error('Another multisig creation is already in progress.');
      }

      const syncError = syncUncertainActionsFromStorage();

      if (syncError) {
        throw new Error(syncError);
      }

      const unresolvedProposal = findUncertainProposalForSigner(
        uncertainProposalActionIdentities.current.values(),
        sender.networkKey,
        sender.address,
      );

      if (unresolvedProposal) {
        throw new Error(
          'A multisig approval or cancellation from this signer and network still has an uncertain result. ' +
            `Inspect its CID for ${unresolvedProposal.multisigAddress} before creating another actor.`,
        );
      }

      if (uncertainCreateIdentities.current.has(actionIdentity)) {
        throw new Error(
          'A multisig creation from this signer and network still has an uncertain result. ' +
            'Inspect the submitted message before trying again with this identity.',
        );
      }

      const actionId = createActionSequence.current + 1;
      const actionSnapshot = {
        networkKey: sender.networkKey,
        chainId: sender.chainId,
        networkLabel: sender.network.walletLabel,
        signerAddress: sender.address,
      } satisfies Pick<
        MultisigCreateActionState,
        'networkKey' | 'chainId' | 'networkLabel' | 'signerAddress'
      >;
      let cid: string | undefined;
      let submissionUncertaintyDetail: string | undefined;

      const markUncertain = (
        result: Extract<CreateMultisigResult, { outcome: 'uncertain' }>,
      ): CreateMultisigResult => {
        let warning = result.warning;
        let uncertainState: MultisigCreateActionState = {
          ...actionSnapshot,
          status: 'uncertain',
          cid: result.cid,
          warning: result.warning,
        };
        uncertainCreateIdentities.current.set(actionIdentity, uncertainState);
        const persistenceError = persistCreateSafetyState(uncertainState);

        if (persistenceError) {
          warning = `${warning} ${persistenceError}`;
          uncertainState = {
            ...uncertainState,
            warning,
          };
          uncertainCreateIdentities.current.set(actionIdentity, uncertainState);
        }

        if (createActionSequence.current === actionId) {
          setCreateActionState(uncertainState);
        }

        return {
          ...result,
          warning,
        };
      };

      createActionSequence.current = actionId;
      createActionInFlight.current = true;
      setCreateActionState({
        ...actionSnapshot,
        status: 'preparing',
      });

      try {
        const nativeProvider = getNativeExecutionProvider(provider);
        const validated = validateCreateMultisigValues(values, sender.nativePrefix);
        const connectedSignerAddress = newFromString(sender.address).toString();

        if (!validated.signers.includes(connectedSignerAddress)) {
          throw new Error('Connected signer must be included in the multisig signer list.');
        }

        const initialSignerBalance = await nativeProvider.getBalance({
          address: sender.address,
          networkKey: sender.networkKey,
          nativePrefix: sender.nativePrefix,
        });

        if (initialSignerBalance === 0n) {
          throw new Error(
            'Connected signer has 0 FIL. Fund it or connect a funded signer. ' +
              'The connected signer pays the initial deposit plus creation gas.',
          );
        }

        if (initialSignerBalance <= validated.initialDepositAttoFil) {
          throw new Error(
            'Connected signer balance must be greater than the initial deposit to cover creation gas. ' +
              'Fund it, lower the deposit, or connect a funded signer. ' +
              'The connected signer pays the initial deposit plus creation gas.',
          );
        }

        const preflight = await preflightCreateMultisig({
          sender,
          signers: validated.signers,
          threshold: validated.threshold,
          initialDepositAttoFil: validated.initialDepositAttoFil,
          startEpoch: validated.startEpoch,
          unlockDuration: validated.unlockDuration,
          rpc,
        });
        const signerBalanceImmediatelyBeforeSigning = await nativeProvider.getBalance({
          address: sender.address,
          networkKey: sender.networkKey,
          nativePrefix: sender.nativePrefix,
        });
        const requiredBalance =
          validated.initialDepositAttoFil + preflight.gasEstimate.estimatedFee;

        if (currentCreateIdentityRef.current !== actionIdentity) {
          throw new Error(
            'The connected signer or network changed while preparing the multisig. Review it again.',
          );
        }

        if (signerBalanceImmediatelyBeforeSigning < requiredBalance) {
          throw new Error(
            'Connected signer balance is too low for the initial deposit plus creation gas. ' +
              'Fund it, lower the deposit, or connect a funded signer.',
          );
        }

        const preSignSyncError = syncUncertainActionsFromStorage();

        if (preSignSyncError) {
          throw new Error(preSignSyncError);
        }

        if (uncertainCreateIdentities.current.has(actionIdentity)) {
          throw new Error(
            'Another browser tab submitted a multisig creation for this signer. Inspect its CID before signing again.',
          );
        }

        const storagePreflightError = verifyUncertaintyStorage();

        if (storagePreflightError) {
          throw new Error(storagePreflightError);
        }

        let pendingPersistenceError: string | undefined;
        let safetyLockPersisted = false;
        const persistComputedCid = (computedCid: string, abortBeforePush: boolean) => {
          cid = computedCid;
          let safetyState: MultisigCreateActionState = {
            ...actionSnapshot,
            status: 'uncertain',
            cid: computedCid,
            warning:
              'This signed multisig creation is awaiting a proof-bearing chain result. ' +
              'Recheck its CID before retrying if this page reloads.',
          };
          uncertainCreateIdentities.current.set(actionIdentity, safetyState);
          const persistenceError = persistCreateSafetyState(safetyState);

          if (persistenceError) {
            uncertainCreateIdentities.current.delete(actionIdentity);

            if (abortBeforePush) {
              throw new MultisigSafetyLockPersistenceError(persistenceError);
            }

            pendingPersistenceError = persistenceError;
            safetyState = {
              ...safetyState,
              warning: `${safetyState.warning} ${persistenceError}`,
            };
            uncertainCreateIdentities.current.set(actionIdentity, safetyState);
            return;
          }

          safetyLockPersisted = true;

          if (abortBeforePush && createActionSequence.current === actionId) {
            setCreateActionState({
              ...actionSnapshot,
              status: 'submitting',
              cid: computedCid,
            });
          }
        };

        await withNativeSignerLock(
          {
            networkKey: sender.networkKey,
            signerAddress: sender.address,
            storage,
          },
          async () => {
            if (createActionSequence.current === actionId) {
              setCreateActionState({
                ...actionSnapshot,
                status: 'signing',
              });
            }

            try {
              const submission = await nativeProvider.signAndSubmitMessage(
                preflight.estimatedMessage,
                {
                  onCidComputed: (computedCid) => persistComputedCid(computedCid, true),
                },
              );

              if (!safetyLockPersisted) {
                persistComputedCid(submission.cid, false);
              }
            } catch (error) {
              if (error instanceof MultisigSafetyLockPersistenceError) {
                cid = undefined;
                throw error;
              }

              if (!isNativeFilecoinSubmissionUncertainError(error)) {
                if (cid) {
                  const safetyState = uncertainCreateIdentities.current.get(actionIdentity);
                  const persistenceError = safetyState
                    ? clearCreateSafetyState(safetyState)
                    : undefined;
                  cid = undefined;

                  if (persistenceError) {
                    throw new Error(
                      `${error instanceof Error ? error.message : 'Multisig submission failed.'} ${persistenceError}`,
                    );
                  }
                }

                throw error;
              }

              if (!safetyLockPersisted) {
                persistComputedCid(error.cid, false);
              }
              submissionUncertaintyDetail = error.message;
            }
          },
        );

        if (!cid) {
          throw new Error('The signed multisig creation did not produce a message CID.');
        }

        if (createActionSequence.current === actionId) {
          setCreateActionState({
            ...actionSnapshot,
            status: 'pending',
            cid,
            warning: pendingPersistenceError,
          });
        }

        let status: TransactionStatus;

        try {
          status = await pollMessageStatus(cid, 60, 5000, sender.networkKey);
        } catch (error) {
          return markUncertain(
            createUncertainMultisigWarning(
              cid,
              [
                submissionUncertaintyDetail,
                error instanceof Error ? error.message : 'confirmation polling failed',
              ]
                .filter(Boolean)
                .join(' '),
            ),
          );
        }

        if (status.status === 'failed' && status.receipt && status.receipt.ExitCode !== 0) {
          const safetyState = uncertainCreateIdentities.current.get(actionIdentity);
          const persistenceError = safetyState ? clearCreateSafetyState(safetyState) : undefined;
          const detail =
            status.error ??
            `Multisig create message failed with outer exit code ${status.receipt.ExitCode}.`;
          throw new Error(detail + (persistenceError ? ` ${persistenceError}` : ''));
        }

        if (status.status !== 'confirmed' || !status.receipt || status.receipt.ExitCode !== 0) {
          return markUncertain(
            createUncertainMultisigWarning(
              cid,
              [
                submissionUncertaintyDetail,
                status.error ??
                  'the confirmation status and receipt did not prove successful execution',
              ]
                .filter(Boolean)
                .join(' '),
            ),
          );
        }

        let decodedReturn: NonNullable<ReturnType<typeof decodeExecReturn>>;

        try {
          if (!status.receipt?.Return) {
            throw new Error('confirmed message is missing InitActor return data');
          }

          const decoded = decodeExecReturn(status.receipt.Return, sender.networkKey);

          if (!decoded) {
            throw new Error('confirmed message contains an empty InitActor return');
          }

          decodedReturn = decoded;
        } catch (error) {
          return markUncertain(
            createUncertainMultisigWarning(
              cid,
              'the confirmed message did not contain a verifiable multisig address' +
                (error instanceof Error ? ` (${error.message})` : ''),
            ),
          );
        }

        let robustAddress: NativeMultisigAddress;

        try {
          robustAddress = validateNativeMultisigAddress(
            decodedReturn.robustAddress,
            sender.networkKey,
          );
        } catch {
          return markUncertain(
            createUncertainMultisigWarning(
              cid,
              'the confirmed return did not contain a valid multisig actor address',
            ),
          );
        }

        const safetyState = uncertainCreateIdentities.current.get(actionIdentity);
        const safetyClearError = safetyState ? clearCreateSafetyState(safetyState) : undefined;

        const saveResult = saveMultisigResult(
          {
            address: robustAddress,
            networkKey: sender.networkKey,
            robustAddress,
            idAddress: decodedReturn.idAddress,
          },
          storage,
        );
        const savedItem = saveResult.multisigs.find((item) => item.address === robustAddress);
        const isCurrentCreateIdentity = currentCreateIdentityRef.current === actionIdentity;
        let result: CreateMultisigResult;

        if (saveResult.error) {
          if (isCurrentCreateIdentity) {
            setStorageError(
              `The multisig was created, but it was not saved locally. ${saveResult.error}`,
            );
          }

          result = {
            cid,
            outcome: 'confirmed',
            createdAddress: robustAddress,
            warning:
              `The multisig was created at ${robustAddress}, but it was not saved locally. ${saveResult.error}` +
              (safetyClearError ? ` ${safetyClearError}` : ''),
          };
        } else {
          if (isCurrentCreateIdentity) {
            setStorageError(undefined);
            setSavedSnapshot({
              networkKey: sender.networkKey,
              multisigs: saveResult.multisigs,
            });
            invalidateSelectedSnapshot();
            setSelection({
              address: robustAddress,
              networkKey: sender.networkKey,
            });
          }

          result = {
            cid,
            outcome: 'confirmed',
            createdAddress: robustAddress,
            savedMultisig: savedItem,
            warning: savedItem
              ? safetyClearError
              : `The multisig was created at ${robustAddress}, but SendFIL could not find it in local storage. Save this address manually.${
                  safetyClearError ? ` ${safetyClearError}` : ''
                }`,
          };
        }

        if (createActionSequence.current === actionId) {
          setCreateActionState({
            ...actionSnapshot,
            status: 'confirmed',
            cid,
            createdAddress: robustAddress,
            warning: result.warning,
          });
        }

        return result;
      } catch (error) {
        if (createActionSequence.current === actionId) {
          setCreateActionState({
            ...actionSnapshot,
            status: 'failed',
            cid,
            error: error instanceof Error ? error.message : 'Failed to create multisig.',
          });
        }

        throw error;
      } finally {
        if (createActionSequence.current === actionId) {
          createActionInFlight.current = false;
        }
      }
    },
    [
      invalidateSelectedSnapshot,
      clearCreateSafetyState,
      network,
      persistCreateSafetyState,
      pollMessageStatus,
      provider,
      rpc,
      sender,
      storage,
      syncUncertainActionsFromStorage,
      verifyUncertaintyStorage,
    ],
  );

  const recheckCreateAction = useCallback(async (): Promise<void> => {
    if (!sender || !network) {
      throw new Error('Reconnect the native Filecoin signer used for this creation first.');
    }

    const actionIdentity = getCreateMultisigIdentityKey(sender.networkKey, sender.address);
    const syncError = syncUncertainActionsFromStorage();

    if (syncError) {
      throw new Error(syncError);
    }

    const uncertainState = uncertainCreateIdentities.current.get(actionIdentity);

    if (!uncertainState?.cid) {
      throw new Error('There is no uncertain multisig creation to recheck for this signer.');
    }

    if (createActionInFlight.current) {
      throw new Error('Another multisig creation check is already in progress.');
    }

    if (
      sender.networkKey !== network.key ||
      sender.chainId !== network.chainId ||
      uncertainState.networkKey !== sender.networkKey ||
      uncertainState.chainId !== sender.chainId
    ) {
      throw new Error('Reconnect the original signer and network before rechecking this creation.');
    }

    const actionId = createActionSequence.current + 1;
    createActionSequence.current = actionId;
    createActionInFlight.current = true;
    setCreateActionState({ ...uncertainState, status: 'rechecking' });

    const keepUncertain = (detail: string) => {
      let nextState: MultisigCreateActionState = {
        ...uncertainState,
        status: 'uncertain',
        warning: createUncertainMultisigWarning(uncertainState.cid!, detail).warning,
      };
      uncertainCreateIdentities.current.set(actionIdentity, nextState);
      const persistenceError = persistCreateSafetyState(nextState);

      if (persistenceError) {
        nextState = {
          ...nextState,
          warning: `${nextState.warning} ${persistenceError}`,
        };
        uncertainCreateIdentities.current.set(actionIdentity, nextState);
      }

      if (createActionSequence.current === actionId) {
        setCreateActionState(nextState);
      }
    };

    try {
      let status: TransactionStatus;

      try {
        status = await pollMessageStatus(uncertainState.cid, 1, 0, uncertainState.networkKey);
      } catch (error) {
        keepUncertain(
          error instanceof Error ? error.message : 'the confirmation recheck could not complete',
        );
        return;
      }

      if (status.status === 'failed' && status.receipt && status.receipt.ExitCode !== 0) {
        const persistenceError = clearCreateSafetyState(uncertainState);

        if (createActionSequence.current === actionId) {
          setCreateActionState({
            ...uncertainState,
            status: 'failed',
            error:
              (status.error ??
                `Multisig create message failed with outer exit code ${status.receipt.ExitCode}.`) +
              (persistenceError ? ` ${persistenceError}` : ''),
          });
        }
        return;
      }

      if (status.status !== 'confirmed' || !status.receipt || status.receipt.ExitCode !== 0) {
        keepUncertain(
          status.error ?? 'the latest chain status still did not prove successful execution',
        );
        return;
      }

      let decodedReturn: NonNullable<ReturnType<typeof decodeExecReturn>>;

      try {
        if (!status.receipt.Return) {
          throw new Error('the confirmed message is missing InitActor return data');
        }

        const decoded = decodeExecReturn(status.receipt.Return, uncertainState.networkKey);

        if (!decoded) {
          throw new Error('the confirmed message contains an empty InitActor return');
        }

        decodedReturn = decoded;
      } catch (error) {
        keepUncertain(
          error instanceof Error
            ? error.message
            : 'the confirmed message did not contain a verifiable multisig address',
        );
        return;
      }

      let robustAddress: NativeMultisigAddress;

      try {
        robustAddress = validateNativeMultisigAddress(
          decodedReturn.robustAddress,
          uncertainState.networkKey,
        );
      } catch {
        keepUncertain('the confirmed return did not contain a valid multisig actor address');
        return;
      }

      const saveResult = saveMultisigResult(
        {
          address: robustAddress,
          networkKey: uncertainState.networkKey,
          robustAddress,
          idAddress: decodedReturn.idAddress,
        },
        storage,
      );
      const savedItem = saveResult.multisigs.find((item) => item.address === robustAddress);
      const persistenceError = clearCreateSafetyState(uncertainState);
      const warningParts = [
        saveResult.error
          ? `The multisig was created at ${robustAddress}, but it was not saved locally. ${saveResult.error}`
          : savedItem
            ? undefined
            : `The multisig was created at ${robustAddress}, but SendFIL could not find it in local storage. Save this address manually.`,
        persistenceError,
      ].filter(Boolean);

      if (currentCreateIdentityRef.current === actionIdentity) {
        setSavedSnapshot({
          networkKey: uncertainState.networkKey,
          multisigs: saveResult.multisigs,
        });
        invalidateSelectedSnapshot();
        setSelection({ address: robustAddress, networkKey: uncertainState.networkKey });
      }

      if (createActionSequence.current === actionId) {
        setCreateActionState({
          ...uncertainState,
          status: 'confirmed',
          createdAddress: robustAddress,
          warning: warningParts.length > 0 ? warningParts.join(' ') : undefined,
        });
      }
    } finally {
      if (createActionSequence.current === actionId) {
        createActionInFlight.current = false;
      }
    }
  }, [
    invalidateSelectedSnapshot,
    clearCreateSafetyState,
    network,
    persistCreateSafetyState,
    pollMessageStatus,
    sender,
    storage,
    syncUncertainActionsFromStorage,
  ]);

  const submitProposalAction = useCallback(
    async (
      proposal: MultisigPendingProposal,
      action: 'approve' | 'cancel',
      acknowledgeDuplicatePayments = false,
    ): Promise<string> => {
      const actionIdentity = selectedIdentity;

      if (!sender || !selectedMultisig || !actionIdentity || !network) {
        throw new Error('Connect a native Filecoin signer and select a multisig first.');
      }

      if (proposalActionInFlight.current) {
        throw new Error('Another multisig approval or cancellation is still in progress.');
      }

      const syncError = syncUncertainActionsFromStorage();

      if (syncError) {
        throw new Error(syncError);
      }

      const unresolvedCreate = uncertainCreateIdentities.current.get(
        getCreateMultisigIdentityKey(sender.networkKey, sender.address),
      );

      if (unresolvedCreate) {
        throw new Error(
          'A multisig creation from this signer and network still has an uncertain result. ' +
            'Inspect its CID before approving or cancelling another proposal.',
        );
      }

      const unresolvedProposal = findUncertainProposalForSigner(
        uncertainProposalActionIdentities.current.values(),
        sender.networkKey,
        sender.address,
      );

      if (unresolvedProposal) {
        throw new Error(
          'A multisig action from this signer and network still has an uncertain result. ' +
            `Inspect its CID for ${unresolvedProposal.multisigAddress} before trying another approval or cancellation.`,
        );
      }

      if (action === 'approve' && !proposal.canApprove) {
        throw new Error('This proposal cannot be approved from SendFIL.');
      }

      const actionId = proposalActionSequence.current + 1;
      const actionSnapshot = {
        action,
        proposalId: proposal.id,
        multisigAddress: selectedMultisig.address,
        networkKey: sender.networkKey,
        chainId: sender.chainId,
        networkLabel: sender.network.walletLabel,
        signerAddress: sender.address,
      } satisfies Pick<
        MultisigProposalActionState,
        | 'action'
        | 'proposalId'
        | 'multisigAddress'
        | 'networkKey'
        | 'chainId'
        | 'networkLabel'
        | 'signerAddress'
      >;
      proposalActionSequence.current = actionId;
      proposalActionInFlight.current = true;
      setProposalActionState({
        ...actionSnapshot,
        status: 'preparing',
      });

      try {
        const nativeProvider = getNativeExecutionProvider(provider);
        const tipSetKey = await getMultisigSnapshotTipSetKey(network.key, multisigRpc);
        const freshMultisig = await loadMultisigActorState({
          address: selectedMultisig.address,
          connectedSignerAddress: sender.address,
          networkKey: network.key,
          rpc: multisigRpc,
          tipSetKey,
        });

        if (
          selectedIdentityRef.current !== actionIdentity ||
          !freshMultisig.connectedSignerCanApprove
        ) {
          throw new Error(
            'The selected multisig or connected signer changed. Review the action again.',
          );
        }

        const freshProposals = await loadMultisigPendingProposals({
          multisig: freshMultisig,
          network,
          connectedSignerAddress: sender.address,
          rpc: multisigRpc,
          tipSetKey,
        });
        const freshProposal = freshProposals.find((candidate) => candidate.id === proposal.id);

        if (!freshProposal || !equalBytes(proposal.proposalHash, freshProposal.proposalHash)) {
          throw new Error(
            'The pending proposal changed or no longer exists. Refresh and review it again.',
          );
        }

        if (action === 'approve' && !freshProposal.canApprove) {
          throw new Error('This proposal no longer passes SendFIL approval checks.');
        }

        if (
          action === 'approve' &&
          hasDuplicateProposalPayments(freshProposal) &&
          !acknowledgeDuplicatePayments
        ) {
          throw new Error('Acknowledge the duplicate proposal payments before approving.');
        }

        if (action === 'cancel' && !freshProposal.canCancel) {
          throw new Error('The connected signer is no longer allowed to cancel this proposal.');
        }

        const preflight = await preflightProposalAction({
          sender,
          multisig: freshMultisig,
          proposal: freshProposal,
          action,
          rpc,
        });
        const signerBalance = await nativeProvider.getBalance({
          address: sender.address,
          networkKey: sender.networkKey,
          nativePrefix: sender.nativePrefix,
        });

        if (selectedIdentityRef.current !== actionIdentity) {
          throw new Error(
            'The selected multisig or connected signer changed. Review the action again.',
          );
        }

        if (signerBalance < preflight.gasEstimate.estimatedFee) {
          throw new Error('Connected signer balance is too low for the multisig action gas.');
        }

        const preSignSyncError = syncUncertainActionsFromStorage();

        if (preSignSyncError) {
          throw new Error(preSignSyncError);
        }

        if (uncertainProposalActionIdentities.current.has(actionIdentity)) {
          throw new Error(
            'Another browser tab submitted a multisig action for this actor and signer. Inspect its CID before signing again.',
          );
        }

        const storagePreflightError = verifyUncertaintyStorage();

        if (storagePreflightError) {
          throw new Error(storagePreflightError);
        }

        let cid: string | undefined;
        let submissionUncertaintyDetail: string | undefined;
        let pendingPersistenceError: string | undefined;
        let safetyLockPersisted = false;
        const persistComputedCid = (computedCid: string, abortBeforePush: boolean) => {
          cid = computedCid;
          let safetyState: MultisigProposalActionState = {
            ...actionSnapshot,
            status: 'uncertain',
            cid: computedCid,
            error:
              `This signed multisig ${action} is awaiting a proof-bearing chain result. ` +
              'Recheck its CID before retrying if this page reloads.',
          };
          uncertainProposalActionIdentities.current.set(actionIdentity, safetyState);
          const persistenceError = persistProposalSafetyState(safetyState);

          if (persistenceError) {
            uncertainProposalActionIdentities.current.delete(actionIdentity);

            if (abortBeforePush) {
              throw new MultisigSafetyLockPersistenceError(persistenceError);
            }

            pendingPersistenceError = persistenceError;
            safetyState = {
              ...safetyState,
              error: `${safetyState.error} ${persistenceError}`,
            };
            uncertainProposalActionIdentities.current.set(actionIdentity, safetyState);
            return;
          }

          safetyLockPersisted = true;

          if (abortBeforePush && proposalActionSequence.current === actionId) {
            setProposalActionState({
              ...actionSnapshot,
              status: 'submitting',
              cid: computedCid,
            });
          }
        };

        await withNativeSignerLock(
          {
            networkKey: sender.networkKey,
            signerAddress: sender.address,
            storage,
          },
          async () => {
            if (proposalActionSequence.current === actionId) {
              setProposalActionState({
                ...actionSnapshot,
                status: 'signing',
              });
            }

            try {
              const submission = await nativeProvider.signAndSubmitMessage(
                preflight.estimatedMessage,
                {
                  onCidComputed: (computedCid) => persistComputedCid(computedCid, true),
                },
              );

              if (!safetyLockPersisted) {
                persistComputedCid(submission.cid, false);
              }
            } catch (error) {
              if (error instanceof MultisigSafetyLockPersistenceError) {
                cid = undefined;
                throw error;
              }

              if (!isNativeFilecoinSubmissionUncertainError(error)) {
                if (cid) {
                  const safetyState = uncertainProposalActionIdentities.current.get(actionIdentity);
                  const persistenceError = safetyState
                    ? clearProposalSafetyState(safetyState)
                    : undefined;
                  cid = undefined;

                  if (persistenceError) {
                    throw new Error(
                      `${error instanceof Error ? error.message : `Failed to submit multisig ${action}.`} ${persistenceError}`,
                    );
                  }
                }

                throw error;
              }

              if (!safetyLockPersisted) {
                persistComputedCid(error.cid, false);
              }
              submissionUncertaintyDetail = error.message;
            }
          },
        );

        if (!cid) {
          throw new Error(`The signed multisig ${action} did not produce a message CID.`);
        }

        setProposalActionState({
          ...actionSnapshot,
          status: 'pending',
          cid,
          error: pendingPersistenceError,
        });

        void (async () => {
          const markUncertain = (detail: string) => {
            let uncertainState: MultisigProposalActionState = {
              ...actionSnapshot,
              status: 'uncertain',
              cid,
              error: detail,
            };
            uncertainProposalActionIdentities.current.set(actionIdentity, uncertainState);
            const persistenceError = persistProposalSafetyState(uncertainState);

            if (persistenceError) {
              uncertainState = {
                ...uncertainState,
                error: `${uncertainState.error} ${persistenceError}`,
              };
              uncertainProposalActionIdentities.current.set(actionIdentity, uncertainState);
            }

            if (proposalActionSequence.current === actionId) {
              setProposalActionState(uncertainState);
            }
          };

          const markFailed = (detail: string) => {
            const safetyState = uncertainProposalActionIdentities.current.get(actionIdentity);
            const persistenceError = safetyState
              ? clearProposalSafetyState(safetyState)
              : undefined;

            if (proposalActionSequence.current === actionId) {
              setProposalActionState({
                ...actionSnapshot,
                status: 'failed',
                cid,
                error: detail + (persistenceError ? ` ${persistenceError}` : ''),
              });
            }
          };

          try {
            let status: TransactionStatus;

            try {
              status = await pollMessageStatus(cid, 60, 5000, sender.networkKey);
            } catch (error) {
              markUncertain(
                [
                  submissionUncertaintyDetail,
                  error instanceof Error ? error.message : `Failed to confirm multisig ${action}.`,
                ]
                  .filter(Boolean)
                  .join(' '),
              );
              return;
            }

            if (status.status === 'failed' && status.receipt && status.receipt.ExitCode !== 0) {
              markFailed(
                status.error ??
                  `Multisig ${action} message failed with outer exit code ${status.receipt.ExitCode}.`,
              );
              return;
            }

            if (status.status !== 'confirmed' || !status.receipt || status.receipt.ExitCode !== 0) {
              markUncertain(
                [
                  submissionUncertaintyDetail,
                  status.error ??
                    `The multisig ${action} confirmation status and receipt were inconclusive.`,
                ]
                  .filter(Boolean)
                  .join(' '),
              );
              return;
            }

            let outcome: MultisigProposalActionOutcome;

            try {
              outcome = decodeConfirmedProposalAction(status, action);
            } catch (error) {
              if (error instanceof MultisigActionTerminalFailureError) {
                markFailed(error.message);
              } else {
                markUncertain(
                  error instanceof Error
                    ? error.message
                    : `SendFIL could not decode the multisig ${action} result.`,
                );
              }
              return;
            }

            if (proposalActionSequence.current === actionId) {
              const safetyState = uncertainProposalActionIdentities.current.get(actionIdentity);
              const persistenceError = safetyState
                ? clearProposalSafetyState(safetyState)
                : undefined;
              setProposalActionState({
                ...actionSnapshot,
                status: 'confirmed',
                cid,
                outcome,
                error: persistenceError,
              });
            }
          } finally {
            if (selectedIdentityRef.current === actionIdentity) {
              await refreshSelected();
            }

            if (proposalActionSequence.current === actionId) {
              proposalActionInFlight.current = false;
            }
          }
        })();

        return cid;
      } catch (error) {
        if (proposalActionSequence.current === actionId) {
          proposalActionInFlight.current = false;
          setProposalActionState({
            ...actionSnapshot,
            status: 'failed',
            error: error instanceof Error ? error.message : `Failed to submit multisig ${action}.`,
          });
        }

        throw error;
      }
    },
    [
      multisigRpc,
      clearProposalSafetyState,
      network,
      pollMessageStatus,
      persistProposalSafetyState,
      provider,
      refreshSelected,
      rpc,
      selectedIdentity,
      selectedMultisig,
      sender,
      storage,
      syncUncertainActionsFromStorage,
      verifyUncertaintyStorage,
    ],
  );

  const recheckProposalAction = useCallback(async (): Promise<void> => {
    if (!sender || !network || !selectedMultisig || !selectedIdentity) {
      throw new Error('Reconnect the original signer and select its multisig before rechecking.');
    }

    const syncError = syncUncertainActionsFromStorage();

    if (syncError) {
      throw new Error(syncError);
    }

    const uncertainState = uncertainProposalActionIdentities.current.get(selectedIdentity);

    if (!uncertainState?.cid) {
      throw new Error('There is no uncertain multisig action to recheck for this selection.');
    }

    if (proposalActionInFlight.current) {
      throw new Error('Another multisig action check is already in progress.');
    }

    if (
      sender.networkKey !== network.key ||
      sender.chainId !== network.chainId ||
      uncertainState.multisigAddress !== selectedMultisig.address ||
      uncertainState.signerAddress !== sender.address
    ) {
      throw new Error('Reconnect the original signer and network before rechecking this action.');
    }

    const actionId = proposalActionSequence.current + 1;
    proposalActionSequence.current = actionId;
    proposalActionInFlight.current = true;
    setProposalActionState({ ...uncertainState, status: 'rechecking' });

    const keepUncertain = (detail: string) => {
      let nextState: MultisigProposalActionState = {
        ...uncertainState,
        status: 'uncertain',
        error: detail,
      };
      uncertainProposalActionIdentities.current.set(selectedIdentity, nextState);
      const persistenceError = persistProposalSafetyState(nextState);

      if (persistenceError) {
        nextState = {
          ...nextState,
          error: `${nextState.error} ${persistenceError}`,
        };
        uncertainProposalActionIdentities.current.set(selectedIdentity, nextState);
      }

      if (proposalActionSequence.current === actionId) {
        setProposalActionState(nextState);
      }
    };

    try {
      let status: TransactionStatus;

      try {
        status = await pollMessageStatus(uncertainState.cid, 1, 0, uncertainState.networkKey);
      } catch (error) {
        keepUncertain(
          error instanceof Error
            ? error.message
            : `The multisig ${uncertainState.action} recheck could not complete.`,
        );
        return;
      }

      if (status.status === 'failed' && status.receipt && status.receipt.ExitCode !== 0) {
        const persistenceError = clearProposalSafetyState(uncertainState);

        if (proposalActionSequence.current === actionId) {
          setProposalActionState({
            ...uncertainState,
            status: 'failed',
            error:
              (status.error ??
                `Multisig ${uncertainState.action} message failed with outer exit code ${status.receipt.ExitCode}.`) +
              (persistenceError ? ` ${persistenceError}` : ''),
          });
        }
        return;
      }

      if (status.status !== 'confirmed' || !status.receipt || status.receipt.ExitCode !== 0) {
        keepUncertain(
          status.error ??
            `The latest multisig ${uncertainState.action} status still did not prove a terminal result.`,
        );
        return;
      }

      let outcome: MultisigProposalActionOutcome;

      try {
        outcome = decodeConfirmedProposalAction(status, uncertainState.action);
      } catch (error) {
        if (error instanceof MultisigActionTerminalFailureError) {
          const persistenceError = clearProposalSafetyState(uncertainState);

          if (proposalActionSequence.current === actionId) {
            setProposalActionState({
              ...uncertainState,
              status: 'failed',
              error: error.message + (persistenceError ? ` ${persistenceError}` : ''),
            });
          }
        } else {
          keepUncertain(
            error instanceof Error
              ? error.message
              : `SendFIL could not decode the multisig ${uncertainState.action} result.`,
          );
        }
        return;
      }

      const persistenceError = clearProposalSafetyState(uncertainState);

      if (proposalActionSequence.current === actionId) {
        setProposalActionState({
          ...uncertainState,
          status: 'confirmed',
          outcome,
          error: persistenceError,
        });
      }
    } finally {
      if (selectedIdentityRef.current === selectedIdentity) {
        await refreshSelected();
      }

      if (proposalActionSequence.current === actionId) {
        proposalActionInFlight.current = false;
      }
    }
  }, [
    network,
    clearProposalSafetyState,
    persistProposalSafetyState,
    pollMessageStatus,
    refreshSelected,
    selectedIdentity,
    selectedMultisig,
    sender,
    syncUncertainActionsFromStorage,
  ]);

  return {
    savedMultisigs,
    selectedAddress,
    selectedMultisig,
    pendingProposals,
    isLoadingSelected,
    selectedError,
    uncertaintyStorageError,
    createActionState: displayedCreateActionState,
    isCreateActionInFlight,
    isCreateRetryBlocked,
    proposalActionState: displayedProposalActionState,
    isProposalActionInFlight,
    isProposalRetryBlocked,
    selectMultisig,
    addMultisig,
    removeMultisig,
    refreshSelected,
    createMultisig,
    recheckCreateAction,
    approveProposal: (proposal, acknowledgeDuplicatePayments) =>
      submitProposalAction(proposal, 'approve', acknowledgeDuplicatePayments),
    cancelProposal: (proposal) => submitProposalAction(proposal, 'cancel'),
    recheckProposalAction,
  };
}
