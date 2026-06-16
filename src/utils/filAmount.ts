export const ATTO_FIL_PER_FIL = 1_000_000_000_000_000_000n;
export const MICRO_FIL_IN_ATTO_FIL = 1_000_000_000_000n;

function normalizeDecimalInput(value: string): string {
  const trimmed = value.trim();

  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
    throw new Error('Amount must be a non-negative decimal string');
  }

  return trimmed;
}

export function decimalStringToScaledBigInt(
  value: string,
  decimals: number,
): bigint {
  const normalized = normalizeDecimalInput(value);
  const [whole, decimal = ''] = normalized.split('.');

  if (decimal.length > decimals) {
    throw new Error(`Amount has more than ${decimals} decimal places`);
  }

  return BigInt(`${whole}${decimal.padEnd(decimals, '0')}`);
}

export function decimalNumberToScaledBigInt(
  value: number,
  decimals: number,
): bigint {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Amount must be a finite non-negative number');
  }

  const decimalString = value.toString().includes('e')
    ? value.toFixed(decimals).replace(/\.?0+$/, '')
    : value.toString();

  return decimalStringToScaledBigInt(decimalString, decimals);
}

export function filDecimalToAttoFil(amount: string): bigint {
  return decimalStringToScaledBigInt(amount, 18);
}

export function attoFilToFilDecimal(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absoluteValue = value < 0n ? -value : value;
  const whole = absoluteValue / ATTO_FIL_PER_FIL;
  const decimal = absoluteValue % ATTO_FIL_PER_FIL;

  if (decimal === 0n) {
    return `${sign}${whole.toString()}`;
  }

  return `${sign}${whole.toString()}.${decimal
    .toString()
    .padStart(18, '0')
    .replace(/0+$/, '')}`;
}

export function attoFilToFilNumber(value: bigint): number {
  return Number(value) / Number(ATTO_FIL_PER_FIL);
}

export function truncateAttoFilToMicroFil(value: bigint): bigint {
  return (value / MICRO_FIL_IN_ATTO_FIL) * MICRO_FIL_IN_ATTO_FIL;
}
