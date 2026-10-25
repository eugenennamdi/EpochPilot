"use client";

import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  formatUnits,
  http,
  isAddress,
  parseUnits,
  type Address,
} from "viem";
import {
  useAccount,
  useConnect,
  useConnections,
  useDisconnect,
  useSwitchChain,
  useWalletClient,
  type Connector,
} from "wagmi";
import {
  ArrowUpRight,
  Check,
  Copy,
  Moon,
  Sun,
  ArrowsClockwise,
  SlidersHorizontal,
  Code,
  WarningCircle,
  Wallet,
  SignOut,
  CaretDown,
  X,
  ArrowsLeftRight,
} from "@phosphor-icons/react";
import {
  BOOST_VOTER_ABI,
  BRIBE_VOTING_REWARD_ABI,
  EPOCH_PILOT_ROUTER_ABI,
  ERC20_ABI,
  mezoMainnet,
  mezoTestnet,
  PROTOCOL_CONFIG,
  REWARDS_DISTRIBUTOR_ABI,
  THIRD_PARTY_VOTER_ABI,
  VOTING_ESCROW_ABI,
  type NetworkKey,
} from "@/lib/chains";
import {
  evaluateCrossPairStrategy,
  getEpochTimingState,
  optimizeDualVoterPortfolio,
} from "@/lib/optimizer";
import {
  EPOCH_PILOT_ROUTER_BYTECODE,
  EPOCH_PILOT_ROUTER_COMPILED_ABI,
} from "@/lib/routerArtifact";
import type {
  InspectedNftPosition,
  ProtocolTelemetry,
} from "@/lib/indexer";

interface Props {
  initialTelemetry: ProtocolTelemetry;
  initialPosition: InspectedNftPosition;
}

const DEPLOYED_TESTNET_ROUTER =
  "0x938419eB410b5fc2785a17DcCE80f405508Af8ad";
const VERIFIED_TESTNET_DEPLOY_TX =
  "0x0fa47491850b687f8decbc24e4b1e162bf1afdc853a0b013797f07da1a0a2e1b";
const VERIFIED_TESTNET_OPERATOR =
  "0x727eE5DC96E729d8f6C6930cd02ad1695498f3B8";

const PRESET_POSITIONS_BY_NETWORK: Record<
  NetworkKey,
  {
    label: string;
    veMezoId: number;
    veBtcId: number;
    defaultPower: number;
    defaultVeBtcWeight: number;
    defaultBaseFee: number;
    defaultBribeRate: number;
  }[]
> = {
  mainnet: [
    {
      label: "Whale #148",
      veMezoId: 148,
      veBtcId: 98,
      defaultPower: 1_217_233,
      defaultVeBtcWeight: 25.0,
      defaultBaseFee: 64,
      defaultBribeRate: 0.42,
    },
    {
      label: "Pair #96",
      veMezoId: 96,
      veBtcId: 2396,
      defaultPower: 496_012,
      defaultVeBtcWeight: 12.5,
      defaultBaseFee: 58,
      defaultBribeRate: 0.42,
    },
    {
      label: "Voter #342",
      veMezoId: 342,
      veBtcId: 848,
      defaultPower: 152_970,
      defaultVeBtcWeight: 1.5,
      defaultBaseFee: 44,
      defaultBribeRate: 0.72,
    },
    {
      label: "Retail #71",
      veMezoId: 71,
      veBtcId: 3923,
      defaultPower: 34_012,
      defaultVeBtcWeight: 0.5,
      defaultBaseFee: 44,
      defaultBribeRate: 0.72,
    },
  ],
  testnet: [
    {
      label: "Whale #682",
      veMezoId: 682,
      veBtcId: 8,
      defaultPower: 1_033_311,
      defaultVeBtcWeight: 22.0,
      defaultBaseFee: 64,
      defaultBribeRate: 0.42,
    },
    {
      label: "Pair #48",
      veMezoId: 48,
      veBtcId: 8,
      defaultPower: 461_872,
      defaultVeBtcWeight: 11.5,
      defaultBaseFee: 58,
      defaultBribeRate: 0.42,
    },
    {
      label: "Voter #161",
      veMezoId: 161,
      veBtcId: 8,
      defaultPower: 146_585,
      defaultVeBtcWeight: 1.5,
      defaultBaseFee: 44,
      defaultBribeRate: 0.72,
    },
    {
      label: "Retail #597",
      veMezoId: 597,
      veBtcId: 8,
      defaultPower: 32_285,
      defaultVeBtcWeight: 0.5,
      defaultBaseFee: 44,
      defaultBribeRate: 0.72,
    },
  ],
};

function formatCompactDuration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${seconds % 60}s`;
}

function formatVotes(votes: number): string {
  if (votes >= 1_000_000) return `${(votes / 1_000_000).toFixed(2)}M`;
  if (votes >= 1_000) return `${(votes / 1_000).toFixed(1)}k`;
  if (votes >= 1) return Math.round(votes).toLocaleString("en-US");
  return "< 1";
}

function formatUsd(amount: number, decimals = 2): string {
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatSignedUsd(amount: number, decimals = 2): string {
  const absFormatted = Math.abs(amount).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  if (amount < -0.0001) return `-$${absFormatted}`;
  return `$${absFormatted}`;
}

function formatTxError(err: unknown): string {
  if (!err) return "Transaction failed.";
  const anyErr = err as {
    shortMessage?: string;
    details?: string;
    message?: string;
  };
  const raw = (anyErr.shortMessage || anyErr.message || String(err)).trim();
  const lower = raw.toLowerCase();

  if (
    lower.includes("user rejected") ||
    lower.includes("user denied") ||
    lower.includes("rejected the request") ||
    lower.includes("action_rejected") ||
    lower.includes("request rejected")
  ) {
    return "Transaction cancelled in wallet.";
  }
  if (lower.includes("notapprovedorowner")) {
    return "Connected wallet does not own or have approval for this veMEZO NFT.";
  }
  if (lower.includes("alreadyvoted") || lower.includes("onlynewepoch")) {
    return "This veMEZO lock has already voted in the current epoch.";
  }
  if (lower.includes("insufficient funds")) {
    return "Insufficient BTC balance for network gas fee.";
  }

  // Strip verbose viem dumps ("Request Arguments:", "Contract Call:", "Docs:", "Version:")
  const cleaned = raw
    .split(
      /Request Arguments:|Contract Call:|Raw Call Arguments:|Docs:|Version:|Details:/i
    )[0]
    .replace(
      /0x[a-fA-F0-9]{16,}/g,
      (match) => `${match.slice(0, 6)}…${match.slice(-4)}`
    )
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "Transaction failed.";
  return cleaned.length > 140 ? `${cleaned.slice(0, 140)}…` : cleaned;
}

function assertValidVotePayload(
  targets: Address[],
  weights: bigint[],
  voterLabel: string
): void {
  if (targets.length === 0 || targets.length !== weights.length) {
    throw new Error(`${voterLabel}: invalid or empty gauge allocation array.`);
  }
  const seen = new Set<string>();
  let weightSum = 0n;
  for (let i = 0; i < targets.length; i++) {
    const addr = targets[i];
    const w = weights[i];
    if (!isAddress(addr)) {
      throw new Error(`${voterLabel}: invalid gauge address ${String(addr)}.`);
    }
    const lower = addr.toLowerCase();
    if (seen.has(lower)) {
      throw new Error(`${voterLabel}: duplicate gauge target ${addr} blocked.`);
    }
    seen.add(lower);
    if (w <= 0n) {
      throw new Error(`${voterLabel}: gauge weight must be positive.`);
    }
    weightSum += w;
  }
  if (weightSum !== 10_000n) {
    throw new Error(
      `${voterLabel}: weight sum (${weightSum.toString()}) must equal 10000 bps.`
    );
  }
}

function TokenIcon({
  symbol,
  size = 16,
  className = "",
}: {
  symbol: string;
  size?: number;
  className?: string;
}) {
  const upper = symbol.toUpperCase();

  if (upper === "MUSD" || upper === "SMUSD") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/icons/musd.png"
        alt={symbol}
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className={`rounded-full bg-white p-[0.5px] ring-1 ring-[var(--border)] object-contain shrink-0 select-none ${className}`}
      />
    );
  }

  if (upper === "MEZO" || upper === "VEMEZO") {
    return (
      <span
        style={{ width: size, height: size }}
        className={`inline-flex items-center justify-center rounded-full bg-[#111113] ring-1 ring-[var(--border)] shrink-0 select-none ${className}`}
        title={symbol}
      >
        <svg
          viewBox="0 0 400 222"
          fill="none"
          style={{ width: Math.round(size * 0.72), height: Math.round(size * 0.72) }}
        >
          <path
            d="M114.94 142.08L146.44 110.58V110.44L177.79 141.94C186.85 151 197.93 155.03 208.86 155.03C231.73 155.03 253.73 137.2 253.73 110.44L285.08 141.94C294.14 151 305.22 155.03 316.15 155.03C339.02 155.03 361.02 137.2 361.02 110.44H334.12L302.77 79.09C293.71 70.03 282.49 66 271.56 66C248.69 66 226.83 83.69 226.83 110.44L195.48 79.09C186.42 70.03 175.2 66 164.27 66C141.4 66 119.54 83.69 119.54 110.44L39 110.58C39 137.48 61.29 154.88 84.16 154.88C95.09 154.88 106.17 150.85 114.94 142.08Z"
            fill="#FF004D"
          />
        </svg>
      </span>
    );
  }

  if (upper === "BTC" || upper === "VEBTC" || upper === "WBTC") {
    return (
      <span
        style={{ width: size, height: size }}
        className={`inline-flex items-center justify-center rounded-full bg-[#F7931A] ring-1 ring-[var(--border)] text-white font-mono-tabular font-bold leading-none shrink-0 select-none ${className}`}
        title={symbol}
      >
        <span style={{ fontSize: Math.max(8, Math.round(size * 0.62)) }}>₿</span>
      </span>
    );
  }

  if (upper === "USDC") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/icons/usdc.png"
        alt="USDC"
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className={`rounded-full ring-1 ring-[var(--border)] object-contain shrink-0 select-none ${className}`}
      />
    );
  }

  if (upper === "USDT") {
    return (
      <span
        style={{ width: size, height: size }}
        className={`inline-flex items-center justify-center rounded-full bg-[#26A17B] ring-1 ring-[var(--border)] text-white font-mono-tabular font-bold leading-none shrink-0 select-none ${className}`}
        title="USDT"
      >
        <span style={{ fontSize: Math.max(8, Math.round(size * 0.58)) }}>₮</span>
      </span>
    );
  }

  return (
    <span
      style={{ width: size, height: size }}
      className={`inline-flex items-center justify-center rounded-full bg-[var(--surface-subtle)] ring-1 ring-[var(--border)] text-[var(--foreground)] font-mono-tabular font-semibold leading-none shrink-0 select-none ${className}`}
      title={symbol}
    >
      <span style={{ fontSize: Math.max(8, Math.round(size * 0.55)) }}>
        {symbol.slice(0, 1).toUpperCase()}
      </span>
    </span>
  );
}

function ChainIcon({
  chainLabel,
  size = 13,
}: {
  chainLabel: string;
  size?: number;
}) {
  const lower = chainLabel.toLowerCase();

  if (lower.includes("ethereum")) {
    return (
      <span
        style={{ width: size, height: size }}
        className="inline-flex items-center justify-center rounded-full bg-[#627EEA] ring-1 ring-[var(--border)] shrink-0 select-none"
        title="Ethereum"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          style={{ width: Math.round(size * 0.68), height: Math.round(size * 0.68) }}
        >
          <path
            d="M12 2.5L5.8 12.2L12 15.8L18.2 12.2L12 2.5Z"
            fill="white"
            fillOpacity="0.92"
          />
          <path
            d="M5.8 13.4L12 21.5L18.2 13.4L12 17L5.8 13.4Z"
            fill="white"
            fillOpacity="0.75"
          />
        </svg>
      </span>
    );
  }

  if (lower.includes("base")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/icons/base.svg"
        alt="Base"
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className="rounded-[3px] ring-1 ring-[var(--border)] object-contain shrink-0 select-none"
        title="Base"
      />
    );
  }

  // Default: Mezo network mark
  return <TokenIcon symbol="MEZO" size={size} />;
}

function PoolPairAvatar({
  label,
  voterType,
}: {
  label: string;
  voterType: "thirdParty" | "boost";
}) {
  if (voterType === "boost") {
    return (
      <span className="inline-flex items-center shrink-0">
        <TokenIcon symbol="BTC" size={16} />
        <TokenIcon
          symbol="MEZO"
          size={16}
          className="-ml-1.5 ring-2 ring-[var(--card)]"
        />
      </span>
    );
  }

  const upper = label.toUpperCase();
  const quoteSymbol = upper.includes("USDC")
    ? "USDC"
    : upper.includes("USDT")
      ? "USDT"
      : upper.includes("MEZO")
        ? "MEZO"
        : upper.includes("BTC")
          ? "BTC"
          : "SMUSD";

  return (
    <span className="inline-flex items-center shrink-0">
      <TokenIcon symbol="MUSD" size={16} />
      <TokenIcon
        symbol={quoteSymbol}
        size={16}
        className="-ml-1.5 ring-2 ring-[var(--card)]"
      />
    </span>
  );
}

function WalletBrandIcon({
  name,
  icon,
  size = 20,
}: {
  name?: string;
  icon?: string;
  size?: number;
}) {
  const lower = (name || "").toLowerCase();

  // 1. Rabby Wallet — electric blue gradient rabbit from user reference
  if (lower.includes("rabby")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/icons/rabby-color.png"
        alt={name || "Rabby Wallet"}
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className="object-contain shrink-0 select-none"
      />
    );
  }

  // 2. OKX Wallet — neon-lime (#AEF949) rounded tile with 5-square checkerboard
  if (lower.includes("okx")) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        style={{ width: size, height: size }}
        className="shrink-0 select-none"
        aria-label={name || "OKX Wallet"}
      >
        <rect width="24" height="24" rx="5.5" fill="#AEF949" />
        <rect x="5" y="5" width="4.6" height="4.6" rx="0.6" fill="#09090B" />
        <rect x="14.4" y="5" width="4.6" height="4.6" rx="0.6" fill="#09090B" />
        <rect x="9.7" y="9.7" width="4.6" height="4.6" rx="0.6" fill="#09090B" />
        <rect x="5" y="14.4" width="4.6" height="4.6" rx="0.6" fill="#09090B" />
        <rect x="14.4" y="14.4" width="4.6" height="4.6" rx="0.6" fill="#09090B" />
      </svg>
    );
  }

  // 3. MetaMask — full-color orange fox (preserve native EIP-6963 color or SVG fallback)
  if (lower.includes("metamask")) {
    if (icon) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={icon}
          alt={name || "MetaMask"}
          width={size}
          height={size}
          style={{ width: size, height: size }}
          className="rounded-xs object-contain shrink-0 select-none"
        />
      );
    }
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        style={{ width: size, height: size }}
        className="shrink-0 select-none"
        aria-label="MetaMask"
      >
        <path d="M21.2 2L13.3 7.9L14.8 4.4L21.2 2Z" fill="#E2761B" />
        <path d="M2.8 2L10.6 8L9.2 4.4L2.8 2Z" fill="#E4761B" />
        <path d="M18.4 16.4L16.3 19.6L20.8 20.8L22.1 16.5L18.4 16.4Z" fill="#E4761B" />
        <path d="M1.9 16.5L3.2 20.8L7.7 19.6L5.6 16.4L1.9 16.5Z" fill="#E4761B" />
        <path d="M7.5 10.5L6.2 12.5L10.6 12.7L10.5 7.9L7.5 10.5Z" fill="#E4761B" />
        <path d="M16.5 10.5L13.4 7.8L13.3 12.7L17.8 12.5L16.5 10.5Z" fill="#E4761B" />
        <path d="M7.7 19.6L10.4 18.3L8.1 16.5L7.7 19.6Z" fill="#E4761B" />
        <path d="M13.6 18.3L16.3 19.6L15.9 16.5L13.6 18.3Z" fill="#E4761B" />
        <path d="M16.3 19.6L13.6 18.3L13.8 20.1L13.8 20.9L16.3 19.6Z" fill="#D7C1B3" />
        <path d="M7.7 19.6L10.2 20.9L10.2 20.1L10.4 18.3L7.7 19.6Z" fill="#D7C1B3" />
        <path d="M10.3 15.1L8 14.4L9.6 13.7L10.3 15.1Z" fill="#233447" />
        <path d="M13.7 15.1L14.4 13.7L16 14.4L13.7 15.1Z" fill="#233447" />
        <path d="M7.7 19.6L8.1 16.4L5.6 16.5L7.7 19.6Z" fill="#CD6116" />
        <path d="M15.9 16.4L16.3 19.6L18.4 16.5L15.9 16.4Z" fill="#CD6116" />
        <path d="M17.8 12.5L13.3 12.7L13.7 15.1L14.4 13.7L16 14.4L17.8 12.5Z" fill="#CD6116" />
        <path d="M8 14.4L9.6 13.7L10.3 15.1L10.6 12.7L6.2 12.5L8 14.4Z" fill="#CD6116" />
        <path d="M6.2 12.5L8.1 16.5L8 14.4L6.2 12.5Z" fill="#E4751F" />
        <path d="M16 14.4L15.9 16.5L17.8 12.5L16 14.4Z" fill="#E4751F" />
        <path d="M10.6 12.7L10.3 15.1L10.8 17.9L10.9 14.2L10.6 12.7Z" fill="#E4751F" />
        <path d="M13.3 12.7L13.1 14.2L13.2 17.9L13.7 15.1L13.3 12.7Z" fill="#E4751F" />
        <path d="M13.7 15.1L13.2 17.9L13.6 18.3L15.9 16.5L16 14.4L13.7 15.1Z" fill="#F6851B" />
        <path d="M8 14.4L8.1 16.5L10.4 18.3L10.8 17.9L10.3 15.1L8 14.4Z" fill="#F6851B" />
        <path d="M13.8 20.9L13.8 20.1L13.6 19.9H10.4L10.2 20.1L10.2 20.9L7.7 19.6L8.6 20.3L10.4 21.5H13.6L15.4 20.3L16.3 19.6L13.8 20.9Z" fill="#C0AD9E" />
        <path d="M13.6 18.3L13.2 17.9H10.8L10.4 18.3L10.2 20.1L10.4 19.9H13.6L13.8 20.1L13.6 18.3Z" fill="#161616" />
        <path d="M21.6 8.4L22.3 5L21.2 2L13.6 7.6L16.5 10.5L20.6 11.7L21.5 10.6L21.1 10.3L21.8 9.7L21.3 9.3L22 8.8L21.6 8.4Z" fill="#763D16" />
        <path d="M1.7 5L2.4 8.4L1.9 8.8L2.7 9.3L2.2 9.7L2.9 10.3L2.5 10.6L3.4 11.7L7.5 10.5L10.4 7.6L2.8 2L1.7 5Z" fill="#763D16" />
        <path d="M20.6 11.7L16.5 10.5L17.8 12.5L15.9 16.5L18.4 16.4H22.1L20.6 11.7Z" fill="#F6851B" />
        <path d="M7.5 10.5L3.4 11.7L1.9 16.4H5.6L8.1 16.5L6.2 12.5L7.5 10.5Z" fill="#F6851B" />
        <path d="M13.3 12.7L13.6 7.6L14.8 4.4H9.2L10.4 7.6L10.6 12.7L10.8 14.2V17.9H13.2V14.2L13.3 12.7Z" fill="#F6851B" />
      </svg>
    );
  }

  // Default for other wallets: monochrome grayscale treatment
  if (icon) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={icon}
        alt={name || "Wallet"}
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className="rounded-xs object-contain grayscale contrast-125 shrink-0 select-none"
      />
    );
  }

  return (
    <div
      style={{ width: size, height: size }}
      className="rounded-xs border border-[var(--border-strong)] bg-[var(--surface-subtle)] flex items-center justify-center font-mono-tabular text-[10px] shrink-0"
    >
      {(name || "W").slice(0, 1).toUpperCase()}
    </div>
  );
}

