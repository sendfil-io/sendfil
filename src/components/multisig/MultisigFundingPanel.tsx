import * as React from 'react';
import type { NativeFilecoinConnectedSender } from '../../lib/senders';
import type { SendFilNetworkConfig } from '../../lib/networks';
import type {
  CreateMultisigFormValues,
  MultisigActorState,
  MultisigPendingProposal,
  NativeMultisigAddress,
  SavedMultisig,
} from '../../lib/multisig';
import { getProposalSignatureRows } from './signatureStatus';

interface MultisigFundingPanelProps {
  enabled: boolean;
  network?: SendFilNetworkConfig;
  connectedSigner?: NativeFilecoinConnectedSender;
  savedMultisigs: SavedMultisig[];
  selectedAddress?: NativeMultisigAddress;
  selectedMultisig?: MultisigActorState;
  pendingProposals: MultisigPendingProposal[];
  isLoadingSelected: boolean;
  selectedError?: string;
  onSelect: (address?: NativeMultisigAddress) => void;
  onAdd: (address: string, label?: string) => Promise<SavedMultisig>;
  onRemove: (address: NativeMultisigAddress) => void;
  onCreate: (values: CreateMultisigFormValues) => Promise<{ cid: string }>;
  onApprove: (proposal: MultisigPendingProposal) => Promise<string>;
  onCancel: (proposal: MultisigPendingProposal) => Promise<string>;
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
  network,
  connectedSigner,
  savedMultisigs,
  selectedAddress,
  selectedMultisig,
  pendingProposals,
  isLoadingSelected,
  selectedError,
  onSelect,
  onAdd,
  onRemove,
  onCreate,
  onApprove,
  onCancel,
}: MultisigFundingPanelProps) {
  const [importAddress, setImportAddress] = React.useState('');
  const [importLabel, setImportLabel] = React.useState('');
  const [formError, setFormError] = React.useState<string | undefined>();
  const [actionStatus, setActionStatus] = React.useState<string | undefined>();
  const [isCreating, setIsCreating] = React.useState(false);
  const [isAdding, setIsAdding] = React.useState(false);
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

  React.useEffect(() => {
    setCreateValues(createDefaultCreateValues(connectedSignerAddress));
  }, [connectedSignerAddress]);

  React.useEffect(() => {
    setFormError(undefined);
    setActionStatus(undefined);
  }, [connectedSignerAddress, mode, network?.key]);

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
    setFormError(undefined);
    setActionStatus(undefined);
    setIsAdding(true);

    try {
      await onAdd(importAddress, importLabel.trim() || undefined);
      setImportAddress('');
      setImportLabel('');
      setActionStatus('Multisig saved locally.');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to add multisig.');
    } finally {
      setIsAdding(false);
    }
  };

  const handleCreate = async () => {
    setFormError(undefined);
    setActionStatus(undefined);
    setIsCreating(true);

    try {
      const result = await onCreate(createValues);
      setActionStatus(`Create submitted: ${truncateAddress(result.cid)}.`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to create multisig.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleProposalAction = async (
    proposal: MultisigPendingProposal,
    action: 'approve' | 'cancel',
  ) => {
    setFormError(undefined);
    setActionStatus(undefined);

    try {
      const cid = action === 'approve' ? await onApprove(proposal) : await onCancel(proposal);
      setActionStatus(
        `${action === 'approve' ? 'Approval' : 'Cancel'} submitted: ${truncateAddress(cid)}.`,
      );
    } catch (error) {
      setFormError(error instanceof Error ? error.message : `Failed to ${action} proposal.`);
    }
  };

  const expectedPrefix = network?.nativePrefix === 't' ? 't2...' : 'f2...';
  const expectedSignerPrefix = network?.nativePrefix === 't' ? 't1...' : 'f1...';

  return (
    <div className="mt-4 border-t border-slate-100 pt-4" data-testid="multisig-funding-panel">
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
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {formError}
          </div>
        )}

        {actionStatus && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {actionStatus}
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
                  className="text-xs font-semibold text-slate-500 hover:text-slate-900"
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
                      className="min-w-0 flex-1 text-left"
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
                      className="shrink-0 text-xs font-semibold text-slate-400 hover:text-red-700"
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
            </div>

            {isLoadingSelected ? (
              <p className="mt-3 text-sm text-slate-500">Loading multisig state...</p>
            ) : selectedError ? (
              <p className="mt-3 text-sm text-red-700">{selectedError}</p>
            ) : selectedMultisig ? (
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <div>
                  <dt className="text-slate-500">Spendable</dt>
                  <dd className="mt-0.5 font-semibold text-slate-900">
                    {formatFilFromAtto(selectedMultisig.availableBalanceAttoFil)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Threshold</dt>
                  <dd className="mt-0.5 font-semibold text-slate-900">
                    {selectedMultisig.threshold} / {selectedMultisig.signers.length}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Balance</dt>
                  <dd className="mt-0.5 font-semibold text-slate-900">
                    {formatFilFromAtto(selectedMultisig.balanceAttoFil)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Signer</dt>
                  <dd
                    className={`mt-0.5 font-semibold ${
                      selectedMultisig.connectedSignerCanApprove
                        ? 'text-emerald-700'
                        : 'text-red-700'
                    }`}
                  >
                    {selectedMultisig.connectedSignerCanApprove ? 'Member' : 'Not member'}
                  </dd>
                </div>
              </dl>
            ) : null}
          </div>
        )}

        {selectedMultisig && pendingProposals.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
              Pending
            </p>
            <div className="mt-2 divide-y divide-slate-100 border-y border-slate-100">
              {pendingProposals.map((proposal) => {
                const signatureRows = getProposalSignatureRows(selectedMultisig, proposal);
                const completedSignatureCount = signatureRows.filter(
                  (row) => row.hasApproved,
                ).length;
                const signaturesNeeded = Math.max(
                  selectedMultisig.threshold - completedSignatureCount,
                  0,
                );

                return (
                  <div key={`${selectedMultisig.address}-${proposal.id}`} className="py-3 text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="font-semibold text-slate-900">Proposal #{proposal.id}</span>
                      <span className="text-slate-500">
                        {completedSignatureCount} / {selectedMultisig.threshold}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-slate-500">
                      {truncateAddress(proposal.to)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatFilFromAtto(proposal.valueAttoFil)}
                    </p>
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
                        onClick={() => handleProposalAction(proposal, 'approve')}
                        disabled={!proposal.canApprove}
                        className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ${
                          proposal.canApprove
                            ? 'bg-[#1f69ff] text-white hover:bg-[#1857d4]'
                            : 'cursor-not-allowed bg-slate-200 text-slate-500'
                        }`}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => handleProposalAction(proposal, 'cancel')}
                        disabled={!proposal.canCancel}
                        className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ${
                          proposal.canCancel
                            ? 'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                            : 'cursor-not-allowed border border-slate-200 bg-slate-50 text-slate-400'
                        }`}
                      >
                        Cancel
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
                disabled={!canAddMultisig || isAdding}
                className={`w-full rounded-xl px-3 py-2 text-sm font-semibold ${
                  canAddMultisig && !isAdding
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
                  aria-label="Threshold"
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
              <button
                type="button"
                onClick={handleCreate}
                disabled={!canCreateMultisig || isCreating}
                className={`w-full rounded-xl px-3 py-2 text-sm font-semibold ${
                  canCreateMultisig && !isCreating
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
