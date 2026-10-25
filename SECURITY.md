# EpochPilot Security Architecture & Audit Report

EpochPilot is a **100% non-custodial** Dual-Voter optimization engine, Cross-Pair boost arbitrage solver, and MUSD/sMUSD bribe auto-compounder built for **Mezo Network** (Mainnet Chain ID `31612` & Matsnet Testnet Chain ID `31611`).

This document outlines our smart contract invariants, transaction execution safeguards, mathematical solver bounds, and verified on-chain deployments for the Mezo Buildathon judges.

---

## 1. EpochPilot Security Model (Non-Custodial Tri-Mode Execution)

EpochPilot never takes custody of a user's `veMEZO` or `veBTC` NFTs, nor does it hold user funds between transactions. Users and institutional treasuries can execute epoch allocations across three isolated trust tiers:

| Execution Mode | Trust Boundary | Target Contracts | Key Guarantee |
| :--- | :--- | :--- | :--- |
| **1. Direct EOA Mode** | Zero intermediary contracts | `ThirdPartyVoter`, `BoostVoter`, `RewardsDistributor` | Calls Mezo core protocol contracts directly from the user's wallet. Requires **zero** NFT or ERC-20 approvals to EpochPilot. |
| **2. Batch Router Mode (`EpochPilotRouter.sol`)** | Stateless atomic router | `EpochPilotRouter` (`0x9384…f8ad`) | Bundles dual `vote()` calls, rebase claims, boost pokes, and `MUSD` / `sMUSD` compounding into 1 transaction. Holds **zero** state or token balances after execution. |
| **3. Safe Multisig / Raw Calldata** | Air-gapped / DAO Treasury | Gnosis Safe / Hardware Signer | Exports deterministic ABI-encoded calldata (`vote(uint256,address[],uint256[])` & `executeOptimalEpochVote`) for offline verification. |

---

## 2. Smart Contract Invariants (`contracts/EpochPilotRouter.sol`)

All state-changing entrypoints in [`contracts/EpochPilotRouter.sol`](./contracts/EpochPilotRouter.sol) enforce five core invariants:

### 2.1 Strict NFT Ownership & Caller Authorization
- Every function operating on a `veMEZO` lock (`executeOptimalEpochVote`, `claimAndCompoundToMUSD`) enforces the `onlyTokenOperator(veMEZO, veMezoTokenId)` modifier:
  ```solidity
  if (!escrow.isApprovedOrOwner(msg.sender, tokenId)) {
      revert NotAuthorizedForToken(tokenId);
  }
  ```
- **Anti-Frontrunning Guarantee:** Even when a user approves `EpochPilotRouter` for their `veMEZO` NFT (`veMEZO.approve(router, tokenId)`), an unauthorized third party **cannot** call the router on behalf of `tokenId` because `msg.sender` is verified against `veMEZO.isApprovedOrOwner(msg.sender, tokenId)` before execution.
- In `postCrossPairBribeAndPoke`, optional `poolsVoter.poke(veBtcTokenId)` execution requires both `veBTC.isApprovedOrOwner(msg.sender, veBtcTokenId)` and router approval.

### 2.2 Unconditional Recipient Locking (Anti-Theft)
- In `claimAndCompoundToMUSD`, the router queries the canonical owner directly from the escrow contract (`address nftOwner = veMEZO.ownerOf(veMezoTokenId)`).
- Neither `executeOptimalEpochVote` nor `claimAndCompoundToMUSD` accepts an external `recipient` address parameter:
  - When `stakeIntoSMusd == false`, swapped `MUSD` from `ITigrisRouter.swapExactTokensForTokens` is routed directly to `nftOwner`.
  - When `stakeIntoSMusd == true`, `MUSD` is deposited into `MUSDSavingsRate` (`sMUSD`, `0xb4D498029af77680cD1eF828b967f010d06C51CC`) via `IERC4626(sMusd).deposit(totalMusdOut, nftOwner)`, minting `sMUSD` shares directly to `nftOwner`.
  - Any anti-dilution `MEZO` rebase claimed via `RewardsDistributor.claim(veMezoTokenId)` is compounded directly into the `veMEZO` lock on-chain.

