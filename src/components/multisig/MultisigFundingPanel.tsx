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

function createDefaultCreateValues(
  connectedSignerAddress?: string,
): CreateMultisigFormValues {
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
  const connectedSignerAddress = connectedSigner?.address;
  const [createValues, setCreateValues] = React.useState<CreateMultisigFormValues>(() =>
    createDefaultCreateValues(connectedSignerAddress),
  );

  React.useEffect(() => {
    setCreateValues(createDefaultCreateValues(connectedSignerAddress));
  }, [connectedSignerAddress]);

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
      const cid =
        action === 'approve'
          ? await onApprove(proposal)
          : await onCancel(proposal);
      setActionStatus(`${action === 'approve' ? 'Approval' : 'Cancel'} submitted: ${truncateAddress(cid)}.`);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : `Failed to ${action} proposal.`,
      );
    }
  };

  const expectedPrefix = network?.nativePrefix === 't' ? 't2...' : 'f2...';
  const expectedSignerPrefix = network?.nativePrefix === 't' ? 't1...' : 'f1...';

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">Native multisig</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {enabled
              ? 'Use an f2/t2 multisig as the funding source.'
              : 'Connect a native Filecoin signer to use multisig funding.'}
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          {network?.walletLabel ?? 'No network'}
        </span>
      </div>

      {formError && (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {formError}
        </div>
      )}

      {actionStatus && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {actionStatus}
        </div>
      )}

      <div className="mt-4 space-y-2">
        <button
          type="button"
          onClick={() => onSelect(undefined)}
          className={`w-full rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
            selectedAddress
              ? 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-white'
              : 'border-[#1f69ff] bg-[#eef4ff] font-semibold text-[#124ac4]'
          }`}
        >
          Connected signer funds batch
        </button>

        {savedMultisigs.map((multisig) => (
          <div
            key={multisig.address}
            className={`rounded-xl border px-3 py-2 ${
              selectedAddress === multisig.address
                ? 'border-[#1f69ff] bg-[#eef4ff]'
                : 'border-slate-200 bg-slate-50'
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(multisig.address)}
              className="block w-full text-left"
            >
              <span className="block text-sm font-semibold text-slate-900">
                {multisig.label || truncateAddress(multisig.address)}
              </span>
              <span className="mt-1 block font-mono text-xs text-slate-500">
                {multisig.address}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onRemove(multisig.address)}
              className="mt-2 text-xs font-semibold text-slate-500 hover:text-red-700"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      {selectedAddress && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
          {isLoadingSelected ? (
            <p className="text-sm text-slate-500">Loading multisig state...</p>
          ) : selectedError ? (
            <p className="text-sm text-red-700">{selectedError}</p>
          ) : selectedMultisig ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">Balance</span>
                <span className="font-semibold text-slate-900">
                  {formatFilFromAtto(selectedMultisig.balanceAttoFil)}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">Spendable</span>
                <span className="font-semibold text-slate-900">
                  {formatFilFromAtto(selectedMultisig.availableBalanceAttoFil)}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">Threshold</span>
                <span className="font-semibold text-slate-900">
                  {selectedMultisig.threshold} / {selectedMultisig.signers.length}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">Signer</span>
                <span
                  className={
                    selectedMultisig.connectedSignerCanApprove
                      ? 'font-semibold text-emerald-700'
                      : 'font-semibold text-red-700'
                  }
                >
                  {selectedMultisig.connectedSignerCanApprove ? 'Member' : 'Not a member'}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {selectedMultisig && pendingProposals.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            Pending proposals
          </p>
          {pendingProposals.map((proposal) => (
            <div
              key={`${selectedMultisig.address}-${proposal.id}`}
              className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm"
            >
              <div className="flex justify-between gap-3">
                <span className="font-semibold text-slate-900">#{proposal.id}</span>
                <span className="text-slate-500">
                  {proposal.approvals.length} / {selectedMultisig.threshold}
                </span>
              </div>
              <p className="mt-1 font-mono text-xs text-slate-500">
                {truncateAddress(proposal.to)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {formatFilFromAtto(proposal.valueAttoFil)}
              </p>
              {!proposal.isSendFilCompatible && (
                <p className="mt-2 text-xs text-amber-700">
                  {proposal.compatibilityReason}
                </p>
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
          ))}
        </div>
      )}

      <div className="mt-4 border-t border-slate-100 pt-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
          Add saved multisig
        </p>
        <div className="mt-2 space-y-2">
          <input
            value={importAddress}
            onChange={(event) => setImportAddress(event.target.value)}
            placeholder={expectedPrefix}
            disabled={!enabled}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 placeholder:text-slate-300 focus:border-[#1f69ff] focus:outline-none focus:ring-2 focus:ring-[#1f69ff]/20 disabled:cursor-not-allowed disabled:bg-slate-100"
          />
          <input
            value={importLabel}
            onChange={(event) => setImportLabel(event.target.value)}
            placeholder="Label"
            disabled={!enabled}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-300 focus:border-[#1f69ff] focus:outline-none focus:ring-2 focus:ring-[#1f69ff]/20 disabled:cursor-not-allowed disabled:bg-slate-100"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!enabled || isAdding}
            className={`w-full rounded-xl px-3 py-2 text-sm font-semibold ${
              enabled && !isAdding
                ? 'border border-[#1f69ff]/35 bg-white text-[#124ac4] hover:border-[#1f69ff]'
                : 'cursor-not-allowed bg-slate-200 text-slate-500'
            }`}
          >
            {isAdding ? 'Adding...' : 'Add multisig'}
          </button>
        </div>
      </div>

      <div className="mt-4 border-t border-slate-100 pt-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
          Create multisig
        </p>
        <div className="mt-2 space-y-2">
          {createValues.signers.map((signer, index) => (
            <div key={`create-signer-${index}`} className="flex gap-2">
              <input
                value={signer}
                onChange={(event) => updateSigner(index, event.target.value)}
                placeholder={expectedSignerPrefix}
                disabled={!enabled}
                className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 placeholder:text-slate-300 focus:border-[#1f69ff] focus:outline-none focus:ring-2 focus:ring-[#1f69ff]/20 disabled:cursor-not-allowed disabled:bg-slate-100"
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
            disabled={!enabled}
            className="text-sm font-semibold text-[#124ac4] disabled:text-slate-400"
          >
            + Add signer
          </button>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              min={1}
              step={1}
              value={createValues.threshold}
              onChange={(event) =>
                setCreateValues((current) => ({
                  ...current,
                  threshold: Number(event.target.value),
                }))
              }
              disabled={!enabled}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-[#1f69ff] focus:outline-none focus:ring-2 focus:ring-[#1f69ff]/20 disabled:cursor-not-allowed disabled:bg-slate-100"
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
              disabled={!enabled}
              placeholder="Deposit FIL"
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-300 focus:border-[#1f69ff] focus:outline-none focus:ring-2 focus:ring-[#1f69ff]/20 disabled:cursor-not-allowed disabled:bg-slate-100"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              min={0}
              step={1}
              value={createValues.startEpoch ?? ''}
              onChange={(event) =>
                setCreateValues((current) => ({
                  ...current,
                  startEpoch:
                    event.target.value === '' ? undefined : Number(event.target.value),
                }))
              }
              disabled={!enabled}
              placeholder="Start epoch"
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-300 focus:border-[#1f69ff] focus:outline-none focus:ring-2 focus:ring-[#1f69ff]/20 disabled:cursor-not-allowed disabled:bg-slate-100"
            />
            <input
              type="number"
              min={0}
              step={1}
              value={createValues.unlockDuration ?? ''}
              onChange={(event) =>
                setCreateValues((current) => ({
                  ...current,
                  unlockDuration:
                    event.target.value === '' ? undefined : Number(event.target.value),
                }))
              }
              disabled={!enabled}
              placeholder="Unlock duration"
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-300 focus:border-[#1f69ff] focus:outline-none focus:ring-2 focus:ring-[#1f69ff]/20 disabled:cursor-not-allowed disabled:bg-slate-100"
            />
          </div>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!enabled || isCreating}
            className={`w-full rounded-xl px-3 py-2 text-sm font-semibold ${
              enabled && !isCreating
                ? 'bg-[#1f69ff] text-white hover:bg-[#1857d4]'
                : 'cursor-not-allowed bg-slate-200 text-slate-500'
            }`}
          >
            {isCreating ? 'Creating...' : 'Create multisig'}
          </button>
        </div>
      </div>
    </div>
  );
}
