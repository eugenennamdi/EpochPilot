import {
  createPublicClient,
  fallback,
  formatUnits,
  http,
  parseAbi,
  type Address,
} from "viem";
import {
  BOOST_VOTER_ABI,
  BRIBE_VOTING_REWARD_ABI,
  ERC20_ABI,
  KNOWN_BOOST_GAUGE_VEBTC_IDS,
  KNOWN_THIRD_PARTY_GAUGES,
  mezoMainnet,
  mezoTestnet,
  PROTOCOL_CONFIG,
  REWARDS_DISTRIBUTOR_ABI,
  THIRD_PARTY_VOTER_ABI,
  VOTING_ESCROW_ABI,
  type NetworkKey,
} from "./chains.ts";
import {
  getEpochTimingState,
  type BribeTokenReward,
  type GaugeOpportunity,
} from "./optimizer.ts";

export interface ProtocolTelemetry {
  network: NetworkKey;
  chainId: number;
  blockNumber: number;
  fetchedAtIso: string;
  mezoPriceUsd: number;
  btcPriceUsd: number;
  musdPriceUsd: number;
  veMezoLockedTotal: number;
  veMezoTotalVotingPower: number;
  veMezoPermanentLocked: number;
  veBtcLockedTotal: number;
  veBtcTotalVotingPower: number;
  boostVoterTotalWeight: number;
  boostVoterGaugeCount: number;
  thirdPartyVoterTotalWeight: number;
  thirdPartyVoterGaugeCount: number;
  poolsVoterTotalWeight: number;
  musdTotalSupply: number;
  boostUtilizationPercent: number;
  thirdPartyUtilizationPercent: number;
  idleBoostVotingPower: number;
  idleThirdPartyVotingPower: number;
  gauges: GaugeOpportunity[];
}

export interface InspectedNftPosition {
  veMezoTokenId: number;
  owner: Address;
  lockedMezo: number;
  votingPowerVeMezo: number;
  lockEndUnix: number;
  isPermanent: boolean;
  boostUsedWeight: number;
  boostLastVoted: number;
  boostVotedThisEpoch: boolean;
  thirdPartyUsedWeight: number;
  thirdPartyLastVoted: number;
  thirdPartyVotedThisEpoch: boolean;
  claimableRebaseMezo: number;
  // Optional paired veBTC NFT
  veBtcTokenId?: number;
  lockedBtc?: number;
  unboostedVeBtc?: number;
  currentBoostMultiplier?: number;
  veBtcBoostGauge?: Address;
}

const NON_STAKING_GAUGE_ABI = parseAbi([
  "function rewardRate() view returns (uint256)",
  "function rewardsBeneficiary() view returns (address)",
]);

const TIGRIS_BTC_MUSD_POOL: Address =
  "0x52e604c44417233b6CcEDDDc0d640A405Caacefb";
// ponytail: MEZO/MUSD pool address on Tigris — if wrong or nonexistent, getReserves will fail and we fall back to 0.085
const TIGRIS_MEZO_MUSD_POOL: Address =
  "0x6C52De47c9E3A0e11a9649ab1767c8b2E0e1C4aA";
const TIGRIS_POOL_RESERVES_ABI = parseAbi([
  "function getReserves() view returns (uint256 reserve0, uint256 reserve1, uint256 blockTimestampLast)",
]);
const SMUSD_PREVIEW_ABI = parseAbi([
  "function convertToAssets(uint256 shares) view returns (uint256)",
]);

const TOKEN_PRICES_USD: Record<string, { symbol: string; decimals: number; priceUsd: number }> = {
  "0x7b7c000000000000000000000000000000000000": {
    symbol: "BTC",
    decimals: 18,
    priceUsd: 81_015,
  },
  "0x7b7c000000000000000000000000000000000001": {
    symbol: "MEZO",
    decimals: 18,
    priceUsd: 0.085,
  },
  "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186": {
    symbol: "MUSD",
    decimals: 18,
    priceUsd: 1.0,
  },
  "0x118917a40faf1cd7a13db0ef56c86de7973ac503": {
    symbol: "MUSD",
    decimals: 18,
    priceUsd: 1.0,
  },
  "0xb4d498029af77680cd1ef828b967f010d06c51cc": {
    symbol: "sMUSD",
    decimals: 18,
    priceUsd: 1.04,
  },
};

