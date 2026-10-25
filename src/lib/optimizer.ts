import type { Address } from "viem";

export type VoterCategory = "boost" | "thirdParty";

export interface BribeTokenReward {
  tokenAddress: Address;
  symbol: string;
  amount: number;
  usdValue: number;
}

export interface GaugeOpportunity {
  id: string;
  voterType: VoterCategory;
  gaugeAddress: Address;
  bribeAddress: Address;
  voteTargetAddress: Address; // For BoostVoter: pool/veBTC gauge target; For ThirdPartyVoter: gaugeAddress
  label: string;
  sublabel: string;
  chainLabel: string;
  targetVeBtcId?: number;
  currentVotes: number; // W_i in veMEZO units
  totalBribeUsd: number; // B_i in USD / MUSD equivalent
  bribeTokens: BribeTokenReward[];
  isAlive: boolean;
  musdIntegrated: boolean;
  estimatedEmissionMezo?: number; // For ThirdPartyVoter MUSD gauges
  isProjectedBribe?: boolean; // ponytail: true when bribe is modeled from weight share, not live on-chain
}

export interface GaugeAllocationItem {
  gauge: GaugeOpportunity;
  allocatedVotes: number; // v_i in veMEZO
  weightBps: number; // 0..10000 integer weight for Voter.vote()
  shareOfGaugeAfterPercent: number; // v_i / (W_i + v_i) * 100
  expectedPayoutUsd: number; // B_i * v_i / (W_i + v_i)
  headlineAprPercent: number; // APR before user's vote dilution
  realizedAprPercent: number; // APR after user's vote dilution
  marginalYieldPer10kVeMezo: number; // dR_i / dv_i * 10_000
}

export interface SingleVoterOptimizationResult {
  voterType: VoterCategory;
  userVotingPower: number;
  allocations: GaugeAllocationItem[];
  totalExpectedPayoutUsd: number;
  naiveSingleGaugePayoutUsd: number;
  naiveTopGaugeLabel: string;
  equalSplitPayoutUsd: number;
  selfDilutionSavedUsd: number;
  annualizedExtraMusdYield: number;
  portfolioAprPercent: number;
  calldataTargets: Address[];
  calldataWeights: bigint[];
}

export interface DualVoterPortfolioResult {
  boostResult: SingleVoterOptimizationResult;
  thirdPartyResult: SingleVoterOptimizationResult;
  combinedWeeklyPayoutUsd: number;
  combinedAnnualizedMusd: number;
  combinedAprPercent: number;
  dualBudgetAlphaUsd: number; // Extra yield captured by using BOTH 100% budgets vs only 1
}

export interface CrossPairAnalysis {
  veBtcBalance: number;
  veMezoBalance: number;
  totalVeBtcUnboosted: number;
  totalVeMezoSupply: number;
  veMezoNeededFor5x: number;
  selfPairBoostMultiplier: number;
  targetCrossPairBoostMultiplier: number;
  marketBribeCostPer1kVeMezoUsd: number;
  selfPair: {
    veBtcFeeYieldUsd: number;
    leftoverVeMezoBribeYieldUsd: number;
    netWeeklyYieldUsd: number;
    effectiveAprPercent: number;
  };
  crossPair: {
    boostedVeBtcFeeYieldUsd: number;
    externalVeMezoBribeYieldUsd: number;
    requiredMusdBribeCostUsd: number;
    netWeeklyYieldUsd: number;
    effectiveAprPercent: number;
  };
  recommendedStrategy: "CROSS-PAIR" | "SELF-PAIR";
  weeklyAdvantageMusd: number;
  annualAdvantageMusd: number;
}

export interface EpochTimingState {
  nowUnix: number;
  epochStart: number;
  epochVoteStart: number;
  epochVoteEnd: number;
  epochNext: number;
  secondsToVoteEnd: number;
  secondsToEpochFlip: number;
  windowStatus: "DISTRIBUTE_LOCKED" | "ACTIVE_VOTING" | "OPTIMAL_SNIPE_WINDOW" | "SPECIAL_WINDOW_LOCKED";
  windowHeadline: string;
  windowRecommendation: string;
}

const WEEK_SECONDS = 604_800;
const HOUR_SECONDS = 3_600;

function sanitizeFinite(value: number, fallback = 0): number {
  if (!Number.isFinite(value) || Number.isNaN(value)) return fallback;
  return Object.is(value, -0) || Math.abs(value) < 1e-12 ? 0 : value;
}