### 2.3 Slippage & Deadline Protection on Tigris AMM Swaps
- Every swap routed through Mezo's Tigris Router (`_swapTokenToMusd`) enforces:
  1. Caller-supplied minimum output bounds (`minMusdOuts[i]`), verified both inside the Tigris router and explicitly post-swap via `if (actualOut < minOut) revert SlippageToleranceExceeded(actualOut, minOut);`.
  2. The frontend execution engine (`handleClaimAndCompoundToMusd` in [`src/components/EpochPilotDesk.tsx`](./src/components/EpochPilotDesk.tsx)) computes a **1.0% maximum slippage floor** (`9900 bps` of oracle-implied MUSD value, with a non-zero `1 wei` minimum floor) rather than passing `0`.
  3. A strict transaction deadline (`block.timestamp + 600`) to prevent stale mempool execution across epoch flips.

### 2.4 Reentrancy Protection & SafeERC20 Hygiene
- **Reentrancy Guard:** All external batch functions (`executeOptimalEpochVote`, `claimAndCompoundToMUSD`, `postCrossPairBribeAndPoke`) are protected by a `nonReentrant` mutex (`ReentrancyGuardReentrantCall()`).
- **SafeERC20 & Zero Dangling Allowances:**
  - All ERC-20 interactions use low-level `_safeTransfer`, `_safeTransferFrom`, and `_forceApprove` wrappers that check both call success and optional boolean return data.
  - Every token approval granted to `dexRouter`, `sMusd`, or `bribeContract` is explicitly reset to `0` (`_forceApprove(token, spender, 0)`) immediately after the external call completes.

### 2.5 Dust Sweep & Native BTC Safety
- `EpochPilotRouter.sol` contains **no** `payable` functions, `receive()`, or `fallback()` hooks, making it impossible to accidentally send and trap native `BTC` gas tokens inside the contract.
- After every swap or `sMUSD` deposit, any unspent input token or `MUSD` dust remaining on the router is automatically swept back to `nftOwner` (or `msg.sender` in `postCrossPairBribeAndPoke`).

---

## 3. Web3 Frontend, Solver & Calldata Safety Guarantees

### 3.1 Explicit Chain ID Verification
- Before any transaction signature is requested (`getWalletClient` in [`src/components/EpochPilotDesk.tsx`](./src/components/EpochPilotDesk.tsx)), the client:
  1. Requests a network switch to the active UI network (`31612` for Mezo Mainnet or `31611` for Mezo Matsnet Testnet).
  2. Queries the wallet provider's live `eth_chainId` directly and halts execution with a `Chain mismatch` error if the wallet's active Chain ID does not match the selected UI environment.
  3. Verifies `telemetry.network === network` (`getVerifiedNetworkOptimization`) and runs an on-chain `pubClient.simulateContract` pre-check before opening the wallet signing prompt.

### 3.2 Principle of Least Privilege (Scoped Approvals)
- **Single-NFT Approval:** `handleApproveRouter` and `handleRouterBatchExecute` call `veMEZO.approve(routerAddress, tokenId)` for the specific `tokenId` being voted, never `setApprovalForAll(routerAddress, true)`.
- **Exact ERC-20 Approvals:** `handleMintVeMezoLock` and `handlePostCrossPairMusdBribe` approve only the exact required `MEZO` or `MUSD` wei amount (`lockAmountWei` / `amountWei`), never `type(uint256).max`.

