import { describe, expect, it } from 'vitest';
import type { MultisigActorState, MultisigPendingProposal } from '../../../lib/multisig';
import { getProposalSignatureRows } from '../signatureStatus';

const multisig: MultisigActorState = {
  address: 't2multisig',
  networkKey: 'calibration',
  balanceAttoFil: 0n,
  availableBalanceAttoFil: 0n,
  threshold: 2,
  signers: ['t1signer-a', 't1signer-b', 't1signer-c'],
  signerIdAddresses: ['t01001', 't01002', 't01003'],
  connectedSignerIdAddress: 't01002',
  connectedSignerCanApprove: true,
  pendingProposalCount: 1,
};

const proposal: MultisigPendingProposal = {
  id: 7,
  proposer: 't01001',
  proposerIdAddress: 't01001',
  to: 't410ftarget',
  valueAttoFil: 100n,
  method: 3_844_450_837,
  paramsBase64: '',
  paramsBytes: new Uint8Array(),
  approvals: ['t01001'],
  approvalIdAddresses: ['t01001'],
  connectedSignerHasApproved: false,
  isSendFilCompatible: true,
  canApprove: true,
  canCancel: false,
};

describe('MultisigFundingPanel signer status', () => {
  it('maps proposal approvals onto multisig signers by ID address', () => {
    const rows = getProposalSignatureRows(multisig, proposal);

    expect(rows).toEqual([
      expect.objectContaining({
        signer: 't1signer-a',
        signerIdAddress: 't01001',
        hasApproved: true,
        isConnectedSigner: false,
      }),
      expect.objectContaining({
        signer: 't1signer-b',
        signerIdAddress: 't01002',
        hasApproved: false,
        isConnectedSigner: true,
      }),
      expect.objectContaining({
        signer: 't1signer-c',
        signerIdAddress: 't01003',
        hasApproved: false,
        isConnectedSigner: false,
      }),
    ]);
  });
});