export function getPublicClient(network: NetworkKey) {
  const chain = network === "mainnet" ? mezoMainnet : mezoTestnet;
  return createPublicClient({
    chain,
    transport: fallback(
      chain.rpcUrls.default.http.map((url) =>
        http(url, {
          timeout: 10_000,
          retryCount: 2,
        })
      )
    ),
  });
}

/**
 * Fetches live Mezo Mainnet (31612) or Matsnet Testnet (31611) gauge, voter, and token telemetry
 * using batched Multicall3 calls.
 */
export async function fetchLiveProtocolTelemetry(
  network: NetworkKey = "mainnet",
  includeProjectedBribeFloor = true
): Promise<ProtocolTelemetry> {
  const cfg = PROTOCOL_CONFIG[network];
  const client = getPublicClient(network);
  const epochState = getEpochTimingState();

  const [blockNumber, globalMulticall] = await Promise.all([
    client.getBlockNumber(),
    client.multicall({
      contracts: [
        { address: cfg.veMEZO, abi: VOTING_ESCROW_ABI, functionName: "supply" },
        { address: cfg.veMEZO, abi: VOTING_ESCROW_ABI, functionName: "totalVotingPower" },
        { address: cfg.veMEZO, abi: VOTING_ESCROW_ABI, functionName: "permanentLockBalance" },
        { address: cfg.veBTC, abi: VOTING_ESCROW_ABI, functionName: "supply" },
        { address: cfg.veBTC, abi: VOTING_ESCROW_ABI, functionName: "totalVotingPower" },
        { address: cfg.boostVoter, abi: BOOST_VOTER_ABI, functionName: "totalWeight" },
        { address: cfg.boostVoter, abi: BOOST_VOTER_ABI, functionName: "length" },
        { address: cfg.thirdPartyVoter, abi: THIRD_PARTY_VOTER_ABI, functionName: "totalWeight" },
        { address: cfg.thirdPartyVoter, abi: THIRD_PARTY_VOTER_ABI, functionName: "length" },
        { address: cfg.poolsVoter, abi: BOOST_VOTER_ABI, functionName: "totalWeight" },
        { address: cfg.musd, abi: parseAbi(["function totalSupply() view returns (uint256)"]), functionName: "totalSupply" },
        { address: TIGRIS_BTC_MUSD_POOL, abi: TIGRIS_POOL_RESERVES_ABI, functionName: "getReserves" },
      ],
      allowFailure: true,
    }),
  ]);

  const toNum18 = (val: unknown) =>
    typeof val === "bigint" ? Number(formatUnits(val, 18)) : 0;

  const veMezoLockedTotal = toNum18(globalMulticall[0].result);
  const veMezoTotalVotingPower = toNum18(globalMulticall[1].result);
  const veMezoPermanentLocked = toNum18(globalMulticall[2].result);
  const veBtcLockedTotal = toNum18(globalMulticall[3].result);
  const veBtcTotalVotingPower = toNum18(globalMulticall[4].result);
  const boostVoterTotalWeight = toNum18(globalMulticall[5].result);
  const boostVoterGaugeCount = Number(globalMulticall[6].result ?? 0n);
  const thirdPartyVoterTotalWeight = toNum18(globalMulticall[7].result);
  const thirdPartyVoterGaugeCount = Number(globalMulticall[8].result ?? 0n);
  const poolsVoterTotalWeight = toNum18(globalMulticall[9].result);
  const musdTotalSupply = toNum18(globalMulticall[10].result);

  let btcPriceUsd = 81_015;
  if (
    globalMulticall[11]?.status === "success" &&
    Array.isArray(globalMulticall[11].result)
  ) {
    const [r0, r1] = globalMulticall[11].result as unknown as [bigint, bigint, bigint];
    const btcRes = toNum18(r0);
    const musdRes = toNum18(r1);
    if (btcRes > 0.01 && musdRes > 1_000) {
      btcPriceUsd = Math.round(musdRes / btcRes);
    }
  }

  // M3: Live MEZO price from Tigris MEZO/MUSD pool (fallback: 0.085)
  let mezoPriceUsd = 0.085;
  try {
    const mezoPoolRes = await client.readContract({
      address: TIGRIS_MEZO_MUSD_POOL,
      abi: TIGRIS_POOL_RESERVES_ABI,
      functionName: "getReserves",
    });
    const mezoRes = toNum18(mezoPoolRes[0]);
    const musdRes = toNum18(mezoPoolRes[1]);
    if (mezoRes > 100 && musdRes > 1) {
      mezoPriceUsd = musdRes / mezoRes;
    }
  } catch {
    // ponytail: pool may not exist yet — keep fallback
  }

  // M3: Live sMUSD exchange rate from ERC-4626 convertToAssets (fallback: 1.04)
  let sMusdPriceUsd = 1.04;
  if (cfg.sMusd !== "0x0000000000000000000000000000000000000000") {
    try {
      const rate = await client.readContract({
        address: cfg.sMusd,
        abi: SMUSD_PREVIEW_ABI,
        functionName: "convertToAssets",
        args: [BigInt(1e18)],
      });
      const rateNum = toNum18(rate);
      if (rateNum > 0.9 && rateNum < 2.0) sMusdPriceUsd = rateNum;
    } catch {
      // ponytail: sMUSD may not be deployed — keep fallback
    }
  }

  // Update mutable price table with live values
  TOKEN_PRICES_USD["0x7b7c000000000000000000000000000000000000"].priceUsd = btcPriceUsd;
  TOKEN_PRICES_USD["0x7b7c000000000000000000000000000000000001"].priceUsd = mezoPriceUsd;
  if (TOKEN_PRICES_USD["0xb4d498029af77680cd1ef828b967f010d06c51cc"]) {
    TOKEN_PRICES_USD["0xb4d498029af77680cd1ef828b967f010d06c51cc"].priceUsd = sMusdPriceUsd;
  }

  // 1) Index ALL ThirdPartyVoter (MEZO MUSD Gauges) + top active BoostVoter Gauges
  const tpIndices = Array.from({ length: thirdPartyVoterGaugeCount }, (_, i) => i);

  // Include verified top-weight Mainnet BoostVoter gauge indices + head/tail window
  const boostSampleSet = new Set<number>();
  const priorityBoostIndices = [
    669, 36, 123, 387, 549, 509, 391, 63, 392, 702, 215, 596, 90, 142, 203,
  ];
  for (const idx of priorityBoostIndices) {
    if (idx < boostVoterGaugeCount) boostSampleSet.add(idx);
  }
  const headCount = Math.min(25, boostVoterGaugeCount);
  for (let i = 0; i < headCount; i++) boostSampleSet.add(i);
  if (boostVoterGaugeCount > 25) {
    const tailStart = Math.max(25, boostVoterGaugeCount - 25);
    for (let i = tailStart; i < boostVoterGaugeCount; i++) {
      boostSampleSet.add(i);
    }
  }
  const boostSampleIndices = Array.from(boostSampleSet);

  const gaugeAddrCalls = [
    ...tpIndices.map((idx) => ({
      address: cfg.thirdPartyVoter,
      abi: THIRD_PARTY_VOTER_ABI,
      functionName: "gauges" as const,
      args: [BigInt(idx)] as const,
    })),
    ...boostSampleIndices.map((idx) => ({
      address: cfg.boostVoter,
      abi: BOOST_VOTER_ABI,
      functionName: "gauges" as const,
      args: [BigInt(idx)] as const,
    })),
  ];

  const gaugeAddrResults = await client.multicall({
    contracts: gaugeAddrCalls,
    allowFailure: true,
  });

  const tpGaugeAddresses = gaugeAddrResults
    .slice(0, tpIndices.length)
    .map((r) => (r.status === "success" ? (r.result as Address) : null))
    .filter((a): a is Address => Boolean(a));

  const boostGaugeAddresses = gaugeAddrResults
    .slice(tpIndices.length)
    .map((r) => (r.status === "success" ? (r.result as Address) : null))
    .filter((a): a is Address => Boolean(a));

  // Fetch weights, gaugeToBribe, isAlive, and on-chain rewardRate for all discovered gauges
  const detailCalls = [
    ...tpGaugeAddresses.flatMap((g) => [
      { address: cfg.thirdPartyVoter, abi: THIRD_PARTY_VOTER_ABI, functionName: "weights" as const, args: [g] as const },
      { address: cfg.thirdPartyVoter, abi: THIRD_PARTY_VOTER_ABI, functionName: "gaugeToBribe" as const, args: [g] as const },
      { address: cfg.thirdPartyVoter, abi: THIRD_PARTY_VOTER_ABI, functionName: "isAlive" as const, args: [g] as const },
      { address: g, abi: NON_STAKING_GAUGE_ABI, functionName: "rewardRate" as const },
    ]),
    ...boostGaugeAddresses.flatMap((g) => [
      { address: cfg.boostVoter, abi: BOOST_VOTER_ABI, functionName: "weights" as const, args: [g] as const },
      { address: cfg.boostVoter, abi: BOOST_VOTER_ABI, functionName: "gaugeToBribe" as const, args: [g] as const },
      { address: cfg.boostVoter, abi: BOOST_VOTER_ABI, functionName: "isAlive" as const, args: [g] as const },
    ]),
  ];

  const detailResults = await client.multicall({
    contracts: detailCalls,
    allowFailure: true,
  });

  const gauges: GaugeOpportunity[] = [];
  const bribeContractsToInspect: { gaugeIndex: number; bribeAddress: Address }[] = [];

  let cursor = 0;
  for (let i = 0; i < tpGaugeAddresses.length; i++) {
    const gAddr = tpGaugeAddresses[i];
    const weight = toNum18(detailResults[cursor]?.result);
    const bribeAddr = (detailResults[cursor + 1]?.result as Address) ?? "0x0000000000000000000000000000000000000000";
    const isAlive = Boolean(detailResults[cursor + 2]?.result);
    const rewardRatePerSec = toNum18(detailResults[cursor + 3]?.result);
    cursor += 4;

    if (!isAlive && weight <= 0) continue;

    const known = KNOWN_THIRD_PARTY_GAUGES[gAddr.toLowerCase()];
    const shareOfTp =
      thirdPartyVoterTotalWeight > 0 ? weight / thirdPartyVoterTotalWeight : 0.25;
    const liveWeeklyEmission = Math.round(rewardRatePerSec * 604_800);
    const estimatedEmissionMezo =
      liveWeeklyEmission > 0 ? liveWeeklyEmission : Math.round(396_672 * shareOfTp);

    const idx = gauges.length;
    gauges.push({
      id: `tp-${gAddr.toLowerCase()}`,
      voterType: "thirdParty",
      gaugeAddress: gAddr,
      bribeAddress: bribeAddr,
      voteTargetAddress: gAddr,
      label: known?.name ?? `MEZO Remote MUSD Gauge #${i}`,
      sublabel: known ? `${known.protocol} · ${known.pair}` : "Off-Chain MUSD Liquidity Gauge",
      chainLabel: known?.chain ?? "Multi-Chain",
      currentVotes: weight,
      totalBribeUsd: 0,
      bribeTokens: [],
      isAlive,
      musdIntegrated: true,
      estimatedEmissionMezo,
    });
    bribeContractsToInspect.push({ gaugeIndex: idx, bribeAddress: bribeAddr });
  }

  const minBoostWeight = network === "mainnet" ? 50_000 : 1;
  for (let i = 0; i < boostGaugeAddresses.length; i++) {
    const gAddr = boostGaugeAddresses[i];
    const weight = toNum18(detailResults[cursor]?.result);
    const bribeAddr = (detailResults[cursor + 1]?.result as Address) ?? "0x0000000000000000000000000000000000000000";
    const isAlive = Boolean(detailResults[cursor + 2]?.result);
    cursor += 3;

    if (!isAlive || weight < minBoostWeight) continue;

    const veBtcId = KNOWN_BOOST_GAUGE_VEBTC_IDS[gAddr.toLowerCase()] ?? 0;

    const idx = gauges.length;
    gauges.push({
      id: `boost-${gAddr.toLowerCase()}`,
      voterType: "boost",
      gaugeAddress: gAddr,
      bribeAddress: bribeAddr,
      voteTargetAddress: gAddr,
      label:
        veBtcId > 0
          ? `veBTC Lock #${veBtcId} Boost`
          : `veBTC Boost ${gAddr.slice(0, 6)}…${gAddr.slice(-4)}`,
      sublabel:
        veBtcId > 0
          ? `BoostVoter · Target veBTC #${veBtcId}`
          : `BoostVoter · ${gAddr.slice(0, 8)}…${gAddr.slice(-4)}`,
      chainLabel: "Mezo",
      targetVeBtcId: veBtcId > 0 ? veBtcId : undefined,
      currentVotes: weight,
      totalBribeUsd: 0,
      bribeTokens: [],
      isAlive,
      musdIntegrated: true,
    });
    bribeContractsToInspect.push({ gaugeIndex: idx, bribeAddress: bribeAddr });
  }

  // Query live BribeVotingReward epoch rewards for MEZO, MUSD, and BTC on each gauge's bribe contract
  const epochStartBig = BigInt(epochState.epochStart);
  const prevEpochStartBig = BigInt(epochState.epochStart - 604_800);
  const trackedTokens: Address[] = [cfg.musd, cfg.mezo, cfg.btc];

  const bribeCalls = bribeContractsToInspect.flatMap((item) =>
    trackedTokens.flatMap((tokenAddr) => [
      {
        address: item.bribeAddress,
        abi: BRIBE_VOTING_REWARD_ABI,
        functionName: "tokenRewardsPerEpoch" as const,
        args: [tokenAddr, epochStartBig] as const,
      },
      {
        address: item.bribeAddress,
        abi: BRIBE_VOTING_REWARD_ABI,
        functionName: "tokenRewardsPerEpoch" as const,
        args: [tokenAddr, prevEpochStartBig] as const,
      },
    ])
  );

  if (bribeCalls.length > 0) {
    const bribeResults = await client.multicall({
      contracts: bribeCalls,
      allowFailure: true,
    });

    let bCursor = 0;
    for (const item of bribeContractsToInspect) {
      const gauge = gauges[item.gaugeIndex];
      let gaugeBribeUsd = 0;
      const tokens: BribeTokenReward[] = [];

      for (const tokenAddr of trackedTokens) {
        const curEpochRaw = bribeResults[bCursor]?.result;
        const prevEpochRaw = bribeResults[bCursor + 1]?.result;
        bCursor += 2;

        // Use current epoch bribe if posted, or previous epoch run-rate if early in epoch
        const activeRaw =
          typeof curEpochRaw === "bigint" && curEpochRaw > 0n
            ? curEpochRaw
            : includeProjectedBribeFloor && typeof prevEpochRaw === "bigint"
            ? prevEpochRaw
            : 0n;

        if (activeRaw > 0n) {
          const meta = TOKEN_PRICES_USD[tokenAddr.toLowerCase()] ?? {
            symbol: "ERC20",
            decimals: 18,
            priceUsd: 1.0,
          };
          const amount = Number(formatUnits(activeRaw, meta.decimals));
          const usdValue = amount * meta.priceUsd;
          if (usdValue > 0.01) {
            gaugeBribeUsd += usdValue;
            tokens.push({
              tokenAddress: tokenAddr,
              symbol: meta.symbol,
              amount,
              usdValue,
            });
          }
        }
      }

      // M4: If includeProjectedBribeFloor is enabled and a live gauge has active votes,
      // model projected bribes from gauge weight share × observed protocol clearing rate.
      if (includeProjectedBribeFloor && gaugeBribeUsd < 1 && gauge.currentVotes > 0) {
        tokens.length = 0;
        if (gauge.voterType === "thirdParty") {
          // ThirdPartyVoter clearing rate: ~$0.31/1k veMEZO from observed MUSD+MEZO incentives
          const weightShare = thirdPartyVoterTotalWeight > 0
            ? gauge.currentVotes / thirdPartyVoterTotalWeight
            : 0.25;
          const syntheticMusd = Math.round(
            Math.max(450, weightShare * 12_000)
          );
          const syntheticMezo = Math.round(syntheticMusd * 6.5);
          const mezoUsd = syntheticMezo * mezoPriceUsd;
          gaugeBribeUsd = syntheticMusd + mezoUsd;
          tokens.push(
            {
              tokenAddress: cfg.musd,
              symbol: "MUSD",
              amount: syntheticMusd,
              usdValue: syntheticMusd,
            },
            {
              tokenAddress: cfg.mezo,
              symbol: "MEZO",
              amount: syntheticMezo,
              usdValue: mezoUsd,
            }
          );
        } else {
          // BoostVoter gauge: derive from weight share × observed clearing rate (~$0.85/1k veMEZO avg)
          const weightShare = boostVoterTotalWeight > 0
            ? gauge.currentVotes / boostVoterTotalWeight
            : 0;
          const totalUsd = Math.max(
            18,
            Math.round(weightShare * boostVoterTotalWeight / 1_000 * 0.85)
          );
          const musdPortion = Math.round(totalUsd * 0.6);
          const mezoAmount = Math.round((totalUsd * 0.4) / Math.max(mezoPriceUsd, 0.001));
          gaugeBribeUsd = musdPortion + mezoAmount * mezoPriceUsd;
          tokens.push(
            {
              tokenAddress: cfg.musd,
              symbol: "MUSD",
              amount: musdPortion,
              usdValue: musdPortion,
            },
            {
              tokenAddress: cfg.mezo,
              symbol: "MEZO",
              amount: mezoAmount,
              usdValue: mezoAmount * mezoPriceUsd,
            }
          );
        }
        gauge.isProjectedBribe = true;
      }

      gauge.totalBribeUsd = gaugeBribeUsd;
      gauge.bribeTokens = tokens;
    }
  }

  // Sort gauges: ThirdPartyVoter MUSD gauges first by weight, then BoostVoter gauges by bribe efficiency
  gauges.sort((a, b) => {
    if (a.voterType !== b.voterType) {
      return a.voterType === "thirdParty" ? -1 : 1;
    }
    const ratioA = a.totalBribeUsd / Math.max(a.currentVotes, 100);
    const ratioB = b.totalBribeUsd / Math.max(b.currentVotes, 100);
    return ratioB - ratioA;
  });

  const safeTotalVeMezo = Math.max(veMezoTotalVotingPower, 1);
  const boostUtilizationPercent = Math.min(
    100,
    (boostVoterTotalWeight / safeTotalVeMezo) * 100
  );
  const thirdPartyUtilizationPercent = Math.min(
    100,
    (thirdPartyVoterTotalWeight / safeTotalVeMezo) * 100
  );

  return {
    network,
    chainId: cfg.chainId,
    blockNumber: Number(blockNumber),
    fetchedAtIso: new Date().toISOString(),
    mezoPriceUsd,
    btcPriceUsd,
    musdPriceUsd: 1.0,
    veMezoLockedTotal,
    veMezoTotalVotingPower,
    veMezoPermanentLocked,
    veBtcLockedTotal,
    veBtcTotalVotingPower,
    boostVoterTotalWeight,
    boostVoterGaugeCount,
    thirdPartyVoterTotalWeight,
    thirdPartyVoterGaugeCount,
    poolsVoterTotalWeight,
    musdTotalSupply,
    boostUtilizationPercent,
    thirdPartyUtilizationPercent,
    idleBoostVotingPower: Math.max(0, veMezoTotalVotingPower - boostVoterTotalWeight),
    idleThirdPartyVotingPower: Math.max(
      0,
      veMezoTotalVotingPower - thirdPartyVoterTotalWeight
    ),
    gauges,
  };
}

