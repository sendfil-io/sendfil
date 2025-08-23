# SendFIL Development Todo

## Current Status Overview

- **Project Hygiene & CI**: ✅ Complete
- **Wallet Core**: ✅ Complete (wagmi config done, UI integrated, NetworkBanner integrated)
- **CSV Upload & Validation**: ✅ Complete (Full CSV workflow with validation implemented)
- **Fee Logic**: ✅ Complete (Implemented and integrated with UI preview)
- **Data Layer**: 🟡 Basic structure exists, needs expansion for transactions
- **Other Tasks**: ⏳ Pending

## Task Breakdown

### ✅ Task 0: Project Hygiene & CI - COMPLETE

- [x] TypeScript strict mode configured
- [x] ESLint with comprehensive rules
- [x] Prettier integration
- [x] Vitest testing framework
- [x] Proper project structure and build setup
- [x] Cursor + env setup working

### ✅ Task 1: Wallet Core - Connect & Persist - COMPLETE

**Status**: All wallet functionality implemented and integrated

**Completed**:

- [x] wagmi configuration with Filecoin chain
- [x] RainbowKit integration
- [x] Basic wallet connection components
- [x] Network banner for unsupported networks
- [x] Address display and management
- [x] NetworkBanner integrated into main App layout
- [x] Wallet connection state integrated into App component
- [x] Clean UI flow for connected/disconnected states

### ✅ Task 3: CSV Upload & Validation - COMPLETE

**Status**: Full CSV workflow implemented with comprehensive validation

**Completed**:

- [x] Drag & drop CSV file upload component
- [x] PapaParse integration for CSV parsing
- [x] Row-level validation (bad addresses, duplicates, negative amounts)
- [x] Filecoin address format validation
- [x] CSV workflow integrated into main App UI
- [x] Error and warning display system
- [x] Support for flexible column naming (receiverAddress/address/to, value/amount/fil)
- [x] Manual input fallback option
- [x] CSV data summary with total calculations

### ✅ Task 4: Fee Injection Logic (1%) - COMPLETE

**Status**: Fee calculation implemented and integrated with UI

**Completed**:

- [x] Fee calculation algorithm (1% total, configurable split)
- [x] Environment variable configuration
- [x] Fee address validation
- [x] Integration with CSV validation workflow
- [x] Fee preview in batch review
- [x] Total calculations including fees

### ⏳ Task 2: Data Layer Abstraction (DataProvider) & Glif RPC Impl - PENDING

**Status**: Basic structure exists, needs expansion for transaction operations

**Current State**: Basic structure exists with:

- [x] Basic RPC abstraction layer
- [x] Retry and fallback logic
- [x] Basic Filecoin methods (balance, nonce, chain head)

**To Implement**:

- [ ] Expand DataProvider interface for batch operations
- [ ] Add methods for transaction building
- [ ] Implement batch transaction validation
- [ ] Add proper error handling and types
- [ ] Test RPC fallback scenarios

### ⏳ Task 5: Batch Transaction Execution - PENDING

**Status**: Ready to implement - requires Task 2 completion

**To Implement**:

- [ ] Build Filecoin message from connected signer
- [ ] Implement single-sig transaction signing
- [ ] Add transaction confirmation UI
- [ ] Integrate with DataProvider for nonce and balance checks
- [ ] Add gas estimation
- [ ] Test transaction flow end-to-end

### ⏳ Task 6: Pending Tx Progress & Gas Feedback - PENDING

**Status**: Pairs with Task 5

**To Implement**:

- [ ] Poll StateGetReceipt for transaction status
- [ ] Show transaction progress in UI
- [ ] Link to Filfox for transaction details
- [ ] Add gas usage feedback
- [ ] Handle transaction failures gracefully

### ❌ Task 7: Recent History Panel - PAUSED

**Status**: Paused - requires deployed Filecoin actor for BatchSent events

**Reason**: This task assumes a deployed Filecoin actor that emits BatchSent events. Since this actor doesn't exist yet, this task is paused per client request.

**Alternative**: Could implement local storage-based history tracking as a fallback.

### ⏳ Task 8: Local Rate-Limit & Cache - PENDING

**Status**: Best added after Tasks 5-6 for stability

**To Implement**:

- [ ] Cache RPC results with react-query
- [ ] Implement persistQueryClient for offline support
- [ ] Add request throttling
- [ ] Optimize for performance

### ⏳ Task 9: Security Guardrails - PENDING

**Status**: Can be added early or just before launch

**To Implement**:

- [ ] Max FIL per batch (environment configurable)
- [ ] Checksum validation for CSV files
- [ ] Confirmation phrase for large transactions
- [ ] Rate limiting for transaction submissions
- [ ] Address blacklist/whitelist support

### ⏳ Task 10: Global Error Boundary & Observability - PENDING

**Status**: Ship after core logic stabilizes

**To Implement**:

- [ ] React error boundary component
- [ ] Sentry DSN integration
- [ ] Netlify uptime monitoring
- [ ] Error logging and reporting
- [ ] User-friendly error messages

### ⏳ Task 11: Responsive & Accessibility Pass - PENDING

**Status**: Add once core features are in place

**To Implement**:

- [ ] Tailwind responsive breakpoints
- [ ] Keyboard navigation support
- [ ] ARIA labels and screen reader support
- [ ] Mobile-optimized UI
- [ ] Accessibility testing

### ⏳ Task 12: Deployment Hardening - PENDING

**Status**: Polish phase

**To Implement**:

- [ ] Clean Netlify production build
- [ ] Source map stripping
- [ ] Secure environment variable handling
- [ ] Performance optimization
- [ ] Final testing and validation

## Immediate Next Steps (Priority Order)

1. **Complete Task 2**: Expand DataProvider for transaction operations
2. **Implement Task 5**: Build batch transaction execution
3. **Add Task 6**: Transaction progress monitoring
4. **Begin Task 9**: Add basic security guardrails

## Technical Notes

- **Architecture**: Well-structured with proper separation of concerns
- **Dependencies**: All major packages properly configured (wagmi, RainbowKit, react-query, papaparse)
- **Testing**: Vitest framework ready, need to add comprehensive test coverage
- **Environment**: .env.example exists with all required variables
- **Filecoin Integration**: Address conversion utilities exist, CSV validation robust
- **UI/UX**: Clean wallet connection flow, comprehensive CSV upload with validation

## Major Accomplishments

✅ **Full CSV Workflow**: Complete drag-and-drop CSV upload with comprehensive validation, error handling, and flexible column support

✅ **Wallet Integration**: Seamless wallet connection with network detection and clean UI states

✅ **Fee System**: Complete 1% fee calculation with environment configuration and UI preview

✅ **Robust Validation**: Address format validation, duplicate detection, amount validation, and user-friendly error messaging

## Ready for Transaction Implementation

The foundation is now solid with:

- Complete wallet connectivity
- Robust CSV data processing and validation
- Fee calculation integration
- Clean UI workflows

Next phase focuses on building the actual Filecoin transaction execution using the existing DataProvider foundation.
