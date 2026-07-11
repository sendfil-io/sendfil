import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CoinType, Protocol, newFromString } from '@glif/filecoin-address';
import type { NativeFilecoinConnectedSender, NativeFilecoinWalletProvider } from '../senders';
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
import { readSavedMultisigsResult, removeSavedMultisigResult, saveMultisigResult } from './storage';

export interface CreateMultisigFormValues {
  signers: string[];
  threshold: number;
  initialDepositFil: string;
  startEpoch?: number;
  unlockDuration?: number;
}

export interface CreateMultisigResult {
  cid: string;
  savedMultisig?: SavedMultisig;
  warning?: string;
}

export type MultisigProposalActionOutcome = 'queued' | 'applied-success' | 'cancelled';

export interface MultisigProposalActionState {
  action: 'approve' | 'cancel';
  proposalId: number;
  multisigAddress: NativeMultisigAddress;
  networkKey: SendFilNetworkKey;
  signerAddress: string;
  status: 'signing' | 'pending' | 'confirmed' | 'failed';
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
  proposalActionState?: MultisigProposalActionState;
  selectMultisig: (address?: NativeMultisigAddress) => void;
  addMultisig: (address: string, label?: string) => Promise<SavedMultisig>;
  removeMultisig: (address: NativeMultisigAddress) => void;
  refreshSelected: () => Promise<MultisigActorState | undefined>;
  createMultisig: (values: CreateMultisigFormValues) => Promise<CreateMultisigResult>;
  approveProposal: (
    proposal: MultisigPendingProposal,
    acknowledgeDuplicatePayments?: boolean,
  ) => Promise<string>;
  cancelProposal: (proposal: MultisigPendingProposal) => Promise<string>;
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
    throw new Error(
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
    throw new Error(
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
  const [savedSnapshot, setSavedSnapshot] = useState<SavedMultisigSnapshot>();
  const [selection, setSelection] = useState<SelectedMultisigIdentity>();
  const [selectedSnapshot, setSelectedSnapshot] = useState<SelectedMultisigSnapshot>();
  const [storageError, setStorageError] = useState<string>();
  const [proposalActionState, setProposalActionState] = useState<MultisigProposalActionState>();
  const selectionRequestSequence = useRef(0);
  const proposalActionSequence = useRef(0);
  const proposalActionInFlight = useRef(false);
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

  selectedIdentityRef.current = selectedIdentity;
  currentNetworkKeyRef.current = network?.key;
  currentSignerAddressRef.current = sender?.address;

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
        !result.multisigs.some((item) => item.address === selection.address))
    ) {
      invalidateSelectedSnapshot();
      setSelection(undefined);
    }
  }, [invalidateSelectedSnapshot, network, selection, storage]);

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
      const actorState = await loadMultisigActorState({
        address: selectedAddress,
        connectedSignerAddress: sender?.address,
        networkKey: network.key,
        rpc: multisigRpc,
      });

      if (!isCurrentRequest()) {
        return undefined;
      }

      const proposals = await loadMultisigPendingProposals({
        multisig: actorState,
        network,
        connectedSignerAddress: sender?.address,
        rpc: multisigRpc,
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

      const nativeProvider = getNativeExecutionProvider(provider);
      const validated = validateCreateMultisigValues(values, sender.nativePrefix);
      const connectedSignerAddress = newFromString(sender.address).toString();

      if (!validated.signers.includes(connectedSignerAddress)) {
        throw new Error('Connected signer must be included in the multisig signer list.');
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
      const signerBalance = await nativeProvider.getBalance({
        address: sender.address,
        networkKey: sender.networkKey,
        nativePrefix: sender.nativePrefix,
      });
      const requiredBalance = validated.initialDepositAttoFil + preflight.gasEstimate.estimatedFee;

      if (signerBalance < requiredBalance) {
        throw new Error('Connected signer balance is too low for the deposit plus gas.');
      }

      const { cid } = await nativeProvider.signAndSubmitMessage(preflight.estimatedMessage);
      const status: TransactionStatus = await pollMessageStatus(cid, 60, 5000, sender.networkKey);

      if (status.status !== 'confirmed') {
        throw new Error(status.error ?? 'Multisig create message was not confirmed.');
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
        return {
          cid,
          warning:
            'The create message was confirmed, but SendFIL could not verify the new multisig address. ' +
            `Inspect ${cid} before trying again${
              error instanceof Error ? `: ${error.message}` : '.'
            }`,
        };
      }

      let robustAddress: NativeMultisigAddress;

      try {
        robustAddress = validateNativeMultisigAddress(
          decodedReturn.robustAddress,
          sender.networkKey,
        );
      } catch {
        return {
          cid,
          warning:
            'The create message was confirmed, but its return did not contain a valid multisig actor address. ' +
            `Inspect ${cid} before trying again.`,
        };
      }

      {
        const result = saveMultisigResult(
          {
            address: robustAddress,
            networkKey: sender.networkKey,
            robustAddress,
            idAddress: decodedReturn.idAddress,
          },
          storage,
        );
        const savedItem = result.multisigs.find((item) => item.address === robustAddress);
        const isCurrentCreateIdentity =
          currentNetworkKeyRef.current === sender.networkKey &&
          currentSignerAddressRef.current === sender.address;

        if (result.error) {
          if (isCurrentCreateIdentity) {
            setStorageError(
              `The multisig was created, but it was not saved locally. ${result.error}`,
            );
          }

          return {
            cid,
            warning: `The multisig was created, but it was not saved locally. ${result.error}`,
          };
        }

        if (isCurrentCreateIdentity) {
          setStorageError(undefined);
          setSavedSnapshot({
            networkKey: sender.networkKey,
            multisigs: result.multisigs,
          });
          invalidateSelectedSnapshot();
          setSelection({
            address: robustAddress,
            networkKey: sender.networkKey,
          });
        }

        return {
          cid,
          savedMultisig: savedItem,
          warning: savedItem
            ? undefined
            : 'The multisig was created, but SendFIL could not find it in local storage. Save its address manually.',
        };
      }
    },
    [invalidateSelectedSnapshot, network, pollMessageStatus, provider, rpc, sender, storage],
  );

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

      if (action === 'approve' && !proposal.canApprove) {
        throw new Error('This proposal cannot be approved from SendFIL.');
      }

      const actionId = proposalActionSequence.current + 1;
      proposalActionSequence.current = actionId;
      proposalActionInFlight.current = true;
      setProposalActionState({
        action,
        proposalId: proposal.id,
        multisigAddress: selectedMultisig.address,
        networkKey: sender.networkKey,
        signerAddress: sender.address,
        status: 'signing',
      });

      try {
        const nativeProvider = getNativeExecutionProvider(provider);
        const freshMultisig = await loadMultisigActorState({
          address: selectedMultisig.address,
          connectedSignerAddress: sender.address,
          networkKey: network.key,
          rpc: multisigRpc,
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

        const { cid } = await nativeProvider.signAndSubmitMessage(preflight.estimatedMessage);

        setProposalActionState({
          action,
          proposalId: proposal.id,
          multisigAddress: selectedMultisig.address,
          networkKey: sender.networkKey,
          signerAddress: sender.address,
          status: 'pending',
          cid,
        });

        void (async () => {
          try {
            const status = await pollMessageStatus(cid, 60, 5000, sender.networkKey);
            const outcome = decodeConfirmedProposalAction(status, action);

            if (proposalActionSequence.current === actionId) {
              setProposalActionState({
                action,
                proposalId: proposal.id,
                multisigAddress: selectedMultisig.address,
                networkKey: sender.networkKey,
                signerAddress: sender.address,
                status: 'confirmed',
                cid,
                outcome,
              });
            }
          } catch (error) {
            if (proposalActionSequence.current === actionId) {
              setProposalActionState({
                action,
                proposalId: proposal.id,
                multisigAddress: selectedMultisig.address,
                networkKey: sender.networkKey,
                signerAddress: sender.address,
                status: 'failed',
                cid,
                error:
                  error instanceof Error ? error.message : `Failed to confirm multisig ${action}.`,
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
            action,
            proposalId: proposal.id,
            multisigAddress: selectedMultisig.address,
            networkKey: sender.networkKey,
            signerAddress: sender.address,
            status: 'failed',
            error: error instanceof Error ? error.message : `Failed to submit multisig ${action}.`,
          });
        }

        throw error;
      }
    },
    [
      multisigRpc,
      network,
      pollMessageStatus,
      provider,
      refreshSelected,
      rpc,
      selectedIdentity,
      selectedMultisig,
      sender,
    ],
  );

  return {
    savedMultisigs,
    selectedAddress,
    selectedMultisig,
    pendingProposals,
    isLoadingSelected,
    selectedError,
    proposalActionState,
    selectMultisig,
    addMultisig,
    removeMultisig,
    refreshSelected,
    createMultisig,
    approveProposal: (proposal, acknowledgeDuplicatePayments) =>
      submitProposalAction(proposal, 'approve', acknowledgeDuplicatePayments),
    cancelProposal: (proposal) => submitProposalAction(proposal, 'cancel'),
  };
}
