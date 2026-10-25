# EpochPilot — Mezo Ecosystem & Protocol Primary-Source Research

> **Compiled**: October 23, 2026  
> **Primary Sources**: Official Mezo Docs (`mezo.org/docs`), Mezo Blog (`mezo.org/blog`), Akindo WaveHack API (`api.akindo.io/public/wave-hacks/OVOO0gdrVU8379D10`), Mezo GitHub (`github.com/mezo-org/tigris`, `github.com/mezo-org/musd`, `github.com/mezo-org/documentation`), and live on-chain queries via Mezo Mainnet (`31612`) & Testnet (`31611`) RPCs and Blockscout v2 APIs (`api.explorer.mezo.org`, `api.explorer.test.mezo.org`).

---

## 1. Mezo Buildathon (Oct 16 – Nov 15, 2026) — Rules, Rubric & Strategy

### Sources
- Announcement Blog: [The Mezo Buildathon Is Underway: Build What's Next for MUSD and MEZO](https://mezo.org/blog/mezo-buildathon-is-underway/) (Andre Coutinho, Oct 19, 2026)
- Akindo Portal & Spec: [Mezo Buildathon on Akindo](https://app.akindo.io/wave-hacks/OVOO0gdrVU8379D10) (`https://api.akindo.io/public/wave-hacks/OVOO0gdrVU8379D10`)
- Previous Hackathon Benchmarks: [Announcing Mezo Hackathon 2 Winners](https://mezo.org/blog/announcing-mezo-hackathon-2-winners/) (Vaish Puri, Jun 9, 2026)

### Schedule & Prize Pool ($7,000 USD in MEZO)
| Phase | Dates | Prize Pool | Focus |
|---|---|---|---|
| **Wave 1 Build** | Oct 16 – Oct 26, 2026 | **$2,000 in MEZO** | Core working MVP, live deployment on Mezo Mainnet/Testnet, clear MUSD + MEZO integration, end-to-end user flow |
| **Wave 1 Judging** | Oct 27 – Nov 1, 2026 | — | AKINDO DevRel screening + Mezo Core Team point allocation |
| **Wave 2 Build** | Nov 2 – Nov 15, 2026 | **$5,000 in MEZO** | Automated delegation vaults (`ManagedNFT` / `AutoCompounder`), MUSD auto-compounding, deeper polish |
| **Wave 2 Judging** | Nov 16 – Nov 22, 2026 | — | Must document delta/progress since Wave 1 |
| **Winners & Demo Day** | Nov 23, 2026 | — | Live online demo session; prizes paid via 14-day MEZO TWAP after KYB |

### Judging Rubric (Stage 2 — Mezo Core Engineering & Product Team)
1. **Mezo Integration (30%)**: Meaningful, protocol-level usage of **both MUSD and MEZO** (not just a superficial ERC-20 balance check).
2. **Product & Business Viability (30%)**: Directly solves a real Mezo ecosystem bottleneck; "Extend, don't detour" and "Composability wins."
3. **Technical Implementation (20%)**: Smart contract quality, real on-chain reads/writes, composability with Mezo Earn (`tigris`) and MUSD contracts.
4. **User Experience (10%)**: Clarity of financial metrics, decision desk ergonomics, and frictionless wallet/transaction execution.
5. **Submission Materials Quality (10%)**: Live URL, public GitHub repo, product deck, and 2-minute pitch video.

### Dual-Track Qualification
- **Track 1: DeFi (Borrowing, Lending, Looping, and Yield)** — Yield-generating routers, gauge vote optimizers, and auto-compounding strategies for MUSD/MEZO.
- **Track 2: Access & Distribution** — Discovery, analytics, and matching/routing interfaces that make MEZO and MUSD yield opportunities transparent and one-click accessible.
- *Note*: Akindo allows selecting **both Track 1 and Track 2**.

---

## 2. Deep Ecosystem Discovery: How Mezo's Dual-Token Gauge System Actually Works

A surface-level builder assumes Mezo works like standard Velodrome where one veToken votes on one `Voter` contract. **Reading the live deployed contracts in `mezo-org/tigris` and on `api.explorer.mezo.org` reveals a three-voter, dual-token architecture that is unique to Mezo:**

### A. The Two Vote-Escrow Tokens (`VotingEscrow.sol`)
1. **`veBTC` (`0x3D4b1b884A7a1E59fE8589a3296EC8f8cBB6f279` on Mainnet)**:
   - Underlying: Native `BTC` (`0x7b7C000000000000000000000000000000000000`, 18 decimals).
   - Lock duration: 1 day to **28 days** (4 weeks, linear decay, or `lockPermanent`).
   - Current Mainnet stats (Oct 23, 2026): `804.53 BTC` locked across `6,161` veBTC NFTs; `647.84` unboosted voting power -> `1,765.84` boosted voting power.
   - What it votes on:
     - **`PoolsVoter` (`0x48233cCC97B87Ba93bCA212cbEe48e3210211f03`)**: 28 Staking Gauges (DEX Basic Pools, Slipstream CL Pools, `sMUSD` MUSD Savings Rate Vault, Morpho USDC Vault). Voters earn **100% of swap fees / MUSD vault fees** (`FeesVotingReward`) + **external bribes** (`BribeVotingReward`).
     - **`ValidatorsVoter` (`0xe99a9ad5Ed26BD30e4DB25397f378817e9b9515a`)**: 24 Validator Gauges (independent 100% vote weight).
2. **`veMEZO` (`0xb90fdAd3DFD180458D62Cc6acedc983D78E20122` on Mainnet)**:
   - Underlying: Native `MEZO` (`0x7B7c000000000000000000000000000000000001`, 18 decimals).
   - Lock duration: 1 week to **4 years** (1,456 days, linear decay, or `lockPermanent` auto-max lock).
   - Current Mainnet stats (Oct 23, 2026): `280.43M MEZO` locked across `2,903` veMEZO NFTs; `98.74M` total voting power (`34.72M` permanently locked).
   - **CRITICAL INSIGHT — Every `veMEZO` NFT has TWO independent 100% voting budgets every epoch**:
     1. **Budget #1 — `BoostVoter` (`0x2ba614a598cffa5a19d683cdca97bac3a49313d1`)**:
        - Every `veBTC` NFT can spin up a dedicated **Boost Gauge** (currently **719 boost gauges** on Mainnet, `59.82M` veMEZO voting weight cast).
        - `veMEZO` holders vote on these boost gauges to multiply that `veBTC` NFT's voting power up to **5x** and earn the **ERC-20 bribes** (`BribeVotingReward`) posted by the `veBTC` holder.
     2. **Budget #2 — `ThirdPartyVoter` / MEZO Gauges (`0x2e6d2f2cacc1d24f9f9358030674eb307397a6eb`)**:
        - Launched September 11, 2026 ([Introducing MEZO Gauges](https://mezo.org/blog/introducing-mezo-gauges/)) and updated October 20, 2026 ([MEZO Gauges: New Aero Pools](https://mezo.org/blog/mezo-gauges-on-aero/)).
        - Directs the non-staking branch of weekly MEZO emissions (~200k+ MEZO/epoch) to **MUSD liquidity pools on Ethereum (Curve, Uniswap via Merkl) and Base (Aerodrome/Aero)**.
        - `veMEZO` holders who vote on `ThirdPartyVoter` earn any **incentives/bribes posted on those MEZO Gauges** (`BribeVotingReward`), AND if they LP in those MUSD pools, they capture the directed MEZO/AERO emissions.
        - **Crucially**: Voting 100% of your `veMEZO` on `ThirdPartyVoter` **does NOT reduce or consume** your 100% `veMEZO` vote on `BoostVoter`! Yet right now on Mainnet, out of `98.74M` total `veMEZO` voting power, only `59.82M` (60.5%) is voting on `BoostVoter` and only `35.15M` (35.6%) is voting on `ThirdPartyVoter` — meaning **over 63M veMEZO on MEZO Gauges and 38.9M veMEZO on Boost Gauges is sitting completely idle every epoch!**

### B. Why Judges Will Love EpochPilot's Problem Framing
1. **Boar Finance (`https://boar.finance/mezo`)** — Featured in Mezo's blog ([Set It and Earn: Automated veBTC Yield with Boar Finance](https://mezo.org/blog/set-it-and-earn-automated-vebtc-yield-with-boar-finance/), Apr 20, 2026) — only optimizes `veBTC` voting on `PoolsVoter` (and posts MEZO bribes on its own boost gauge on Matchbox).
2. **Matchbox (`https://matchbox.markets`)** — Provides a manual marketplace UI for browsing `BoostVoter` gauges and Remote MEZO Gauges, and **`veBoost Calculator` (`https://boost.mallard.sh`)** estimates boost math in isolation, **but NO tool on Mezo**:
   - Indexes all live `BoostVoter` gauges (719 on Mainnet) + `ThirdPartyVoter` MEZO Gauges (4 active on Mainnet) + `PoolsVoter` Staking Gauges (28 on Mainnet) in one unified terminal,
   - Solves the **marginal bribe-dilution problem** (if you drop 500,000 `veMEZO` into a small gauge paying \$50 in bribes, you dilute yourself; the optimal split across gauges requires marginal return equalization / water-filling optimization),
   - Solves the **Cross-Pair vs. Self-Pair Decision** highlighted in Mezo's own May 8, 2026 blog post ([Understanding veMEZO: A Bitcoin Earner's Field Guide](https://mezo.org/blog/understanding-vemezo/)), where a wallet holding both `veBTC` and `veMEZO` earned **5.3x more ($203.20 vs $38.87, 7.5% APR vs 1.4% APR)** by bribing external `veMEZO` to boost its `veBTC` to 5x while deploying its own `veMEZO` to high-bribe gauges,
   - Executes **both** `BoostVoter.vote()`, `ThirdPartyVoter.vote()`, `BoostVoter.pokeBoost()`, `PoolsVoter.poke()`, and batch bribe claims + MUSD swaps in a single streamlined router workflow,
   - Adapts the dormant `AutoCompounder.sol` / `CompoundOptimizer.sol` contracts in `mezo-org/tigris` (which still have hardcoded Optimism `_weth` and `_op` addresses from the Velodrome fork!) to actually work on Mezo with `MUSD`, `BTC`, and `MEZO`!

---

## 3. Exact Mathematical Models to Implement in EpochPilot

### A. Optimal Bribe-Per-Vote Allocation (Water-Filling / Marginal Yield Solver)
Suppose a user has voting weight $V > 0$ (e.g., `veMEZO` weight on `BoostVoter` or `ThirdPartyVoter`) and there are $M$ active gauges.
For each gauge $i \in \{1, \dots, M\}$:
- Current total votes on gauge $i$ (excluding the user's current vote if re-voting, or for a fresh vote): $W_i$
- Total USD (or MUSD) value of bribes deposited on `gaugeToBribe[gauge_i]` for the current epoch: $B_i$
- If the user allocates $v_i \ge 0$ votes to gauge $i$ (subject to $\sum_{i=1}^M v_i = V$), the user's payout from gauge $i$ is:
  $$R_i(v_i) = B_i \cdot \frac{v_i}{W_i + v_i}$$
- Because $R_i(v_i)$ is strictly concave for $W_i > 0$, the marginal return is:
  $$\frac{\partial R_i}{\partial v_i} = \frac{B_i W_i}{(W_i + v_i)^2}$$
- **Closed-Form Karush-Kuhn-Tucker (KKT) Water-Filling Solution**:
  For a Lagrange multiplier $\lambda > 0$, the exact optimal allocation to each active gauge is:
  $$v_i^*(\lambda) = \max\left(0, \; \sqrt{\frac{B_i W_i}{\lambda}} - W_i\right)$$
  where $\lambda$ is found via binary search (or exact sorting of $B_i / W_i$) such that $\sum_{i} v_i^*(\lambda) = V$.
  - *Special case ($W_i = 0$ and $B_i > 0$)*: Even 1 wei of vote captures 100% of $B_i$! Our solver assigns a minimal dust weight (e.g. 1 bps of $V$) to any zero-vote gauge with $B_i > 0$ to capture the entire uncontested pot.
  - This is a **provably optimal, zero-dependency mathematical solver** that shows the user their **Naive Return (100% in top APR gauge)** vs. **Optimal Split Return (EpochPilot KKT Router)** — quantifying the exact extra MUSD/MEZO yield saved from self-dilution!

### B. Exact Boost Multiplier & Cross-Pair vs. Self-Pair Solver (`BoostLibrary.sol`)
From `BoostVoter.sol` on Mezo Mainnet:
$$\text{Boost}(tokenId) = \min\left(5, \; 1 + 4 \cdot \frac{|\text{veBTC}|_{\text{total, unboosted}}}{|\text{veBTC}|_{tokenId}} \cdot \frac{|\text{veMEZO}|_{\text{gauge}}}{|\text{veMEZO}|_{\text{total}}}\right)$$
- **Exact `veMEZO` required for full 5x boost**:
  $$|\text{veMEZO}|_{\text{for 5x}} = |\text{veMEZO}|_{\text{total}} \cdot \frac{|\text{veBTC}|_{tokenId}}{|\text{veBTC}|_{\text{total, unboosted}}}$$
- **Cross-Pair Arbitrage Calculator**:
  Given the current clearing price of boost on `BoostVoter` (median/marginal MUSD per 1,000 `veMEZO` votes), EpochPilot calculates:
  1. **Self-Pair Net Yield**: Directing user's own `veMEZO` to their `veBTC` boost gauge + resulting `PoolsVoter` fee uplift.
  2. **Cross-Pair Net Yield**: Routing user's `veMEZO` to top external `BoostVoter` gauges + posting an optimal MUSD/MEZO bribe on their own `veBTC` boost gauge to rent 5x boost from the market.

### C. Epoch Timing & Window Guard (`ProtocolTimeLibrary.sol`)
- `WEEK = 604800` seconds (7 days).
- `epochStart(t) = t - (t % 604800)` (Thursday 00:00:00 UTC).
- `epochVoteStart(t) = epochStart(t) + 3600` (Thursday 01:00:00 UTC).
- `epochVoteEnd(t) = epochNext(t) - 3600` (Wednesday 23:00:00 UTC).
- `epochNext(t) = epochStart(t) + 604800` (Next Thursday 00:00:00 UTC).
- **Important Contract Constraint**: Each `tokenId` can only call `vote()` or `reset()` **once per epoch** (`lastVoted[tokenId] >= epochStart`). Therefore, **EpochPilot's Epoch Countdown & Optimal Execution Window indicator** warns users not to fire early in the epoch before bribes are posted, and highlights the sweet spot just before `Wednesday 23:00 UTC` (`epochVoteEnd`).

---

## 4. Complete Verified Contract Directory (Mainnet `31612` & Testnet `31611`)

### Network & Explorer Endpoints
| Parameter | Mezo Mainnet | Mezo Testnet (Matsnet) |
|---|---|---|
| **Chain ID** | `31612` | `31611` |
| **Native Gas Token** | `BTC` (18 decimals) | `BTC` (18 decimals) |
| **Primary Public RPC** | `https://mezo-mainnet.boar.network` | `https://rpc.test.mezo.org` |
| **Backup Public RPC** | `https://mainnet.mezo.public.validationcloud.io` | `wss://rpc-ws.test.mezo.org` |
| **Block Explorer UI** | `https://explorer.mezo.org` | `https://explorer.test.mezo.org` |
| **Blockscout REST API v2** | `https://api.explorer.mezo.org/api/v2` | `https://api.explorer.test.mezo.org/api/v2` |

### Core Token Precompiles & MUSD Contracts
| Contract | Mainnet (`31612`) | Testnet (`31611`) |
|---|---|---|
| **BTC (ERC-20 Precompile)** | `0x7b7C000000000000000000000000000000000000` | `0x7b7C000000000000000000000000000000000000` |
| **MEZO (ERC-20 Precompile)** | `0x7B7c000000000000000000000000000000000001` | `0x7B7c000000000000000000000000000000000001` |
| **MUSD Stablecoin** | `0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186` | `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` |
| **MUSDSavingsRate (`sMUSD`)** | `0xb4D498029af77680cD1eF828b967f010d06C51CC` | — |
| **MUSD PriceFeed** | `0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88` | `0x86bCF0841622a5dAC14A313a15f96A95421b9366` |
| **Pyth Oracle Proxy** | `0x2880aB155794e7179c9eE2e38200202908C17B43` | `0x2880aB155794e7179c9eE2e38200202908C17B43` |

### Mezo Earn (`tigris`) Governance, Voter & DEX Contracts
| Contract | Mainnet (`31612`) | Testnet (`31611`) | Role |
|---|---|---|---|
| **`veMEZO` (Proxy)** | `0xb90fdAd3DFD180458D62Cc6acedc983D78E20122` | `0xaCE816CA2bcc9b12C59799dcC5A959Fb9b98111b` | Vote-escrowed MEZO ERC-721 |
| **`veBTC` (Live Proxy)** | `0x3D4b1b884A7a1E59fE8589a3296EC8f8cBB6f279` | `0x38E35d92E6Bfc6787272A62345856B13eA12130a` | Vote-escrowed BTC ERC-721 |
| **`BoostVoter` (Proxy)** | `0x2ba614a598cffa5a19d683cdca97bac3a49313d1` | `0x21d7bdf5a5929ad179f8ca0c9014a0b62ae6bfd1` | `veMEZO` -> `veBTC` Boost Gauges (719 Mainnet / 669 Testnet) |
| **`ThirdPartyVoter` (Proxy)** | `0x2e6d2f2cacc1d24f9f9358030674eb307397a6eb` | `0x62fe6d71be2ac2806da046bf93b02c279246251d` | `veMEZO` -> MEZO Gauges (Curve, Uniswap, Aerodrome MUSD pools) |
| **`PoolsVoter` (Proxy)** | `0x48233cCC97B87Ba93bCA212cbEe48e3210211f03` | `0x263f1fd5fb7f866881e1b6cd7d5d6c40fd985f0d` | `veBTC` -> Staking Gauges (28 Mainnet / 17 Testnet) |
| **`ValidatorsVoter` (Proxy)** | `0xe99a9ad5Ed26BD30e4DB25397f378817e9b9515a` | — | `veBTC` -> Validator Gauges (24 Mainnet) |
| **`veMEZO RewardsDistributor`** | `0x075108f275ed81c9cfc01065e6e50ceea81d6363` | `0x2962e8817ae716019f759d098e2cae658bdcad04` | Weekly anti-dilution MEZO rebases |
| **`veBTC RewardsDistributor`** | `0xb58477e074265bdc7f7ca6100ed0f7de264f74a2` | `0x9050218f89f0b5b17df4a30ba4fc97c72e307442` | Weekly passive BTC chain/bridge fees |
| **`MEZOMinter`** | `0x66bff681611553b3204a226b2019ec621f39ffc3` | `0xe1952b3e980e43d3910d42088029341f436c1b74` | Epochal MEZO emission minter |
| **`MEZOChainSplitter`** | `0x5c6ef634e279a77d64e21d24b1a1bb4a5e59c5da` | `0xca8895934ff0a5d61ee36a5a2cdc683a2180d22a` | 20% Validators / 80% Ecosystem splitter |
| **`MEZOEcosystemSplitter`** | `0xe9e697d49d47c7042e768177f42d5789666d99fa` | `0x47fbb2e6d3f6ef14af3553d139e8af6cc92ed51f` | Staking (`PoolsVoter`) vs Non-Staking (`ThirdPartyVoter`) splitter |
| **Basic DEX `Router`** | `0x16A76d3cd3C1e3CE843C6680d6B37E9116b5C706` | `0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9` | Aerodrome-style AMM Swap Router |
| **Basic `PoolFactory`** | `0x83FE469C636C4081b87bA5b3Ae9991c6Ed104248` | `0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A` | Volatile (0.30%) & Stable (0.02%) Pool Factory |
| **CL `CLSwapRouter`** | `0x37cDd11919ec3860eaD9efB8673d7476E5326225` | `0x3112908bB72ce9c26a321Eeb22EC8e051F3b6E6a` | Slipstream Concentrated Liquidity Router |

### Live Active `ThirdPartyVoter` (MEZO Gauges) on Mainnet (`0x2e6d2f2cacc1d24f9f9358030674eb307397a6eb`)
| Index | Gauge Address | Bribe Contract (`BribeVotingReward`) | Beneficiary | Current Weight (`veMEZO`) | Target MUSD Pool |
|---|---|---|---|---|---|
| `3` | `0xc7e81dd77a4624f0dd14a8bb97bc721b0cee6e26` | `0xcfa897afb3d313456f5f7cc91d5935e652327cf6` | `0x31c72c4e04ecdfe4073e06b553702c1651388eb3` | `11,446,035.26` | Aerodrome `USDC/MUSD` CL10 (Base) |
| `4` | `0x4440a9b2954cb98416c0122e2ea996c46555f4b6` | `0x6760b0488c43513d7bead617e6ae52ce6b68f83f` | `0xf07033c58ff054f97d7f9ff8301fad00a2fa32d2` | `6,871,103.03` | Aerodrome `MEZO/MUSD` CL200 (Base) |
| `5` | `0x2ced96e759ab481210d41c567eee5c42edb59a1d` | `0xb232a2e03004a99724c1f13efa5f156e058b69ac` | `0x0f81c175b53a0bbf001f01f31521d26d6e92f705` | `16,007,685.57` | Curve `USDT/USDC/MUSD` (Ethereum via Merkl) |
| `6` | `0xc39a294024dca62f579c49d7c83a6c831d4976d0` | `0xe41b40ea3cb353fb335e363d3190ed60ad16451a` | `0x995cfe3e46068c288f45718c74cd68e5e123d338` | `822,088.72` | Uniswap `USDC/MUSD` (Ethereum via Merkl) |

---

## 5. Crucial Technical Caveat: Why Direct Smart-Contract `vote()` Needs ERC-721 Approval

In `mezo-org/tigris` (`Voter.sol` and `NonStakingVoter.sol`):
```solidity
function vote(
    uint256 _tokenId,
    address[] calldata _poolVote, // or _gaugeVote
    uint256[] calldata _weights
) external nonReentrant onlyNewEpoch(_tokenId) {
    if (!IVotingEscrow(ve).isApprovedOrOwner(_msgSender(), _tokenId))
        revert NotApprovedOrOwner();
    ...
}
```
And in `BribeVotingReward.sol` / `FeesVotingReward.sol`:
```solidity
function getReward(uint256 tokenId, address[] memory tokens) external {
    address _sender = _msgSender();
    if (_sender != voter) {
        if (!IVotingEscrow(ve).isApprovedOrOwner(_sender, tokenId))
            revert NotApprovedOrOwner();
    }
    _getReward(tokenId, tokens);
}
```
**What this means for `EpochPilotRouter.sol`:**
1. Because `VeMEZO` (`0xb90fdAd3DFD180458D62Cc6acedc983D78E20122`) and `VeBTC` (`0x3D4b1b884A7a1E59fE8589a3296EC8f8cBB6f279`) implement standard ERC-721 `approve(address to, uint256 tokenId)` and `setApprovalForAll(address operator, bool approved)` and `isApprovedOrOwner(address spender, uint256 tokenId)`, **a user does NOT have to give up custody of their `veMEZO` or `veBTC` NFT!**
2. By granting `veMEZO.approve(address(epochPilotRouter), tokenId)` (or `setApprovalForAll`), `EpochPilotRouter` becomes an approved operator for `tokenId` and can atomically execute in **ONE transaction**:
   - `BoostVoter.vote(veMezoTokenId, boostGauges, boostWeights)` (allocating 100% of Budget #1 to optimal boost gauges)
   - `ThirdPartyVoter.vote(veMezoTokenId, mezoGauges, mezoWeights)` (allocating 100% of Budget #2 to optimal MUSD remote gauges)
   - `BoostVoter.pokeBoosts(boostedVeBtcIds)` (permissionlessly activating the boost on target `veBTC` NFTs)
   - `RewardsDistributor.claim(veMezoTokenId)` (claiming weekly anti-dilution MEZO rebase directly into the lock)
3. Or, in **Direct EOA Mode (Zero Approval Needed)**:
   - The frontend computes the exact KKT optimal `address[] _gaugeVote` and `uint256[] _weights` arrays and submits `BoostVoter.vote(...)` or `ThirdPartyVoter.vote(...)` directly from the user's wallet in one click!
4. And for **Claim & Auto-Compound to MUSD (`claimAndCompoundToMUSD`)**:
   - When the user approves `EpochPilotRouter` on their `veMEZO` NFT (or transfers claimed tokens), `EpochPilotRouter` calls `BribeVotingReward.getReward(tokenId, tokens)` (or sweeps claimed ERC-20 bribes), routes MEZO/BTC/ERC-20s through the Mezo Basic `Router` (`0x16A76d3cd3C1e3CE843C6680d6B37E9116b5C706`) or `CLSwapRouter` (`0x37cDd11919ec3860eaD9efB8673d7476E5326225`) into **`MUSD`** (`0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186`), optionally stakes into **`sMUSD`** (`MUSDSavingsRate` at `0xb4D498029af77680cD1eF828b967f010d06C51CC`), and sends the `MUSD` / `sMUSD` straight to the user's wallet!
