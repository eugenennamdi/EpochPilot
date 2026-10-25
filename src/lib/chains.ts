import { defineChain, parseAbi, type Address } from "viem";

export const mezoMainnet = defineChain({
  id: 31612,
  name: "Mezo Mainnet",
  nativeCurrency: {
    decimals: 18,
    name: "Bitcoin",
    symbol: "BTC",
  },
  rpcUrls: {
    default: {
      http: [
        "https://mezo-mainnet.boar.network",
        "https://mainnet.mezo.public.validationcloud.io",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Mezo Explorer",
      url: "https://explorer.mezo.org",
    },
  },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
  },
});

export const mezoTestnet = defineChain({
  id: 31611,
  name: "Mezo Matsnet Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "Testnet Bitcoin",
    symbol: "BTC",
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.test.mezo.org"],
    },
  },
  blockExplorers: {
    default: {
      name: "Mezo Testnet Explorer",
      url: "https://explorer.test.mezo.org",
    },
  },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
  },
});

export type NetworkKey = "mainnet" | "testnet";

export interface MezoProtocolAddresses {
  chainId: number;
  chainName: string;
  explorerUrl: string;
  explorerApi: string;
  rpcUrl: string;
  btc: Address;
  mezo: Address;
  musd: Address;
  sMusd: Address;
  veMEZO: Address;
  veBTC: Address;
  boostVoter: Address;
  thirdPartyVoter: Address;
  poolsVoter: Address;
  veMezoRewardsDistributor: Address;
  veBtcRewardsDistributor: Address;
  tigrisRouter: Address;
  poolFactory: Address;
  multicall3: Address;
}

export const PROTOCOL_CONFIG: Record<NetworkKey, MezoProtocolAddresses> = {
  mainnet: {
    chainId: 31612,
    chainName: "Mezo Mainnet",
    explorerUrl: "https://explorer.mezo.org",
    explorerApi: "https://api.explorer.mezo.org/api/v2",
    rpcUrl: "https://mezo-mainnet.boar.network",
    btc: "0x7b7C000000000000000000000000000000000000",
    mezo: "0x7B7c000000000000000000000000000000000001",
    musd: "0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186",
    sMusd: "0xb4D498029af77680cD1eF828b967f010d06C51CC",
    veMEZO: "0xb90fdAd3DFD180458D62Cc6acedc983D78E20122",
    veBTC: "0x3D4b1b884A7a1E59fE8589a3296EC8f8cBB6f279",
    boostVoter: "0x2ba614a598cffa5a19d683cdca97bac3a49313d1",
    thirdPartyVoter: "0x2e6d2f2cacc1d24f9f9358030674eb307397a6eb",
    poolsVoter: "0x48233cCC97B87Ba93bCA212cbEe48e3210211f03",
    veMezoRewardsDistributor: "0x075108f275ed81c9cfc01065e6e50ceea81d6363",
    veBtcRewardsDistributor: "0xb58477e074265bdc7f7ca6100ed0f7de264f74a2",
    tigrisRouter: "0x16A76d3cd3C1e3CE843C6680d6B37E9116b5C706",
    poolFactory: "0x83FE469C636C4081b87bA5b3Ae9991c6Ed104248",
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  },
  testnet: {
    chainId: 31611,
    chainName: "Mezo Matsnet Testnet",
    explorerUrl: "https://explorer.test.mezo.org",
    explorerApi: "https://api.explorer.test.mezo.org/api/v2",
    rpcUrl: "https://rpc.test.mezo.org",
    btc: "0x7b7C000000000000000000000000000000000000",
    mezo: "0x7B7c000000000000000000000000000000000001",
    musd: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503",
    sMusd: "0x0000000000000000000000000000000000000000",
    veMEZO: "0xaCE816CA2bcc9b12C59799dcC5A959Fb9b98111b",
    veBTC: "0x38E35d92E6Bfc6787272A62345856B13eA12130a",
    boostVoter: "0x21d7bdf5a5929ad179f8ca0c9014a0b62ae6bfd1",
    thirdPartyVoter: "0x62fe6d71be2ac2806da046bf93b02c279246251d",
    poolsVoter: "0x263f1fd5fb7f866881e1b6cd7d5d6c40fd985f0d",
    veMezoRewardsDistributor: "0x2962e8817ae716019f759d098e2cae658bdcad04",
    veBtcRewardsDistributor: "0x9050218f89f0b5b17df4a30ba4fc97c72e307442",
    tigrisRouter: "0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9",
    poolFactory: "0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A",
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  },
};

