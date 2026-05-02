## What changed?


## Invariants touched

Reference `docs/invariants.md` IDs where applicable.

## Execution boundaries touched

- [ ] UI
- [ ] validation
- [ ] amount parsing
- [ ] duplicate detection
- [ ] review/send gating
- [ ] network/wallet gating
- [ ] RPC
- [ ] transaction builder
- [ ] fee/value accounting
- [ ] tests only
- [ ] docs only

## CI / verification

- [ ] `yarn lint`
- [ ] `yarn typecheck`
- [ ] `yarn test:unit`
- [ ] `yarn build`
- [ ] `yarn test:e2e:smoke` if review/send UI changed
- [ ] `yarn test:future` if implementing or modifying future invariant tests

## Red-zone review

Required if touching transaction builder, wallet signing/submission,
`msg.value` or value accounting, amount parsing, network gating, RPC
`getCode`/`eth_getCode`, or fee rows.

- [ ] value accounting reviewed
- [ ] no JS Number precision regression in money-moving path
- [ ] wrong-network behavior reviewed
- [ ] estimate/send config alignment reviewed
- [ ] no live RPC/wallet dependency added to tests

## Known gaps

