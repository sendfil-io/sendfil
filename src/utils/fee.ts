import {
  type SendFilFeePolicy,
  type SendFilNetworkConfig,
  getNetworkConfig,
  getSupportedNetworkByChainId,
} from '../lib/networks';
import { validateRecipientRows } from './recipientValidation';

export interface Recipient {
  address: string;
  amount: number;
}

function validateFeePolicy(
  feePolicy: SendFilFeePolicy,
  nativePrefix: SendFilNetworkConfig['nativePrefix'],
): asserts feePolicy is SendFilFeePolicy & {
  recipientA: string;
  recipientB: string;
} {
  if (!feePolicy.recipientA || !feePolicy.recipientB) {
    throw new Error('Fee addresses are not configured for the active network');
  }

  const validation = validateRecipientRows(
    [
      { address: feePolicy.recipientA, amount: '1' },
      { address: feePolicy.recipientB, amount: '1' },
    ],
    {
      source: 'manual',
      expectedNetworkPrefix: nativePrefix,
      maxRecipients: 2,
    },
  );

  if (validation.errors.length > 0) {
    throw new Error(
      `Invalid fee address configuration: ${validation.errors
        .map((error) => error.replace(/^Recipient \d+:\s*/, ''))
        .join('; ')}`,
    );
  }
}

export function getFeePolicyForNetwork(
  chainId?: number,
): SendFilFeePolicy {
  return getSupportedNetworkByChainId(chainId)?.feePolicy ?? getNetworkConfig('mainnet').feePolicy;
}

export function getFeeLabel(
  chainId?: number,
): string {
  const network = getSupportedNetworkByChainId(chainId);
  const feePolicy = network?.feePolicy;

  if (network?.isTestnet && feePolicy && !feePolicy.enabled) {
    return 'Platform fee (disabled on testnet)';
  }

  return `Platform fee (${(feePolicy ?? getNetworkConfig('mainnet').feePolicy).percent}%)`;
}

export function calculateFeeRows(
  recipients: Recipient[],
  network: Pick<SendFilNetworkConfig, 'feePolicy' | 'nativePrefix'>,
): Recipient[] {
  const feePolicy = network.feePolicy;

  if (!feePolicy.enabled) {
    return recipients;
  }

  validateFeePolicy(feePolicy, network.nativePrefix);

  if (
    recipients.some(
      (recipient) =>
        recipient.address === feePolicy.recipientA || recipient.address === feePolicy.recipientB,
    )
  ) {
    throw new Error('Fee address included in recipient list');
  }

  const total = recipients.reduce((sum, recipient) => sum + recipient.amount, 0);
  const feeTotal = (total * feePolicy.percent) / 100;
  const feeA = Math.floor(feeTotal * feePolicy.split * 1e6) / 1e6;
  const feeB = Math.floor(feeTotal * (1 - feePolicy.split) * 1e6) / 1e6;

  return [
    ...recipients,
    { address: feePolicy.recipientA, amount: feeA },
    { address: feePolicy.recipientB, amount: feeB },
  ];
}