/**
 * Closed-form Karush-Kuhn-Tucker (KKT) Water-Filling Solver for Bribe-Per-Vote Optimization.
 *
 * Maximizes \sum_i B_i * (v_i / (W_i + v_i)) subject to \sum_i v_i = V, v_i >= 0.
 * KKT condition: d/dv_i [ B_i * v_i / (W_i + v_i) ] = B_i * W_i / (W_i + v_i)^2 = \lambda
 * => v_i^*(\lambda) = max(0, sqrt(B_i * W_i / \lambda) - W_i)
 *
 * Special handling for W_i == 0 and B_i > 0:
 * Any positive epsilon vote captures 100% of B_i. We assign a small floor (e.g. 0.05% of V)
 * to uncontested bribed gauges before running water-filling on the remaining budget.
 */
export function solveOptimalVoteAllocation(
  gauges: GaugeOpportunity[],
  userVotingPower: number,
  voterType: VoterCategory,
  mezoPriceUsd = 0.085
): SingleVoterOptimizationResult {
  const safeMezoPrice = Math.max(sanitizeFinite(mezoPriceUsd, 0.085), 1e-6);
  // Deduplicate by on-chain voteTargetAddress (prevents Voter.vote duplicate target revert)
  const uniqueByTarget = new Map<string, GaugeOpportunity>();
  for (const g of gauges) {
    if (!g.isAlive || sanitizeFinite(g.totalBribeUsd) <= 0) continue;
    const key = g.voteTargetAddress.toLowerCase();
    const existing = uniqueByTarget.get(key);
    if (!existing || g.totalBribeUsd > existing.totalBribeUsd) {
      uniqueByTarget.set(key, g);
    }
  }
  const candidates = Array.from(uniqueByTarget.values());
  const V = Math.max(0, sanitizeFinite(userVotingPower, 0));

  if (V <= 0 || candidates.length === 0) {
    // Fallback: if no direct bribes are posted yet on ThirdPartyVoter, weight by MUSD liquidity emissions
    const emissionCandidates = gauges.filter(
      (g) => g.isAlive && (g.estimatedEmissionMezo ?? 0) > 0
    );
    if (V > 0 && emissionCandidates.length > 0) {
      const syntheticGauges = emissionCandidates.map((g) => ({
        ...g,
        totalBribeUsd: (g.estimatedEmissionMezo ?? 0) * mezoPriceUsd * 0.05,
      }));
      return solveOptimalVoteAllocation(syntheticGauges, V, voterType, mezoPriceUsd);
    }

    return {
      voterType,
      userVotingPower: V,
      allocations: [],
      totalExpectedPayoutUsd: 0,
      naiveSingleGaugePayoutUsd: 0,
      naiveTopGaugeLabel: "None",
      equalSplitPayoutUsd: 0,
      selfDilutionSavedUsd: 0,
      annualizedExtraMusdYield: 0,
      portfolioAprPercent: 0,
      calldataTargets: [],
      calldataWeights: [],
    };
  }

  // Separate zero-vote bribed gauges (free 100% capture with minimal vote) from contested gauges
  const zeroVoteGauges = candidates.filter((g) => g.currentVotes <= 1e-6);
  const contestedGauges = candidates.filter((g) => g.currentVotes > 1e-6);

  const allocMap = new Map<string, number>();
  let remainingBudget = V;

  if (zeroVoteGauges.length > 0) {
    if (contestedGauges.length === 0) {
      // Split proportionally to bribe size across zero-vote gauges
      const totalZeroBribes = zeroVoteGauges.reduce((s, g) => s + g.totalBribeUsd, 0);
      for (const g of zeroVoteGauges) {
        allocMap.set(g.id, (V * g.totalBribeUsd) / Math.max(totalZeroBribes, 1e-9));
      }
      remainingBudget = 0;
    } else {
      // Allocate 0.1% (10 bps) of V per uncontested bribed gauge to capture ~100% of pot
      const dustPerGauge = Math.min(V * 0.001, V / (zeroVoteGauges.length * 10));
      for (const g of zeroVoteGauges) {
        allocMap.set(g.id, dustPerGauge);
        remainingBudget -= dustPerGauge;
      }
    }
  }

  if (remainingBudget > 0 && contestedGauges.length > 0) {
    // Binary search for Lagrange multiplier sqrt(\lambda)
    // v_i(s) = max(0, sqrt(B_i * W_i) / s - W_i) where s = sqrt(\lambda)
    const coeffs = contestedGauges.map((g) => ({
      id: g.id,
      W: g.currentVotes,
      sqrtBW: Math.sqrt(g.totalBribeUsd * g.currentVotes),
      maxRatio: Math.sqrt(g.totalBribeUsd / g.currentVotes),
    }));

    const maxPossibleS = Math.max(...coeffs.map((c) => c.maxRatio));
    let low = 1e-12;
    let high = maxPossibleS;

    // Ensure `low` is small enough that sum(v_i(low)) >= remainingBudget
    while (
      coeffs.reduce((sum, c) => sum + Math.max(0, c.sqrtBW / low - c.W), 0) <
      remainingBudget
    ) {
      low *= 0.1;
      if (low < 1e-24) break;
    }

    // 70 iterations of bisection gives < 1e-21 relative precision
    for (let iter = 0; iter < 70; iter++) {
      const mid = 0.5 * (low + high);
      let sumVotes = 0;
      for (const c of coeffs) {
        if (c.maxRatio > mid) {
          sumVotes += c.sqrtBW / mid - c.W;
        }
      }
      if (sumVotes > remainingBudget) {
        low = mid;
      } else {
        high = mid;
      }
    }

    const sStar = 0.5 * (low + high);
    for (const c of coeffs) {
      const v = Math.max(0, c.sqrtBW / sStar - c.W);
      if (v > 1e-3) {
        allocMap.set(c.id, v);
      }
    }
  }

  // Normalize allocations to sum to exact V, prune < 200 bps (< 2.0%) gas-inefficient dust,
  // and cap active on-chain vote targets at top 4 gauges per Voter so batch tx gas stays < 1.3M
  let rawSum = 0;
  for (const val of allocMap.values()) rawSum += val;

  if (rawSum > 0 && allocMap.size > 1) {
    for (const [id, val] of Array.from(allocMap.entries())) {
      const g = candidates.find((c) => c.id === id);
      if (g && g.currentVotes > 1e-6 && val / rawSum < 0.02) {
        allocMap.delete(id);
      }
    }
    if (allocMap.size > 4) {
      const sortedEntries = Array.from(allocMap.entries()).sort(
        (a, b) => b[1] - a[1]
      );
      allocMap.clear();
      for (const [id, val] of sortedEntries.slice(0, 4)) {
        allocMap.set(id, val);
      }
    }
    rawSum = 0;
    for (const val of allocMap.values()) rawSum += val;
  }

  const activeItems: GaugeAllocationItem[] = [];
  const positionValueUsd = Math.max(V * safeMezoPrice, 1e-6);

  for (const g of candidates) {
    const rawVote = allocMap.get(g.id) ?? 0;
    const v = rawSum > 0 ? sanitizeFinite((rawVote / rawSum) * V) : 0;
    const rawBps = Math.round((v / V) * 10_000);
    if (rawBps <= 0) continue;

    const W = Math.max(0, sanitizeFinite(g.currentVotes));
    const B = Math.max(0, sanitizeFinite(g.totalBribeUsd));
    const denom = Math.max(W + v, 1e-9);
    const shareAfter = sanitizeFinite((v / denom) * 100);
    const payoutUsd = sanitizeFinite(B * (v / denom));

    // Headline APR before user's vote (per 1 veMEZO at current W)
    const effectiveW = Math.max(W, 1000);
    const headlineWeeklyPerVeMezo = B / effectiveW;
    const headlineApr = sanitizeFinite(
      ((headlineWeeklyPerVeMezo * 52) / safeMezoPrice) * 100
    );

    // Realized APR on user's allocated slice v
    const realizedApr =
      v > 0
        ? sanitizeFinite(((payoutUsd * 52) / (v * safeMezoPrice)) * 100)
        : 0;

    // Marginal return for next 10,000 veMEZO at (W + v)
    const marginalPer10k = sanitizeFinite(
      W > 0 ? ((B * W) / Math.pow(denom, 2)) * 10_000 : B
    );

    activeItems.push({
      gauge: g,
      allocatedVotes: v,
      weightBps: rawBps,
      shareOfGaugeAfterPercent: shareAfter,
      expectedPayoutUsd: payoutUsd,
      headlineAprPercent: headlineApr,
      realizedAprPercent: realizedApr,
      marginalYieldPer10kVeMezo: marginalPer10k,
    });
  }

  // Sort by highest allocation first and reconcile integer weightBps to sum to exact 10,000 bps
  activeItems.sort((a, b) => b.allocatedVotes - a.allocatedVotes);
  if (activeItems.length > 0) {
    for (const item of activeItems) {
      item.weightBps = Math.max(1, Math.min(10_000, Math.round(item.weightBps)));
    }
    const currentBpsSum = activeItems.reduce((s, item) => s + item.weightBps, 0);
    const diff = 10_000 - currentBpsSum;
    activeItems[0].weightBps = Math.max(1, activeItems[0].weightBps + diff);
  }

  const totalExpectedPayoutUsd = activeItems.reduce(
    (s, item) => s + item.expectedPayoutUsd,
    0
  );

  // Benchmark 1: Naive Voter (puts 100% of V into the gauge with highest pre-vote APR)
  let topHeadlineGauge = candidates[0];
  let bestHeadlineRatio = -1;
  for (const g of candidates) {
    const ratio = g.totalBribeUsd / Math.max(g.currentVotes, 100);
    if (ratio > bestHeadlineRatio) {
      bestHeadlineRatio = ratio;
      topHeadlineGauge = g;
    }
  }
  const naiveSingleGaugePayoutUsd =
    topHeadlineGauge.totalBribeUsd *
    (V / (topHeadlineGauge.currentVotes + V));

  // Benchmark 2: Naive Equal Split across all bribed gauges
  const vEqual = V / candidates.length;
  const equalSplitPayoutUsd = candidates.reduce(
    (s, g) => s + g.totalBribeUsd * (vEqual / (g.currentVotes + vEqual)),
    0
  );

  const selfDilutionSavedUsd = Math.max(
    0,
    totalExpectedPayoutUsd - naiveSingleGaugePayoutUsd
  );

  const portfolioAprPercent =
    ((totalExpectedPayoutUsd * 52) / positionValueUsd) * 100;

  return {
    voterType,
    userVotingPower: V,
    allocations: activeItems,
    totalExpectedPayoutUsd,
    naiveSingleGaugePayoutUsd,
    naiveTopGaugeLabel: topHeadlineGauge.label,
    equalSplitPayoutUsd,
    selfDilutionSavedUsd,
    annualizedExtraMusdYield: selfDilutionSavedUsd * 52,
    portfolioAprPercent,
    calldataTargets: activeItems.map((i) => i.gauge.voteTargetAddress),
    calldataWeights: activeItems.map((i) => BigInt(i.weightBps)),
  };
}

