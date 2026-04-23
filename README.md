# SendFIL

SendFIL is a client-only Vite SPA for batch sending FIL. Senders can disperse FIL from a single-signer or multi-sig to one or many f1, f2, f4, or 0x addresses.

## Current live execution surface

- Single-signer FEVM batch execution through `Multicall3.aggregate3Value(...)` plus `FilForwarder`.
- Filecoin Mainnet and Calibration wallet flow through wagmi/RainbowKit with `metaMaskWallet` and `walletConnectWallet`.
- Review-step gas estimation and send execution now use the same FEVM batch builder and the same selected error mode.
- Duplicate recipients are warnings that require explicit acknowledgment before send.

## Error handling modes

- `PARTIAL` is the default. Successful internal calls can still finalize even if another call fails.
- `ATOMIC` is all-or-nothing. Any failing internal call reverts the entire batch and no transfer is finalized.

Recommended usage:

- Use `PARTIAL` when best-effort delivery is acceptable and you want the batch to keep going.
- Use `ATOMIC` when every recipient must succeed together or the batch should fail as one unit.

When an atomic preflight fails, SendFIL blocks submission and explains that the whole batch would revert. When an atomic transaction fails after submission, the failure copy explicitly states that no transfer was finalized.

## Telemetry

Batch execution emits structured telemetry in two places:

- `console.info('[sendfil:batch-telemetry]', payload)`
- `window` custom events named `sendfil:batch-telemetry`

Payloads include:

- `errorMode`
- `recipientCount`
- `totalValueAttoFil`
- preflight/simulation result
- final transaction status
- normalized error category

## Known limitations

- `ThinBatch` is still UI-visible but not live.
- Filecoin-native signer flows are not wired into the live app path.
- Contract-recipient blocking (`eth_getCode`) is not implemented yet.
- Balance is checked during review, but there is not yet a second submit-time balance recheck.

## Environment setup

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
yarn test:e2e tests/e2e/review-flow.spec.ts
```

## Calibration smoke test

1. Connect a wallet on Calibration (`314159`).
2. Enter a `t1...` recipient and a `0x...` recipient.
3. Confirm the review modal opens without a network error.
4. Confirm the modal labels the batch as `Calibration Testnet`.
5. Send the batch and confirm the transaction link opens on `calibration.filfox.info`.

## Design note

See [docs/atomic-error-handling.md](docs/atomic-error-handling.md) for the ATOMIC-mode execution contract, error taxonomy, telemetry schema, and rollout notes.
