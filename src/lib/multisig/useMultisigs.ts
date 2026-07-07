import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CoinType,
  Protocol,
  newFromString,
} from '@glif/filecoin-address';
import type {
  NativeFilecoinConnectedSender,
  NativeFilecoinWalletProvider,
} from '../senders';
import { pollTransactionStatus } from '../DataProvider';
import type { TransactionStatus } from '../DataProvider/types';
import type { SendFilNetworkConfig } from '../networks';
import type {
  MultisigActorState,
  MultisigPendingProposal,
  NativeMultisigAddress,
  SavedMultisig,
} from './types';
import {
  MAX_MULTISIG_SIGNERS,
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
import {
  readSavedMultisigs,
  removeSavedMultisig,
  saveMultisig,
} from './storage';

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
  selectMultisig: (address?: NativeMultisigAddress) => void;
  addMultisig: (address: string, label?: string) => Promise<SavedMultisig>;
  removeMultisig: (address: NativeMultisigAddress) => void;
  refreshSelected: () => Promise<void>;
  createMultisig: (values: CreateMultisigFormValues) => Promise<CreateMultisigResult>;
  approveProposal: (proposal: MultisigPendingProposal) => Promise<string>;
  cancelProposal: (proposal: MultisigPendingProposal) => Promise<string>;
}

type SignAndSubmitNativeProvider = NativeFilecoinWalletProvider & {
  signAndSubmitMessage: NonNullable<NativeFilecoinWalletProvider['signAndSubmitMessage']>;
};

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

    if (
      parsed.protocol() !== Protocol.SECP256K1 ||
      parsed.coinType() !== expectedCoinType
    ) {
      throw new Error('Wrong signer protocol or network');
    }

    return parsed.toString();
  } catch {
    throw new Error(`Multisig signers must be ${expected} Filecoin f1/t1 addresses.`);
  }
}