### 3.3 KKT Solver & Calldata Invariant Validation
- In [`src/lib/optimizer.ts`](./src/lib/optimizer.ts) and `assertValidVotePayload` ([`src/components/EpochPilotDesk.tsx`](./src/components/EpochPilotDesk.tsx)):
  - **Numerical Sanitization:** `sanitizeFinite()` clamps any `NaN`, `Infinity`, or `-0.0` values and floors denominators (`Math.max(W + v, 1e-9)`) so zero-vote or zero-bribe gauges never cause division-by-zero.
  - **Duplicate Target Prevention:** Candidate gauges are deduplicated by lowercase `voteTargetAddress` before optimization, and `assertValidVotePayload` verifies `new Set(targets).size === targets.length` before signing (preventing on-chain `Voter.vote()` reverts from duplicate gauge targets).
  - **Exact 10,000 bps Reconciliation:** Integer weights are clamped to `[1, 10000]` and reconciled so `sum(weights) == 10000` (`100.00%`).
  - **Input & API Boundary Validation:** Custom contract addresses are validated with `viem`'s `isAddress()`, and `/api/telemetry` bounds `veMezoId` and `veBtcId` via `parseBoundedTokenId` (`1 <= id <= 1,000,000`).
  - **External Link Isolation:** All external block explorer and faucet links enforce `rel="noopener noreferrer"`.

---

## 4. Verified On-Chain Deployments & Protocol Registry

### Mezo Matsnet Testnet (Chain ID `31611`)
- **Deployed `EpochPilotRouter.sol`:** [`0x938419eB410b5fc2785a17DcCE80f405508Af8ad`](https://explorer.test.mezo.org/address/0x938419eB410b5fc2785a17DcCE80f405508Af8ad)
- **Router Deployment Transaction (Block `#16,348,533`):** [`0x0fa47491850b687f8decbc24e4b1e162bf1afdc853a0b013797f07da1a0a2e1b`](https://explorer.test.mezo.org/tx/0x0fa47491850b687f8decbc24e4b1e162bf1afdc853a0b013797f07da1a0a2e1b)
- **`veMEZO` (VotingEscrow):** [`0xaCE816CA2bcc9b12C59799dcC5A959Fb9b98111b`](https://explorer.test.mezo.org/address/0xaCE816CA2bcc9b12C59799dcC5A959Fb9b98111b)
- **`BoostVoter`:** [`0x21d7bdf5a5929ad179f8ca0c9014a0b62ae6bfd1`](https://explorer.test.mezo.org/address/0x21d7bdf5a5929ad179f8ca0c9014a0b62ae6bfd1)
- **`ThirdPartyVoter`:** [`0x62fe6d71be2ac2806da046bf93b02c279246251d`](https://explorer.test.mezo.org/address/0x62fe6d71be2ac2806da046bf93b02c279246251d)

### Mezo Mainnet (Chain ID `31612`)
- **`veMEZO` (VotingEscrow):** [`0xb90fdAd3DFD180458D62Cc6acedc983D78E20122`](https://explorer.mezo.org/address/0xb90fdAd3DFD180458D62Cc6acedc983D78E20122)
- **`veBTC` (VotingEscrow):** [`0x3D4b1b884A7a1E59fE8589a3296EC8f8cBB6f279`](https://explorer.mezo.org/address/0x3D4b1b884A7a1E59fE8589a3296EC8f8cBB6f279)
- **`BoostVoter`:** [`0x2ba614a598cffa5a19d683cdca97bac3a49313d1`](https://explorer.mezo.org/address/0x2ba614a598cffa5a19d683cdca97bac3a49313d1)
- **`ThirdPartyVoter`:** [`0x2e6d2f2cacc1d24f9f9358030674eb307397a6eb`](https://explorer.mezo.org/address/0x2e6d2f2cacc1d24f9f9358030674eb307397a6eb)
- **`MUSD`:** [`0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186`](https://explorer.mezo.org/address/0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186)
- **`sMUSD` (`MUSDSavingsRate` ERC-4626):** [`0xb4D498029af77680cD1eF828b967f010d06C51CC`](https://explorer.mezo.org/address/0xb4D498029af77680cD1eF828b967f010d06C51CC)
- **`Tigris AMM Router`:** [`0x16A76d3cd3C1e3CE843C6680d6B37E9116b5C706`](https://explorer.mezo.org/address/0x16A76d3cd3C1e3CE843C6680d6B37E9116b5C706)