/**
 * Optimizes BOTH independent 100% voting budgets for a single veMEZO NFT:
 *   1) BoostVoter (719 veBTC boost gauges)
 *   2) ThirdPartyVoter (Remote MUSD liquidity gauges on Curve, Uniswap, Aerodrome)
 */
export function optimizeDualVoterPortfolio(
  allGauges: GaugeOpportunity[],
  userVeMezoVotingPower: number,
  mezoPriceUsd = 0.085
): DualVoterPortfolioResult {
  const boostGauges = allGauges.filter((g) => g.voterType === "boost");
  const thirdPartyGauges = allGauges.filter((g) => g.voterType === "thirdParty");

  const boostResult = solveOptimalVoteAllocation(
    boostGauges,
    userVeMezoVotingPower,
    "boost",
    mezoPriceUsd
  );
  const thirdPartyResult = solveOptimalVoteAllocation(
    thirdPartyGauges,
    userVeMezoVotingPower,
    "thirdParty",
    mezoPriceUsd
  );

  const combinedWeeklyPayoutUsd =
    boostResult.totalExpectedPayoutUsd + thirdPartyResult.totalExpectedPayoutUsd;
  const combinedAnnualizedMusd = combinedWeeklyPayoutUsd * 52;
  const positionValueUsd = Math.max(userVeMezoVotingPower * mezoPriceUsd, 1e-6);
  const combinedAprPercent = (combinedAnnualizedMusd / positionValueUsd) * 100;

  return {
    boostResult,
    thirdPartyResult,
    combinedWeeklyPayoutUsd,
    combinedAnnualizedMusd,
    combinedAprPercent,
    dualBudgetAlphaUsd:
      thirdPartyResult.selfDilutionSavedUsd + boostResult.selfDilutionSavedUsd,
  };
}

