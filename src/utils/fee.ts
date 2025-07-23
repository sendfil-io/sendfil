export interface Recipient {
  address: string;
  amount: number;
}

export function calculateFeeRows(
  recipients: Recipient[],
): Recipient[] {
  const FEE_PERCENT = Number(import.meta.env.VITE_FEE_PERCENT) || 1;
  const FEE_SPLIT = Number(import.meta.env.VITE_FEE_SPLIT) || 0.5;
  const FEE_ADDR_A = import.meta.env.VITE_FEE_ADDR_A as string;
  const FEE_ADDR_B = import.meta.env.VITE_FEE_ADDR_B as string;

  if (recipients.some(r => r.address === FEE_ADDR_A || r.address === FEE_ADDR_B)) {
    throw new Error('Fee address included in recipient list');
  }

  const total = recipients.reduce((sum, r) => sum + r.amount, 0);
  const feeTotal = (total * FEE_PERCENT) / 100;
  const feeA = Math.floor(feeTotal * FEE_SPLIT * 1e6) / 1e6;
  const feeB = Math.floor(feeTotal * (1 - FEE_SPLIT) * 1e6) / 1e6;

  return [
    ...recipients,
    { address: FEE_ADDR_A, amount: feeA },
    { address: FEE_ADDR_B, amount: feeB },
  ];
}
