import {
  type SendFilFeePolicy,
  type SendFilNetworkConfig,
  getNetworkConfig,
  getSupportedNetworkByChainId,
} from '../lib/networks';
import {
  ATTO_FIL_PER_FIL,
  attoFilToFilDecimal,
  decimalNumberToScaledBigInt,
  filDecimalToAttoFil,
  truncateAttoFilToMicroFil,
} from './filAmount';
import { validateRecipientRows } from './recipientValidation';

export interface Recipient {
  address: string;
  amount: number;
}

export interface ExactRecipient {
  address: string;
  amount: string;
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
  return calculateExactFeeRows(
    recipients.map((recipient) => ({
      address: recipient.address,
      amount: recipient.amount.toString(),
    })),
    network,
  ).map((recipient) => ({
    address: recipient.address,
    amount: Number(recipient.amount),
  }));
}

export function calculateExactFeeRows(
  recipients: ExactRecipient[],
  network: Pick<SendFilNetworkConfig, 'feePolicy' | 'nativePrefix'>,
): ExactRecipient[] {
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

  const totalAttoFil = recipients.reduce(
    (sum, recipient) => sum + filDecimalToAttoFil(recipient.amount),
    0n,
  );
  const percent = decimalNumberToScaledBigInt(feePolicy.percent, 18);
  const split = decimalNumberToScaledBigInt(feePolicy.split, 18);
  const feeTotalAttoFil = (totalAttoFil * percent) / (100n * ATTO_FIL_PER_FIL);
  const feeAAttoFil = truncateAttoFilToMicroFil(
    (feeTotalAttoFil * split) / ATTO_FIL_PER_FIL,
  );
  const feeBAttoFil = truncateAttoFilToMicroFil(
    (feeTotalAttoFil * (ATTO_FIL_PER_FIL - split)) / ATTO_FIL_PER_FIL,
  );

  return [
    ...recipients,
    { address: feePolicy.recipientA, amount: attoFilToFilDecimal(feeAAttoFil) },
    { address: feePolicy.recipientB, amount: attoFilToFilDecimal(feeBAttoFil) },
  ];
}
