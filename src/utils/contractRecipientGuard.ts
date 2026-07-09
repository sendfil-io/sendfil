import {
  getAddressType,
  normalizeToEvmAddress,
} from './addressEncoder';

export interface ContractRecipientCandidate {
  address: string;
}

export interface ContractCodeClient {
  getCode: (parameters: { address: `0x${string}` }) => Promise<`0x${string}` | undefined>;
}

function getRecipientLabel(
  inputAddress: string,
  normalizedAddress: `0x${string}`,
): string {
  const trimmedAddress = inputAddress.trim();

  return trimmedAddress.startsWith('0x')
    ? inputAddress
    : `${trimmedAddress} (${normalizedAddress})`;
}

export async function validateNoEvmContractRecipients(
  recipients: ContractRecipientCandidate[],
  client: ContractCodeClient | undefined,
): Promise<string[]> {
  const evmRecipients = new Map<`0x${string}`, Set<string>>();

  recipients.forEach((recipient) => {
    if (getAddressType(recipient.address) !== 'evm') {
      return;
    }

    const normalizedAddress = normalizeToEvmAddress(recipient.address);

    if (!normalizedAddress) {
      return;
    }

    const labels = evmRecipients.get(normalizedAddress) ?? new Set<string>();
    labels.add(getRecipientLabel(recipient.address, normalizedAddress));
    evmRecipients.set(normalizedAddress, labels);
  });

  if (evmRecipients.size === 0) {
    return [];
  }

  if (!client) {
    return [
      'Could not verify whether 0x or f4 recipients are contract addresses. Check the network connection and retry.',
    ];
  }

  const errors: string[] = [];

  for (const [address, labels] of evmRecipients.entries()) {
    let code: `0x${string}` | undefined;

    try {
      code = await client.getCode({ address });
    } catch (error) {
      return [
        error instanceof Error && error.message.length > 0
          ? `Could not verify whether 0x or f4 recipients are contract addresses: ${error.message}`
          : 'Could not verify whether 0x or f4 recipients are contract addresses. Check the network connection and retry.',
      ];
    }

    if (code && code !== '0x') {
      errors.push(
        `EVM contract recipients are not supported: ${Array.from(labels).join(', ')}.`,
      );
    }
  }

  return errors;
}
