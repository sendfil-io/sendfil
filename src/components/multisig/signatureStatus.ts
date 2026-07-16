import type { MultisigActorState, MultisigPendingProposal } from '../../lib/multisig';

export interface ProposalSignatureRow {
  signer: string;
  signerIdAddress: string;
  hasApproved: boolean;
  isConnectedSigner: boolean;
}

export function getProposalSignatureRows(
  multisig: MultisigActorState,
  proposal: MultisigPendingProposal,
): ProposalSignatureRow[] {
  const approvalAddresses = new Set(proposal.approvals);
  const approvalIdAddresses = new Set(proposal.approvalIdAddresses);

  return multisig.signers.map((signer, index) => {
    const signerIdAddress = multisig.signerIdAddresses[index] ?? signer;
    const hasApproved =
      approvalAddresses.has(signer) ||
      approvalAddresses.has(signerIdAddress) ||
      approvalIdAddresses.has(signerIdAddress);
    const isConnectedSigner = Boolean(
      multisig.connectedSignerIdAddress && signerIdAddress === multisig.connectedSignerIdAddress,
    );

    return {
      signer,
      signerIdAddress,
      hasApproved,
      isConnectedSigner,
    };
  });
}