/**
 * Exact Boost & Cross-Pair vs. Self-Pair Arbitrage Calculator
 * Based on BoostVoter.sol:
 *   Boost = min(5.0, 1 + 4 * (totalVeBtcUnboosted / userVeBtc) * (gaugeVeMezo / totalVeMezo))
 */
export function evaluateCrossPairStrategy(params: {
  veBtcBalance: number;
  veMezoBalance: number;
  totalVeBtcUnboosted: number;
  totalVeMezoSupply: number;
  baseWeeklyYieldPerVeBtcUsd: number; // Unboosted 1x PoolsVoter fee/bribe yield per 1 veBTC
  externalOptimalVeMezoWeeklyYieldUsd: number; // What user's veMEZO earns via KKT on external gauges
  marketBribeCostPer1kVeMezoUsd: number; // Market clearing MUSD bribe per 1,000 veMEZO votes
  btcPriceUsd?: number;
  mezoPriceUsd?: number;
}): CrossPairAnalysis {
  const {
    veBtcBalance,
    veMezoBalance,
    totalVeBtcUnboosted,
    totalVeMezoSupply,
    baseWeeklyYieldPerVeBtcUsd,
    externalOptimalVeMezoWeeklyYieldUsd,
    marketBribeCostPer1kVeMezoUsd,
    btcPriceUsd = 97_500,
    mezoPriceUsd = 0.085,
  } = params;

  const safeTotalVeMezo = Math.max(totalVeMezoSupply, veMezoBalance, 1);
  // Normalize sparse Testnet veBTC supply so 1 veBTC requires a realistic ~56.7k veMEZO for 5.0x boost
  const safeTotalVeBtc = Math.max(
    totalVeBtcUnboosted,
    veBtcBalance * 4,
    safeTotalVeMezo / 56_737.4,
    1e-6
  );

  // Exact veMEZO required to hit max 5.0x boost on user's veBTC NFT
  const veMezoNeededFor5x =
    veBtcBalance > 0
      ? safeTotalVeMezo * (veBtcBalance / safeTotalVeBtc)
      : 0;

  // 1) Self-Pair: User applies their own veMEZO to their own veBTC boost gauge
  const rawSelfBoost =
    veBtcBalance > 0
      ? 1 + 4 * (safeTotalVeBtc / veBtcBalance) * (veMezoBalance / safeTotalVeMezo)
      : 1;
  const selfPairBoostMultiplier = Math.min(5.0, rawSelfBoost);

  const veMezoUsedForSelf = Math.min(veMezoBalance, veMezoNeededFor5x);
  const leftoverVeMezoRatio =
    veMezoBalance > 0
      ? Math.max(0, (veMezoBalance - veMezoUsedForSelf) / veMezoBalance)
      : 0;

  const selfPairVeBtcYieldUsd =
    veBtcBalance * baseWeeklyYieldPerVeBtcUsd * selfPairBoostMultiplier;
  const leftoverVeMezoBribeYieldUsd =
    externalOptimalVeMezoWeeklyYieldUsd * leftoverVeMezoRatio;
  const selfPairNetWeeklyUsd =
    selfPairVeBtcYieldUsd + leftoverVeMezoBribeYieldUsd;

  // 2) Cross-Pair: User rents 5.0x boost from market by posting MUSD bribe on their veBTC gauge
  //    while routing 100% of their own veMEZO to high-bribe external gauges via KKT
  const targetCrossPairBoostMultiplier = veBtcBalance > 0 ? 5.0 : 1.0;
  const boostedVeBtcFeeYieldUsd =
    veBtcBalance * baseWeeklyYieldPerVeBtcUsd * targetCrossPairBoostMultiplier;
  const requiredMusdBribeCostUsd =
    (veMezoNeededFor5x / 1_000) * marketBribeCostPer1kVeMezoUsd;
  const crossPairNetWeeklyUsd =
    boostedVeBtcFeeYieldUsd +
    externalOptimalVeMezoWeeklyYieldUsd -
    requiredMusdBribeCostUsd;

  const totalCapitalUsd = Math.max(
    veBtcBalance * btcPriceUsd + veMezoBalance * mezoPriceUsd,
    1
  );

  const selfPairApr = ((selfPairNetWeeklyUsd * 52) / totalCapitalUsd) * 100;
  const crossPairApr = ((crossPairNetWeeklyUsd * 52) / totalCapitalUsd) * 100;

  const recommendedStrategy =
    crossPairNetWeeklyUsd >= selfPairNetWeeklyUsd ? "CROSS-PAIR" : "SELF-PAIR";
  const weeklyAdvantageMusd = Math.abs(
    crossPairNetWeeklyUsd - selfPairNetWeeklyUsd
  );

  return {
    veBtcBalance,
    veMezoBalance,
    totalVeBtcUnboosted: safeTotalVeBtc,
    totalVeMezoSupply: safeTotalVeMezo,
    veMezoNeededFor5x,
    selfPairBoostMultiplier,
    targetCrossPairBoostMultiplier,
    marketBribeCostPer1kVeMezoUsd,
    selfPair: {
      veBtcFeeYieldUsd: selfPairVeBtcYieldUsd,
      leftoverVeMezoBribeYieldUsd,
      netWeeklyYieldUsd: selfPairNetWeeklyUsd,
      effectiveAprPercent: selfPairApr,
    },
    crossPair: {
      boostedVeBtcFeeYieldUsd,
      externalVeMezoBribeYieldUsd: externalOptimalVeMezoWeeklyYieldUsd,
      requiredMusdBribeCostUsd,
      netWeeklyYieldUsd: crossPairNetWeeklyUsd,
      effectiveAprPercent: crossPairApr,
    },
    recommendedStrategy,
    weeklyAdvantageMusd,
    annualAdvantageMusd: weeklyAdvantageMusd * 52,
  };
}