export const KNOWN_THIRD_PARTY_GAUGES: Record<
  string,
  { name: string; chain: string; protocol: string; pair: string; musdIntegrated: boolean }
> = {
  "0xc7e81dd77a4624f0dd14a8bb97bc721b0cee6e26": {
    name: "Aerodrome USDC/MUSD CL10",
    chain: "Base",
    protocol: "Aerodrome Slipstream",
    pair: "USDC / MUSD",
    musdIntegrated: true,
  },
  "0x4440a9b2954cb98416c0122e2ea996c46555f4b6": {
    name: "Aerodrome MEZO/MUSD CL200",
    chain: "Base",
    protocol: "Aerodrome Slipstream",
    pair: "MEZO / MUSD",
    musdIntegrated: true,
  },
  "0x2ced96e759ab481210d41c567eee5c42edb59a1d": {
    name: "Curve USDT/USDC/MUSD",
    chain: "Ethereum",
    protocol: "Curve · MUSD / 2Pool",
    pair: "MUSD / USDC / USDT",
    musdIntegrated: true,
  },
  "0xc39a294024dca62f579c49d7c83a6c831d4976d0": {
    name: "Uniswap USDC/MUSD",
    chain: "Ethereum",
    protocol: "Uniswap v4 · Fee 100",
    pair: "USDC / MUSD",
    musdIntegrated: true,
  },
  "0xf453fc7481a1d36eb57cf227afb5bfe7170d61a8": {
    name: "Testnet Remote MUSD Gauge",
    chain: "Mezo",
    protocol: "testertesting.eth · Test Gauge",
    pair: "MUSD / MEZO",
    musdIntegrated: true,
  },
};

export const KNOWN_BOOST_GAUGE_VEBTC_IDS: Record<string, number> = {
  "0x449b06b9b6c9b649b610105d1a5e337e1d6d3d1e": 6033,
  "0x5893a3fbb51dd117c08cf0407103ce0809aac406": 1226,
  "0x51a0df462583e9438c1b18b3f6c2dd07b4546cd9": 848,
  "0x404743ad26e8106a9e63a14411daf9f87c44d317": 5651,
  "0x299702517681a443d04a8cbc4599fd40b20f50c7": 1048,
  "0x30f957d6e3e24485fd37bb028b0e147742971735": 5808,
  "0x0c1f692efd5fa0f5e07cf759ae61f3dd6c389de8": 5655,
  "0xd4073c7289bfc4fa908d4c5baa91ef3eb808c1e6": 98,
  "0xf9428b10f93468ba6e7fb28a896a40e41a0636ae": 5657,
  "0xde8ade7a0931f88644f7e2e5b8343c5be04f12dd": 6087,
  "0x769cd3108a08507408e8afef8886faad8a749fa2": 2396,
  "0x90abe24f45f3e39646abe6098ce6798befbf3ff7": 556,
  "0x715b27ba2fe4ffc886f81e50c4efed694c66d89d": 613,
};

export const VOTING_ESCROW_ABI = parseAbi([
  "function supply() view returns (uint256)",
  "function totalVotingPower() view returns (uint256)",
  "function permanentLockBalance() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function votingPowerOfNFT(uint256 tokenId) view returns (uint256)",
  "function unboostedVotingPowerOfNFT(uint256 tokenId) view returns (uint256)",
  "function ownerToNFTokenIdList(address owner, uint256 index) view returns (uint256)",
  "function tokenId() view returns (uint256)",
  "function createLock(uint256 _value, uint256 _lockDuration) returns (uint256)",
  "function locked(uint256 tokenId) view returns (int128 amount, uint256 end, bool isPermanent)",
  "function voted(uint256 tokenId) view returns (bool)",
  "function isApprovedOrOwner(address spender, uint256 tokenId) view returns (bool)",
  "function approve(address to, uint256 tokenId)",
  "function setApprovalForAll(address operator, bool approved)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function getApproved(uint256 tokenId) view returns (address)",
]);

