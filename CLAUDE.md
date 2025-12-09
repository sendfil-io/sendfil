# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SendFIL is a **client-only** batch payout tool for sending FIL from single-signer (f1 or f4/0x) or multisig (f2) wallets to multiple recipients across all Filecoin address types (f1/f2/f3/f4/0x). Built with React 19, TypeScript, Vite, and Wagmi/RainbowKit for wallet integration.

**Key Principle:** This is a financial tool handling real cryptocurrency. Prioritize correctness, security, and clear error handling over clever abstractions. The app runs entirely in the browser with no custom backend—only FIL transfers execute on-chain.

---

## Common Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server at http://localhost:5173
npm run lint         # Run ESLint (must pass with 0 warnings)
npm test             # Run all Vitest tests
```

### Testing
- Run all tests: `npm test`
- Run specific test file: `npx vitest run src/path/to/file.test.ts`
- Watch mode: `npx vitest`

**Linting:** ESLint with Airbnb TypeScript config. Code must pass `npm run lint` with **zero warnings** (enforced by `--max-warnings=0` flag).

---

## Quick Reference

### Critical Constants
```typescript
// Chain IDs
FILECOIN_MAINNET = 314
FILECOIN_CALIBRATION = 314159

// Contract Addresses (same on both networks)
MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11"
FILFORWARDER = "0x2b3ef6906429b580b7b2080de5ca893bc282c225"

// Denomination
1 FIL = 10^18 attoFIL (same as wei)
```

### Address Types
| Prefix | Type | Can Send (v1) | Can Receive | Notes |
|--------|------|---------------|-------------|-------|
| `f1` | secp256k1 | ✅ | ✅ | Filecoin native |
| `f2` | Actor/Multisig | ❌ (v2) | ✅ | Route via FilForwarder |
| `f3` | BLS | ❌ | ✅ | Route via FilForwarder |
| `f4` | Delegated/EVM | ✅ | ✅ EOA only | Twin of 0x |
| `0x` | EVM | ✅ | ✅ EOA only | Twin of f4 |
| `f0` | ID | ❌ | ❌ | Always reject |

---

## Environment Setup

Required environment variables (copy `.env.example` to `.env.local`):

### RPC Configuration
- `VITE_RPC_URL` - Wagmi transport RPC endpoint (for wallet operations)
- `VITE_GLIF_RPC_URL_PRIMARY` - Primary GLIF RPC for DataProvider
- `VITE_GLIF_RPC_URL_FALLBACK` - Fallback GLIF RPC for DataProvider
- `VITE_GLIF_RPC_TIMEOUT_MS` - RPC timeout in milliseconds (default: 10000)

### Wallet & Network
- `VITE_WALLETCONNECT_PROJECT_ID` - WalletConnect Cloud project ID

### Fee Configuration
- `VITE_FEE_ADDR_A` / `VITE_FEE_ADDR_B` - Fee collection addresses
- `VITE_FEE_SPLIT` - Split ratio between fee addresses (0.5 = 50/50)
- `VITE_FEE_PERCENT` - Fee percentage (1 = 1%)

---

## Architecture

### Dual RPC Layer
The app uses **two separate RPC systems** that serve different purposes:

1. **Wagmi/Viem RPC** (`VITE_RPC_URL`)
   - Used by Wagmi for wallet connection and transaction signing
   - Configured in `src/lib/wagmi.ts` via `transports` config
   - Handles EIP-1193 wallet interactions (MetaMask, WalletConnect)

2. **DataProvider RPC** (`VITE_GLIF_RPC_URL_PRIMARY/FALLBACK`)
   - Custom JSON-RPC client in `src/lib/DataProvider/`
   - Calls Filecoin-specific methods (balance, nonce, gas estimation, transaction status)
   - Implements automatic failover with `p-retry` and `p-timeout`
   - First attempts PRIMARY, falls back to FALLBACK on failure

**Key distinction:** Wagmi RPC is for wallet operations, DataProvider RPC is for Filecoin chain queries. They can point to the same endpoint but serve different architectural purposes.

### Provider Hierarchy
```
main.tsx
  └─ QueryClientProvider (React Query)
      └─ Web3Provider (combines below)
          ├─ WagmiProvider (wallet state)
          └─ RainbowKitProvider (wallet UI)
              └─ App