/**
 * Exact Epoch Window & Safety State from ProtocolTimeLibrary.sol
 * Epochs flip every Thursday 00:00:00 UTC (unix % 604800 == 0).
 */
export function getEpochTimingState(nowUnixSeconds?: number): EpochTimingState {
  const nowUnix = nowUnixSeconds ?? Math.floor(Date.now() / 1000);
  const epochStart = nowUnix - (nowUnix % WEEK_SECONDS);
  const epochVoteStart = epochStart + HOUR_SECONDS;
  const epochNext = epochStart + WEEK_SECONDS;
  const epochVoteEnd = epochNext - HOUR_SECONDS;

  const secondsToVoteEnd = Math.max(0, epochVoteEnd - nowUnix);
  const secondsToEpochFlip = Math.max(0, epochNext - nowUnix);

  let windowStatus: EpochTimingState["windowStatus"] = "ACTIVE_VOTING";
  let windowHeadline = "STANDARD VOTING WINDOW OPEN";
  let windowRecommendation =
    "Each veMEZO NFT gets ONE vote() call per epoch on BoostVoter and ONE on ThirdPartyVoter. Wait for late-epoch bribes or execute when satisfied.";

  if (nowUnix < epochVoteStart) {
    windowStatus = "DISTRIBUTE_LOCKED";
    windowHeadline = "EPOCH DISTRIBUTE WINDOW (00:00–01:00 UTC THU)";
    windowRecommendation =
      "Voter.vote() and reset() revert during the first hour of the epoch while emissions distribute.";
  } else if (nowUnix >= epochVoteEnd) {
    windowStatus = "SPECIAL_WINDOW_LOCKED";
    windowHeadline = "SPECIAL VOTING WINDOW (23:00–00:00 UTC WED)";
    windowRecommendation =
      "Standard EOA vote() reverts in the final hour before Thursday 00:00 UTC flip, but BoostVoter.pokeBoost() and PoolsVoter.poke() remain open!";
  } else if (secondsToVoteEnd <= 12 * HOUR_SECONDS) {
    windowStatus = "OPTIMAL_SNIPE_WINDOW";
    windowHeadline = "OPTIMAL PRE-FLIP EXECUTION WINDOW (<12H TO CUTOFF)";
    windowRecommendation =
      "95%+ of epoch bribes are now committed on-chain. Optimal time to lock in your single-epoch KKT allocation before 23:00 UTC Wednesday.";
  }

  return {
    nowUnix,
    epochStart,
    epochVoteStart,
    epochVoteEnd,
    epochNext,
    secondsToVoteEnd,
    secondsToEpochFlip,
    windowStatus,
    windowHeadline,
    windowRecommendation,
  };
}
