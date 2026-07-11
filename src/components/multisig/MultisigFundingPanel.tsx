import * as React from 'react';
import type { NativeFilecoinConnectedSender } from '../../lib/senders';
import { getFilfoxMessageUrl, type SendFilNetworkConfig } from '../../lib/networks';
import type {
  CreateMultisigFormValues,
  CreateMultisigResult,
  MultisigActorState,
  MultisigPendingProposal,
  MultisigProposalActionState,
  NativeMultisigAddress,
  SavedMultisig,
} from '../../lib/multisig';
import { getProposalSignatureRows } from './signatureStatus';

interface MultisigFundingPanelProps {
  enabled: boolean;
  isExternallyLocked?: boolean;
  network?: SendFilNetworkConfig;
  connectedSigner?: NativeFilecoinConnectedSender;
  savedMultisigs: SavedMultisig[];
  selectedAddress?: NativeMultisigAddress;
  selectedMultisig?: MultisigActorState;
  pendingProposals: MultisigPendingProposal[];
  isLoadingSelected: boolean;
  selectedError?: string;
  proposalActionState?: MultisigProposalActionState;
  onSelect: (address?: NativeMultisigAddress) => void;
  onAdd: (address: string, label?: string) => Promise<SavedMultisig>;
  onRemove: (address: NativeMultisigAddress) => void;
  onCreate: (values: CreateMultisigFormValues) => Promise<CreateMultisigResult>;
  onApprove: (
    proposal: MultisigPendingProposal,
    acknowledgeDuplicatePayments?: boolean,
  ) => Promise<string>;
  onCancel: (proposal: MultisigPendingProposal) => Promise<string>;
  onRefresh: () => Promise<unknown>;
}

interface ActionStatus {
  message: string;
  cid?: string;
  tone?: 'success' | 'warning';
}

function formatFilFromAtto(value?: bigint): string {
  if (value === undefined) {
    return 'Unavailable';
  }

  const fil = Number(value) / 1e18;

  if (fil === 0) {
    return '0 FIL';
  }

  if (fil < 0.000001) {
    return '< 0.000001 FIL';
  }

  return `${fil.toLocaleString(undefined, {
    maximumFractionDigits: fil < 1 ? 6 : 3,
  })} FIL`;
}

