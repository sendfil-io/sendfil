import { expect, test, type Page } from '@playwright/test';
import { E2E_ATOMIC_REVERT_ADDRESS } from '../../src/lib/transaction/mockAdapter';

const DUPLICATE_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const UNIQUE_ADDRESS = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

async function openManualInput(page: Page) {
  await page.goto('/');
  await expect(page.getByText('SendFIL')).toBeVisible();
  await expect(page.getByTestId('mock-wallet-chip')).toBeVisible();
  await page.getByTestId('manual-mode-toggle').click();
}

async function fillRecipient(
  page: Page,
  index: number,
  address: string,
  amount: string,
) {
  await page.getByTestId(`recipient-address-${index}`).fill(address);
  await page.getByTestId(`recipient-amount-${index}`).fill(amount);
}

async function selectAtomicMode(page: Page) {
  await page.getByRole('button', { name: /Configure transaction/i }).click();
  await page.getByTestId('error-handling-atomic').click();
}

test('manual review can proceed without duplicate acknowledgment for unique recipients', async ({
  page,
}) => {
  await openManualInput(page);
  await fillRecipient(page, 0, DUPLICATE_ADDRESS, '1');
  await fillRecipient(page, 1, UNIQUE_ADDRESS, '2');

  await page.getByTestId('review-batch-button').click();

  await expect(page.getByRole('heading', { name: 'Review Batch' })).toBeVisible();
  await expect(page.getByTestId('duplicate-acknowledgment')).toHaveCount(0);
  await expect(page.getByTestId('send-batch-button')).toBeEnabled();

  await page.getByTestId('send-batch-button').click();
  await expect(page.getByText('Transaction Confirmed')).toBeVisible();
});

test('manual review requires duplicate acknowledgment before send is enabled', async ({
  page,
}) => {
  await openManualInput(page);
  await fillRecipient(page, 0, DUPLICATE_ADDRESS, '1');
  await fillRecipient(page, 1, DUPLICATE_ADDRESS, '2');

  await page.getByTestId('review-batch-button').click();

  await expect(page.getByText('Duplicate recipients need confirmation')).toBeVisible();
  await expect(page.getByTestId('send-batch-button')).toBeDisabled();

  await page.getByTestId('duplicate-acknowledgment').check();
  await expect(page.getByTestId('send-batch-button')).toBeEnabled();
});

test('csv review preserves duplicate warnings and requires acknowledgment', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('mock-wallet-chip')).toBeVisible();
  await page.getByRole('button', { name: 'CSV Upload' }).click();

  await page.locator('#csv-file-input').setInputFiles({
    name: 'duplicate-recipients.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`receiverAddress,value
${DUPLICATE_ADDRESS},1
${DUPLICATE_ADDRESS},2
`),
  });

  await expect(page.getByText('CSV loaded successfully')).toBeVisible();
  await expect(page.getByText('2 recipients imported from the uploaded file.')).toBeVisible();
  await page.getByTestId('review-batch-button').click();

  await expect(page.getByText('Duplicate recipients need confirmation')).toBeVisible();
  await expect(page.getByTestId('send-batch-button')).toBeDisabled();
  await page.getByTestId('duplicate-acknowledgment').check();
  await expect(page.getByTestId('send-batch-button')).toBeEnabled();
});

test('atomic mode stays blocked and review continues with partial semantics', async ({
  page,
}) => {
  await openManualInput(page);
  await selectAtomicMode(page);
  await expect(page.getByTestId('unavailable-capability-modal')).toBeVisible();
  await expect(page.getByText('Atomic error handling is not wired yet')).toBeVisible();
  await page.getByRole('button', { name: 'Keep default' }).click();

  await fillRecipient(page, 0, DUPLICATE_ADDRESS, '1');
  await fillRecipient(page, 1, UNIQUE_ADDRESS, '2');

  await page.getByTestId('review-batch-button').click();

  await expect(page.getByTestId('error-mode-summary')).toContainText(
    'Some transfers may succeed even if others fail.',
  );
  await expect(page.getByTestId('send-batch-button')).toBeEnabled();

  await page.getByTestId('send-batch-button').click();
  await expect(page.getByText('Transaction Confirmed')).toBeVisible();
});

test('atomic selection remains blocked even for an atomic-only preflight case', async ({
  page,
}) => {
  await openManualInput(page);
  await selectAtomicMode(page);
  await expect(page.getByTestId('unavailable-capability-modal')).toBeVisible();
  await page.getByRole('button', { name: 'Keep default' }).click();

  await fillRecipient(page, 0, E2E_ATOMIC_REVERT_ADDRESS, '1');

  await page.getByTestId('review-batch-button').click();

  await expect(page.getByTestId('error-mode-summary')).toContainText(
    'Some transfers may succeed even if others fail.',
  );
  await expect(page.getByTestId('atomic-preflight-error')).toHaveCount(0);
  await expect(page.getByTestId('send-batch-button')).toBeEnabled();
});
