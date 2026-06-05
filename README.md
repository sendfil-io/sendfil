# SendFIL

SendFIL is a client-only Vite SPA for batch sending FIL. The live app currently supports single-signer EVM/FEVM senders and native Filecoin `f1`/`t1` senders through the Standard batch path. Multi-sig sender support remains planned work.

## Current live execution surface

- Single-signer FEVM batch execution through `Multicall3.aggregate3Value(...)` plus `FilForwarder`.
- Filecoin Mainnet and Calibration EVM wallet flow through wagmi/RainbowKit with MetaMask, Brave Wallet, and WalletConnect.
- Native Filecoin wallet rows for FilSnap and Ledger. Native `f1`/`t1` senders use one native `InvokeEVM` message that carries the same Standard batch payload.
- Review-step gas estimation and send execution use the same Standard batch builder.
- Duplicate recipients are warnings that require explicit acknowledgment before send.
- Submit-time balance recheck is wired for the EVM/wagmi sender path and the native Filecoin sender path.

## Error handling modes

- `PARTIAL` is the live UI default and the only selectable mode in the current `App.tsx` flow. Successful internal calls can still finalize even if another call fails.
- `ATOMIC` is implemented in the lower transaction layer by setting `allowFailure=false` for every Multicall3 call, and review/failure copy exists in `ReviewTransactionModal`. It is not currently selectable in the live app UI; choosing Atomic opens an unavailable-capability notice and leaves the batch on Partial.

Recommended usage:

- Use `PARTIAL` when best-effort delivery is acceptable and you want the batch to keep going.
- Use `ATOMIC` once the UI selector is wired when every recipient must succeed together or the batch should fail as one unit.

Current implementation note: the transaction hooks and mock adapter can execute/preflight ATOMIC batches when called directly, but the live UI hardcodes `PARTIAL` until the selector is intentionally enabled.

## Telemetry

Batch execution emits structured telemetry in two places:

- `console.info('[sendfil:batch-telemetry]', payload)`
- `window` custom events named `sendfil:batch-telemetry`

Payloads include:

- `errorMode`
- `recipientCount`
- `totalValueAttoFil`
- `networkKey`
- `chainId`
- preflight/simulation result
- final transaction status
- normalized error category

## Known limitations

- `ThinBatch` is still UI-visible but not live.
- `ATOMIC` is transaction-layer-ready but blocked by the live UI selector.
- Contract-recipient blocking (`eth_getCode`) is not implemented yet.
- There is no centralized-exchange `0x` warning flow yet.
- There is no past-transactions sidebar or stuck-transaction guidance in the main user flow yet.
- Native Filecoin provider support has not been exhaustively verified across target browser, hardware, and network-switching environments.
- Native account derivation currently uses adapter defaults; account/index selection UX is not implemented.
- High-precision amount validation accepts up to 18 decimal places, but the live `App.tsx` value path still converts validated amounts to JavaScript `Number` before fee calculation and execution. A fully string/bigint-safe amount pipeline remains a money-safety hardening task.

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
yarn test:e2e:smoke
```

## Calibration smoke test

1. Connect a wallet on Calibration (`314159`).
2. Enter a `t1...` recipient and a `0x...` recipient.
3. Confirm the review modal opens without a network error.
4. Confirm the modal labels the batch as `Calibration Testnet`.
5. Send the batch and confirm the transaction link opens on `calibration.filfox.info`.

## Design note

See [docs/atomic-error-handling.md](docs/atomic-error-handling.md) for the ATOMIC-mode transaction-layer contract, current UI gate, error taxonomy, telemetry schema, and rollout notes.