function formatExactFilFromAtto(value: string): string {
  const attoFil = BigInt(value);
  const whole = attoFil / 10n ** 18n;
  const fraction = (attoFil % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');

  return `${whole.toString()}${fraction ? `.${fraction}` : ''} FIL`;
}

function truncateAddress(address: string): string {
  if (address.length <= 18) {
    return address;
  }

  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function createDefaultCreateValues(connectedSignerAddress?: string): CreateMultisigFormValues {
  return {
    signers: connectedSignerAddress ? [connectedSignerAddress] : [''],
    threshold: 1,
    initialDepositFil: '0',
  };
}

export function MultisigFundingPanel({
  enabled,
  isExternallyLocked = false,
  network,
  connectedSigner,
  savedMultisigs,
  selectedAddress,
  selectedMultisig,
  pendingProposals,
  isLoadingSelected,
  selectedError,
  proposalActionState,
  onSelect,
  onAdd,
  onRemove,
  onCreate,
  onApprove,
  onCancel,
  onRefresh,
}: MultisigFundingPanelProps) {
  const [importAddress, setImportAddress] = React.useState('');
  const [importLabel, setImportLabel] = React.useState('');
  const [formError, setFormError] = React.useState<string | undefined>();
  const [actionStatus, setActionStatus] = React.useState<ActionStatus | undefined>();
  const [isCreating, setIsCreating] = React.useState(false);
  const [isAdding, setIsAdding] = React.useState(false);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [acknowledgedDuplicateProposals, setAcknowledgedDuplicateProposals] = React.useState(
    () => new Set<number>(),
  );
  const [activeProposalAction, setActiveProposalAction] = React.useState<{
    proposalId: number;
    action: 'approve' | 'cancel';
  }>();
  const [mode, setMode] = React.useState<'add' | 'create'>('add');
  const connectedSignerAddress = connectedSigner?.address;
  const [createValues, setCreateValues] = React.useState<CreateMultisigFormValues>(() =>
    createDefaultCreateValues(connectedSignerAddress),
  );
  const canAddMultisig = Boolean(network);
  const canCreateMultisig = enabled && Boolean(network && connectedSigner);
  const selectedSavedMultisig = savedMultisigs.find(
    (multisig) => multisig.address === selectedAddress,
  );
  const currentSelectedMultisig =
    selectedAddress &&
    selectedMultisig?.address === selectedAddress &&
    (!network || selectedMultisig.networkKey === network.key)
      ? selectedMultisig
      : undefined;
  const currentProposalAction =
    proposalActionState &&
    selectedAddress === proposalActionState.multisigAddress &&
    (!network || network.key === proposalActionState.networkKey) &&
    connectedSignerAddress === proposalActionState.signerAddress
      ? proposalActionState
      : undefined;
  const isGlobalProposalActionAwaitingConfirmation =
    proposalActionState?.status === 'signing' || proposalActionState?.status === 'pending';
  const isProposalActionAwaitingConfirmation =
    currentProposalAction?.status === 'signing' || currentProposalAction?.status === 'pending';
  const hasWalletActionInFlight =
    isExternallyLocked ||
    isCreating ||
    activeProposalAction !== undefined ||
    isGlobalProposalActionAwaitingConfirmation;

  React.useEffect(() => {
    setCreateValues(createDefaultCreateValues(connectedSignerAddress));
  }, [connectedSignerAddress]);

  React.useEffect(() => {
    setFormError(undefined);
    setActionStatus(undefined);
    setAcknowledgedDuplicateProposals(new Set());
  }, [connectedSignerAddress, mode, network?.key, selectedAddress]);

  const addSigner = () => {
    setCreateValues((current) => ({
      ...current,
      signers: [...current.signers, ''],
    }));
  };

  const removeSigner = (index: number) => {
    setCreateValues((current) => ({
      ...current,
      signers: current.signers.filter((_, signerIndex) => signerIndex !== index),
      threshold: Math.min(current.threshold, Math.max(1, current.signers.length - 1)),
    }));
  };

  const updateSigner = (index: number, value: string) => {
    setCreateValues((current) => ({
      ...current,
      signers: current.signers.map((signer, signerIndex) =>
        signerIndex === index ? value : signer,
      ),
    }));
  };

  const handleAdd = async () => {
    if (hasWalletActionInFlight) {
      return;
    }

    setFormError(undefined);
    setActionStatus(undefined);
    setIsAdding(true);

    try {
      await onAdd(importAddress, importLabel.trim() || undefined);
      setImportAddress('');
      setImportLabel('');
      setActionStatus({ message: 'Multisig saved locally.' });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to add multisig.');
    } finally {
      setIsAdding(false);
    }
  };

  const handleCreate = async () => {
    if (hasWalletActionInFlight) {
      return;
    }

    setFormError(undefined);
    setActionStatus(undefined);
    setIsCreating(true);

    try {
      const result = await onCreate(createValues);
      setActionStatus({
        message: result.warning ?? 'Multisig creation confirmed and saved locally.',
        cid: result.cid,
        tone: result.warning ? 'warning' : 'success',
      });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to create multisig.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleProposalAction = async (
    proposal: MultisigPendingProposal,
    action: 'approve' | 'cancel',
    acknowledgeDuplicatePayments = false,
  ) => {
    if (hasWalletActionInFlight) {
      return;
    }

    setFormError(undefined);
    setActionStatus(undefined);
    setActiveProposalAction({ proposalId: proposal.id, action });

    try {
      const cid =
        action === 'approve'
          ? await onApprove(proposal, acknowledgeDuplicatePayments)
          : await onCancel(proposal);
      setActionStatus({
        message: `${action === 'approve' ? 'Approval' : 'Cancellation'} submitted.`,
        cid,
      });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : `Failed to ${action} proposal.`);
    } finally {
      setActiveProposalAction(undefined);
    }
  };

  const handleRefresh = async () => {
    if (isRefreshing || hasWalletActionInFlight) {
      return;
    }

    setFormError(undefined);
    setIsRefreshing(true);

    try {
      await onRefresh();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to refresh multisig state.');
    } finally {
      setIsRefreshing(false);
    }
  };

  const expectedPrefix = network?.nativePrefix === 't' ? 't2...' : 'f2...';
  const expectedSignerPrefix = network?.nativePrefix === 't' ? 't1...' : 'f1...';

  return (
    <div
      className="mt-4 border-t border-slate-100 pt-4"
      data-testid="multisig-funding-panel"
      aria-busy={isLoadingSelected || isRefreshing || hasWalletActionInFlight}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">Native multisig</h3>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          {network?.walletLabel ?? 'No network'}
        </span>
      </div>

      <div className="mt-3 space-y-4">
        {!connectedSigner && (
          <p className="text-xs leading-5 text-slate-500">
            Connect FilSnap or Ledger Filecoin to create, approve, or send.
          </p>
        )}
        {formError && (
          <div
            className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            role="alert"
          >
            {formError}
          </div>
        )}

        {actionStatus && !currentProposalAction && (
          <div
            className={`rounded-xl border px-3 py-2 text-sm ${
              actionStatus.tone === 'warning'
                ? 'border-amber-200 bg-amber-50 text-amber-900'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800'
            }`}
            role={actionStatus.tone === 'warning' ? 'alert' : 'status'}
            aria-live="polite"
          >
            <p>{actionStatus.message}</p>
            {actionStatus.cid && network && (
              <a
                href={getFilfoxMessageUrl(actionStatus.cid, network.chainId)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block font-semibold underline underline-offset-2"
              >
                View message on Filfox ↗
              </a>
            )}
          </div>
        )}

        {currentProposalAction && currentProposalAction.status === 'failed' && (
          <div
            className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            role="alert"
          >
            <p>{currentProposalAction.error ?? 'The multisig action failed.'}</p>
            {currentProposalAction.cid && network && (
              <a
                href={getFilfoxMessageUrl(currentProposalAction.cid, network.chainId)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block font-semibold underline underline-offset-2"
              >
                Inspect message on Filfox ↗
              </a>
            )}
          </div>
        )}

        {currentProposalAction && currentProposalAction.status !== 'failed' && (
          <div
            className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900"
            role="status"
            aria-live="polite"
          >
            <p>
              {currentProposalAction.status === 'signing'
                ? `Preparing ${currentProposalAction.action}. Confirm it in your wallet.`
                : currentProposalAction.status === 'pending'
                  ? `${currentProposalAction.action === 'approve' ? 'Approval' : 'Cancellation'} submitted and awaiting confirmation.`
                  : currentProposalAction.outcome === 'queued'
                    ? 'Approval confirmed. The proposal still needs additional approvals.'
                    : currentProposalAction.outcome === 'applied-success'
                      ? 'Approval confirmed. The threshold was reached and the batch call completed.'
                      : 'Proposal cancellation confirmed.'}
            </p>
            {currentProposalAction.cid && network && (
              <a
                href={getFilfoxMessageUrl(currentProposalAction.cid, network.chainId)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block font-semibold underline underline-offset-2"
              >
                View message on Filfox ↗
              </a>
            )}
          </div>
        )}

        {savedMultisigs.length > 0 && (
          <div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                Saved
              </p>
              {selectedAddress && (
                <button
                  type="button"
                  onClick={() => onSelect(undefined)}
                  disabled={hasWalletActionInFlight}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-900 disabled:cursor-not-allowed disabled:text-slate-300"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="mt-2 divide-y divide-slate-100 border-y border-slate-100">
              {savedMultisigs.map((multisig) => {
                const isSelected = selectedAddress === multisig.address;

                return (
                  <div key={multisig.address} className="flex items-center gap-2 py-2">
                    <button
                      type="button"
                      onClick={() => onSelect(multisig.address)}
                      disabled={hasWalletActionInFlight}
                      aria-pressed={isSelected}
                      aria-label={`Select multisig ${multisig.label || multisig.address}`}
                      className="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span
                        className={`block truncate text-sm font-semibold ${
                          isSelected ? 'text-[#124ac4]' : 'text-slate-900'
                        }`}
                      >
                        {multisig.label || truncateAddress(multisig.address)}
                      </span>
                      <span className="block truncate font-mono text-xs text-slate-500">
                        {multisig.address}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(multisig.address)}
                      disabled={hasWalletActionInFlight}
                      aria-label={`Remove multisig ${multisig.label || multisig.address}`}
                      className="shrink-0 text-xs font-semibold text-slate-400 hover:text-red-700 disabled:cursor-not-allowed disabled:text-slate-300"
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {selectedAddress && (
          <div className="border-y border-slate-100 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-950">
                  {selectedSavedMultisig?.label || truncateAddress(selectedAddress)}
                </p>
                <p className="mt-1 truncate font-mono text-xs text-slate-500">{selectedAddress}</p>
              </div>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={isLoadingSelected || isRefreshing || hasWalletActionInFlight}
                aria-label={`Refresh multisig ${selectedAddress}`}
                className="shrink-0 text-xs font-semibold text-[#124ac4] disabled:cursor-not-allowed disabled:text-slate-400"
              >
                {isLoadingSelected || isRefreshing ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>

            {isLoadingSelected ? (
              <p className="mt-3 text-sm text-slate-500" role="status" aria-live="polite">
                Loading multisig state...
              </p>
            ) : selectedError ? (
              <p className="mt-3 text-sm text-red-700" role="alert">
                {selectedError}
              </p>
            ) : currentSelectedMultisig ? (
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <div>
                  <dt className="text-slate-500">Spendable</dt>
                  <dd className="mt-0.5 font-semibold text-slate-900">
                    {formatFilFromAtto(currentSelectedMultisig.availableBalanceAttoFil)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Threshold</dt>
                  <dd className="mt-0.5 font-semibold text-slate-900">
                    {currentSelectedMultisig.threshold} / {currentSelectedMultisig.signers.length}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Balance</dt>
                  <dd className="mt-0.5 font-semibold text-slate-900">
                    {formatFilFromAtto(currentSelectedMultisig.balanceAttoFil)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Signer</dt>
                  <dd
                    className={`mt-0.5 font-semibold ${
                      currentSelectedMultisig.connectedSignerCanApprove
                        ? 'text-emerald-700'
                        : 'text-red-700'
                    }`}
                  >
                    {currentSelectedMultisig.connectedSignerCanApprove ? 'Member' : 'Not member'}
                  </dd>
                </div>
              </dl>
            ) : null}
          </div>
        )}

        {currentSelectedMultisig && pendingProposals.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
              Pending
            </p>
            <div className="mt-2 divide-y divide-slate-100 border-y border-slate-100">
              {pendingProposals.map((proposal) => {
                const signatureRows = getProposalSignatureRows(currentSelectedMultisig, proposal);
                const completedSignatureCount = signatureRows.filter(
                  (row) => row.hasApproved,
                ).length;
                const signaturesNeeded = Math.max(
                  currentSelectedMultisig.threshold - completedSignatureCount,
                  0,
                );
                const seenRecipients = new Set<string>();
                const hasDuplicatePayments = Boolean(
                  proposal.decodedBatch?.payments.some((payment) => {
                    const identity = payment.recipient.toLowerCase();
                    const isDuplicate = seenRecipients.has(identity);
                    seenRecipients.add(identity);
                    return isDuplicate;
                  }),
                );
                const hasAcknowledgedDuplicates = acknowledgedDuplicateProposals.has(proposal.id);
                const isThisApprovalPending =
                  (activeProposalAction?.proposalId === proposal.id &&
                    activeProposalAction.action === 'approve') ||
                  (isProposalActionAwaitingConfirmation &&
                    currentProposalAction?.proposalId === proposal.id &&
                    currentProposalAction.action === 'approve');
                const isThisCancellationPending =
                  (activeProposalAction?.proposalId === proposal.id &&
                    activeProposalAction.action === 'cancel') ||
                  (isProposalActionAwaitingConfirmation &&
                    currentProposalAction?.proposalId === proposal.id &&
                    currentProposalAction.action === 'cancel');
                const canApprove =
                  proposal.canApprove &&
                  (!hasDuplicatePayments || hasAcknowledgedDuplicates) &&
                  !hasWalletActionInFlight;
                const canCancel = proposal.canCancel && !hasWalletActionInFlight;

                return (
                  <div
                    key={`${currentSelectedMultisig.address}-${proposal.id}`}
                    className="py-3 text-sm"
                  >
                    <div className="flex justify-between gap-3">
                      <span className="font-semibold text-slate-900">Proposal #{proposal.id}</span>
                      <span className="text-slate-500">
                        {completedSignatureCount} / {currentSelectedMultisig.threshold}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-slate-500">
                      {truncateAddress(proposal.to)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatFilFromAtto(proposal.valueAttoFil)}
                    </p>
                    {proposal.decodedBatch && (
                      <div
                        className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2"
                        data-testid={`proposal-${proposal.id}-decoded-batch`}
                      >
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <p className="text-slate-400">Method</p>
                            <p className="font-semibold text-slate-800">
                              {proposal.decodedBatch.executionMethod === 'THINBATCH'
                                ? 'ThinBatch'
                                : 'Standard'}
                            </p>
                          </div>
                          <div>
                            <p className="text-slate-400">Error handling</p>
                            <p className="font-semibold text-slate-800">
                              {proposal.decodedBatch.errorMode === 'PARTIAL' ? 'Partial' : 'Atomic'}
                            </p>
                          </div>
                        </div>
                        <p className="mt-3 text-xs font-semibold text-slate-700">
                          {proposal.decodedBatch.recipientCount}{' '}
                          {proposal.decodedBatch.recipientCount === 1 ? 'payment' : 'payments'}
                        </p>
                        <div
                          className="mt-2 max-h-48 space-y-2 overflow-y-auto pr-1"
                          role="list"
                          aria-label={`Decoded payments for proposal #${proposal.id}`}
                        >
                          {proposal.decodedBatch.payments.map((payment) => (
                            <div
                              key={`${proposal.id}-${payment.index}`}
                              className="rounded-lg bg-slate-50 px-2 py-2"
                              role="listitem"
                            >
                              <div className="flex items-start justify-between gap-2 text-xs">
                                <span className="font-semibold text-slate-600">
                                  Payment #{payment.index + 1}
                                </span>
                                <span className="shrink-0 font-semibold text-slate-900">
                                  {formatExactFilFromAtto(payment.amountAttoFil)}
                                </span>
                              </div>
                              <code className="mt-1 block break-all text-[11px] leading-4 text-slate-500">
                                {payment.recipient}
                              </code>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {hasDuplicatePayments && (
                      <label className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 shrink-0 rounded border-amber-300"
                          checked={hasAcknowledgedDuplicates}
                          onChange={(event) => {
                            setAcknowledgedDuplicateProposals((current) => {
                              const next = new Set(current);

                              if (event.target.checked) {
                                next.add(proposal.id);
                              } else {
                                next.delete(proposal.id);
                              }

                              return next;
                            });
                          }}
                          aria-label={`Acknowledge duplicate payments in proposal #${proposal.id}`}
                        />
                        <span>
                          This proposal pays at least one recipient more than once. Confirm that
                          every duplicate payment is intentional before approving.
                        </span>
                      </label>
                    )}
                    <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="font-semibold text-slate-700">Signatures</span>
                        <span
                          className={
                            signaturesNeeded === 0
                              ? 'font-semibold text-emerald-700'
                              : 'font-semibold text-slate-500'
                          }
                        >
                          {signaturesNeeded === 0 ? 'Ready' : `${signaturesNeeded} needed`}
                        </span>
                      </div>
                      <div className="mt-2 space-y-1.5">
                        {signatureRows.map((row) => (
                          <div
                            key={`${proposal.id}-${row.signerIdAddress}`}
                            className="flex items-center justify-between gap-2"
                          >
                            <span className="min-w-0 truncate font-mono text-xs text-slate-500">
                              {truncateAddress(row.signer)}
                              {row.isConnectedSigner ? ' (you)' : ''}
                            </span>
                            <span
                              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                                row.hasApproved
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-slate-200 text-slate-500'
                              }`}
                            >
                              {row.hasApproved ? 'Signed' : 'Needed'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {!proposal.isSendFilCompatible && (
                      <p className="mt-2 text-xs text-amber-700">{proposal.compatibilityReason}</p>
                    )}
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          handleProposalAction(proposal, 'approve', hasAcknowledgedDuplicates)
                        }
                        disabled={!canApprove}
                        aria-label={`Approve proposal #${proposal.id}`}
                        className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ${
                          canApprove
                            ? 'bg-[#1f69ff] text-white hover:bg-[#1857d4]'
                            : 'cursor-not-allowed bg-slate-200 text-slate-500'
                        }`}
                      >
                        {isThisApprovalPending ? 'Approving...' : 'Approve'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleProposalAction(proposal, 'cancel')}
                        disabled={!canCancel}
                        aria-label={`Cancel proposal #${proposal.id}`}
                        className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ${
                          canCancel
                            ? 'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                            : 'cursor-not-allowed border border-slate-200 bg-slate-50 text-slate-400'
                        }`}
                      >
                        {isThisCancellationPending ? 'Cancelling...' : 'Cancel'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <div className="grid grid-cols-2 rounded-full border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              onClick={() => setMode('add')}
              disabled={hasWalletActionInFlight}
              data-testid="multisig-mode-add"
              className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${
                mode === 'add'
                  ? 'bg-white text-[#124ac4] shadow-sm'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setMode('create')}
              disabled={hasWalletActionInFlight}
              data-testid="multisig-mode-create"
              className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${
                mode === 'create'
                  ? 'bg-white text-[#124ac4] shadow-sm'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Create
            </button>
          </div>

          {mode === 'add' ? (
            <div className="mt-3 space-y-2">
              <input
                value={importAddress}
                onChange={(event) => setImportAddress(event.target.value)}
                placeholder={expectedPrefix}
                aria-label="Multisig address"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 placeholder:text-slate-300 focus:border-[#1f69ff] focus:outline-none focus:ring-2 focus:ring-[#1f69ff]/20"
              />
              <input
                value={importLabel}
                onChange={(event) => setImportLabel(event.target.value)}
                placeholder="Label"
                aria-label="Multisig label"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-300 focus:border-[#1f69ff] focus:outline-none focus:ring-2 focus:ring-[#1f69ff]/20"
              />
              <button
                type="button"
                onClick={handleAdd}
                disabled={!canAddMultisig || isAdding || hasWalletActionInFlight}
                className={`w-full rounded-xl px-3 py-2 text-sm font-semibold ${
                  canAddMultisig && !isAdding && !hasWalletActionInFlight
                    ? 'border border-[#1f69ff]/35 bg-white text-[#124ac4] hover:border-[#1f69ff]'
                    : 'cursor-not-allowed bg-slate-200 text-slate-500'
                }`}
              >
                {isAdding ? 'Adding...' : 'Add multisig'}
              </button>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {createValues.signers.map((signer, index) => (
                <div key={`create-signer-${index}`} className="flex gap-2">
                  <input
                    value={signer}
                    onChange={(event) => updateSigner(index, event.target.value)}
                    placeholder={expectedSignerPrefix}
                    aria-label={`Signer ${index + 1}`}
                    className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 placeholder:text-slate-300 focus:border-[#1f69ff] focus:outline-none focus:ring-2 focus:ring-[#1f69ff]/20"
                  />
                  {createValues.signers.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSigner(index)}
                      className="h-10 w-10 rounded-xl border border-slate-200 bg-slate-50 text-slate-500 hover:text-slate-900"
                      aria-label={`Remove signer ${index + 1}`}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={addSigner}
                className="text-sm font-semibold text-[#124ac4]"
              >
                + Add signer
              </button>
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                  <span>Signatures required</span>
                  <span className="shrink-0 text-slate-500">
                    {createValues.threshold} of {createValues.signers.length}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min={1}
                    max={createValues.signers.length}
                    step={1}
                    value={createValues.threshold}
                    onChange={(event) =>
                      setCreateValues((current) => ({
                        ...current,
                        threshold: Number(event.target.value),
                      }))
                    }
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-[#1f69ff] focus:outline-none focus:ring-2 focus:ring-[#1f69ff]/20"
                    aria-label="Signatures required"
                  />
                  <input
                    value={createValues.initialDepositFil}
                    onChange={(event) =>
                      setCreateValues((current) => ({
                        ...current,
                        initialDepositFil: event.target.value,
                      }))
                    }
                    placeholder="Deposit FIL"
                    aria-label="Initial deposit"
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-300 focus:border-[#1f69ff] focus:outline-none focus:ring-2 focus:ring-[#1f69ff]/20"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={handleCreate}
                disabled={!canCreateMultisig || hasWalletActionInFlight}
                className={`w-full rounded-xl px-3 py-2 text-sm font-semibold ${
                  canCreateMultisig && !hasWalletActionInFlight
                    ? 'bg-[#1f69ff] text-white hover:bg-[#1857d4]'
                    : 'cursor-not-allowed bg-slate-200 text-slate-500'
                }`}
              >
                {isCreating
                  ? 'Creating...'
                  : canCreateMultisig
                    ? 'Create multisig'
                    : 'Connect signer to create'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