function validateOptionalEpochValue(
  value: number | undefined,
  label: string,
): number | undefined {
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
  const unlockDuration = validateOptionalEpochValue(
    values.unlockDuration,
    'Unlock duration',
  );

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

export function useMultisigs({
  sender,
  provider,
  network,
  storage,
  rpc,
  pollMessageStatus = pollTransactionStatus,
}: UseMultisigsOptions = {}): UseMultisigsReturn {
  const multisigRpc = useMemo(() => getMultisigRpc(rpc), [rpc]);
  const [savedMultisigs, setSavedMultisigs] = useState<SavedMultisig[]>([]);
  const [selectedAddress, setSelectedAddress] =
    useState<NativeMultisigAddress | undefined>();
  const [selectedMultisig, setSelectedMultisig] =
    useState<MultisigActorState | undefined>();
  const [pendingProposals, setPendingProposals] = useState<MultisigPendingProposal[]>([]);
  const [isLoadingSelected, setIsLoadingSelected] = useState(false);
  const [selectedError, setSelectedError] = useState<string | undefined>();

  useEffect(() => {
    if (!network) {
      setSavedMultisigs([]);
      setSelectedAddress(undefined);
      return;
    }

    const saved = readSavedMultisigs(network.key, storage);
    setSavedMultisigs(saved);

    if (selectedAddress && !saved.some((item) => item.address === selectedAddress)) {
      setSelectedAddress(undefined);
    }
  }, [network, selectedAddress, storage]);

  const refreshSelected = useCallback(async () => {
    if (!selectedAddress || !network) {
      setSelectedMultisig(undefined);
      setPendingProposals([]);
      setSelectedError(undefined);
      return;
    }

    setIsLoadingSelected(true);
    setSelectedError(undefined);

    try {
      const actorState = await loadMultisigActorState({
        address: selectedAddress,
        connectedSignerAddress: sender?.address,
        networkKey: network.key,
        rpc: multisigRpc,
      });
      const proposals = await loadMultisigPendingProposals({
        multisig: actorState,
        network,
        connectedSignerAddress: sender?.address,
        rpc: multisigRpc,
      });

      setSelectedMultisig(actorState);
      setPendingProposals(proposals);
    } catch (error) {
      setSelectedMultisig(undefined);
      setPendingProposals([]);
      setSelectedError(
        error instanceof Error ? error.message : 'Failed to load selected multisig.',
      );
    } finally {
      setIsLoadingSelected(false);
    }
  }, [multisigRpc, network, selectedAddress, sender?.address]);

  useEffect(() => {
    void refreshSelected();
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
      const saved = saveMultisig(
        {
          address: multisigAddress,
          networkKey: network.key,
          robustAddress: actorState.robustAddress,
          idAddress: actorState.idAddress,
          label,
        },
        storage,
      );
      const savedItem = saved.find((item) => item.address === multisigAddress);

      setSavedMultisigs(saved);
      setSelectedAddress(multisigAddress);
      setSelectedMultisig(actorState);

      if (!savedItem) {
        throw new Error('Failed to save multisig locally.');
      }

      return savedItem;
    },
    [multisigRpc, network, sender?.address, storage],
  );

  const removeMultisig = useCallback(
    (address: NativeMultisigAddress) => {
      if (!network) {
        return;
      }

      const saved = removeSavedMultisig(network.key, address, storage);
      setSavedMultisigs(saved);

      if (selectedAddress === address) {
        setSelectedAddress(undefined);
        setSelectedMultisig(undefined);
        setPendingProposals([]);
      }
    },
    [network, selectedAddress, storage],
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
      const requiredBalance =
        validated.initialDepositAttoFil + preflight.gasEstimate.estimatedFee;

      if (signerBalance < requiredBalance) {
        throw new Error('Connected signer balance is too low for the deposit plus gas.');
      }

      const { cid } = await nativeProvider.signAndSubmitMessage(
        preflight.estimatedMessage,
      );
      const status: TransactionStatus = await pollMessageStatus(
        cid,
        60,
        5000,
        sender.networkKey,
      );

      if (status.status !== 'confirmed') {
        throw new Error(status.error ?? 'Multisig create message was not confirmed.');
      }

      const decodedReturn = (() => {
        if (!status.receipt?.Return) {
          return undefined;
        }

        try {
          return decodeExecReturn(status.receipt.Return, sender.networkKey);
        } catch {
          return undefined;
        }
      })();
      const robustAddress = decodedReturn?.robustAddress;

      if (
        robustAddress &&
        (robustAddress.startsWith('f2') || robustAddress.startsWith('t2'))
      ) {
        const saved = saveMultisig(
          {
            address: robustAddress as NativeMultisigAddress,
            networkKey: sender.networkKey,
            robustAddress: robustAddress as NativeMultisigAddress,
            idAddress: decodedReturn?.idAddress,
          },
          storage,
        );
        const savedItem = saved.find((item) => item.address === robustAddress);

        setSavedMultisigs(saved);
        setSelectedAddress(robustAddress as NativeMultisigAddress);

        const actorState = await loadMultisigActorState({
          address: robustAddress,
          connectedSignerAddress: sender.address,
          networkKey: sender.networkKey,
          rpc: multisigRpc,
        }).catch(() => undefined);

        if (actorState) {
          setSelectedMultisig(actorState);
        }

        return {
          cid,
          savedMultisig: savedItem,
        };
      }

      return { cid };
    },
    [multisigRpc, network, pollMessageStatus, provider, rpc, sender, storage],
  );

  const submitProposalAction = useCallback(
    async (
      proposal: MultisigPendingProposal,
      action: 'approve' | 'cancel',
    ): Promise<string> => {
      if (!sender || !selectedMultisig) {
        throw new Error('Connect a native Filecoin signer and select a multisig first.');
      }

      if (action === 'approve' && !proposal.canApprove) {
        throw new Error('This proposal cannot be approved from SendFIL.');
      }

      if (action === 'cancel' && !proposal.canCancel) {
        throw new Error('This proposal cannot be cancelled from SendFIL.');
      }

      const nativeProvider = getNativeExecutionProvider(provider);
      const preflight = await preflightProposalAction({
        sender,
        multisig: selectedMultisig,
        proposal,
        action,
        rpc,
      });
      const signerBalance = await nativeProvider.getBalance({
        address: sender.address,
        networkKey: sender.networkKey,
        nativePrefix: sender.nativePrefix,
      });

      if (signerBalance < preflight.gasEstimate.estimatedFee) {
        throw new Error('Connected signer balance is too low for the approval gas.');
      }

      const { cid } = await nativeProvider.signAndSubmitMessage(
        preflight.estimatedMessage,
      );

      void pollMessageStatus(cid, 60, 5000, sender.networkKey).then(() => refreshSelected());

      return cid;
    },
    [pollMessageStatus, provider, refreshSelected, rpc, selectedMultisig, sender],
  );

  return {
    savedMultisigs,
    selectedAddress,
    selectedMultisig,
    pendingProposals,
    isLoadingSelected,
    selectedError,
    selectMultisig: setSelectedAddress,
    addMultisig,
    removeMultisig,
    refreshSelected,
    createMultisig,
    approveProposal: (proposal) => submitProposalAction(proposal, 'approve'),
    cancelProposal: (proposal) => submitProposalAction(proposal, 'cancel'),
  };
}
