import {
  type SendFilFeePolicy,
  type SendFilNetworkConfig,
  getNetworkConfig,
  getSupportedNetworkByChainId,
} from '../lib/networks';
import { validateRecipientRows } from './recipientValidation';
import { normalizeToEvmAddress } from './addressEncoder';

export interface Recipient {
  address: string;
  amount: number;
}

export interface AttoFeePayment {
  address: string;
  amountAttoFil: bigint;
}

const ATTOFIL_PER_FIL = 10n ** 18n;
const ATTOFIL_PER_MICROFIL = 10n ** 12n;

function recipientIdentity(address: string): string {
  return normalizeToEvmAddress(address)?.toLowerCase() ?? address.trim();
}

function decimalNumberToRatio(
  value: number,
  label: string,
): {
  numerator: bigint;
  denominator: bigint;
} {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative finite number.`);
  }

  const match = value.toString().match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);

  if (!match) {
    throw new Error(`${label} could not be represented exactly.`);
  }

  const fraction = match[2] ?? '';
  const exponent = Number(match[3] ?? '0') - fraction.length;
  const digits = BigInt(`${match[1]}${fraction}`);

  return exponent >= 0
    ? { numerator: digits * 10n ** BigInt(exponent), denominator: 1n }
    : { numerator: digits, denominator: 10n ** BigInt(-exponent) };
}

function filNumberToAttoFil(value: number): bigint {
  const ratio = decimalNumberToRatio(value, 'Recipient amount');
  return (ratio.numerator * ATTOFIL_PER_FIL) / ratio.denominator;
}

function validateFeePolicy(
  feePolicy: SendFilFeePolicy,
  nativePrefix: SendFilNetworkConfig['nativePrefix'],
): asserts feePolicy is SendFilFeePolicy & {
  recipientA: string;
  recipientB: string;
} {
  if (!feePolicy.recipientA || !feePolicy.recipientB) {
    throw new Error(
      'SendFIL fee settings are unavailable for this network. Please try again later.',
    );
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
      `SendFIL fee settings need attention before this batch can be sent: ${validation.errors
        .map((error) => error.replace(/^Recipient \d+:\s*/, ''))
        .join('; ')}`,
    );
  }

  const percent = decimalNumberToRatio(feePolicy.percent, 'Fee percent');
  const split = decimalNumberToRatio(feePolicy.split, 'Fee split');

  if (percent.numerator < 0n || split.numerator > split.denominator) {
    throw new Error('SendFIL fee settings need attention before this batch can be sent.');
  }
}

export function calculateFeePaymentsAttoFil(
  recipientTotalAttoFil: bigint,
  network: Pick<SendFilNetworkConfig, 'feePolicy' | 'nativePrefix'>,
): AttoFeePayment[] {
  const feePolicy = network.feePolicy;

  if (!feePolicy.enabled) {
    return [];
  }

  validateFeePolicy(feePolicy, network.nativePrefix);

  if (recipientTotalAttoFil < 0n) {
    throw new Error('Recipient total must be nonnegative.');
  }

  const percent = decimalNumberToRatio(feePolicy.percent, 'Fee percent');
  const split = decimalNumberToRatio(feePolicy.split, 'Fee split');
  const percentDenominator = 100n * percent.denominator;
  const feeAUntruncated =
    (recipientTotalAttoFil * percent.numerator * split.numerator) /
    (percentDenominator * split.denominator);
  const feeBUntruncated =
    (recipientTotalAttoFil * percent.numerator * (split.denominator - split.numerator)) /
    (percentDenominator * split.denominator);
  const feeA = (feeAUntruncated / ATTOFIL_PER_MICROFIL) * ATTOFIL_PER_MICROFIL;
  const feeB = (feeBUntruncated / ATTOFIL_PER_MICROFIL) * ATTOFIL_PER_MICROFIL;

  return [
    { address: feePolicy.recipientA, amountAttoFil: feeA },
    { address: feePolicy.recipientB, amountAttoFil: feeB },
  ].filter((payment) => payment.amountAttoFil > 0n);
}

export function getFeePolicyForNetwork(chainId?: number): SendFilFeePolicy {
  return getSupportedNetworkByChainId(chainId)?.feePolicy ?? getNetworkConfig('mainnet').feePolicy;
}

export function getFeeLabel(chainId?: number): string {
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
        recipientIdentity(recipient.address) === recipientIdentity(feePolicy.recipientA) ||
        recipientIdentity(recipient.address) === recipientIdentity(feePolicy.recipientB),
    )
  ) {
    throw new Error('One recipient is already used by SendFIL fees. Remove it to continue.');
  }

  const totalAttoFil = recipients.reduce(
    (sum, recipient) => sum + filNumberToAttoFil(recipient.amount),
    0n,
  );
  const feePayments = calculateFeePaymentsAttoFil(totalAttoFil, network);

  return [
    ...recipients,
    ...feePayments.map((payment) => ({
      address: payment.address,
      amount: Number(payment.amountAttoFil) / 1e18,
    })),
  ];
}