```

Note: There are two QueryClient instances (one in `main.tsx`, one in `Web3Provider.tsx`) both with `contextSharing: true` to share caches.

### DataProvider (`src/lib/DataProvider/`)
Custom RPC client for Filecoin chain operations:
- `rpc.ts` - Low-level `callRpc()` with retry/failover logic
- `index.ts` - High-level methods: `getBalance()`, `getNonce()`, `estimateGas()`, `submitTransaction()`, `getTransactionStatus()`, `pollTransactionStatus()`
- `types.ts` - Zod schemas and TypeScript types for Filecoin messages, receipts, transactions
- `RpcProviderError.ts` - Custom error types

All methods use `pRetry` with 1 retry: first attempt uses PRIMARY RPC, second attempt uses FALLBACK.

### Two Execution Methods
1. **Standard (Default):** Multicall3 + FilForwarder
   - Zero new contracts to audit
   - Battle-tested components
   - Slightly cheaper gas (no events)

2. **ThinBatch:** Custom contract (🚧 not yet deployed)
   - Per-recipient events for audit trails
   - Cleaner reconciliation
   - Small gas overhead for events

### Error Handling Modes
- **PARTIAL (Default):** Failed rows don't block others; best-effort delivery
- **ATOMIC:** All-or-nothing; any failure reverts entire batch

---

## Critical Invariants

**These MUST be maintained. Violations are bugs.**

1. **One signature per batch** - Single-signer batches require exactly ONE user approval regardless of recipient count

2. **No f0 addresses** - Always reject f0 as sender OR recipient

3. **Block EVM contracts as recipients** - Check `eth_getCode` at Review step; only EOAs allowed for 0x/f4

4. **Budget guard** - `Total + estimated_fee ≤ wallet_balance` MUST pass before submission

5. **Network enforcement** - Block sends on chain mismatch; prompt wallet to switch

6. **Address canonicalization is invisible** - Users never see 0x↔f4 conversions; engine handles internally

---

## Component Structure

- `App.tsx` - Main app with tabbed interface (Send FIL / Transaction Testing)
- `CSVUpload.tsx` - CSV parser using papaparse, validates addresses and amounts
- `TransactionTest.tsx` - Testing interface for gas estimation and transaction submission
- `NetworkBanner.tsx` - Shows warning when not on Filecoin mainnet
- `CustomConnectButton.tsx` - Custom styled wallet connection button
- Layout components: `Header.tsx`, `Footer.tsx`

### Wallet Integration
- Wagmi config in `src/lib/wagmi.ts` supports MetaMask and WalletConnect
- Custom chain config in `src/utils/chains.ts`
- RainbowKit modal footer is patched in `main.tsx` to link to Filecoin docs
- `ConnectButton` from RainbowKit is wrapped in `CustomConnectButton` component

---

## Key Implementation Patterns

### Address Validation
Use `@glif/filecoin-address` for validating Filecoin addresses across all formats.

```typescript
// CORRECT: Validate and check type
function validateRecipient(input: string): ValidationResult {
  const trimmed = input.trim();
  
  // Reject f0 immediately
  if (trimmed.startsWith('f0') || trimmed.startsWith('t0')) {
    return { valid: false, error: 'f0 addresses not supported' };
  }
  
  // Use @glif/filecoin-address for validation
  // ... validate format based on prefix
}
```

### Amount Conversion
- UI uses FIL (human-readable)
- Filecoin RPC uses attoFIL (1 FIL = 10^18 attoFIL)
- Convert with: `BigInt(amountFIL * 1e18).toString()` for RPC calls
- **Always use bigint for attoFIL calculations** - never floating point

### Fee Calculation (`src/utils/fee.ts`)
The `calculateFeeRows()` function:
- Takes original recipients array
- Calculates total amount
- Computes fee based on `VITE_FEE_PERCENT` (e.g., 1%)
- Splits fee between two addresses using `VITE_FEE_SPLIT` ratio
- Returns new array: `[...original recipients, { FEE_ADDR_A, amount }, { FEE_ADDR_B, amount }]`
- Throws error if fee addresses are already in recipient list

### Transaction Flow
1. User inputs recipients (CSV or manual)
2. Fee calculation adds fee recipients
3. Gas estimation via DataProvider
4. Transaction signing via Wagmi (wallet)
5. Submit signed message via DataProvider
6. Poll transaction status with `pollTransactionStatus()`

### Error Handling
- RPC errors are wrapped in try/catch with descriptive messages
- CSV upload shows errors (blocking) and warnings (non-blocking) separately
- Transaction status polling returns status object with `pending | confirmed | failed`

---

## CSV Format

Expected columns: `receiverAddress,value`

```csv
receiverAddress,value
f410fdjztlgqlzfda5hm6bm6z5gt3aglxcfsu24pgrsi,30.25
f1abjxfbp274xpdqcpuaykwkfb43omjotacm2p3za,100
0x1234567890abcdef1234567890abcdef12345678,0.5
```

### Validation Rules
- **Address:** Trim whitespace, reject f0, validate format per type using `@glif/filecoin-address`
- **Value:** FIL denomination (not attoFIL), must be > 0, no commas/symbols
- **Max rows:** 500 recipients per batch
- **Duplicates:** Flag at review (warn, don't auto-merge)

Validation happens in `CSVUpload` component with detailed error/warning messages.

---

## Gas Estimation

### FEVM Transactions (EVM wallet)
```typescript
async function estimateFEVMFee(tx: TransactionRequest): Promise<bigint> {
  const gasLimit = await provider.estimateGas(tx);
  const block = await provider.getBlock('latest');
  const priorityFee = await provider.send('eth_maxPriorityFeePerGas', []);
  
  // 1.25x buffer on baseFee for ~6 block protection
  const bufferedBaseFee = (block.baseFeePerGas * 125n) / 100n;
  const maxFeePerGas = bufferedBaseFee + BigInt(priorityFee);
  
  // 1.1x buffer on gas limit
  const bufferedGasLimit = (gasLimit * 110n) / 100n;
  
  return bufferedGasLimit * maxFeePerGas;
}
```

### Approximate Gas Costs
| Operation | Gas Units |
|-----------|-----------|
| Base transaction | ~21,000 |
| Multicall3 overhead | ~5,000 |
| Per EVM recipient (0x/f4) | ~25,000-35,000 |
| Per native recipient (f1/f2/f3) | ~45,000-60,000 |
| ThinBatch event per recipient | ~3,000-5,000 extra |

---

## Testing

- Vitest with jsdom environment (configured in `vitest.config.ts`)
- MSW for mocking HTTP requests
- Test files co-located with source: `__tests__/ComponentName.test.ts`

### Testing Checklist
When adding features, ensure tests cover:
- [ ] Valid address parsing (all supported types)
- [ ] Invalid address rejection (f0, malformed, wrong network)
- [ ] EVM contract detection and blocking
- [ ] Amount validation (zero, negative, overflow)
- [ ] Balance checks (exact boundary, insufficient)
- [ ] Gas estimation (both wallet types)
- [ ] Error mode behavior (ATOMIC vs PARTIAL)
- [ ] Network mismatch handling
- [ ] CSV parsing (valid, malformed, edge cases)
- [ ] Fee calculation logic

---

## Common Pitfalls

### ❌ Don't
- Assume addresses are pre-validated
- Allow f0 addresses anywhere
- Send to EVM contracts (0x/f4 with code)
- Let users edit gas manually
- Auto-retry failed transactions
- Show 0x↔f4 conversions to users
- Use floating point for FIL amounts (use bigint)
- Ignore the dual RPC architecture (Wagmi vs DataProvider)

### ✅ Do
- Validate every address at input AND at review
- Check `eth_getCode` for 0x/f4 recipients
- Show single estimated fee, no speed-up options
- Surface wallet errors clearly
- Canonicalize addresses internally only
- Use bigint for all attoFIL calculations
- Provide Filfox links for transaction inspection
- Use DataProvider for chain queries, Wagmi for wallet ops

---

## Version Scope

**V1 (MVP) - Current:**
- Single-signer only (f1, f4/0x EOAs)
- Mainnet + Calibration testnet
- Standard execution method (Multicall3 + FilForwarder)
- ThinBatch toggle (disabled until contract deployed)

**V2 (Future):**
- f2 multisig sender support
- Multi-approval flows

---

## Reference Documentation

- **Full Technical Spec:** `SendFIL-_Technical_Spec_Doc.md` in repo root
- **Filecoin Addresses:** https://docs.filecoin.io/basics/the-blockchain/addresses
- **Multicall3:** https://docs.filecoin.io/smart-contracts/advanced/multicall
- **FilForwarder:** https://docs.filecoin.io/smart-contracts/filecoin-evm-runtime/filforwarder
- **FEVM Address Types:** https://docs.filecoin.io/smart-contracts/filecoin-evm-runtime/address-types