export function EpochPilotDesk({
  initialTelemetry,
  initialPosition,
}: Props) {
  const [isMounted, setIsMounted] = useState<boolean>(false);
  const [isDark, setIsDark] = useState<boolean>(true);
  const [network, setNetwork] = useState<NetworkKey>(initialTelemetry.network);
  const [includeFloor, setIncludeFloor] = useState<boolean>(true);
  const [telemetry, setTelemetry] =
    useState<ProtocolTelemetry>(initialTelemetry);
  const [position, setPosition] =
    useState<InspectedNftPosition>(initialPosition);
  const [isLoadingTelemetry, setIsLoadingTelemetry] = useState<boolean>(false);

  // Wagmi v2 + EIP-6963 standard wallet state
  const {
    address: connectedAddress,
    isConnected,
    connector: activeConnector,
    chainId: activeChainId,
  } = useAccount();
  const { connectors, connectAsync, isPending: isConnecting } = useConnect();
  const connections = useConnections();
  const { disconnect, disconnectAsync } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { data: wagmiWalletClient } = useWalletClient();

  // Wallet Modal & Account Dropdown state
  const [isDisconnectedByUser, setIsDisconnectedByUser] =
    useState<boolean>(false);
  const [isWalletModalOpen, setIsWalletModalOpen] = useState<boolean>(false);
  const [connectingUid, setConnectingUid] = useState<string | null>(null);
  const [walletModalError, setWalletModalError] = useState<string | null>(null);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState<boolean>(false);
  const [copiedAddress, setCopiedAddress] = useState<boolean>(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);

  // Primary Workspace View (shadcn Tabs)
  const [workspaceView, setWorkspaceView] = useState<
    "optimizer" | "crossPair" | "compounder"
  >("optimizer");

  // Gauge table filter & expanded row inspector
  const [gaugeFilter, setGaugeFilter] = useState<
    "all" | "thirdParty" | "boost"
  >("all");
  const [expandedGaugeId, setExpandedGaugeId] = useState<string | null>(null);

  // Position & Simulator controls
  const [veMezoIdInput, setVeMezoIdInput] = useState<number>(
    initialPosition.veMezoTokenId || 148
  );
  const [veBtcIdInput, setVeBtcIdInput] = useState<number>(
    initialPosition.veBtcTokenId || 98
  );
  const [simulatedVotingPower, setSimulatedVotingPower] = useState<number>(
    initialPosition.votingPowerVeMezo > 100
      ? Math.round(initialPosition.votingPowerVeMezo)
      : 1_217_233
  );
  const [showCustomNftInputs, setShowCustomNftInputs] =
    useState<boolean>(false);

  // Cross-Pair Arbitrage inputs (default to Whale #148 profitable Cross-Pair profile)
  const [crossVeBtcAmount, setCrossVeBtcAmount] = useState<number>(25.0);
  const [baseWeeklyUsdPerVeBtc, setBaseWeeklyUsdPerVeBtc] =
    useState<number>(64);
  const [marketBribePer1kUsd, setMarketBribePer1kUsd] = useState<number>(0.42);

  // Execution state (router address scoped per network so Testnet deployment only appears on Testnet)
  const [executionMode, setExecutionMode] = useState<"direct" | "router">(
    "direct"
  );
  const [showCustomMainnetRouter, setShowCustomMainnetRouter] =
    useState<boolean>(false);
  const [routerByNetwork, setRouterByNetwork] = useState<
    Record<NetworkKey, string>
  >({
    mainnet: "",
    testnet: DEPLOYED_TESTNET_ROUTER,
  });
  const routerAddress = routerByNetwork[network];
  const setRouterAddress = useCallback(
    (val: string) => {
      setRouterByNetwork((prev) => ({ ...prev, [network]: val }));
    },
    [network]
  );
  const [stakeIntoSMusd, setStakeIntoSMusd] = useState<boolean>(true);
  const [showCalldataDrawer, setShowCalldataDrawer] = useState<boolean>(false);
  const [txStatus, setTxStatus] = useState<{
    type: "idle" | "pending" | "success" | "error";
    message: string;
    hash?: string;
  }>({ type: "idle", message: "" });
  const [copiedCalldata, setCopiedCalldata] = useState<string | null>(null);
  const latestTelemetryReqRef = useRef<number>(0);

  // Connected wallet's live MEZO balance & owned veMEZO / veBTC locks on active network
  const [walletHoldings, setWalletHoldings] = useState<{
    mezoBalance: number;
    testnetMezoBalance: number;
    musdBalance: number;
    ownedVeMezoIds: number[];
    ownedVeBtcIds: number[];
    isLoading: boolean;
  }>({
    mezoBalance: 0,
    testnetMezoBalance: 0,
    musdBalance: 0,
    ownedVeMezoIds: [],
    ownedVeBtcIds: [],
    isLoading: false,
  });
  const [isMintingLock, setIsMintingLock] = useState<boolean>(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Close account dropdown on outside click or Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        accountMenuRef.current &&
        !accountMenuRef.current.contains(e.target as Node)
      ) {
        setIsAccountMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsAccountMenuOpen(false);
        setIsWalletModalOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Only show detected wallets (deduplicated by name)
  const detectedWallets = useMemo(() => {
    const byName = new Map<string, Connector>();
    for (const c of connectors) {
      if (c.id === "injected" && !c.icon && connectors.length > 1) continue;
      const key = c.name.trim().toLowerCase();
      if (!byName.has(key) || c.icon) {
        byName.set(key, c);
      }
    }
    return Array.from(byName.values());
  }, [connectors]);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", next);
    }
  };

  // Live Epoch Countdown Clock
  const [nowUnix, setNowUnix] = useState<number>(() =>
    Math.floor(Date.now() / 1000)
  );
  useEffect(() => {
    const timer = setInterval(() => {
      setNowUnix(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const epochState = useMemo(() => getEpochTimingState(nowUnix), [nowUnix]);
  const cfg = PROTOCOL_CONFIG[network];

  const refreshTelemetry = useCallback(
    async (
      targetNet: NetworkKey,
      targetFloor: boolean,
      targetMezoId: number,
      targetBtcId: number
    ) => {
      const reqId = ++latestTelemetryReqRef.current;
      setIsLoadingTelemetry(true);
      try {
        const res = await fetch(
          `/api/telemetry?network=${targetNet}&floor=${targetFloor}&veMezoId=${targetMezoId}&veBtcId=${targetBtcId}`
        );
        const data = await res.json();
        if (reqId !== latestTelemetryReqRef.current) return;
        if (data.ok) {
          setTelemetry(data.telemetry);
          setPosition(data.position);
          const matchingPreset = PRESET_POSITIONS_BY_NETWORK[targetNet].find(
            (p) => p.veMezoId === targetMezoId
          );
          if (matchingPreset) {
            setSimulatedVotingPower(matchingPreset.defaultPower);
            setCrossVeBtcAmount(matchingPreset.defaultVeBtcWeight);
            setBaseWeeklyUsdPerVeBtc(matchingPreset.defaultBaseFee);
            setMarketBribePer1kUsd(matchingPreset.defaultBribeRate);
          } else {
            if (data.position.votingPowerVeMezo > 10) {
              setSimulatedVotingPower(
                Math.round(data.position.votingPowerVeMezo)
              );
            }
            if (
              data.position.unboostedVeBtc &&
              data.position.unboostedVeBtc > 0.001
            ) {
              setCrossVeBtcAmount(
                Number(data.position.unboostedVeBtc.toFixed(3))
              );
            }
          }
        }
      } catch (e) {
        console.error("Telemetry refresh error:", e);
      } finally {
        if (reqId === latestTelemetryReqRef.current) {
          setIsLoadingTelemetry(false);
        }
      }
    },
    []
  );

  const didInitTelemetryRef = useRef<boolean>(false);
  useEffect(() => {
    if (!didInitTelemetryRef.current) {
      didInitTelemetryRef.current = true;
      refreshTelemetry(network, includeFloor, veMezoIdInput, veBtcIdInput);
    } else if (telemetry.network !== network) {
      refreshTelemetry(network, includeFloor, veMezoIdInput, veBtcIdInput);
    }
  }, [
    network,
    includeFloor,
    veMezoIdInput,
    veBtcIdInput,
    telemetry.network,
    refreshTelemetry,
  ]);

  const getReadClient = useCallback((targetNet: NetworkKey) => {
    const chain = targetNet === "mainnet" ? mezoMainnet : mezoTestnet;
    return createPublicClient({
      chain,
      transport: http(PROTOCOL_CONFIG[targetNet].rpcUrl, {
        timeout: 12_000,
        retryCount: 2,
      }),
    });
  }, []);

  const refreshWalletHoldings = useCallback(
    async (
      addr: Address,
      targetNet: NetworkKey,
      autoSelectOwned = false
    ): Promise<number[]> => {
      const targetCfg = PROTOCOL_CONFIG[targetNet];
      const pubClient = getReadClient(targetNet);
      setWalletHoldings((prev) => ({ ...prev, isLoading: true }));

      try {
        const [mezoRaw, musdRaw, veMezoCountRaw, veBtcCountRaw] =
          await Promise.all([
            pubClient
              .readContract({
                address: targetCfg.mezo,
                abi: ERC20_ABI,
                functionName: "balanceOf",
                args: [addr],
              })
              .catch(() => 0n),
            pubClient
              .readContract({
                address: targetCfg.musd,
                abi: ERC20_ABI,
                functionName: "balanceOf",
                args: [addr],
              })
              .catch(() => 0n),
            pubClient
              .readContract({
                address: targetCfg.veMEZO,
                abi: VOTING_ESCROW_ABI,
                functionName: "balanceOf",
                args: [addr],
              })
              .catch(() => 0n),
            pubClient
              .readContract({
                address: targetCfg.veBTC,
                abi: VOTING_ESCROW_ABI,
                functionName: "balanceOf",
                args: [addr],
              })
              .catch(() => 0n),
          ]);

        const mezoBalance = Number(formatUnits(mezoRaw, 18));
        const musdBalance = Number(formatUnits(musdRaw, 18));
        const veMezoCount = Math.min(Number(veMezoCountRaw), 8);
        const veBtcCount = Math.min(Number(veBtcCountRaw), 8);

        let testnetMezoBalance = targetNet === "testnet" ? mezoBalance : 0;
        if (targetNet === "mainnet" && mezoBalance < 1) {
          const testClient = getReadClient("testnet");
          const testMezoRaw = await testClient
            .readContract({
              address: PROTOCOL_CONFIG.testnet.mezo,
              abi: ERC20_ABI,
              functionName: "balanceOf",
              args: [addr],
            })
            .catch(() => 0n);
          testnetMezoBalance = Number(formatUnits(testMezoRaw, 18));
        }

        const ownedVeMezoIds: number[] = [];
        for (let i = 0; i < veMezoCount; i++) {
          const idRaw = await pubClient
            .readContract({
              address: targetCfg.veMEZO,
              abi: VOTING_ESCROW_ABI,
              functionName: "ownerToNFTokenIdList",
              args: [addr, BigInt(i)],
            })
            .catch(() => 0n);
          if (idRaw > 0n) ownedVeMezoIds.push(Number(idRaw));
        }

        const ownedVeBtcIds: number[] = [];
        for (let i = 0; i < veBtcCount; i++) {
          const idRaw = await pubClient
            .readContract({
              address: targetCfg.veBTC,
              abi: VOTING_ESCROW_ABI,
              functionName: "ownerToNFTokenIdList",
              args: [addr, BigInt(i)],
            })
            .catch(() => 0n);
          if (idRaw > 0n) ownedVeBtcIds.push(Number(idRaw));
        }

        setWalletHoldings({
          mezoBalance,
          testnetMezoBalance,
          musdBalance,
          ownedVeMezoIds,
          ownedVeBtcIds,
          isLoading: false,
        });

        if (autoSelectOwned && ownedVeMezoIds.length > 0) {
          const latestMezoId = ownedVeMezoIds[ownedVeMezoIds.length - 1];
          const latestBtcId =
            ownedVeBtcIds.length > 0
              ? ownedVeBtcIds[ownedVeBtcIds.length - 1]
              : 8;
          setVeMezoIdInput(latestMezoId);
          if (ownedVeBtcIds.length > 0) setVeBtcIdInput(latestBtcId);
          refreshTelemetry(targetNet, includeFloor, latestMezoId, latestBtcId);
        }

        return ownedVeMezoIds;
      } catch {
        setWalletHoldings((prev) => ({ ...prev, isLoading: false }));
        return [];
      }
    },
    [getReadClient, includeFloor, refreshTelemetry]
  );

  useEffect(() => {
    if (
      isMounted &&
      !isDisconnectedByUser &&
      isConnected &&
      connectedAddress
    ) {
      refreshWalletHoldings(connectedAddress, network, false);
    } else {
      setWalletHoldings({
        mezoBalance: 0,
        testnetMezoBalance: 0,
        musdBalance: 0,
        ownedVeMezoIds: [],
        ownedVeBtcIds: [],
        isLoading: false,
      });
    }
  }, [
    isMounted,
    isDisconnectedByUser,
    isConnected,
    connectedAddress,
    network,
    refreshWalletHoldings,
  ]);

  const dualOptimization = useMemo(
    () =>
      optimizeDualVoterPortfolio(
        telemetry.gauges,
        simulatedVotingPower,
        telemetry.mezoPriceUsd
      ),
    [telemetry.gauges, simulatedVotingPower, telemetry.mezoPriceUsd]
  );

  const crossPairAnalysis = useMemo(
    () =>
      evaluateCrossPairStrategy({
        veBtcBalance: crossVeBtcAmount,
        veMezoBalance: simulatedVotingPower,
        totalVeBtcUnboosted: telemetry.veBtcTotalVotingPower,
        totalVeMezoSupply: telemetry.veMezoTotalVotingPower,
        baseWeeklyYieldPerVeBtcUsd: baseWeeklyUsdPerVeBtc,
        externalOptimalVeMezoWeeklyYieldUsd:
          dualOptimization.boostResult.totalExpectedPayoutUsd,
        marketBribeCostPer1kVeMezoUsd: marketBribePer1kUsd,
        btcPriceUsd: telemetry.btcPriceUsd,
        mezoPriceUsd: telemetry.mezoPriceUsd,
      }),
    [
      crossVeBtcAmount,
      simulatedVotingPower,
      telemetry.veBtcTotalVotingPower,
      telemetry.veMezoTotalVotingPower,
      baseWeeklyUsdPerVeBtc,
      dualOptimization.boostResult.totalExpectedPayoutUsd,
      marketBribePer1kUsd,
      telemetry.btcPriceUsd,
      telemetry.mezoPriceUsd,
    ]
  );

  const encodedCalldata = useMemo(() => {
    const tokenIdBig = BigInt(Math.max(1, veMezoIdInput));
    const boostVoteHex =
      dualOptimization.boostResult.calldataTargets.length > 0
        ? encodeFunctionData({
            abi: BOOST_VOTER_ABI,
            functionName: "vote",
            args: [
              tokenIdBig,
              dualOptimization.boostResult.calldataTargets,
              dualOptimization.boostResult.calldataWeights,
            ],
          })
        : "0x";

    const thirdPartyVoteHex =
      dualOptimization.thirdPartyResult.calldataTargets.length > 0
        ? encodeFunctionData({
            abi: THIRD_PARTY_VOTER_ABI,
            functionName: "vote",
            args: [
              tokenIdBig,
              dualOptimization.thirdPartyResult.calldataTargets,
              dualOptimization.thirdPartyResult.calldataWeights,
            ],
          })
        : "0x";

    const routerBatchHex = encodeFunctionData({
      abi: EPOCH_PILOT_ROUTER_ABI,
      functionName: "executeOptimalEpochVote",
      args: [
        tokenIdBig,
        dualOptimization.boostResult.calldataTargets,
        dualOptimization.boostResult.calldataWeights,
        dualOptimization.thirdPartyResult.calldataTargets,
        dualOptimization.thirdPartyResult.calldataWeights,
        [],
        true,
      ],
    });

    return {
      boostVoteHex,
      thirdPartyVoteHex,
      routerBatchHex,
    };
  }, [dualOptimization, veMezoIdInput]);

  // Ensure wallet is switched to the selected Mezo network
  const ensureMezoChain = async (connector?: Connector) => {
    const targetChain = network === "mainnet" ? mezoMainnet : mezoTestnet;
    try {
      await switchChainAsync({ chainId: targetChain.id });
    } catch {
      // Fallback: request wallet_addEthereumChain directly on the connector's provider
      const active = connector ?? activeConnector;
      const provider = (await active?.getProvider().catch(() => null)) as {
        request?: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      } | null;
      if (provider?.request) {
        const chainHex = `0x${targetChain.id.toString(16)}`;
        await provider
          .request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: chainHex,
                chainName: targetChain.name,
                nativeCurrency: targetChain.nativeCurrency,
                rpcUrls: targetChain.rpcUrls.default.http,
                blockExplorerUrls: [targetChain.blockExplorers.default.url],
              },
            ],
          })
          .catch(() => null);
      }
    }
  };

  // Connect a specific wallet option from the modal
  const handleSelectWallet = async (connector: Connector) => {
    setWalletModalError(null);
    setConnectingUid(connector.uid);
    const targetChain = network === "mainnet" ? mezoMainnet : mezoTestnet;

    try {
      for (const conn of connections) {
        await disconnectAsync({ connector: conn.connector }).catch(() => null);
      }

      await connectAsync({ connector });
      setIsDisconnectedByUser(false);
      await ensureMezoChain(connector);

      setIsWalletModalOpen(false);
      setIsAccountMenuOpen(false);
    } catch (err) {
      setWalletModalError(formatTxError(err));
    } finally {
      setConnectingUid(null);
    }
  };

  // Disconnect wallet immediately without requiring page reload
  const handleDisconnectWallet = async () => {
    setIsDisconnectedByUser(true);
    setIsAccountMenuOpen(false);
    setTxStatus({ type: "idle", message: "" });

    try {
      // Disconnect every active connection in wagmi state
      for (const conn of connections) {
        disconnect({ connector: conn.connector });
        await disconnectAsync({ connector: conn.connector }).catch(() => null);
      }
      if (activeConnector) {
        disconnect({ connector: activeConnector });
        await disconnectAsync({ connector: activeConnector }).catch(() => null);
      }
      disconnect();

      if (typeof window !== "undefined") {
        window.localStorage.removeItem("wagmi.store");
        window.localStorage.removeItem("wagmi.recentConnectorId");
      }
    } catch {
      // State is already disconnected in UI
    }
  };

  const getWalletClient = async () => {
    if (isDisconnectedByUser || !isConnected || !connectedAddress) {
      setIsWalletModalOpen(true);
      throw new Error("Please connect a wallet to continue.");
    }
    const chain = network === "mainnet" ? mezoMainnet : mezoTestnet;
    if (activeChainId !== chain.id) {
      await ensureMezoChain();
    }

    const provider = (await activeConnector?.getProvider().catch(() => null)) as {
      request?: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    } | null;

    if (provider?.request) {
      const hexChainId = (await provider
        .request({ method: "eth_chainId" })
        .catch(() => null)) as string | number | null;
      const liveChainId =
        typeof hexChainId === "string"
          ? Number.parseInt(hexChainId, hexChainId.startsWith("0x") ? 16 : 10)
          : typeof hexChainId === "number"
            ? hexChainId
            : chain.id;
      if (Number.isFinite(liveChainId) && liveChainId !== chain.id) {
        throw new Error(
          `Chain mismatch: wallet is on Chain ID ${liveChainId}, expected ${chain.name} (${chain.id}). Please approve the network switch in your wallet.`
        );
      }
    }

    if (wagmiWalletClient && wagmiWalletClient.chain?.id === chain.id) {
      return {
        client: wagmiWalletClient,
        account: connectedAddress,
        chain,
      };
    }
    if (!provider) {
      setIsWalletModalOpen(true);
      throw new Error("Wallet provider unavailable. Please reconnect.");
    }
    const client = createWalletClient({
      account: connectedAddress,
      chain,
      transport: custom(provider as Parameters<typeof custom>[0]),
    });
    return { client, account: connectedAddress, chain };
  };

  // Pre-flight check: verifies the connected wallet owns (or is approved for) the target veMEZO NFT,
  // and if voting, prefers an owned veMEZO lock that has not yet voted in the current epoch.
  const resolveExecutableVeMezoId = async (
    account: Address,
    voterScope?: "boost" | "thirdParty" | "dual"
  ): Promise<number> => {
    const pubClient = getReadClient(network);

    const hasAvailableVote = async (tokenId: number): Promise<boolean> => {
      if (!voterScope) return true;
      const [lvBoost, lvTp] = await Promise.all([
        voterScope === "boost" || voterScope === "dual"
          ? pubClient
              .readContract({
                address: cfg.boostVoter,
                abi: BOOST_VOTER_ABI,
                functionName: "lastVoted",
                args: [BigInt(tokenId)],
              })
              .catch(() => 0n)
          : Promise.resolve(0n),
        voterScope === "thirdParty" || voterScope === "dual"
          ? pubClient
              .readContract({
                address: cfg.thirdPartyVoter,
                abi: THIRD_PARTY_VOTER_ABI,
                functionName: "lastVoted",
                args: [BigInt(tokenId)],
              })
              .catch(() => 0n)
          : Promise.resolve(0n),
      ]);
      if (voterScope === "boost") {
        return Number(lvBoost) < epochState.epochStart;
      }
      if (voterScope === "thirdParty") {
        return Number(lvTp) < epochState.epochStart;
      }
      return (
        Number(lvBoost) < epochState.epochStart ||
        Number(lvTp) < epochState.epochStart
      );
    };

    const canUseCurrent = await pubClient
      .readContract({
        address: cfg.veMEZO,
        abi: VOTING_ESCROW_ABI,
        functionName: "isApprovedOrOwner",
        args: [account, BigInt(veMezoIdInput)],
      })
      .catch(() => false);

    if (canUseCurrent && (await hasAvailableVote(veMezoIdInput))) {
      return veMezoIdInput;
    }

    // Check if the user owns another veMEZO lock on this network
    const ownedIds =
      walletHoldings.ownedVeMezoIds.length > 0
        ? walletHoldings.ownedVeMezoIds
        : await refreshWalletHoldings(account, network, false);

    if (ownedIds.length > 0) {
      // Prefer the newest lock that still has an unvoted budget this epoch
      for (let i = ownedIds.length - 1; i >= 0; i--) {
        const candidateId = ownedIds[i];
        if (await hasAvailableVote(candidateId)) {
          setVeMezoIdInput(candidateId);
          setPosition((prev) => ({ ...prev, veMezoTokenId: candidateId }));
          return candidateId;
        }
      }
      const fallbackId = canUseCurrent
        ? veMezoIdInput
        : ownedIds[ownedIds.length - 1];
      setVeMezoIdInput(fallbackId);
      setPosition((prev) => ({ ...prev, veMezoTokenId: fallbackId }));
      return fallbackId;
    }

    if (walletHoldings.mezoBalance >= 1) {
      throw new Error(
        `NFT #${veMezoIdInput} is a read-only preset. Click "Lock MEZO → Mint veMEZO NFT" above to lock your MEZO and vote on-chain.`
      );
    }

    throw new Error(
      `Wallet does not own veMEZO #${veMezoIdInput}. Claim MEZO from faucet.test.mezo.org and mint a veMEZO lock first.`
    );
  };

  const handleMintVeMezoLock = async () => {
    setIsMintingLock(true);
    try {
      const { client, account, chain } = await getWalletClient();
      const pubClient = getReadClient(network);

      const rawMezoBal = await pubClient.readContract({
        address: cfg.mezo,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [account],
      });
      const availMezo = Number(formatUnits(rawMezoBal, 18));
      if (availMezo < 1) {
        throw new Error(
          "No unlocked MEZO in wallet. Claim Testnet MEZO at faucet.test.mezo.org first."
        );
      }

      const lockAmountMezo = availMezo >= 25 ? 25 : Math.max(1, Math.floor(availMezo));
      const lockAmountWei = parseUnits(String(lockAmountMezo), 18);
      const lockDurationSeconds = BigInt(365 * 86400); // 1 year lock

      const currentAllowance = await pubClient.readContract({
        address: cfg.mezo,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [account, cfg.veMEZO],
      });

      if (currentAllowance < lockAmountWei) {
        setTxStatus({
          type: "pending",
          message: `Step 1/2: Approve ${lockAmountMezo} MEZO in wallet...`,
        });
        const approveHash = await client.writeContract({
          chain,
          account,
          address: cfg.mezo,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [cfg.veMEZO, lockAmountWei],
        });
        setTxStatus({
          type: "pending",
          message: `Step 1/2: Confirming MEZO approval on-chain...`,
          hash: approveHash,
        });
        await pubClient.waitForTransactionReceipt({ hash: approveHash });
      }

      setTxStatus({
        type: "pending",
        message: `Step 2/2: Confirm createLock(${lockAmountMezo} MEZO, 1 yr) in wallet...`,
      });
      const lockHash = await client.writeContract({
        chain,
        account,
        address: cfg.veMEZO,
        abi: VOTING_ESCROW_ABI,
        functionName: "createLock",
        args: [lockAmountWei, lockDurationSeconds],
      });

      setTxStatus({
        type: "pending",
        message: `Minting your veMEZO NFT on-chain...`,
        hash: lockHash,
      });
      await pubClient.waitForTransactionReceipt({ hash: lockHash });

      const ownedIds = await refreshWalletHoldings(account, network, true);
      const mintedId = ownedIds[ownedIds.length - 1];

      setTxStatus({
        type: "success",
        message: mintedId
          ? `Minted veMEZO #${mintedId} (${lockAmountMezo} MEZO locked). Ready to vote!`
          : `Minted veMEZO lock (${lockAmountMezo} MEZO). Ready to vote!`,
        hash: lockHash,
      });
    } catch (err) {
      setTxStatus({
        type: "error",
        message: formatTxError(err),
      });
    } finally {
      setIsMintingLock(false);
    }
  };

  // Ensure active telemetry matches the selected network before building vote calldata
  const getVerifiedNetworkOptimization = async () => {
    if (telemetry.network === network && telemetry.gauges.length > 0) {
      return dualOptimization;
    }
    const res = await fetch(
      `/api/telemetry?network=${network}&floor=${includeFloor}&veMezoId=${veMezoIdInput}&veBtcId=${veBtcIdInput}`
    );
    const data = await res.json();
    if (data.ok && data.telemetry) {
      setTelemetry(data.telemetry);
      if (data.position) setPosition(data.position);
      return optimizeDualVoterPortfolio(
        data.telemetry.gauges,
        simulatedVotingPower,
        data.telemetry.mezoPriceUsd
      );
    }
    return dualOptimization;
  };

  const handleDirectBoostVote = async () => {
    try {
      const { client, account, chain } = await getWalletClient();
      setTxStatus({
        type: "pending",
        message: `Verifying veMEZO lock ownership on ${cfg.chainName}...`,
      });
      const [tokenIdToUse, activeOpt] = await Promise.all([
        resolveExecutableVeMezoId(account, "boost"),
        getVerifiedNetworkOptimization(),
      ]);
      const pubClient = getReadClient(network);
      const lastVotedRaw = await pubClient
        .readContract({
          address: cfg.boostVoter,
          abi: BOOST_VOTER_ABI,
          functionName: "lastVoted",
          args: [BigInt(tokenIdToUse)],
        })
        .catch(() => 0n);

      if (Number(lastVotedRaw) >= epochState.epochStart) {
        throw new Error(
          `veMEZO #${tokenIdToUse} already voted on BoostVoter this epoch. Mint another lock to vote again.`
        );
      }

      assertValidVotePayload(
        activeOpt.boostResult.calldataTargets,
        activeOpt.boostResult.calldataWeights,
        "BoostVoter"
      );

      setTxStatus({
        type: "pending",
        message: `Confirm BoostVoter.vote(#${tokenIdToUse}) in wallet...`,
      });
      const hash = await client.writeContract({
        chain,
        account,
        address: cfg.boostVoter,
        abi: BOOST_VOTER_ABI,
        functionName: "vote",
        args: [
          BigInt(tokenIdToUse),
          activeOpt.boostResult.calldataTargets,
          activeOpt.boostResult.calldataWeights,
        ],
      });
      setTxStatus({
        type: "success",
        message: `BoostVoter.vote(#${tokenIdToUse}) submitted`,
        hash,
      });
    } catch (err) {
      setTxStatus({
        type: "error",
        message: formatTxError(err),
      });
    }
  };

  const handleDirectThirdPartyVote = async () => {
    try {
      const { client, account, chain } = await getWalletClient();
      setTxStatus({
        type: "pending",
        message: `Verifying veMEZO lock ownership on ${cfg.chainName}...`,
      });
      const [tokenIdToUse, activeOpt] = await Promise.all([
        resolveExecutableVeMezoId(account, "thirdParty"),
        getVerifiedNetworkOptimization(),
      ]);
      const pubClient = getReadClient(network);
      const lastVotedRaw = await pubClient
        .readContract({
          address: cfg.thirdPartyVoter,
          abi: THIRD_PARTY_VOTER_ABI,
          functionName: "lastVoted",
          args: [BigInt(tokenIdToUse)],
        })
        .catch(() => 0n);

      if (Number(lastVotedRaw) >= epochState.epochStart) {
        throw new Error(
          `veMEZO #${tokenIdToUse} already voted on ThirdPartyVoter this epoch. Mint another lock to vote again.`
        );
      }

      assertValidVotePayload(
        activeOpt.thirdPartyResult.calldataTargets,
        activeOpt.thirdPartyResult.calldataWeights,
        "ThirdPartyVoter"
      );

      setTxStatus({
        type: "pending",
        message: `Confirm ThirdPartyVoter.vote(#${tokenIdToUse}) in wallet...`,
      });
      const hash = await client.writeContract({
        chain,
        account,
        address: cfg.thirdPartyVoter,
        abi: THIRD_PARTY_VOTER_ABI,
        functionName: "vote",
        args: [
          BigInt(tokenIdToUse),
          activeOpt.thirdPartyResult.calldataTargets,
          activeOpt.thirdPartyResult.calldataWeights,
        ],
      });
      setTxStatus({
        type: "success",
        message: `ThirdPartyVoter.vote(#${tokenIdToUse}) submitted`,
        hash,
      });
    } catch (err) {
      setTxStatus({
        type: "error",
        message: formatTxError(err),
      });
    }
  };

  const handlePokeBoost = async () => {
    try {
      setTxStatus({
        type: "pending",
        message: `Poking veBTC Boost for Lock #${veBtcIdInput}...`,
      });
      const { client, account, chain } = await getWalletClient();
      const hash = await client.writeContract({
        chain,
        account,
        address: cfg.boostVoter,
        abi: BOOST_VOTER_ABI,
        functionName: "pokeBoost",
        args: [BigInt(veBtcIdInput)],
      });
      setTxStatus({
        type: "success",
        message: `BoostVoter.pokeBoost(#${veBtcIdInput}) confirmed`,
        hash,
      });
    } catch (err) {
      setTxStatus({
        type: "error",
        message: formatTxError(err),
      });
    }
  };

  const handleClaimRebase = async () => {
    try {
      const { client, account, chain } = await getWalletClient();
      const tokenIdToUse = await resolveExecutableVeMezoId(account);
      setTxStatus({
        type: "pending",
        message: `Claiming MEZO rebase for veMEZO #${tokenIdToUse}...`,
      });
      const hash = await client.writeContract({
        chain,
        account,
        address: cfg.veMezoRewardsDistributor,
        abi: REWARDS_DISTRIBUTOR_ABI,
        functionName: "claim",
        args: [BigInt(tokenIdToUse)],
      });
      setTxStatus({
        type: "success",
        message: `Rebase claimed for veMEZO #${tokenIdToUse}`,
        hash,
      });
    } catch (err) {
      setTxStatus({
        type: "error",
        message: formatTxError(err),
      });
    }
  };

  const handlePostCrossPairMusdBribe = async () => {
    try {
      const targetGauge =
        position.veBtcBoostGauge &&
        position.veBtcBoostGauge !==
          "0x0000000000000000000000000000000000000000"
          ? telemetry.gauges.find(
              (g) =>
                g.gaugeAddress.toLowerCase() ===
                position.veBtcBoostGauge?.toLowerCase()
            )
          : telemetry.gauges.find((g) => g.voterType === "boost");

      const targetGaugeAddress =
        (targetGauge?.gaugeAddress as Address | undefined) ??
        (position.veBtcBoostGauge &&
        position.veBtcBoostGauge !==
          "0x0000000000000000000000000000000000000000"
          ? position.veBtcBoostGauge
          : ("0xD4073C7289bfC4fa908D4c5baa91EF3EB808c1e6" as Address));

      const amountWei = parseUnits(
        Math.max(
          1,
          crossPairAnalysis.crossPair.requiredMusdBribeCostUsd
        ).toFixed(2),
        18
      );

      const { client, account, chain } = await getWalletClient();
      const pubClient = getReadClient(network);
      const musdBalRaw = await pubClient.readContract({
        address: cfg.musd,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [account],
      });
      if (musdBalRaw < amountWei) {
        throw new Error(
          `Insufficient MUSD balance (${Number(formatUnits(musdBalRaw, 18)).toFixed(2)} MUSD available).`
        );
      }

      const curAllowance = await pubClient.readContract({
        address: cfg.musd,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [account, cfg.boostVoter],
      });

      if (curAllowance < amountWei) {
        setTxStatus({
          type: "pending",
          message: `Step 1/2: Approving MUSD for BoostVoter in wallet...`,
        });
        const appHash = await client.writeContract({
          chain,
          account,
          address: cfg.musd,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [cfg.boostVoter, amountWei],
        });
        await pubClient.waitForTransactionReceipt({ hash: appHash });
      }

      setTxStatus({
        type: "pending",
        message: `Step 2/2: Posting ${crossPairAnalysis.crossPair.requiredMusdBribeCostUsd.toFixed(
          0
        )} MUSD bribe via BoostVoter.addBribes...`,
      });
      const hash = await client.writeContract({
        chain,
        account,
        address: cfg.boostVoter,
        abi: BOOST_VOTER_ABI,
        functionName: "addBribes",
        args: [targetGaugeAddress, [cfg.musd], [amountWei]],
      });

      setTxStatus({
        type: "success",
        message: `BoostVoter.addBribes confirmed for ${targetGaugeAddress.slice(0, 6)}…${targetGaugeAddress.slice(-4)}`,
        hash,
      });
    } catch (err) {
      setTxStatus({
        type: "error",
        message: formatTxError(err),
      });
    }
  };

  const handleSelfPairBoostVote = async () => {
    try {
      const { client, account, chain } = await getWalletClient();
      setTxStatus({
        type: "pending",
        message: `Verifying veMEZO lock ownership for Self-Pair Boost Vote...`,
      });
      const tokenIdToUse = await resolveExecutableVeMezoId(account, "boost");
      const pubClient = getReadClient(network);
      const lastVotedRaw = await pubClient
        .readContract({
          address: cfg.boostVoter,
          abi: BOOST_VOTER_ABI,
          functionName: "lastVoted",
          args: [BigInt(tokenIdToUse)],
        })
        .catch(() => 0n);

      if (Number(lastVotedRaw) >= epochState.epochStart) {
        throw new Error(
          `veMEZO #${tokenIdToUse} already voted on BoostVoter this epoch. Mint another lock to vote again.`
        );
      }

      const targetBoostGauge =
        position.veBtcBoostGauge &&
        position.veBtcBoostGauge !==
          "0x0000000000000000000000000000000000000000"
          ? position.veBtcBoostGauge
          : dualOptimization.boostResult.calldataTargets[0];

      if (!targetBoostGauge) {
        await handleDirectBoostVote();
        return;
      }

      setTxStatus({
        type: "pending",
        message: `Confirm Self-Pair BoostVoter.vote(#${tokenIdToUse} → veBTC #${veBtcIdInput}) in wallet...`,
      });
      const hash = await client.writeContract({
        chain,
        account,
        address: cfg.boostVoter,
        abi: BOOST_VOTER_ABI,
        functionName: "vote",
        args: [BigInt(tokenIdToUse), [targetBoostGauge], [10000n]],
      });
      setTxStatus({
        type: "success",
        message: `Self-Pair BoostVoter.vote(#${tokenIdToUse} → veBTC #${veBtcIdInput}) submitted`,
        hash,
      });
    } catch (err) {
      setTxStatus({
        type: "error",
        message: formatTxError(err),
      });
    }
  };

  const handleDeployRouter = async () => {
    try {
      setTxStatus({
        type: "pending",
        message: `Deploying EpochPilotRouter.sol to ${cfg.chainName}...`,
      });
      const { client, account, chain } = await getWalletClient();
      const hash = await client.deployContract({
        chain,
        account,
        abi: EPOCH_PILOT_ROUTER_COMPILED_ABI,
        bytecode: EPOCH_PILOT_ROUTER_BYTECODE,
        args: [
          cfg.veMEZO,
          cfg.veBTC,
          cfg.boostVoter,
          cfg.thirdPartyVoter,
          cfg.poolsVoter,
          cfg.veMezoRewardsDistributor,
          cfg.tigrisRouter,
          cfg.poolFactory,
          cfg.musd,
          cfg.sMusd,
        ],
      });
      setTxStatus({
        type: "success",
        message: `EpochPilotRouter deployment submitted`,
        hash,
      });
    } catch (err) {
      setTxStatus({
        type: "error",
        message: formatTxError(err),
      });
    }
  };

  const handleApproveRouter = async () => {
    if (!routerAddress || !isAddress(routerAddress)) {
      setTxStatus({
        type: "error",
        message: "Enter a valid EIP-55 EpochPilotRouter contract address first.",
      });
      return;
    }
    try {
      const { client, account, chain } = await getWalletClient();
      const tokenIdToUse = await resolveExecutableVeMezoId(account);
      setTxStatus({
        type: "pending",
        message: `Approving EpochPilotRouter for veMEZO #${tokenIdToUse}...`,
      });
      const hash = await client.writeContract({
        chain,
        account,
        address: cfg.veMEZO,
        abi: VOTING_ESCROW_ABI,
        functionName: "approve",
        args: [routerAddress as Address, BigInt(tokenIdToUse)],
      });
      setTxStatus({
        type: "success",
        message: `Approved Router for veMEZO #${tokenIdToUse}`,
        hash,
      });
    } catch (err) {
      setTxStatus({
        type: "error",
        message: formatTxError(err),
      });
    }
  };

  const handleRouterBatchExecute = async () => {
    if (!routerAddress || !isAddress(routerAddress)) {
      setTxStatus({
        type: "error",
        message:
          "Enter a valid deployed EpochPilotRouter address or use Direct EOA mode.",
      });
      return;
    }
    try {
      const { client, account, chain } = await getWalletClient();
      setTxStatus({
        type: "pending",
        message: `Checking veMEZO lock & router approval on ${cfg.chainName}...`,
      });
      const [tokenIdToUse, activeOpt] = await Promise.all([
        resolveExecutableVeMezoId(account, "dual"),
        getVerifiedNetworkOptimization(),
      ]);
      const pubClient = getReadClient(network);

      const [lvBoostRaw, lvTpRaw, isRouterApproved] = await Promise.all([
        pubClient
          .readContract({
            address: cfg.boostVoter,
            abi: BOOST_VOTER_ABI,
            functionName: "lastVoted",
            args: [BigInt(tokenIdToUse)],
          })
          .catch(() => 0n),
        pubClient
          .readContract({
            address: cfg.thirdPartyVoter,
            abi: THIRD_PARTY_VOTER_ABI,
            functionName: "lastVoted",
            args: [BigInt(tokenIdToUse)],
          })
          .catch(() => 0n),
        pubClient
          .readContract({
            address: cfg.veMEZO,
            abi: VOTING_ESCROW_ABI,
            functionName: "isApprovedOrOwner",
            args: [routerAddress as Address, BigInt(tokenIdToUse)],
          })
          .catch(() => false),
      ]);

      const canVoteBoost = Number(lvBoostRaw) < epochState.epochStart;
      const canVoteTp = Number(lvTpRaw) < epochState.epochStart;

      if (!canVoteBoost && !canVoteTp) {
        throw new Error(
          `veMEZO #${tokenIdToUse} already voted on both Voters this epoch. Click "+ Mint New Lock" above to mint a fresh veMEZO NFT and vote!`
        );
      }

      if (canVoteBoost) {
        assertValidVotePayload(
          activeOpt.boostResult.calldataTargets,
          activeOpt.boostResult.calldataWeights,
          "BoostVoter"
        );
      }
      if (canVoteTp) {
        assertValidVotePayload(
          activeOpt.thirdPartyResult.calldataTargets,
          activeOpt.thirdPartyResult.calldataWeights,
          "ThirdPartyVoter"
        );
      }

      if (!isRouterApproved) {
        setTxStatus({
          type: "pending",
          message: `Step 1/2: Approve EpochPilotRouter for veMEZO #${tokenIdToUse} in wallet...`,
        });
        const approveHash = await client.writeContract({
          chain,
          account,
          address: cfg.veMEZO,
          abi: VOTING_ESCROW_ABI,
          functionName: "approve",
          args: [routerAddress as Address, BigInt(tokenIdToUse)],
        });
        setTxStatus({
          type: "pending",
          message: `Step 1/2: Confirming router approval for veMEZO #${tokenIdToUse}...`,
          hash: approveHash,
        });
        await pubClient.waitForTransactionReceipt({ hash: approveHash });

        // Wait for load-balanced RPC replicas to index the approval before wallet gas estimation
        for (let attempt = 0; attempt < 6; attempt++) {
          const nowApproved = await pubClient
            .readContract({
              address: cfg.veMEZO,
              abi: VOTING_ESCROW_ABI,
              functionName: "isApprovedOrOwner",
              args: [routerAddress as Address, BigInt(tokenIdToUse)],
            })
            .catch(() => false);
          if (nowApproved) break;
          await new Promise((r) => setTimeout(r, 600));
        }
      }

      const batchArgs = [
        BigInt(tokenIdToUse),
        canVoteBoost ? activeOpt.boostResult.calldataTargets : [],
        canVoteBoost ? activeOpt.boostResult.calldataWeights : [],
        canVoteTp ? activeOpt.thirdPartyResult.calldataTargets : [],
        canVoteTp ? activeOpt.thirdPartyResult.calldataWeights : [],
        [],
        true,
      ] as const;

      // Verify simulation succeeds on-chain before opening wallet
      await pubClient.simulateContract({
        account,
        address: routerAddress as Address,
        abi: EPOCH_PILOT_ROUTER_ABI,
        functionName: "executeOptimalEpochVote",
        args: batchArgs,
      });

      setTxStatus({
        type: "pending",
        message: `${
          !isRouterApproved ? "Step 2/2: " : ""
        }Confirm Atomic 1-Tx Dual Vote for veMEZO #${tokenIdToUse} in wallet...`,
      });
      const hash = await client.writeContract({
        chain,
        account,
        address: routerAddress as Address,
        abi: EPOCH_PILOT_ROUTER_ABI,
        functionName: "executeOptimalEpochVote",
        args: batchArgs,
      });
      setTxStatus({
        type: "success",
        message: `Atomic Dual-Voter Batch executed for veMEZO #${tokenIdToUse}`,
        hash,
      });
    } catch (err) {
      setTxStatus({
        type: "error",
        message: formatTxError(err),
      });
    }
  };

  const handleClaimAndCompoundToMusd = async () => {
    const activeAllocations = [
      ...dualOptimization.boostResult.allocations,
      ...dualOptimization.thirdPartyResult.allocations,
    ];
    const bribeContracts = activeAllocations.map((a) => a.gauge.bribeAddress);
    const bribeTokens = activeAllocations.map(() => [
      cfg.musd,
      cfg.mezo,
      cfg.btc,
    ]);

    try {
      const { client, account, chain } = await getWalletClient();
      const tokenIdToUse = await resolveExecutableVeMezoId(account);
      if (routerAddress && isAddress(routerAddress)) {
        const pubClient = getReadClient(network);
        const [mezoBalRaw, btcBalRaw] = await Promise.all([
          pubClient
            .readContract({
              address: cfg.mezo,
              abi: ERC20_ABI,
              functionName: "balanceOf",
              args: [account],
            })
            .catch(() => 0n),
          pubClient
            .readContract({
              address: cfg.btc,
              abi: ERC20_ABI,
              functionName: "balanceOf",
              args: [account],
            })
            .catch(() => 0n),
        ]);

        // C1: Check ERC-20 allowances and prompt approval if needed
        const tokensToApprove: { addr: Address; symbol: string; bal: bigint }[] = [];
        if (mezoBalRaw > 0n) tokensToApprove.push({ addr: cfg.mezo, symbol: "MEZO", bal: mezoBalRaw });
        if (btcBalRaw > 0n) tokensToApprove.push({ addr: cfg.btc, symbol: "BTC", bal: btcBalRaw });

        for (let i = 0; i < tokensToApprove.length; i++) {
          const tok = tokensToApprove[i];
          const allowance = await pubClient
            .readContract({
              address: tok.addr,
              abi: ERC20_ABI,
              functionName: "allowance",
              args: [account, routerAddress as Address],
            })
            .catch(() => 0n);
          if (allowance < tok.bal) {
            setTxStatus({
              type: "pending",
              message: `Step ${i + 1}/${tokensToApprove.length + 1}: Approving ${tok.symbol} for Tigris AMM swap...`,
            });
            const appHash = await client.writeContract({
              chain,
              account,
              address: tok.addr,
              abi: ERC20_ABI,
              functionName: "approve",
              args: [routerAddress as Address, tok.bal],
            });
            await pubClient.waitForTransactionReceipt({ hash: appHash });
          }
        }

        // Calculate 1% max-slippage floor (99.0% of oracle value) so minMusdOuts is never 0 when swapping
        const mezoPriceScaled = BigInt(
          Math.max(1, Math.round(telemetry.mezoPriceUsd * 1e6))
        );
        const btcPriceScaled = BigInt(
          Math.max(1, Math.round(telemetry.btcPriceUsd * 1e6))
        );
        const minMusdFromMezo =
          mezoBalRaw > 0n
            ? ((mezoBalRaw * mezoPriceScaled * 9900n) / (1_000_000n * 10_000n)) || 1n
            : 1n;
        const minMusdFromBtc =
          btcBalRaw > 0n
            ? ((btcBalRaw * btcPriceScaled * 9900n) / (1_000_000n * 10_000n)) || 1n
            : 1n;

        setTxStatus({
          type: "pending",
          message: `Sweeping bribes across ${bribeContracts.length} gauges into ${
            stakeIntoSMusd ? "sMUSD" : "MUSD"
          } (≤1.0% slippage guard)...`,
        });
        const hash = await client.writeContract({
          chain,
          account,
          address: routerAddress as Address,
          abi: EPOCH_PILOT_ROUTER_ABI,
          functionName: "claimAndCompoundToMUSD",
          args: [
            BigInt(tokenIdToUse),
            bribeContracts,
            bribeTokens,
            [cfg.mezo, cfg.btc],
            [minMusdFromMezo, minMusdFromBtc],
            [false, false],
            stakeIntoSMusd,
          ],
        });
        setTxStatus({
          type: "success",
          message: `Compounded bribes into ${stakeIntoSMusd ? "sMUSD" : "MUSD"}`,
          hash,
        });
      } else {
        setTxStatus({
          type: "pending",
          message: `Batch-claiming bribes for veMEZO #${tokenIdToUse}...`,
        });
        const boostBribes = dualOptimization.boostResult.allocations.map(
          (a) => a.gauge.bribeAddress
        );
        const boostTokens = boostBribes.map(() => [
          cfg.musd,
          cfg.mezo,
          cfg.btc,
        ]);
        const hash = await client.writeContract({
          chain,
          account,
          address: cfg.boostVoter,
          abi: BOOST_VOTER_ABI,
          functionName: "claimBribes",
          args: [boostBribes, boostTokens, BigInt(tokenIdToUse)],
        });
        setTxStatus({
          type: "success",
          message: `Claimed BoostVoter bribes for #${tokenIdToUse}`,
          hash,
        });
      }
    } catch (err) {
      setTxStatus({
        type: "error",
        message: formatTxError(err),
      });
    }
  };

  const copyHex = (label: string, hex: string) => {
    navigator.clipboard.writeText(hex);
    setCopiedCalldata(label);
    setTimeout(() => setCopiedCalldata(null), 2000);
  };

  const copyConnectedAddress = () => {
    if (!connectedAddress) return;
    navigator.clipboard.writeText(connectedAddress);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 1800);
  };

  const visibleAllocations = useMemo(() => {
    if (gaugeFilter === "boost")
      return dualOptimization.boostResult.allocations;
    if (gaugeFilter === "thirdParty")
      return dualOptimization.thirdPartyResult.allocations;
    return [
      ...dualOptimization.thirdPartyResult.allocations,
      ...dualOptimization.boostResult.allocations,
    ];
  }, [gaugeFilter, dualOptimization]);

  const walletConnectedReady =
    isMounted &&
    !isDisconnectedByUser &&
    isConnected &&
    Boolean(connectedAddress);

  const handleSwitchNetwork = (targetNet: NetworkKey) => {
    setNetwork(targetNet);
    if (targetNet === "testnet") {
      setExecutionMode("router");
    } else if (!routerByNetwork.mainnet) {
      setExecutionMode("direct");
    }
    const preset = PRESET_POSITIONS_BY_NETWORK[targetNet][0];
    setVeMezoIdInput(preset.veMezoId);
    setVeBtcIdInput(preset.veBtcId);
    setSimulatedVotingPower(preset.defaultPower);
    setCrossVeBtcAmount(preset.defaultVeBtcWeight);
    setBaseWeeklyUsdPerVeBtc(preset.defaultBaseFee);
    setMarketBribePer1kUsd(preset.defaultBribeRate);
    setPosition((prev) => ({
      ...prev,
      veMezoTokenId: preset.veMezoId,
      veBtcTokenId: preset.veBtcId,
    }));
    refreshTelemetry(
      targetNet,
      includeFloor,
      preset.veMezoId,
      preset.veBtcId
    );
    if (walletConnectedReady) {
      switchChainAsync({
        chainId: targetNet === "mainnet" ? mezoMainnet.id : mezoTestnet.id,
      }).catch(() => null);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[var(--background)] text-[var(--foreground)]">
      {/* VERCEL / SHADCN TOP BAR */}
      <header className="sticky top-0 z-30 h-16 border-b border-[var(--border)] bg-[var(--background)]/90 backdrop-blur-md">
        <div className="max-w-[1360px] mx-auto h-full px-6 sm:px-8 flex items-center justify-between gap-6">
          {/* Left: Full EpochPilot Wordmark + Navigation Tabs */}
          <div className="flex items-center gap-7 min-w-0">
            <button
              type="button"
              onClick={() => setWorkspaceView("optimizer")}
              className="flex items-center shrink-0 cursor-pointer focus:outline-none"
              aria-label="EpochPilot"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/epochpilot-logo.png"
                alt="EpochPilot"
                width={106}
                height={22}
                className={`h-[22px] w-auto object-contain select-none transition-opacity hover:opacity-85 ${
                  isDark ? "invert" : ""
                }`}
              />
            </button>

            {/* Desktop Navigation Tabs (shadcn style) */}
            <nav className="hidden md:flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setWorkspaceView("optimizer")}
                className={`ui-btn px-3.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                  workspaceView === "optimizer"
                    ? "bg-[var(--surface-subtle)] text-[var(--foreground)]"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
              >
                Gauge Optimizer
              </button>
              <button
                type="button"
                onClick={() => setWorkspaceView("crossPair")}
                className={`ui-btn px-3.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-2 ${
                  workspaceView === "crossPair"
                    ? "bg-[var(--surface-subtle)] text-[var(--foreground)]"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
              >
                <span>Cross-Pair Arbitrage</span>
                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono-tabular border border-[var(--border-strong)] text-[var(--foreground)]">
                  5.0x
                </span>
              </button>
              <button
                type="button"
                onClick={() => setWorkspaceView("compounder")}
                className={`ui-btn px-3.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-2 ${
                  workspaceView === "compounder"
                    ? "bg-[var(--surface-subtle)] text-[var(--foreground)]"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
              >
                <TokenIcon symbol="MUSD" size={13} />
                <span>MUSD Compounder</span>
              </button>
            </nav>
          </div>

          {/* Right: Cutoff Clock, Network Switcher, Theme Toggle, Wallet Popover/Modal Trigger */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div
              className="hidden lg:flex items-center gap-2 px-3 h-8 rounded-md border border-[var(--border)] bg-[var(--card)] text-xs whitespace-nowrap shrink-0"
              title={epochState.windowRecommendation}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--foreground)] shrink-0" />
              <span className="text-[var(--muted-foreground)]">Cutoff</span>
              <span className="font-mono-tabular font-medium text-[var(--foreground)]">
                {formatCompactDuration(epochState.secondsToVoteEnd)}
              </span>
            </div>

            {/* Network Switcher */}
            <div className="flex items-center p-0.5 h-8 rounded-md border border-[var(--border)] bg-[var(--card)] text-xs shrink-0">
              <button
                type="button"
                onClick={() => handleSwitchNetwork("mainnet")}
                className={`ui-btn px-2.5 h-full rounded-[4px] font-medium whitespace-nowrap cursor-pointer ${
                  network === "mainnet"
                    ? "bg-[var(--foreground)] text-[var(--background)]"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
              >
                Mainnet
              </button>
              <button
                type="button"
                onClick={() => handleSwitchNetwork("testnet")}
                className={`ui-btn px-2.5 h-full rounded-[4px] font-medium whitespace-nowrap cursor-pointer ${
                  network === "testnet"
                    ? "bg-[var(--foreground)] text-[var(--background)]"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
              >
                Testnet
              </button>
            </div>

            {/* Monochrome Dark/Light Toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              className="ui-btn w-8 h-8 rounded-md border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)] shrink-0 cursor-pointer"
              title={
                isDark
                  ? "Switch to Light Monochrome"
                  : "Switch to Dark Monochrome"
              }
              aria-label="Toggle theme"
            >
              {isDark ? <Sun size={14} /> : <Moon size={14} />}
            </button>

            {/* Wallet Button + Connected Account Popover */}
            <div className="relative shrink-0" ref={accountMenuRef}>
              {walletConnectedReady && connectedAddress ? (
                <button
                  type="button"
                  onClick={() => setIsAccountMenuOpen((prev) => !prev)}
                  className="ui-btn h-8 px-3 rounded-md border border-[var(--border-strong)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-[var(--foreground)] text-xs font-mono-tabular font-medium flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {activeConnector ? (
                    <WalletBrandIcon
                      name={activeConnector.name}
                      icon={activeConnector.icon}
                      size={15}
                    />
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--foreground)] shrink-0" />
                  )}
                  <span className="whitespace-nowrap">
                    {connectedAddress.slice(0, 6)}…{connectedAddress.slice(-4)}
                  </span>
                  <CaretDown
                    size={11}
                    className={`text-[var(--muted-foreground)] shrink-0 transition-transform duration-150 ${
                      isAccountMenuOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setWalletModalError(null);
                    setIsWalletModalOpen(true);
                  }}
                  className="ui-btn h-8 px-3.5 rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)] text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Wallet size={13} className="shrink-0" />
                  <span>Connect Wallet</span>
                </button>
              )}

              {/* Connected Account Dropdown Menu */}
              {walletConnectedReady && connectedAddress && isAccountMenuOpen && (
                <div className="animate-popover-in absolute right-0 mt-1.5 w-52 rounded-lg border border-[var(--border-strong)] bg-[var(--card)] divide-y divide-[var(--border)] text-xs z-50">
                  <div className="px-3 py-2.5 flex items-center justify-between gap-2">
                    <span className="font-medium text-[var(--foreground)] flex items-center gap-1.5 truncate">
                      {activeConnector && (
                        <WalletBrandIcon
                          name={activeConnector.name}
                          icon={activeConnector.icon}
                          size={15}
                        />
                      )}
                      <span className="truncate">
                        {activeConnector?.name || "Wallet"}
                      </span>
                    </span>
                    <span className="font-mono-tabular text-[11px] text-[var(--muted-foreground)] shrink-0">
                      {connectedAddress.slice(0, 5)}…{connectedAddress.slice(-4)}
                    </span>
                  </div>

                  <div className="p-1 space-y-0.5">
                    <button
                      type="button"
                      onClick={copyConnectedAddress}
                      className="ui-btn w-full px-2.5 py-1.5 rounded-md hover:bg-[var(--surface-subtle)] text-left flex items-center gap-2 text-xs text-[var(--foreground)] cursor-pointer"
                    >
                      {copiedAddress ? <Check size={13} /> : <Copy size={13} />}
                      <span>{copiedAddress ? "Copied" : "Copy Address"}</span>
                    </button>

                    <a
                      href={`${cfg.explorerUrl}/address/${connectedAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setIsAccountMenuOpen(false)}
                      className="ui-btn w-full px-2.5 py-1.5 rounded-md hover:bg-[var(--surface-subtle)] text-left flex items-center gap-2 text-xs text-[var(--foreground)]"
                    >
                      <ArrowUpRight size={13} />
                      <span>View on Explorer</span>
                    </a>

                    <button
                      type="button"
                      onClick={() => {
                        setIsAccountMenuOpen(false);
                        setWalletModalError(null);
                        setIsWalletModalOpen(true);
                      }}
                      className="ui-btn w-full px-2.5 py-1.5 rounded-md hover:bg-[var(--surface-subtle)] text-left flex items-center gap-2 text-xs text-[var(--foreground)] cursor-pointer"
                    >
                      <ArrowsLeftRight size={13} />
                      <span>Switch Wallet</span>
                    </button>
                  </div>

                  <div className="p-1">
                    <button
                      type="button"
                      onClick={handleDisconnectWallet}
                      className="ui-btn w-full px-2.5 py-1.5 rounded-md hover:bg-[var(--surface-subtle)] text-left flex items-center gap-2 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer"
                    >
                      <SignOut size={13} />
                      <span>Disconnect</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* MINIMAL DETECTED WALLETS MODAL */}
      {isWalletModalOpen && (
        <div
          className="animate-backdrop-in fixed inset-0 z-50 flex items-center justify-center backdrop-blur-xs p-4"
          style={{ backgroundColor: "var(--scrim)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsWalletModalOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-modal-title"
            className="animate-modal-in w-full max-w-[320px] rounded-lg border border-[var(--border-strong)] bg-[var(--card)] text-[var(--foreground)] divide-y divide-[var(--border)] overflow-hidden"
          >
            {/* Modal Header */}
            <div className="px-4 py-3 flex items-center justify-between">
              <h2
                id="wallet-modal-title"
                className="text-xs font-semibold text-[var(--foreground)]"
              >
                Connect Wallet
              </h2>
              <button
                type="button"
                onClick={() => setIsWalletModalOpen(false)}
                className="ui-btn w-6 h-6 rounded-md hover:bg-[var(--surface-subtle)] flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer"
                aria-label="Close modal"
              >
                <X size={13} />
              </button>
            </div>

            {/* Detected Wallets Only — Icon + Name */}
            <div className="p-2 space-y-1">
              {detectedWallets.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">
                  No browser wallet detected
                </div>
              ) : (
                detectedWallets.map((connector) => {
                  const isCurrent =
                    walletConnectedReady &&
                    activeConnector?.uid === connector.uid;
                  const isBusy =
                    isConnecting && connectingUid === connector.uid;

                  return (
                    <button
                      key={connector.uid}
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleSelectWallet(connector)}
                      className={`ui-btn w-full px-3 py-2.5 rounded-md text-left flex items-center justify-between text-xs font-medium cursor-pointer ${
                        isCurrent
                          ? "bg-[var(--surface-subtle)] text-[var(--foreground)]"
                          : "hover:bg-[var(--surface-subtle)] text-[var(--foreground)]"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <WalletBrandIcon
                          name={connector.name}
                          icon={connector.icon}
                          size={20}
                        />
                        <span>{connector.name}</span>
                      </div>

                      {isBusy ? (
                        <span className="text-[11px] text-[var(--muted-foreground)]">
                          …
                        </span>
                      ) : isCurrent ? (
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--foreground)]" />
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>

            {walletModalError && (
              <div className="px-4 py-2.5 text-[11px] text-[var(--muted-foreground)] flex items-start gap-2 overflow-hidden">
                <WarningCircle size={13} className="shrink-0 mt-0.5" />
                <span className="leading-snug min-w-0 flex-1 break-words">
                  {walletModalError}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MAIN WORKSPACE CONTAINER */}
      <main className="max-w-[1360px] w-full mx-auto px-6 sm:px-8 py-8 sm:py-10 flex-1 space-y-8">
        {/* TOP HEADER ROW */}
        <div className="space-y-2">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-[var(--foreground)]">
            veMEZO Dual-Voter Allocation Desk
          </h1>
          <p className="text-[13px] leading-relaxed text-[var(--muted-foreground)] max-w-[72ch]">
            Each{" "}
            <span className="font-mono-tabular text-[var(--foreground)]">
              veMEZO
            </span>{" "}
            lock carries two independent 100% voting budgets:{" "}
            <span className="text-[var(--foreground)] font-medium">
              ThirdPartyVoter ({telemetry.thirdPartyVoterGaugeCount} MUSD
              gauges)
            </span>{" "}
            and{" "}
            <span className="text-[var(--foreground)] font-medium">
              BoostVoter ({telemetry.boostVoterGaugeCount} active gauges)
            </span>
            .
          </p>
        </div>

        {/* MOBILE VIEW SWITCHER */}
        <div className="flex md:hidden items-center p-1 rounded-md border border-[var(--border)] bg-[var(--card)]">
          <button
            type="button"
            onClick={() => setWorkspaceView("optimizer")}
            className={`ui-btn flex-1 py-1.5 rounded-[4px] text-xs font-medium ${
              workspaceView === "optimizer"
                ? "bg-[var(--foreground)] text-[var(--background)]"
                : "text-[var(--muted-foreground)]"
            }`}
          >
            Optimizer
          </button>
          <button
            type="button"
            onClick={() => setWorkspaceView("crossPair")}
            className={`ui-btn flex-1 py-1.5 rounded-[4px] text-xs font-medium ${
              workspaceView === "crossPair"
                ? "bg-[var(--foreground)] text-[var(--background)]"
                : "text-[var(--muted-foreground)]"
            }`}
          >
            Cross-Pair
          </button>
          <button
            type="button"
            onClick={() => setWorkspaceView("compounder")}
            className={`ui-btn flex-1 py-1.5 rounded-[4px] text-xs font-medium ${
              workspaceView === "compounder"
                ? "bg-[var(--foreground)] text-[var(--background)]"
                : "text-[var(--muted-foreground)]"
            }`}
          >
            Compounder
          </button>
        </div>

        {/* UNIFIED 1PX HAIRLINE METRIC STRIP (Vercel Analytics / Linear pattern) */}
        <section className={`rounded-lg border border-[var(--border)] bg-[var(--card)] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[var(--border)] transition-opacity duration-300 ${isLoadingTelemetry ? "opacity-50 animate-pulse" : ""}`}>
          <div className="p-6 flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2 text-xs text-[var(--muted-foreground)] whitespace-nowrap">
              <span>Simulated Voting Weight</span>
              <span className="font-mono-tabular text-[11px] text-[var(--subtle-foreground)]">
                NFT #{veMezoIdInput}
              </span>
            </div>
            <div className="font-mono-tabular text-[26px] leading-none font-semibold tracking-tight text-[var(--foreground)] my-3.5 whitespace-nowrap">
              {formatVotes(simulatedVotingPower)}{" "}
              <span className="text-xs font-normal text-[var(--muted-foreground)]">
                veMEZO
              </span>
            </div>
            <div className="pt-3 border-t border-[var(--border)] flex items-center justify-between gap-2 text-xs text-[var(--subtle-foreground)] font-mono-tabular whitespace-nowrap">
              <span>
                $
                {Math.round(
                  simulatedVotingPower * telemetry.mezoPriceUsd
                ).toLocaleString("en-US")}{" "}
                lock value
              </span>
              <span className="text-[var(--foreground)]">2× 100%</span>
            </div>
          </div>

          <div className="p-6 flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2 text-xs text-[var(--muted-foreground)] whitespace-nowrap">
              <span>Expected Weekly Payout</span>
              <span className="px-1.5 py-0.5 rounded text-[11px] font-mono-tabular font-medium bg-[var(--foreground)] text-[var(--background)]">
                {dualOptimization.combinedAprPercent.toFixed(1)}% APR
              </span>
            </div>
            <div className="font-mono-tabular text-[26px] leading-none font-semibold tracking-tight text-[var(--foreground)] my-3.5 whitespace-nowrap">
              ${formatUsd(dualOptimization.combinedWeeklyPayoutUsd)}
            </div>
            <div className="pt-3 border-t border-[var(--border)] flex items-center justify-between gap-2 text-xs text-[var(--subtle-foreground)] font-mono-tabular whitespace-nowrap">
              <span>
                MUSD: $
                {formatUsd(
                  dualOptimization.thirdPartyResult.totalExpectedPayoutUsd,
                  0
                )}
              </span>
              <span>
                Boost: $
                {formatUsd(
                  dualOptimization.boostResult.totalExpectedPayoutUsd,
                  0
                )}
              </span>
            </div>
          </div>

          <div className="p-6 flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2 text-xs text-[var(--muted-foreground)] whitespace-nowrap">
              <span>KKT Alpha vs. Single-Gauge</span>
              <span className="font-mono-tabular text-[11px] text-[var(--subtle-foreground)]">
                ∂R/∂v = λ
              </span>
            </div>
            <div className="font-mono-tabular text-[26px] leading-none font-semibold tracking-tight text-[var(--foreground)] my-3.5 whitespace-nowrap">
              +${formatUsd(dualOptimization.dualBudgetAlphaUsd)}
              <span className="text-xs font-normal text-[var(--muted-foreground)]">
                {" "}
                / wk
              </span>
            </div>
            <div className="pt-3 border-t border-[var(--border)] flex items-center justify-between gap-2 text-xs text-[var(--subtle-foreground)] font-mono-tabular whitespace-nowrap">
              <span>
                Naive: $
                {formatUsd(
                  dualOptimization.boostResult.naiveSingleGaugePayoutUsd,
                  0
                )}
              </span>
              <span className="text-[var(--foreground)]">
                +${formatUsd(dualOptimization.dualBudgetAlphaUsd * 52, 0)}/yr
              </span>
            </div>
          </div>

          <div className="p-6 flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2 text-xs text-[var(--muted-foreground)] whitespace-nowrap">
              <span>Voter Supply Utilization</span>
              <span className="font-mono-tabular text-[11px] text-[var(--subtle-foreground)]">
                Block #{telemetry.blockNumber.toLocaleString("en-US")}
              </span>
            </div>
            <div className="flex items-baseline gap-2 font-mono-tabular my-3.5 whitespace-nowrap">
              <span className="text-[26px] leading-none font-semibold tracking-tight text-[var(--foreground)]">
                {telemetry.thirdPartyUtilizationPercent.toFixed(1)}%
              </span>
              <span className="text-xs text-[var(--muted-foreground)]">
                MUSD
              </span>
              <span className="text-[var(--subtle-foreground)]">/</span>
              <span className="text-base font-medium text-[var(--muted-foreground)]">
                {telemetry.boostUtilizationPercent.toFixed(1)}%
              </span>
              <span className="text-xs text-[var(--subtle-foreground)]">
                Boost
              </span>
            </div>
            <div className="pt-3 border-t border-[var(--border)] flex items-center justify-between gap-2 text-xs text-[var(--subtle-foreground)] font-mono-tabular whitespace-nowrap">
              <span>
                {(telemetry.idleThirdPartyVotingPower / 1_000_000).toFixed(1)}M
                veMEZO unvoted
              </span>
              <span className="text-[var(--foreground)]">MUSD Pools</span>
            </div>
          </div>
        </section>

        {/* ASYMMETRIC WORKSPACE: SPACIOUS TABLE + 360PX STICKY EXECUTION DESK */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-8 items-start">
          {/* LEFT PRIMARY VIEW */}
          <div className="min-w-0 space-y-6">
            {workspaceView === "optimizer" && (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] overflow-hidden">
                {/* Table Toolbar — Filter + Feed Mode + Refresh */}
                <div className="px-6 py-5 border-b border-[var(--border)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <h2 className="text-[15px] font-semibold tracking-tight text-[var(--foreground)]">
                      Optimal Gauge Allocation
                    </h2>
                    <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
                      Water-filling solver equalizes marginal return across{" "}
                      <span className="font-mono-tabular text-[var(--foreground)]">
                        {dualOptimization.boostResult.allocations.length +
                          dualOptimization.thirdPartyResult.allocations.length}
                      </span>{" "}
                      gauges, saving{" "}
                      <span className="font-mono-tabular text-[var(--foreground)] font-medium">
                        +$
                        {formatUsd(
                          dualOptimization.boostResult.selfDilutionSavedUsd
                        )}
                        /epoch
                      </span>{" "}
                      in self-dilution.
                    </p>
                  </div>

                  {/* Consolidated Table Controls: Segmented Filter + Feed Toggle + Refresh */}
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center p-0.5 h-8 rounded-md border border-[var(--border)] bg-[var(--background)] text-xs shrink-0">
                      <button
                        type="button"
                        onClick={() => setGaugeFilter("all")}
                        className={`ui-btn px-3 h-full rounded-[4px] font-medium whitespace-nowrap cursor-pointer ${
                          gaugeFilter === "all"
                            ? "bg-[var(--foreground)] text-[var(--background)]"
                            : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                        }`}
                      >
                        All (
                        {dualOptimization.thirdPartyResult.allocations.length +
                          dualOptimization.boostResult.allocations.length}
                        )
                      </button>
                      <button
                        type="button"
                        onClick={() => setGaugeFilter("thirdParty")}
                        className={`ui-btn px-3 h-full rounded-[4px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                          gaugeFilter === "thirdParty"
                            ? "bg-[var(--foreground)] text-[var(--background)]"
                            : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                        }`}
                      >
                        <TokenIcon symbol="MUSD" size={12} />
                        <span>
                          MUSD (
                          {dualOptimization.thirdPartyResult.allocations.length}
                          )
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setGaugeFilter("boost")}
                        className={`ui-btn px-3 h-full rounded-[4px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                          gaugeFilter === "boost"
                            ? "bg-[var(--foreground)] text-[var(--background)]"
                            : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                        }`}
                      >
                        <TokenIcon symbol="BTC" size={12} />
                        <span>
                          Boost (
                          {dualOptimization.boostResult.allocations.length})
                        </span>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        const nextFloor = !includeFloor;
                        setIncludeFloor(nextFloor);
                        refreshTelemetry(
                          network,
                          nextFloor,
                          veMezoIdInput,
                          veBtcIdInput
                        );
                      }}
                      className="ui-btn h-8 px-3 rounded-md border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--surface-subtle)] text-xs text-[var(--muted-foreground)] flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                      title="Toggle between pre-flip clearing model and raw on-chain bribes"
                    >
                      <SlidersHorizontal size={12} className="shrink-0" />
                      <span className="font-medium text-[var(--foreground)]">
                        {includeFloor ? "Pre-Flip" : "Raw RPC"}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        refreshTelemetry(
                          network,
                          includeFloor,
                          veMezoIdInput,
                          veBtcIdInput
                        )
                      }
                      className="ui-btn w-8 h-8 rounded-md border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--surface-subtle)] flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)] shrink-0 cursor-pointer"
                      title="Refresh live Mezo RPC state"
                      aria-label="Refresh telemetry"
                    >
                      <ArrowsClockwise
                        size={13}
                        className={
                          isLoadingTelemetry
                            ? "animate-spin text-[var(--foreground)]"
                            : ""
                        }
                      />
                    </button>
                  </div>
                </div>

                {/* Data Table — Dual-Budget Section Headers + Single-Line Rows with Hover Tooltips & Click-to-Expand Breakdown */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--surface-subtle)]/40 text-[11px] font-medium text-[var(--muted-foreground)]">
                        <th className="py-3.5 pl-6 pr-4 whitespace-nowrap">
                          Gauge / Pool
                        </th>
                        <th className="py-3.5 px-4 text-right whitespace-nowrap">
                          Current Votes
                        </th>
                        <th className="py-3.5 px-4 text-right whitespace-nowrap">
                          Bribe Pool
                        </th>
                        <th className="py-3.5 px-4 text-right whitespace-nowrap">
                          Realized APR
                        </th>
                        <th className="py-3.5 px-4 w-[180px] whitespace-nowrap">
                          Optimal Weight
                        </th>
                        <th className="py-3.5 pl-4 pr-6 text-right whitespace-nowrap">
                          Est. Payout
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)] text-[13px]">
                      {visibleAllocations.map((item, idx) => {
                        const pct = (item.weightBps / 100).toFixed(1);
                        const isTp = item.gauge.voterType === "thirdParty";
                        const isExpanded = expandedGaugeId === item.gauge.id;
                        const prevVoterType =
                          idx > 0
                            ? visibleAllocations[idx - 1].gauge.voterType
                            : null;
                        const showSectionHeader =
                          gaugeFilter === "all" &&
                          item.gauge.voterType !== prevVoterType;
                        // Guard against top-row tooltip clipping inside overflow-x-auto
                        const tooltipPos =
                          idx === 0 && !showSectionHeader
                            ? "top-full mt-1.5 origin-top"
                            : "bottom-full mb-1.5 origin-bottom";

                        const cleanSublabel = item.gauge.sublabel.replace(
                          "Target veBTC #?",
                          "Mezo Earn Boost"
                        );

                        return (
                          <React.Fragment key={`${item.gauge.id}-${idx}`}>
                            {showSectionHeader && (
                              <tr className="bg-[var(--surface-subtle)]/65">
                                <td colSpan={6} className="py-3 px-6">
                                  <div className="flex items-center justify-between gap-4 text-xs">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                      <TokenIcon
                                        symbol={isTp ? "MUSD" : "BTC"}
                                        size={15}
                                      />
                                      <span className="font-mono-tabular font-semibold text-[var(--foreground)] whitespace-nowrap">
                                        {isTp
                                          ? "BUDGET 01 · ThirdPartyVoter"
                                          : "BUDGET 02 · BoostVoter"}
                                      </span>
                                      <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded bg-[var(--background)] border border-[var(--border)] text-[11px] text-[var(--muted-foreground)] whitespace-nowrap">
                                        {isTp
                                          ? "MUSD Liquidity Gauges · 100% Budget"
                                          : "veBTC Boost Gauges · 100% Budget"}
                                      </span>
                                    </div>
                                    <span className="font-mono-tabular text-[var(--foreground)] font-medium whitespace-nowrap shrink-0">
                                      100.0% Allocated · +$
                                      {formatUsd(
                                        isTp
                                          ? dualOptimization.thirdPartyResult
                                              .totalExpectedPayoutUsd
                                          : dualOptimization.boostResult
                                              .totalExpectedPayoutUsd
                                      )}
                                      /wk
                                    </span>
                                  </div>
                                </td>
                              </tr>
                            )}

                            <tr
                              onClick={() =>
                                setExpandedGaugeId(
                                  isExpanded ? null : item.gauge.id
                                )
                              }
                              className={`transition-colors cursor-pointer ${
                                isExpanded
                                  ? "bg-[var(--surface-subtle)]/70"
                                  : "hover:bg-[var(--surface-subtle)]/45"
                              }`}
                            >
                              {/* 1. Gauge / Pool (Overlapping Token Pair Avatar + Pool Name + Chain Badge) */}
                              <td className="py-4 pl-6 pr-4 whitespace-nowrap">
                                <div className="flex items-center gap-3">
                                  <PoolPairAvatar
                                    label={item.gauge.label}
                                    voterType={item.gauge.voterType}
                                  />
                                  <span className="font-medium text-[var(--foreground)]">
                                    {item.gauge.label}
                                  </span>
                                  <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--surface-subtle)] border border-[var(--border)] text-[11px] text-[var(--muted-foreground)]">
                                    <ChainIcon
                                      chainLabel={item.gauge.chainLabel}
                                      size={12}
                                    />
                                    <span>{item.gauge.chainLabel}</span>
                                  </span>
                                </div>
                              </td>

                              {/* 2. Current Votes */}
                              <td className="py-4 px-4 text-right font-mono-tabular text-xs text-[var(--muted-foreground)] whitespace-nowrap">
                                {formatVotes(item.gauge.currentVotes)}
                              </td>

                              {/* 3. Bribe Pool (Bold Total + Hover Tooltip with Token Icons) */}
                              <td className="py-4 px-4 text-right font-mono-tabular whitespace-nowrap">
                                <div className="relative inline-block group/bribe">
                                  <span className="font-semibold text-[var(--foreground)] text-xs underline decoration-dotted decoration-[var(--border-strong)] underline-offset-4">
                                    ${formatUsd(item.gauge.totalBribeUsd, 0)}
                                  </span>
                                  {item.gauge.isProjectedBribe && (
                                    <span className="ml-1 px-1 py-0.5 rounded text-[9px] font-medium bg-[var(--surface-subtle)] text-[var(--muted-foreground)] border border-[var(--border)]" title="Projected from gauge weight share — not yet posted on-chain this epoch">Est.</span>
                                  )}
                                  <div
                                    className={`ui-tooltip pointer-events-none opacity-0 group-hover/bribe:opacity-100 absolute right-0 ${tooltipPos} z-30 px-2.5 py-1.5 rounded-md border border-[var(--border-strong)] bg-[var(--card)] text-[11px] text-[var(--foreground)] whitespace-nowrap flex items-center gap-2`}
                                  >
                                    {item.gauge.bribeTokens.map((t, tIdx) => (
                                      <React.Fragment key={`${t.symbol}-${tIdx}`}>
                                        {tIdx > 0 && (
                                          <span className="text-[var(--subtle-foreground)]">
                                            +
                                          </span>
                                        )}
                                        <span className="inline-flex items-center gap-1">
                                          <TokenIcon
                                            symbol={t.symbol}
                                            size={12}
                                          />
                                          <span>
                                            {Math.round(
                                              t.amount
                                            ).toLocaleString("en-US")}{" "}
                                            {t.symbol}
                                          </span>
                                        </span>
                                      </React.Fragment>
                                    ))}
                                  </div>
                                </div>
                              </td>

                              {/* 4. Realized APR (Bold APR + Hover Tooltip for Pre-Impact APR) */}
                              <td className="py-4 px-4 text-right font-mono-tabular whitespace-nowrap">
                                <div className="relative inline-block group/apr">
                                  <span className="text-xs font-semibold text-[var(--foreground)] underline decoration-dotted decoration-[var(--border-strong)] underline-offset-4">
                                    {item.realizedAprPercent.toFixed(1)}%
                                  </span>
                                  <div
                                    className={`ui-tooltip pointer-events-none opacity-0 group-hover/apr:opacity-100 absolute right-0 ${tooltipPos} z-30 px-2.5 py-1.5 rounded-md border border-[var(--border-strong)] bg-[var(--card)] text-[11px] text-[var(--muted-foreground)] whitespace-nowrap`}
                                  >
                                    Pre-impact:{" "}
                                    <span className="text-[var(--foreground)] font-medium">
                                      {item.headlineAprPercent.toFixed(1)}%
                                    </span>
                                  </div>
                                </div>
                              </td>

                              {/* 5. Optimal Weight (Single-Line Bar + Percentage) */}
                              <td className="py-4 px-4 whitespace-nowrap">
                                <div className="relative group/weight flex items-center gap-3">
                                  <div className="w-20 h-1.5 rounded-full bg-[var(--track-bg)] overflow-hidden shrink-0">
                                    <div
                                      className={`bar-fill h-full rounded-full ${
                                        isTp
                                          ? "bg-[var(--foreground)]"
                                          : "bg-[var(--muted-foreground)]"
                                      }`}
                                      style={{
                                        width: `${Math.min(
                                          100,
                                          item.weightBps / 100
                                        )}%`,
                                      }}
                                    />
                                  </div>
                                  <span className="font-mono-tabular text-xs font-medium text-[var(--foreground)]">
                                    {pct}%
                                  </span>
                                  <div
                                    className={`ui-tooltip pointer-events-none opacity-0 group-hover/weight:opacity-100 absolute left-0 ${tooltipPos} z-30 px-2.5 py-1.5 rounded-md border border-[var(--border-strong)] bg-[var(--card)] font-mono-tabular text-[11px] text-[var(--foreground)] whitespace-nowrap inline-flex items-center gap-1.5`}
                                  >
                                    <TokenIcon symbol="MEZO" size={12} />
                                    <span>
                                      {formatVotes(item.allocatedVotes)} veMEZO
                                    </span>
                                  </div>
                                </div>
                              </td>

                              {/* 6. Est. Payout + Expand Toggle */}
                              <td className="py-4 pl-4 pr-6 text-right font-mono-tabular whitespace-nowrap">
                                <div className="inline-flex items-center justify-end gap-2.5">
                                  <div className="relative group/payout">
                                    <span className="font-semibold text-[var(--foreground)] text-[13px] underline decoration-dotted decoration-[var(--border-strong)] underline-offset-4">
                                      ${formatUsd(item.expectedPayoutUsd)}
                                    </span>
                                    <div
                                      className={`ui-tooltip pointer-events-none opacity-0 group-hover/payout:opacity-100 absolute right-0 ${tooltipPos} z-30 px-2.5 py-1.5 rounded-md border border-[var(--border-strong)] bg-[var(--card)] text-[11px] text-[var(--muted-foreground)] whitespace-nowrap`}
                                    >
                                      Pool share:{" "}
                                      <span className="text-[var(--foreground)] font-medium">
                                        {item.shareOfGaugeAfterPercent.toFixed(
                                          1
                                        )}
                                        %
                                      </span>
                                    </div>
                                  </div>
                                  <CaretDown
                                    size={12}
                                    className={`text-[var(--subtle-foreground)] transition-transform duration-150 ${
                                      isExpanded
                                        ? "rotate-180 text-[var(--foreground)]"
                                        : ""
                                    }`}
                                  />
                                </div>
                              </td>
                            </tr>

                            {/* Click-to-Expand Breakdown Drawer Row */}
                            {isExpanded && (
                              <tr className="bg-[var(--surface-subtle)]/35">
                                <td colSpan={6} className="px-6 py-4">
                                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-6 text-xs">
                                    <div>
                                      <div className="text-[11px] text-[var(--subtle-foreground)] mb-1.5">
                                        Bribe Breakdown
                                      </div>
                                      <div className="font-mono-tabular text-[var(--foreground)] font-medium flex flex-wrap items-center gap-2">
                                        {item.gauge.bribeTokens.map(
                                          (t, tIdx) => (
                                            <React.Fragment key={`${t.symbol}-${tIdx}`}>
                                              {tIdx > 0 && (
                                                <span className="text-[var(--subtle-foreground)]">
                                                  +
                                                </span>
                                              )}
                                              <span className="inline-flex items-center gap-1.5">
                                                <TokenIcon
                                                  symbol={t.symbol}
                                                  size={13}
                                                />
                                                <span>
                                                  {Math.round(
                                                    t.amount
                                                  ).toLocaleString("en-US")}{" "}
                                                  {t.symbol}
                                                </span>
                                              </span>
                                            </React.Fragment>
                                          )
                                        )}
                                      </div>
                                    </div>

                                    <div>
                                      <div className="text-[11px] text-[var(--subtle-foreground)] mb-1.5">
                                        APR Impact & Share
                                      </div>
                                      <div className="font-mono-tabular text-[var(--foreground)]">
                                        <span className="text-[var(--muted-foreground)] line-through mr-1.5">
                                          {item.headlineAprPercent.toFixed(1)}%
                                        </span>
                                        <span className="font-medium">
                                          {item.realizedAprPercent.toFixed(1)}%
                                        </span>
                                        <span className="text-[var(--subtle-foreground)] ml-1.5">
                                          (
                                          {item.shareOfGaugeAfterPercent.toFixed(
                                            1
                                          )}
                                          % share)
                                        </span>
                                      </div>
                                    </div>

                                    <div>
                                      <div className="text-[11px] text-[var(--subtle-foreground)] mb-1.5">
                                        Allocated Votes
                                      </div>
                                      <div className="font-mono-tabular text-[var(--foreground)] font-medium inline-flex items-center gap-1.5">
                                        <TokenIcon symbol="MEZO" size={13} />
                                        <span>
                                          {Math.round(
                                            item.allocatedVotes
                                          ).toLocaleString("en-US")}{" "}
                                          veMEZO ({pct}%)
                                        </span>
                                      </div>
                                    </div>

                                    <div className="flex sm:justify-end items-center gap-3">
                                      <span className="text-[11px] text-[var(--subtle-foreground)] inline-flex items-center gap-1.5">
                                        <ChainIcon
                                          chainLabel={item.gauge.chainLabel}
                                          size={13}
                                        />
                                        <span>
                                          {item.gauge.chainLabel} ·{" "}
                                          {cleanSublabel}
                                        </span>
                                      </span>
                                      <a
                                        href={`${cfg.explorerUrl}/address/${item.gauge.gaugeAddress}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="px-2.5 py-1 rounded border border-[var(--border-strong)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] font-mono-tabular text-[11px] text-[var(--foreground)] inline-flex items-center gap-1 shrink-0"
                                      >
                                        <span>Gauge</span>
                                        <ArrowUpRight size={11} />
                                      </a>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {workspaceView === "crossPair" &&
              (() => {
                const isCrossPairOptimal =
                  crossPairAnalysis.recommendedStrategy === "CROSS-PAIR";
                const formattedAdvantage = formatUsd(
                  crossPairAnalysis.weeklyAdvantageMusd
                );
                const formattedBribeCost = Math.round(
                  crossPairAnalysis.crossPair.requiredMusdBribeCostUsd
                ).toLocaleString("en-US");

                return (
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] divide-y divide-[var(--border)]">
                    <div className="p-6 flex flex-wrap items-start justify-between gap-4">
                      <div className="space-y-1.5">
                        <h2 className="text-[15px] font-semibold tracking-tight text-[var(--foreground)]">
                          Cross-Pair vs. Self-Pair Boost Arbitrage
                        </h2>
                        <p className="text-xs text-[var(--muted-foreground)] max-w-[65ch] leading-relaxed">
                          Under{" "}
                          <code className="font-mono-tabular text-[var(--foreground)]">
                            BoostVoter.getBoost()
                          </code>
                          , holders of both{" "}
                          <code className="font-mono-tabular text-[var(--foreground)]">
                            veBTC
                          </code>{" "}
                          and{" "}
                          <code className="font-mono-tabular text-[var(--foreground)]">
                            veMEZO
                          </code>{" "}
                          can either self-vote for boost or post an{" "}
                          <code className="font-mono-tabular text-[var(--foreground)]">
                            MUSD
                          </code>{" "}
                          bribe to rent a 5.0× multiplier from the market while
                          routing their own{" "}
                          <code className="font-mono-tabular text-[var(--foreground)]">
                            veMEZO
                          </code>{" "}
                          to external high-yield gauges.
                        </p>
                      </div>

                      <span className="px-2.5 py-1 rounded text-xs font-mono-tabular font-medium bg-[var(--foreground)] text-[var(--background)] whitespace-nowrap shrink-0">
                        {crossPairAnalysis.recommendedStrategy} (+$
                        {formattedAdvantage}/wk)
                      </span>
                    </div>

                    {/* 3 Monochrome Parameter Cells */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[var(--border)]">
                      <div className="p-6 space-y-2">
                        <label
                          htmlFor="cp-vebtc"
                          className="block text-xs text-[var(--muted-foreground)]"
                        >
                          Your veBTC Weight
                        </label>
                        <input
                          id="cp-vebtc"
                          type="number"
                          step="0.1"
                          min="0.05"
                          value={crossVeBtcAmount}
                          onChange={(e) =>
                            setCrossVeBtcAmount(
                              Math.max(0.01, Number(e.target.value))
                            )
                          }
                          className="w-full bg-transparent font-mono-tabular text-xl font-semibold text-[var(--foreground)] focus:outline-none"
                        />
                        <div className="text-[11px] text-[var(--subtle-foreground)] font-mono-tabular">
                          Needs{" "}
                          {Math.round(
                            crossPairAnalysis.veMezoNeededFor5x
                          ).toLocaleString("en-US")}{" "}
                          veMEZO for 5.0×
                        </div>
                      </div>

                      <div className="p-6 space-y-2">
                        <label
                          htmlFor="cp-base-fee"
                          className="block text-xs text-[var(--muted-foreground)]"
                        >
                          Base 1× veBTC Yield ($/wk)
                        </label>
                        <input
                          id="cp-base-fee"
                          type="number"
                          step="2"
                          min="1"
                          value={baseWeeklyUsdPerVeBtc}
                          onChange={(e) =>
                            setBaseWeeklyUsdPerVeBtc(
                              Math.max(1, Number(e.target.value))
                            )
                          }
                          className="w-full bg-transparent font-mono-tabular text-xl font-semibold text-[var(--foreground)] focus:outline-none"
                        />
                        <div className="text-[11px] text-[var(--subtle-foreground)]">
                          PoolsVoter fees + bribes per veBTC
                        </div>
                      </div>

                      <div className="p-6 space-y-2">
                        <label
                          htmlFor="cp-bribe-rate"
                          className="block text-xs text-[var(--muted-foreground)]"
                        >
                          Market Bribe Cost (MUSD / 1k)
                        </label>
                        <input
                          id="cp-bribe-rate"
                          type="number"
                          step="0.05"
                          min="0.1"
                          value={marketBribePer1kUsd}
                          onChange={(e) =>
                            setMarketBribePer1kUsd(
                              Math.max(0.05, Number(e.target.value))
                            )
                          }
                          className="w-full bg-transparent font-mono-tabular text-xl font-semibold text-[var(--foreground)] focus:outline-none"
                        />
                        <div className="text-[11px] text-[var(--subtle-foreground)]">
                          Clearing price per 1,000 veMEZO votes
                        </div>
                      </div>
                    </div>

                    {/* Side-by-Side Comparison */}
                    <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[var(--border)]">
                      <div
                        className={`p-6 space-y-4 ${
                          !isCrossPairOptimal
                            ? "bg-[var(--surface-subtle)]/35"
                            : ""
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`text-sm ${
                              !isCrossPairOptimal
                                ? "font-semibold text-[var(--foreground)]"
                                : "font-medium text-[var(--muted-foreground)]"
                            }`}
                          >
                            Option A · Self-Pair
                            {!isCrossPairOptimal ? " (Optimal)" : ""}
                          </span>
                          <span
                            className={
                              !isCrossPairOptimal
                                ? "px-2 py-0.5 rounded text-[11px] font-mono-tabular font-medium bg-[var(--foreground)] text-[var(--background)] whitespace-nowrap"
                                : "font-mono-tabular text-xs text-[var(--subtle-foreground)] whitespace-nowrap"
                            }
                          >
                            {crossPairAnalysis.selfPairBoostMultiplier.toFixed(
                              2
                            )}
                            × Boost
                          </span>
                        </div>
                        <div className="space-y-2.5 text-xs text-[var(--muted-foreground)] pt-3 border-t border-[var(--border)]">
                          <div className="flex justify-between gap-2">
                            <span>Boosted veBTC Pool Fees</span>
                            <span className="font-mono-tabular text-[var(--foreground)]">
                              $
                              {formatUsd(
                                crossPairAnalysis.selfPair.veBtcFeeYieldUsd
                              )}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span>Leftover veMEZO Bribe Yield</span>
                            <span className="font-mono-tabular text-[var(--foreground)]">
                              $
                              {formatUsd(
                                crossPairAnalysis.selfPair
                                  .leftoverVeMezoBribeYieldUsd
                              )}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span>MUSD Bribe Cost Paid</span>
                            <span className="font-mono-tabular text-[var(--subtle-foreground)]">
                              $0.00
                            </span>
                          </div>
                        </div>
                        <div className="pt-4 border-t border-[var(--border)] flex items-baseline justify-between gap-2">
                          <span
                            className={`text-xs ${
                              !isCrossPairOptimal
                                ? "font-medium text-[var(--foreground)]"
                                : "text-[var(--muted-foreground)]"
                            }`}
                          >
                            Net Weekly Yield
                          </span>
                          <span className="font-mono-tabular text-xl font-semibold text-[var(--foreground)]">
                            {formatSignedUsd(
                              crossPairAnalysis.selfPair.netWeeklyYieldUsd
                            )}
                          </span>
                        </div>
                      </div>

                      <div
                        className={`p-6 space-y-4 ${
                          isCrossPairOptimal
                            ? "bg-[var(--surface-subtle)]/35"
                            : ""
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`text-sm ${
                              isCrossPairOptimal
                                ? "font-semibold text-[var(--foreground)]"
                                : "font-medium text-[var(--muted-foreground)]"
                            }`}
                          >
                            Option B · Cross-Pair
                            {isCrossPairOptimal ? " (Optimal)" : ""}
                          </span>
                          <span
                            className={
                              isCrossPairOptimal
                                ? "px-2 py-0.5 rounded text-[11px] font-mono-tabular font-medium bg-[var(--foreground)] text-[var(--background)] whitespace-nowrap"
                                : "font-mono-tabular text-xs text-[var(--subtle-foreground)] whitespace-nowrap"
                            }
                          >
                            5.00× Max Boost
                          </span>
                        </div>
                        <div className="space-y-2.5 text-xs text-[var(--muted-foreground)] pt-3 border-t border-[var(--border)]">
                          <div className="flex justify-between gap-2">
                            <span>5.0× Boosted veBTC Pool Fees</span>
                            <span className="font-mono-tabular text-[var(--foreground)]">
                              $
                              {formatUsd(
                                crossPairAnalysis.crossPair
                                  .boostedVeBtcFeeYieldUsd
                              )}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span>External KKT veMEZO Bribes</span>
                            <span className="font-mono-tabular text-[var(--foreground)] font-medium">
                              +$
                              {formatUsd(
                                crossPairAnalysis.crossPair
                                  .externalVeMezoBribeYieldUsd
                              )}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span>MUSD Bribe Cost to Rent 5×</span>
                            <span className="font-mono-tabular text-[var(--muted-foreground)]">
                              -$
                              {formatUsd(
                                crossPairAnalysis.crossPair
                                  .requiredMusdBribeCostUsd
                              )}
                            </span>
                          </div>
                        </div>
                        <div className="pt-4 border-t border-[var(--border)] flex items-baseline justify-between gap-2">
                          <span
                            className={`text-xs ${
                              isCrossPairOptimal
                                ? "font-medium text-[var(--foreground)]"
                                : "text-[var(--muted-foreground)]"
                            }`}
                          >
                            Net Weekly Yield
                          </span>
                          <span className="font-mono-tabular text-xl font-semibold text-[var(--foreground)]">
                            {formatSignedUsd(
                              crossPairAnalysis.crossPair.netWeeklyYieldUsd
                            )}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="p-6 flex flex-wrap items-center justify-between gap-4">
                      <div className="text-xs text-[var(--muted-foreground)]">
                        Annualized Arbitrage Advantage:{" "}
                        <strong className="text-[var(--foreground)] font-mono-tabular">
                          +$
                          {Math.round(
                            crossPairAnalysis.annualAdvantageMusd
                          ).toLocaleString("en-US")}{" "}
                          MUSD / yr
                        </strong>
                      </div>
                      <button
                        type="button"
                        onClick={
                          isCrossPairOptimal
                            ? handlePostCrossPairMusdBribe
                            : handleSelfPairBoostVote
                        }
                        className="ui-btn h-9 px-4 rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)] text-xs font-medium whitespace-nowrap cursor-pointer"
                      >
                        {isCrossPairOptimal
                          ? `Post ${formattedBribeCost} MUSD Bribe on Boost Gauge (+$${formattedAdvantage}/wk)`
                          : `Execute Self-Pair Boost Vote (Save $${formattedAdvantage}/wk)`}
                      </button>
                    </div>
                  </div>
                );
              })()}

            {workspaceView === "compounder" && (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] divide-y divide-[var(--border)]">
                <div className="p-6 space-y-1.5">
                  <h2 className="text-[15px] font-semibold tracking-tight text-[var(--foreground)]">
                    MUSD & sMUSD Bribe Auto-Compounder
                  </h2>
                  <p className="text-xs text-[var(--muted-foreground)] max-w-[65ch] leading-relaxed">
                    <code className="font-mono-tabular text-[var(--foreground)]">
                      EpochPilotRouter.sol
                    </code>{" "}
                    sweeps multi-token bribes across{" "}
                    <code className="font-mono-tabular text-[var(--foreground)]">
                      BoostVoter
                    </code>{" "}
                    and{" "}
                    <code className="font-mono-tabular text-[var(--foreground)]">
                      ThirdPartyVoter
                    </code>
                    , swaps non-MUSD rewards via Tigris Router, and deposits
                    into{" "}
                    <code className="font-mono-tabular text-[var(--foreground)]">
                      MUSDSavingsRate (sMUSD)
                    </code>
                    .
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[var(--border)]">
                  <div className="p-6 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono-tabular text-[11px] text-[var(--subtle-foreground)]">
                        01 / SWEEP
                      </span>
                      <span className="inline-flex items-center">
                        <TokenIcon symbol="MUSD" size={15} />
                        <TokenIcon
                          symbol="MEZO"
                          size={15}
                          className="-ml-1 ring-2 ring-[var(--card)]"
                        />
                        <TokenIcon
                          symbol="BTC"
                          size={15}
                          className="-ml-1 ring-2 ring-[var(--card)]"
                        />
                      </span>
                    </div>
                    <div className="text-sm font-medium text-[var(--foreground)]">
                      {dualOptimization.boostResult.allocations.length +
                        dualOptimization.thirdPartyResult.allocations.length}{" "}
                      Active Bribe Pools
                    </div>
                    <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
                      Batch-claims BribeVotingReward contracts across both
                      Voters.
                    </p>
                  </div>

                  <div className="p-6 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono-tabular text-[11px] text-[var(--subtle-foreground)]">
                        02 / SWAP
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <ChainIcon chainLabel="Mezo" size={15} />
                        <TokenIcon symbol="MUSD" size={15} />
                      </span>
                    </div>
                    <div className="text-sm font-medium text-[var(--foreground)]">
                      Tigris AMM Router
                    </div>
                    <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
                      Converts claimed MEZO and BTC rewards into MUSD
                      stablecoin.
                    </p>
                  </div>

                  <div className="p-6 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono-tabular text-[11px] text-[var(--subtle-foreground)]">
                        03 / STAKE
                      </span>
                      <TokenIcon symbol="MUSD" size={16} />
                    </div>
                    <div className="text-sm font-medium text-[var(--foreground)]">
                      sMUSD Vault (ERC-4626)
                    </div>
                    <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
                      Compounds MUSD into yield-bearing sMUSD shares.
                    </p>
                  </div>
                </div>

                {/* SECTION 3: ROUTER INSTANCE & PROTOCOL TELEMETRY */}
                <div className="p-6 bg-[var(--surface-subtle)]/20">
                  {network === "testnet" ? (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="px-2 py-0.5 rounded border border-[var(--border-strong)] bg-[var(--card)] font-mono-tabular text-[11px] font-medium text-[var(--foreground)]">
                            EpochPilotRouter.sol
                          </span>
                          {routerAddress && routerAddress.startsWith("0x") && (
                            <a
                              href={`${cfg.explorerUrl}/address/${routerAddress}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ui-btn h-7 px-2.5 rounded-md border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] inline-flex items-center gap-1 whitespace-nowrap"
                            >
                              <span>View Contract</span>
                              <ArrowUpRight size={11} />
                            </a>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={handleDeployRouter}
                          className="ui-btn h-7 px-2.5 rounded-md border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-[11px] font-medium text-[var(--foreground)] whitespace-nowrap cursor-pointer"
                        >
                          Deploy New Instance
                        </button>
                      </div>

                      <div className="flex gap-2.5">
                        <input
                          type="text"
                          placeholder="0x... (Optional: deployed EpochPilotRouter address)"
                          value={routerAddress}
                          onChange={(e) => setRouterAddress(e.target.value)}
                          className="flex-1 h-9 px-3 rounded-md bg-[var(--card)] border border-[var(--border)] font-mono-tabular text-xs text-[var(--foreground)] focus:border-[var(--foreground)] focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={handleApproveRouter}
                          className="ui-btn h-9 px-4 rounded-md border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-xs font-medium text-[var(--foreground)] whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          Approve NFT #{veMezoIdInput}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Row 1: Contract Title Badge + Primary Testnet Switch Action */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="px-2 py-0.5 rounded border border-[var(--border-strong)] bg-[var(--card)] font-mono-tabular text-[11px] font-medium text-[var(--foreground)]">
                            EpochPilotRouter.sol
                          </span>
                          <span className="text-[var(--subtle-foreground)]">
                            ·
                          </span>
                          <span className="text-xs font-semibold text-[var(--foreground)]">
                            Atomic Sweep & Compound Engine
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleSwitchNetwork("testnet")}
                          className="ui-btn h-8 px-3.5 rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)] text-xs font-medium inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <span>Switch to Testnet for Live Router Demo</span>
                          <span aria-hidden="true">→</span>
                        </button>
                      </div>

                      {/* Row 2: Structured Contract Telemetry + Custom Router Disclosure Toggle */}
                      <div className="pt-3 border-t border-[var(--border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                        <p className="text-[var(--muted-foreground)] leading-relaxed">
                          Live & verified on Matsnet Testnet (
                          <a
                            href={`https://explorer.test.mezo.org/address/${DEPLOYED_TESTNET_ROUTER}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono-tabular text-[var(--foreground)] hover:underline inline-flex items-center gap-0.5"
                          >
                            <span>0x9384…f8ad</span>
                            <ArrowUpRight size={10} />
                          </a>
                          ). Mainnet reads live{" "}
                          <span className="font-mono-tabular text-[var(--foreground)]">
                            ThirdPartyVoter
                          </span>
                          ,{" "}
                          <span className="font-mono-tabular text-[var(--foreground)]">
                            BoostVoter
                          </span>
                          ,{" "}
                          <span className="font-mono-tabular text-[var(--foreground)]">
                            Tigris AMM
                          </span>{" "}
                          &{" "}
                          <a
                            href={`${cfg.explorerUrl}/address/${cfg.sMusd}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono-tabular text-[var(--foreground)] hover:underline inline-flex items-center gap-0.5"
                          >
                            <span>sMUSD (0xb4D4…51CC)</span>
                            <ArrowUpRight size={10} />
                          </a>{" "}
                          telemetry.
                        </p>

                        <button
                          type="button"
                          onClick={() =>
                            setShowCustomMainnetRouter((prev) => !prev)
                          }
                          className="ui-btn h-7 px-2.5 rounded-md border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-[11px] font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 self-start sm:self-auto cursor-pointer"
                        >
                          <span>Self-Deploy / Custom Mainnet Router</span>
                          <CaretDown
                            size={11}
                            className={`transition-transform duration-150 ${
                              showCustomMainnetRouter ? "rotate-180" : ""
                            }`}
                          />
                        </button>
                      </div>

                      {/* Expandable Custom Mainnet Router Drawer */}
                      {(showCustomMainnetRouter ||
                        Boolean(routerByNetwork.mainnet)) && (
                        <div className="p-4 rounded-md border border-[var(--border)] bg-[var(--card)] space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className="font-medium text-[var(--foreground)]">
                              Custom Mainnet EpochPilotRouter ({cfg.chainName})
                            </span>
                            <div className="flex items-center gap-2.5">
                              {routerAddress &&
                                routerAddress.startsWith("0x") && (
                                  <a
                                    href={`${cfg.explorerUrl}/address/${routerAddress}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] inline-flex items-center gap-1 whitespace-nowrap"
                                  >
                                    <span>View Contract on Mezo Explorer</span>
                                    <ArrowUpRight size={12} />
                                  </a>
                                )}
                              <button
                                type="button"
                                onClick={handleDeployRouter}
                                className="ui-btn h-7 px-2.5 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] hover:bg-[var(--surface-hover)] text-[11px] font-medium text-[var(--foreground)] whitespace-nowrap cursor-pointer"
                              >
                                Deploy Router Instance
                              </button>
                            </div>
                          </div>

                          <div className="flex gap-2.5">
                            <input
                              type="text"
                              placeholder="0x... (Enter deployed Mainnet EpochPilotRouter address)"
                              value={routerAddress}
                              onChange={(e) => setRouterAddress(e.target.value)}
                              className="flex-1 h-9 px-3 rounded-md bg-[var(--background)] border border-[var(--border)] font-mono-tabular text-xs text-[var(--foreground)] focus:border-[var(--foreground)] focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={handleApproveRouter}
                              className="ui-btn h-9 px-4 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] hover:bg-[var(--surface-hover)] text-xs font-medium text-[var(--foreground)] whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              Approve NFT #{veMezoIdInput}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* SECTION 4: EXECUTION ACTION BAR */}
                <div className="px-6 py-4 bg-[var(--card)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <label className="flex items-center gap-2.5 text-xs text-[var(--muted-foreground)] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={stakeIntoSMusd}
                      onChange={(e) => setStakeIntoSMusd(e.target.checked)}
                      className="rounded accent-[var(--foreground)]"
                    />
                    <span>
                      Stake compounded MUSD into{" "}
                      <a
                        href={`${cfg.explorerUrl}/address/${cfg.sMusd}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="font-mono-tabular text-[var(--foreground)] hover:underline inline-flex items-center gap-0.5"
                      >
                        <span>sMUSD (0xb4D4…51CC)</span>
                        <ArrowUpRight size={11} />
                      </a>
                    </span>
                  </label>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      onClick={handleClaimRebase}
                      className="ui-btn h-9 px-4 rounded-md border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--surface-subtle)] text-xs font-medium text-[var(--foreground)] whitespace-nowrap cursor-pointer"
                    >
                      Claim Rebase (
                      {position.claimableRebaseMezo.toLocaleString("en-US", {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })}{" "}
                      MEZO)
                    </button>

                    <button
                      type="button"
                      onClick={handleClaimAndCompoundToMusd}
                      className="ui-btn h-9 px-4 rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)] text-xs font-medium whitespace-nowrap cursor-pointer"
                    >
                      {stakeIntoSMusd
                        ? "Claim Bribes & Compound to sMUSD"
                        : "Claim Bribes & Swap to MUSD"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT 360PX STICKY EXECUTION & INSPECTOR PANEL */}
          <aside className="w-full lg:sticky lg:top-24 rounded-lg border border-[var(--border)] bg-[var(--card)] divide-y divide-[var(--border)]">
            {/* SECTION 1: POSITION & WEIGHT SIMULATOR */}
            <div className="p-6 space-y-5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--foreground)]">
                  Position Simulator
                </span>
                <button
                  type="button"
                  onClick={() => setShowCustomNftInputs(!showCustomNftInputs)}
                  className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] underline underline-offset-4 cursor-pointer"
                >
                  {showCustomNftInputs ? "Close ID" : "Custom NFT #"}
                </button>
              </div>

              {/* Testnet Wallet On-Chain Lock Status & 1-Click Mint (Testnet Tab Only) */}
              {walletConnectedReady && network === "testnet" && (
                <div className="p-3.5 rounded-md border border-[var(--border-strong)] bg-[var(--surface-subtle)]/60 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-[var(--foreground)] inline-flex items-center gap-1.5">
                      <TokenIcon symbol="MEZO" size={13} />
                      <span>Testnet Wallet MEZO</span>
                    </span>
                    <span className="font-mono-tabular text-[var(--foreground)] font-semibold">
                      {walletHoldings.mezoBalance.toLocaleString("en-US", {
                        maximumFractionDigits: 1,
                      })}{" "}
                      MEZO
                    </span>
                  </div>

                  {walletHoldings.ownedVeMezoIds.length > 0 ? (
                    <div className="space-y-2 pt-1 border-t border-[var(--border)]">
                      <div className="flex items-center justify-between text-[11px] text-[var(--muted-foreground)]">
                        <span>Your Owned veMEZO Locks</span>
                        {walletHoldings.mezoBalance >= 1 && (
                          <button
                            type="button"
                            disabled={isMintingLock}
                            onClick={handleMintVeMezoLock}
                            className="text-[var(--foreground)] underline underline-offset-2 hover:text-[var(--muted-foreground)] cursor-pointer"
                          >
                            + Mint New Lock
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {walletHoldings.ownedVeMezoIds.map((id) => {
                          const isSelected = veMezoIdInput === id;
                          return (
                            <button
                              key={id}
                              type="button"
                              onClick={() => {
                                setVeMezoIdInput(id);
                                setPosition((prev) => ({
                                  ...prev,
                                  veMezoTokenId: id,
                                }));
                                refreshTelemetry(
                                  network,
                                  includeFloor,
                                  id,
                                  veBtcIdInput
                                );
                              }}
                              className={`ui-btn px-2.5 py-1 rounded text-xs font-mono-tabular font-medium border cursor-pointer ${
                                isSelected
                                  ? "bg-[var(--foreground)] text-[var(--background)] border-[var(--foreground)]"
                                  : "bg-[var(--card)] text-[var(--foreground)] border-[var(--border-strong)] hover:bg-[var(--surface-subtle)]"
                              }`}
                            >
                              My Lock #{id}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2 pt-1.5 border-t border-[var(--border)]">
                      <p className="text-[11px] text-[var(--muted-foreground)] leading-relaxed">
                        NFT #{veMezoIdInput} is a read-only preset. Lock MEZO
                        to mint your own{" "}
                        <span className="font-mono-tabular text-[var(--foreground)]">
                          veMEZO
                        </span>{" "}
                        NFT and vote on-chain:
                      </p>
                      {walletHoldings.mezoBalance >= 1 ? (
                        <button
                          type="button"
                          disabled={isMintingLock}
                          onClick={handleMintVeMezoLock}
                          className="ui-btn w-full h-8 px-3 rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)] disabled:opacity-50 text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <TokenIcon symbol="MEZO" size={13} />
                          <span>
                            {isMintingLock
                              ? "Minting veMEZO Lock..."
                              : `Lock ${
                                  walletHoldings.mezoBalance >= 25
                                    ? 25
                                    : Math.floor(walletHoldings.mezoBalance)
                                } MEZO (1 Yr) → Mint veMEZO`}
                          </span>
                        </button>
                      ) : (
                        <a
                          href="https://faucet.test.mezo.org"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ui-btn w-full h-8 px-3 rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)] text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <TokenIcon symbol="MEZO" size={13} />
                          <span>Claim MEZO at faucet.test.mezo.org</span>
                          <ArrowUpRight size={12} />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Preset Lock Grid */}
              <div className="grid grid-cols-2 gap-2">
                {PRESET_POSITIONS_BY_NETWORK[network].map((p) => {
                  const active = veMezoIdInput === p.veMezoId;
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => {
                        setVeMezoIdInput(p.veMezoId);
                        setVeBtcIdInput(p.veBtcId);
                        setSimulatedVotingPower(p.defaultPower);
                        setCrossVeBtcAmount(p.defaultVeBtcWeight);
                        setBaseWeeklyUsdPerVeBtc(p.defaultBaseFee);
                        setMarketBribePer1kUsd(p.defaultBribeRate);
                        setPosition((prev) => ({
                          ...prev,
                          veMezoTokenId: p.veMezoId,
                          veBtcTokenId: p.veBtcId,
                        }));
                        refreshTelemetry(
                          network,
                          includeFloor,
                          p.veMezoId,
                          p.veBtcId
                        );
                      }}
                      className={`ui-btn px-3 py-2 rounded-md text-xs font-medium text-left flex items-center justify-between gap-2 whitespace-nowrap border cursor-pointer ${
                        active
                          ? "bg-[var(--foreground)] text-[var(--background)] border-[var(--foreground)]"
                          : "bg-[var(--background)] text-[var(--muted-foreground)] border-[var(--border)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      <span className="truncate">{p.label}</span>
                      <span
                        className={`font-mono-tabular text-[11px] shrink-0 ${
                          active
                            ? "text-[var(--background)]/80"
                            : "text-[var(--subtle-foreground)]"
                        }`}
                      >
                        {formatVotes(p.defaultPower)}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Verified On-Chain NFT Lock Telemetry Strip */}
              <div className="px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)]/40 flex items-center justify-between gap-2 text-[11px]">
                <span className="text-[var(--muted-foreground)] truncate">
                  On-Chain{" "}
                  <span className="font-mono-tabular font-medium text-[var(--foreground)]">
                    veMEZO #{veMezoIdInput}
                  </span>{" "}
                  ·{" "}
                  <span className="font-mono-tabular text-[var(--foreground)]">
                    {Math.round(position.lockedMezo).toLocaleString("en-US")} MEZO
                  </span>{" "}
                  locked
                </span>
                <a
                  href={`${cfg.explorerUrl}/token/${cfg.veMEZO}/instance/${veMezoIdInput}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono-tabular text-[var(--muted-foreground)] hover:text-[var(--foreground)] inline-flex items-center gap-0.5 shrink-0"
                  title={`Owner: ${position.owner}`}
                >
                  <span>
                    {position.owner !==
                    "0x0000000000000000000000000000000000000000"
                      ? `${position.owner.slice(0, 6)}…${position.owner.slice(-4)}`
                      : "Verify"}
                  </span>
                  <ArrowUpRight size={11} />
                </a>
              </div>

              {showCustomNftInputs && (
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <div>
                    <label
                      htmlFor="side-vemezo-id"
                      className="block text-[11px] text-[var(--subtle-foreground)] mb-1"
                    >
                      veMEZO #
                    </label>
                    <input
                      id="side-vemezo-id"
                      type="number"
                      min={1}
                      value={veMezoIdInput}
                      onChange={(e) =>
                        setVeMezoIdInput(Number(e.target.value) || 1)
                      }
                      className="w-full h-8 px-2.5 rounded-md bg-[var(--background)] border border-[var(--border)] font-mono-tabular text-xs text-[var(--foreground)]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="side-vebtc-id"
                      className="block text-[11px] text-[var(--subtle-foreground)] mb-1"
                    >
                      veBTC #
                    </label>
                    <input
                      id="side-vebtc-id"
                      type="number"
                      min={1}
                      value={veBtcIdInput}
                      onChange={(e) =>
                        setVeBtcIdInput(Number(e.target.value) || 1)
                      }
                      className="w-full h-8 px-2.5 rounded-md bg-[var(--background)] border border-[var(--border)] font-mono-tabular text-xs text-[var(--foreground)]"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => {
                        setPosition((prev) => ({
                          ...prev,
                          veMezoTokenId: veMezoIdInput,
                          veBtcTokenId: veBtcIdInput,
                        }));
                        refreshTelemetry(
                          network,
                          includeFloor,
                          veMezoIdInput,
                          veBtcIdInput
                        );
                      }}
                      className="ui-btn w-full h-8 rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-medium cursor-pointer"
                    >
                      Inspect
                    </button>
                  </div>
                </div>
              )}

              {/* Voting Power Slider with Tactile Fill & Quick-Snap Scale */}
              <div className="pt-1 space-y-2.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <label
                    htmlFor="side-power-slider"
                    className="text-[var(--muted-foreground)]"
                  >
                    Voting Weight
                  </label>
                  <span className="font-mono-tabular font-semibold text-[var(--foreground)]">
                    {simulatedVotingPower.toLocaleString("en-US")} veMEZO
                  </span>
                </div>
                {(() => {
                  const sliderPct = Math.max(
                    0,
                    Math.min(
                      100,
                      ((simulatedVotingPower - 5_000) / (5_000_000 - 5_000)) *
                        100
                    )
                  );
                  return (
                    <input
                      id="side-power-slider"
                      type="range"
                      min={5_000}
                      max={5_000_000}
                      step={5_000}
                      value={simulatedVotingPower}
                      onChange={(e) =>
                        setSimulatedVotingPower(Number(e.target.value))
                      }
                      style={{
                        background: `linear-gradient(to right, var(--foreground) ${sliderPct}%, var(--track-bg) ${sliderPct}%)`,
                      }}
                      className="w-full"
                    />
                  );
                })()}
                <div className="flex justify-between text-[11px] font-mono-tabular pt-0.5">
                  {[
                    { label: "5k", val: 5_000 },
                    { label: "500k", val: 500_000 },
                    { label: "1.25M", val: 1_250_000 },
                    { label: "2.5M", val: 2_500_000 },
                    { label: "5M", val: 5_000_000 },
                  ].map((mark) => (
                    <button
                      key={mark.label}
                      type="button"
                      onClick={() => setSimulatedVotingPower(mark.val)}
                      className={`ui-btn px-1.5 py-0.5 rounded cursor-pointer ${
                        simulatedVotingPower === mark.val
                          ? "text-[var(--foreground)] font-medium bg-[var(--surface-subtle)]"
                          : "text-[var(--subtle-foreground)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      {mark.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* SECTION 2: EPOCH EXECUTION SUMMARY */}
            <div className="p-6 space-y-5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--foreground)]">
                  Execution Summary
                </span>
                <div className="flex p-0.5 rounded-md border border-[var(--border)] bg-[var(--background)] text-[11px] shrink-0">
                  <button
                    type="button"
                    onClick={() => setExecutionMode("direct")}
                    className={`ui-btn px-2.5 py-0.5 rounded-[3px] whitespace-nowrap cursor-pointer ${
                      executionMode === "direct"
                        ? "bg-[var(--foreground)] text-[var(--background)] font-medium"
                        : "text-[var(--muted-foreground)]"
                    }`}
                  >
                    Direct EOA
                  </button>
                  <button
                    type="button"
                    onClick={() => setExecutionMode("router")}
                    className={`ui-btn px-2.5 py-0.5 rounded-[3px] whitespace-nowrap cursor-pointer ${
                      executionMode === "router"
                        ? "bg-[var(--foreground)] text-[var(--background)] font-medium"
                        : "text-[var(--muted-foreground)]"
                    }`}
                  >
                    Batch Router
                  </button>
                </div>
              </div>

              <div className="text-xs divide-y divide-[var(--border)]">
                <div className="flex items-center justify-between gap-2 py-2.5 first:pt-0">
                  <span className="text-[var(--muted-foreground)] inline-flex items-center gap-2">
                    <TokenIcon symbol="MUSD" size={14} />
                    <span>
                      Budget 01 · MUSD (
                      {dualOptimization.thirdPartyResult.allocations.length})
                    </span>
                  </span>
                  <span className="font-mono-tabular font-medium text-[var(--foreground)] whitespace-nowrap">
                    +$
                    {formatUsd(
                      dualOptimization.thirdPartyResult.totalExpectedPayoutUsd
                    )}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 py-2.5">
                  <span className="text-[var(--muted-foreground)] inline-flex items-center gap-2">
                    <TokenIcon symbol="BTC" size={14} />
                    <span>
                      Budget 02 · Boost (
                      {dualOptimization.boostResult.allocations.length})
                    </span>
                  </span>
                  <span className="font-mono-tabular font-medium text-[var(--foreground)] whitespace-nowrap">
                    +$
                    {formatUsd(
                      dualOptimization.boostResult.totalExpectedPayoutUsd
                    )}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 py-2.5">
                  <span className="text-[var(--muted-foreground)] inline-flex items-center gap-2">
                    <TokenIcon symbol="MEZO" size={14} />
                    <span>Claimable Rebase</span>
                  </span>
                  <span className="font-mono-tabular text-[var(--foreground)] whitespace-nowrap">
                    {position.claimableRebaseMezo.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    MEZO
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 pt-3.5">
                  <span className="font-medium text-[var(--foreground)]">
                    Total Weekly Return
                  </span>
                  <span className="font-mono-tabular text-lg font-semibold text-[var(--foreground)] whitespace-nowrap">
                    ${formatUsd(dualOptimization.combinedWeeklyPayoutUsd)}
                  </span>
                </div>
              </div>

              {executionMode === "direct" ? (
                <div className="space-y-2.5 pt-1">
                  <button
                    type="button"
                    onClick={handleDirectThirdPartyVote}
                    className="ui-btn w-full h-9 px-4 rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)] text-xs font-medium flex items-center justify-center cursor-pointer"
                  >
                    Vote MUSD Gauges (100% Budget 01)
                  </button>

                  <button
                    type="button"
                    onClick={handleDirectBoostVote}
                    className="ui-btn w-full h-9 px-4 rounded-md border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--surface-subtle)] text-[var(--foreground)] text-xs font-medium flex items-center justify-center cursor-pointer"
                  >
                    Vote BoostVoter (100% Budget 02)
                  </button>

                  <div className="grid grid-cols-2 gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={handlePokeBoost}
                      className="ui-btn h-8 px-3 rounded-md border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--surface-subtle)] text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] whitespace-nowrap cursor-pointer"
                    >
                      Poke veBTC #{veBtcIdInput}
                    </button>
                    <button
                      type="button"
                      onClick={handleClaimRebase}
                      className="ui-btn h-8 px-3 rounded-md border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--surface-subtle)] text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] whitespace-nowrap cursor-pointer"
                    >
                      Claim Rebase
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5 pt-1">
                  <button
                    type="button"
                    onClick={handleRouterBatchExecute}
                    className="ui-btn w-full h-9 px-4 rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)] text-xs font-medium flex items-center justify-center cursor-pointer"
                  >
                    Execute Atomic 1-Tx Dual Vote
                  </button>

                  <button
                    type="button"
                    onClick={handleClaimAndCompoundToMusd}
                    className="ui-btn w-full h-9 px-4 rounded-md border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--surface-subtle)] text-[var(--foreground)] text-xs font-medium flex items-center justify-center cursor-pointer"
                  >
                    Sweep Bribes → {stakeIntoSMusd ? "sMUSD" : "MUSD"}
                  </button>
                </div>
              )}

              {/* Monochrome Status Banner */}
              {txStatus.type !== "idle" && (
                <div className="p-3.5 rounded-md border border-[var(--border-strong)] bg-[var(--surface-subtle)] text-xs flex items-start justify-between gap-2.5 text-[var(--foreground)] overflow-hidden">
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    {txStatus.type === "error" ? (
                      <WarningCircle
                        size={14}
                        className="shrink-0 mt-0.5 text-[var(--foreground)]"
                      />
                    ) : txStatus.type === "pending" ? (
                      <ArrowsClockwise
                        size={14}
                        className="shrink-0 mt-0.5 animate-spin text-[var(--foreground)]"
                      />
                    ) : (
                      <Check
                        size={14}
                        className="shrink-0 mt-0.5 text-[var(--foreground)]"
                      />
                    )}
                    <span className="leading-relaxed min-w-0 flex-1 break-words">
                      {txStatus.message}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {txStatus.hash && (
                      <a
                        href={`${cfg.explorerUrl}/tx/${txStatus.hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline font-mono-tabular font-medium text-[11px] hover:text-[var(--muted-foreground)]"
                      >
                        Tx ↗
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => setTxStatus({ type: "idle", message: "" })}
                      className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] p-0.5 rounded cursor-pointer"
                      aria-label="Dismiss status"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* SECTION 3: SAFE MULTISIG / CALLDATA INSPECTOR */}
            <div className="px-6 py-4">
              <button
                type="button"
                onClick={() => setShowCalldataDrawer(!showCalldataDrawer)}
                className="w-full flex items-center justify-between text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Code size={13} />
                  Safe Multisig / Raw Calldata
                </span>
                <span className="font-mono-tabular text-[11px]">
                  {showCalldataDrawer ? "−" : "+"}
                </span>
              </button>

              {showCalldataDrawer && (
                <div className="mt-3 p-3 rounded-md bg-[var(--background)] border border-[var(--border)] space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[var(--subtle-foreground)]">
                      Copy encoded hex:
                    </span>
                    <div className="flex gap-2.5">
                      <button
                        type="button"
                        onClick={() =>
                          copyHex("BOOST", encodedCalldata.boostVoteHex)
                        }
                        className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Copy size={11} />
                        {copiedCalldata === "BOOST" ? "Copied" : "Boost"}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          copyHex("MUSD", encodedCalldata.thirdPartyVoteHex)
                        }
                        className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Copy size={11} />
                        {copiedCalldata === "MUSD" ? "Copied" : "MUSD"}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          copyHex("ROUTER", encodedCalldata.routerBatchHex)
                        }
                        className="text-[var(--foreground)] font-medium hover:underline inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Copy size={11} />
                        {copiedCalldata === "ROUTER" ? "Copied" : "Router"}
                      </button>
                    </div>
                  </div>
                  <div className="font-mono-tabular text-[10px] text-[var(--subtle-foreground)] truncate">
                    {encodedCalldata.routerBatchHex}
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      </main>

      {/* MONOCHROME FOOTER */}
      <footer className="border-t border-[var(--border)] py-5 px-6 sm:px-8 text-xs text-[var(--subtle-foreground)]">
        <div className="max-w-[1360px] mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4 font-mono-tabular">
            <span className="text-[var(--muted-foreground)] inline-flex items-center gap-1.5">
              <ChainIcon chainLabel="Mezo" size={12} />
              <span>
                {cfg.chainName} ({cfg.chainId})
              </span>
            </span>
            <a
              href={`${cfg.explorerUrl}/address/${cfg.veMEZO}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--foreground)] transition-colors inline-flex items-center gap-1"
            >
              <TokenIcon symbol="MEZO" size={12} />
              <span>veMEZO</span>
            </a>
            <a
              href={`${cfg.explorerUrl}/address/${cfg.boostVoter}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--foreground)] transition-colors"
            >
              BoostVoter
            </a>
            <a
              href={`${cfg.explorerUrl}/address/${cfg.thirdPartyVoter}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--foreground)] transition-colors"
            >
              ThirdPartyVoter
            </a>
            <a
              href={`${cfg.explorerUrl}/address/${cfg.musd}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--foreground)] transition-colors inline-flex items-center gap-1"
            >
              <TokenIcon symbol="MUSD" size={12} />
              <span>MUSD</span>
            </a>
            {cfg.sMusd !== "0x0000000000000000000000000000000000000000" && (
              <a
                href={`${cfg.explorerUrl}/address/${cfg.sMusd}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-[var(--foreground)] transition-colors inline-flex items-center gap-1"
              >
                <TokenIcon symbol="sMUSD" size={12} />
                <span>sMUSD</span>
              </a>
            )}
          </div>
          <div className="inline-flex items-center gap-2 text-[var(--muted-foreground)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/epochpilot-mark.png"
              alt=""
              width={14}
              height={14}
              className={`w-3.5 h-3.5 object-contain opacity-80 ${
                isDark ? "invert" : ""
              }`}
            />
            <span>EpochPilot · Mezo Buildathon</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