export const BOOST_VOTER_ABI = parseAbi([
  "function totalWeight() view returns (uint256)",
  "function length() view returns (uint256)",
  "function gauges(uint256 index) view returns (address)",
  "function gaugeToBribe(address gauge) view returns (address)",
  "function weights(address gauge) view returns (uint256)",
  "function isAlive(address gauge) view returns (bool)",
  "function usedWeights(uint256 tokenId) view returns (uint256)",
  "function lastVoted(uint256 tokenId) view returns (uint256)",
  "function votes(uint256 tokenId, address gauge) view returns (uint256)",
  "function boostableTokenIdToGauge(uint256 veBtcTokenId) view returns (address)",
  "function getBoost(uint256 veBtcTokenId) view returns (uint256)",
  "function vote(uint256 _tokenId, address[] _poolVote, uint256[] _weights)",
  "function addBribes(address _gauge, address[] _tokens, uint256[] _amounts)",
  "function reset(uint256 _tokenId)",
  "function poke(uint256 _tokenId)",
  "function pokeBoost(uint256 _veBtcTokenId)",
  "function pokeBoosts(uint256[] _veBtcTokenIds)",
  "function claimBribes(address[] _bribes, address[][] _tokens, uint256 _tokenId)",
]);

export const THIRD_PARTY_VOTER_ABI = parseAbi([
  "function totalWeight() view returns (uint256)",
  "function length() view returns (uint256)",
  "function gauges(uint256 index) view returns (address)",
  "function gaugeToBribe(address gauge) view returns (address)",
  "function thirdPartyToGauge(address thirdParty) view returns (address gauge, string metadata)",
  "function weights(address gauge) view returns (uint256)",
  "function isAlive(address gauge) view returns (bool)",
  "function usedWeights(uint256 tokenId) view returns (uint256)",
  "function lastVoted(uint256 tokenId) view returns (uint256)",
  "function votes(uint256 tokenId, address gauge) view returns (uint256)",
  "function vote(uint256 _tokenId, address[] _gaugeVote, uint256[] _weights)",
  "function addBribes(address _gauge, address[] _tokens, uint256[] _amounts)",
  "function reset(uint256 _tokenId)",
  "function poke(uint256 _tokenId)",
  "function claimBribes(address[] _bribes, address[][] _tokens, uint256 _tokenId)",
]);

export const BRIBE_VOTING_REWARD_ABI = parseAbi([
  "function rewardsListLength() view returns (uint256)",
  "function rewards(uint256 index) view returns (address)",
  "function tokenRewardsPerEpoch(address token, uint256 epochStart) view returns (uint256)",
  "function earned(address token, uint256 tokenId) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(uint256 tokenId) view returns (uint256)",
  "function getReward(uint256 tokenId, address[] tokens)",
  "function notifyRewardAmount(address token, uint256 amount)",
]);

export const REWARDS_DISTRIBUTOR_ABI = parseAbi([
  "function claimable(uint256 tokenId) view returns (uint256)",
  "function claim(uint256 tokenId) returns (uint256)",
]);

export const ERC20_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export const EPOCH_PILOT_ROUTER_ABI = parseAbi([
  "function executeOptimalEpochVote(uint256 veMezoTokenId, address[] boostTargets, uint256[] boostWeights, address[] thirdPartyGauges, uint256[] thirdPartyWeights, uint256[] veBtcIdsToPokeBoost, bool claimRebase)",
  "function claimAndCompoundToMUSD(uint256 veMezoTokenId, address[] bribeContracts, address[][] bribeTokens, address[] tokensToSwap, uint256[] minMusdOuts, bool[] useStablePool, bool stakeIntoSMusd) returns (uint256)",
  "function postCrossPairBribeAndPoke(address bribeContract, address rewardToken, uint256 amount, uint256 veBtcTokenId, bool pokePoolsVoter)",
]);