/**
 * Inspects any live veMEZO tokenId (and optional paired veBTC tokenId) on-chain via Multicall3.
 */
export async function inspectOnChainPosition(
  network: NetworkKey,
  veMezoTokenId: number,
  veBtcTokenId?: number
): Promise<InspectedNftPosition> {
  const cfg = PROTOCOL_CONFIG[network];
  const client = getPublicClient(network);
  const epochState = getEpochTimingState();
  const idBig = BigInt(Math.max(1, veMezoTokenId));

  const contracts = [
    { address: cfg.veMEZO, abi: VOTING_ESCROW_ABI, functionName: "ownerOf" as const, args: [idBig] as const },
    { address: cfg.veMEZO, abi: VOTING_ESCROW_ABI, functionName: "votingPowerOfNFT" as const, args: [idBig] as const },
    { address: cfg.veMEZO, abi: VOTING_ESCROW_ABI, functionName: "locked" as const, args: [idBig] as const },
    { address: cfg.boostVoter, abi: BOOST_VOTER_ABI, functionName: "usedWeights" as const, args: [idBig] as const },
    { address: cfg.boostVoter, abi: BOOST_VOTER_ABI, functionName: "lastVoted" as const, args: [idBig] as const },
    { address: cfg.thirdPartyVoter, abi: THIRD_PARTY_VOTER_ABI, functionName: "usedWeights" as const, args: [idBig] as const },
    { address: cfg.thirdPartyVoter, abi: THIRD_PARTY_VOTER_ABI, functionName: "lastVoted" as const, args: [idBig] as const },
    { address: cfg.veMezoRewardsDistributor, abi: REWARDS_DISTRIBUTOR_ABI, functionName: "claimable" as const, args: [idBig] as const },
  ];

  const btcIdBig = veBtcTokenId && veBtcTokenId > 0 ? BigInt(veBtcTokenId) : null;
  const btcContracts = btcIdBig
    ? [
        { address: cfg.veBTC, abi: VOTING_ESCROW_ABI, functionName: "votingPowerOfNFT" as const, args: [btcIdBig] as const },
        { address: cfg.veBTC, abi: VOTING_ESCROW_ABI, functionName: "locked" as const, args: [btcIdBig] as const },
        { address: cfg.boostVoter, abi: BOOST_VOTER_ABI, functionName: "getBoost" as const, args: [btcIdBig] as const },
        { address: cfg.boostVoter, abi: BOOST_VOTER_ABI, functionName: "boostableTokenIdToGauge" as const, args: [btcIdBig] as const },
      ]
    : [];

  const res = await client.multicall({
    contracts: [...contracts, ...btcContracts],
    allowFailure: true,
  });

  const toNum18 = (val: unknown) =>
    typeof val === "bigint" ? Number(formatUnits(val, 18)) : 0;

  const owner =
    res[0].status === "success"
      ? (res[0].result as Address)
      : "0x0000000000000000000000000000000000000000";
  const votingPowerVeMezo = toNum18(res[1].result);

  let lockedMezo = 0;
  let lockEndUnix = 0;
  let isPermanent = false;
  if (res[2].status === "success" && Array.isArray(res[2].result)) {
    const [amt, end, perm] = res[2].result as [bigint, bigint, boolean];
    lockedMezo = Number(formatUnits(amt < 0n ? -amt : amt, 18));
    lockEndUnix = Number(end);
    isPermanent = Boolean(perm);
  }

  const boostUsedWeight = toNum18(res[3].result);
  const boostLastVoted = Number(res[4].result ?? 0n);
  const thirdPartyUsedWeight = toNum18(res[5].result);
  const thirdPartyLastVoted = Number(res[6].result ?? 0n);
  const claimableRebaseMezo = toNum18(res[7].result);

  const position: InspectedNftPosition = {
    veMezoTokenId,
    owner,
    lockedMezo,
    votingPowerVeMezo,
    lockEndUnix,
    isPermanent,
    boostUsedWeight,
    boostLastVoted,
    boostVotedThisEpoch: boostLastVoted >= epochState.epochStart,
    thirdPartyUsedWeight,
    thirdPartyLastVoted,
    thirdPartyVotedThisEpoch: thirdPartyLastVoted >= epochState.epochStart,
    claimableRebaseMezo,
  };

  if (btcIdBig && res.length >= 12) {
    position.veBtcTokenId = veBtcTokenId;
    position.unboostedVeBtc = toNum18(res[8].result);
    if (res[9].status === "success" && Array.isArray(res[9].result)) {
      const [amt] = res[9].result as [bigint, bigint, boolean];
      position.lockedBtc = Number(formatUnits(amt < 0n ? -amt : amt, 18));
    }
    const rawBoost = toNum18(res[10].result);
    position.currentBoostMultiplier = rawBoost >= 1 ? rawBoost : 1.0;
    position.veBtcBoostGauge =
      res[11].status === "success"
        ? (res[11].result as Address)
        : "0x0000000000000000000000000000000000000000";
  }

  return position;
}
