# SendFIL

SendFIL is a client-only Vite SPA for batch sending FIL. The live app currently supports single-signer EVM/FEVM senders and native Filecoin `f1`/`t1` senders. Multi-sig sender support remains planned work.

## Current Live Execution Surface

- `Standard` remains the default path and uses `Multicall3.aggregate3Value(...)` plus `FilForwarder`.
- `ThinBatch` uses `ThinBatchPayer.payBatch(...)` when the active network has a configured ThinBatch address.
- Filecoin Mainnet and Calibration EVM wallet flow through wagmi/RainbowKit with MetaMask, Brave Wallet, and WalletConnect.
- Native Filecoin wallet rows for FilSnap and Ledger. Native `f1`/`t1` senders use one native `InvokeEVM` message carrying the selected FEVM batch payload.
- Review-step gas estimation and send execution use the same selected execution method and error mode.
- Duplicate recipients are warnings that require explicit acknowledgment before send.
- Submit-time balance recheck is wired for the EVM/wagmi sender path and the native Filecoin sender path.

## Error Handling Modes

- `ATOMIC` is the default for `Standard`. Any failing internal call reverts the entire batch and no transfer is finalized.
- `PARTIAL` is available only with configured `ThinBatch`. Successful payments can finalize while failed payment value is refunded by `ThinBatchPayer`.

Recommended usage:

- Use `ATOMIC` when every recipient must succeed together or the batch should fail as one unit.
- Use `ThinBatch` + `PARTIAL` only when best-effort delivery is acceptable and failed-payment refunds are required.

When an atomic preflight fails, SendFIL blocks submission and explains that the whole batch would revert. When an atomic transaction fails after submission, the failure copy explicitly states that no transfer was finalized.

## Telemetry

Batch execution emits structured telemetry in two places:

- `console.info('[sendfil:batch-telemetry]', payload)`
- `window` custom events named `sendfil:batch-telemetry`

Payloads include:

- `executionMethod`
- `errorMode`
- `recipientCount`
- `totalValueAttoFil`
- `networkKey`
- `chainId`
- preflight/simulation result
- final transaction status
- normalized error category

## Known Limitations

- `ThinBatch` requires a deployed `ThinBatchPayer` address per network. The contract source and app path are wired, but public Calibration/Mainnet smoke verification still needs to be run after deployment.
- `Standard` no longer exposes Partial execution. Multicall3 `aggregate3Value(...)` does not refund value from failed allowed subcalls, so SendFIL only uses Standard for all-or-nothing Atomic batches.
- App-level contract-recipient blocking (`eth_getCode`) is not implemented yet. `ThinBatchPayer` still rejects EVM recipients with deployed bytecode on-chain.
- There is no centralized-exchange `0x` warning flow yet.
- There is no past-transactions sidebar or stuck-transaction guidance in the main user flow yet.
- Native Filecoin provider support has not been exhaustively verified across target browser, hardware, and network-switching environments.
- Native account derivation currently uses adapter defaults; account/index selection UX is not implemented.
- High-precision amount validation accepts up to 18 decimal places, but the live `App.tsx` value path still converts validated amounts to JavaScript `Number` before fee calculation and execution. A fully string/bigint-safe amount pipeline remains a money-safety hardening task.

## Environment Setup

Copy `.env.example` to `.env.local` and set:

- `VITE_WALLETCONNECT_PROJECT_ID`
- `VITE_FEVM_RPC_URL_MAINNET`
- `VITE_FEVM_RPC_URL_CALIBRATION`
- `VITE_LOTUS_RPC_URL_MAINNET`
- `VITE_LOTUS_RPC_FALLBACK_MAINNET`
- `VITE_LOTUS_RPC_URL_CALIBRATION`
- `VITE_LOTUS_RPC_FALLBACK_CALIBRATION`
- `VITE_LOTUS_RPC_TIMEOUT_MS`
- `VITE_FEE_ENABLED_MAINNET`
- `VITE_FEE_ADDR_A_MAINNET`
- `VITE_FEE_ADDR_B_MAINNET`

Optional ThinBatch deployment addresses:

- `VITE_THINBATCH_ADDRESS_MAINNET`
- `VITE_THINBATCH_ADDRESS_CALIBRATION`

Calibration defaults to fee injection disabled. If you want testnet fee rows, also set:

- `VITE_FEE_ENABLED_CALIBRATION=true`
- `VITE_FEE_ADDR_A_CALIBRATION`
- `VITE_FEE_ADDR_B_CALIBRATION`

Optional E2E-only helpers:

- `VITE_E2E_MOCK_WALLET`
- `VITE_E2E_SKIP_GAS_ESTIMATION`
- `VITE_E2E_SEND_DELAY_MS`

## Development

```sh
yarn install
yarn dev
```

## Validation

```sh
yarn lint
yarn test
yarn typecheck
yarn test:e2e:smoke
```

## Calibration Smoke Test

1. Connect a wallet on Calibration (`314159`).
2. Enter a `t1...` recipient and a `0x...` recipient.
3. Confirm the review modal opens without a network error.
4. Confirm the modal labels the batch as `Calibration Testnet`.
5. Send the batch and confirm the transaction link opens on `calibration.filfox.info`.

## Design Note

See [docs/atomic-error-handling.md](docs/atomic-error-handling.md) for the ATOMIC-mode execution contract, error taxonomy, telemetry schema, and rollout notes.
