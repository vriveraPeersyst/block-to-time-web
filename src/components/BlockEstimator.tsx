"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import type { Network } from "@/lib/networks";

type Mode = "block-to-time" | "time-to-block";

interface ActiveWatch {
  id: string;
  title: string;
  targetBlock: number;
  network: string;
  estimatedTime: string;
  slackWebhookUrl: string | null;
  createdAt: string;
  notifications: { tier: string; scheduledFor: string; sent: boolean }[];
}

interface BlockEstimate {
  currentBlock: number;
  targetBlock: number;
  blocksRemaining: number;
  avgBlockTimeMs: number;
  estimatedTimeMs: number;
  estimatedDate: string;
  sources: {
    ethRpc: { blockHeight: number; url: string } | null;
    tendermint: {
      blockHeight: number;
      avgBlockTimeMs: number;
      url: string;
    } | null;
    cosmosApi: { blockHeight: number; url: string } | null;
  };
  confidence: "high" | "medium" | "low";
}

interface TimeToBlockEstimate {
  currentBlock: number;
  estimatedBlock: number;
  blocksAway: number;
  avgBlockTimeMs: number;
  targetDate: string;
  timeFromNowMs: number;
  sources: BlockEstimate["sources"];
  confidence: "high" | "medium" | "low";
}

interface SubscribeResult {
  id: string;
  targetBlock: number;
  currentBlock: number;
  estimatedTime: string;
  notifications: {
    tier: string;
    scheduledFor: string;
    sent: boolean;
  }[];
}

export default function BlockEstimator() {
  const { data: session, status: authStatus } = useSession();
  const [mode, setMode] = useState<Mode>("block-to-time");
  const [targetBlock, setTargetBlock] = useState("");
  const [targetTime, setTargetTime] = useState("");
  const [network, setNetwork] = useState<Network>("XRPL_EVM_MAINNET");
  const [timezone, setTimezone] = useState("");
  const [slackWebhook, setSlackWebhook] = useState("");
  const [loading, setLoading] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [estimate, setEstimate] = useState<BlockEstimate | null>(null);
  const [timeToBlockEstimate, setTimeToBlockEstimate] =
    useState<TimeToBlockEstimate | null>(null);
  const [subscribeResult, setSubscribeResult] =
    useState<SubscribeResult | null>(null);
  const [error, setError] = useState("");
  const [showSubscribe, setShowSubscribe] = useState(false);
  const [timezones, setTimezones] = useState<string[]>([]);
  const [savedWebhooks, setSavedWebhooks] = useState<string[]>([]);
  const [watches, setWatches] = useState<ActiveWatch[]>([]);
  const [loadingWatches, setLoadingWatches] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [watchTitle, setWatchTitle] = useState("");
  const [watchTab, setWatchTab] = useState<"active" | "completed">("active");
  const [useCustomBlockTime, setUseCustomBlockTime] = useState(false);
  const [customBlockTime, setCustomBlockTime] = useState("");

  useEffect(() => {
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    setTimezones(Intl.supportedValuesOf("timeZone"));

    // Restore state after OAuth redirect
    const saved = sessionStorage.getItem("blockToTimeState");
    if (saved) {
      try {
        const s = JSON.parse(saved);
        if (s.mode) setMode(s.mode);
        if (s.network) setNetwork(s.network);
        if (s.targetBlock) setTargetBlock(s.targetBlock);
        if (s.targetTime) setTargetTime(s.targetTime);
        if (s.showSubscribe) setShowSubscribe(true);
      } catch { /* ignore */ }
      sessionStorage.removeItem("blockToTimeState");
    }
  }, []);

  // Fetch user's watches & saved webhooks when authenticated
  const fetchWatches = useCallback(async () => {
    setLoadingWatches(true);
    try {
      const res = await fetch("/api/watches");
      if (res.ok) {
        const data: ActiveWatch[] = await res.json();
        setWatches(data);
        // Extract unique webhook URLs
        const hooks = data
          .map((w) => w.slackWebhookUrl)
          .filter((h): h is string => !!h && !h.startsWith("..."));
        // We only have masked URLs from the list endpoint, so store full ones from subscribe responses
      }
    } catch { /* ignore */ }
    setLoadingWatches(false);
  }, []);

  useEffect(() => {
    if (session?.user) {
      fetchWatches();
      // Load saved webhooks from localStorage
      const stored = localStorage.getItem("savedWebhooks");
      if (stored) {
        try { setSavedWebhooks(JSON.parse(stored)); } catch { /* ignore */ }
      }
    }
  }, [session, fetchWatches]);



  const handleEstimate = useCallback(async () => {
    if (!targetBlock) return;

    setLoading(true);
    setError("");
    setEstimate(null);
    setSubscribeResult(null);

    try {
      const res = await fetch(
        `/api/estimate?block=${targetBlock}&network=${network}`
      );
      const data = await res.json();

      if (!res.ok) {
        setError(data.error);
        return;
      }

      setEstimate(data);
    } catch {
      setError("Failed to connect to the server.");
    } finally {
      setLoading(false);
    }
  }, [targetBlock, network]);

  const handleTimeToBlock = useCallback(async () => {
    if (!targetTime) return;

    setLoading(true);
    setError("");
    setTimeToBlockEstimate(null);

    try {
      const isoTime = new Date(targetTime).toISOString();
      let url = `/api/time-to-block?time=${encodeURIComponent(isoTime)}&network=${network}`;
      if (useCustomBlockTime && customBlockTime) {
        url += `&blockTime=${encodeURIComponent(customBlockTime)}`;
      }
      const res = await fetch(url);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error);
        return;
      }

      setTimeToBlockEstimate(data);
    } catch {
      setError("Failed to connect to the server.");
    } finally {
      setLoading(false);
    }
  }, [targetTime, network, useCustomBlockTime, customBlockTime]);

  const handleCancelWatch = async (watchId: string) => {
    setCancellingId(watchId);
    try {
      const res = await fetch(`/api/watch/${watchId}`, { method: "DELETE" });
      if (res.ok) {
        setWatches((prev) => prev.filter((w) => w.id !== watchId));
      }
    } catch { /* ignore */ }
    setCancellingId(null);
  };

  const handleSubscribe = async () => {
    if (!estimate || !slackWebhook) return;

    setSubscribing(true);
    setError("");

    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetBlock: Number(targetBlock),
          network,
          timezone,
          slackWebhookUrl: slackWebhook,
          title: watchTitle,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error);
        return;
      }

      setSubscribeResult(data);
      setShowSubscribe(false);
      setWatchTitle("");

      // Save webhook for reuse
      if (slackWebhook) {
        const updated = Array.from(new Set([slackWebhook, ...savedWebhooks])).slice(0, 5);
        setSavedWebhooks(updated);
        localStorage.setItem("savedWebhooks", JSON.stringify(updated));
      }

      // Refresh watches list
      fetchWatches();
    } catch {
      setError("Failed to subscribe.");
    } finally {
      setSubscribing(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || undefined,
      dateStyle: "full",
      timeStyle: "long",
    }).format(date);
  };

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0)
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  const googleCalUrl = estimate
    ? (() => {
        const fmt = (d: Date) =>
          d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
        const start = new Date(estimate.estimatedDate);
        const end = new Date(start.getTime() + 30 * 60000);
        const networkName =
          network === "XRPL_EVM_MAINNET"
            ? "XRPL EVM Mainnet"
            : "XRPL EVM Testnet";
        const url = new URL(
          "https://calendar.google.com/calendar/render"
        );
        url.searchParams.set("action", "TEMPLATE");
        url.searchParams.set(
          "text",
          `Block ${estimate.targetBlock.toLocaleString()} — ${networkName}`
        );
        url.searchParams.set(
          "details",
          `Target block ${estimate.targetBlock} on ${networkName}`
        );
        url.searchParams.set(
          "dates",
          `${fmt(start)}/${fmt(end)}`
        );
        return url.toString();
      })()
    : "";

  const outlookCalUrl = estimate
    ? (() => {
        const start = new Date(estimate.estimatedDate);
        const end = new Date(start.getTime() + 30 * 60000);
        const networkName =
          network === "XRPL_EVM_MAINNET"
            ? "XRPL EVM Mainnet"
            : "XRPL EVM Testnet";
        const url = new URL(
          "https://outlook.live.com/calendar/0/deeplink/compose"
        );
        url.searchParams.set(
          "subject",
          `Block ${estimate.targetBlock.toLocaleString()} — ${networkName}`
        );
        url.searchParams.set(
          "body",
          `Target block ${estimate.targetBlock} on ${networkName}`
        );
        url.searchParams.set("startdt", start.toISOString());
        url.searchParams.set("enddt", end.toISOString());
        url.searchParams.set("path", "/calendar/action/compose");
        url.searchParams.set("rru", "addevent");
        return url.toString();
      })()
    : "";

  const confidenceBadge = (c: string) => {
    const colors: Record<string, string> = {
      high: "bg-chart-2/20 text-chart-2 border-chart-2/40",
      medium: "bg-chart-3/20 text-chart-3 border-chart-3/40",
      low: "bg-destructive/20 text-destructive-foreground border-destructive/40",
    };
    return (
      <span
        className={`text-xs px-2 py-0.5 rounded-full border ${colors[c] ?? ""}`}
      >
        {c} confidence
      </span>
    );
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      {/* Logo */}
      <div className="flex justify-center mb-8">
        <img
          src="/XRPLEVM_FullWhiteLogo.png"
          alt="XRPL EVM"
          className="h-10"
        />
      </div>

      {/* Auth Bar */}
      <div className="flex justify-end mb-4">
        {authStatus === "loading" ? (
          <div className="h-9 w-24 bg-muted rounded-lg animate-pulse" />
        ) : session?.user ? (
          <div className="flex items-center gap-3">
            {session.user.image && (
              <img
                src={session.user.image}
                alt=""
                className="w-7 h-7 rounded-full"
              />
            )}
            <span className="text-sm text-muted-foreground">
              {session.user.name ?? session.user.email}
            </span>
            <button
              onClick={() => signOut()}
              className="text-xs px-3 py-1.5 bg-muted hover:bg-accent text-muted-foreground rounded-lg border border-border transition-all"
            >
              Sign out
            </button>
          </div>
        ) : (
          <button
            onClick={() => {
              sessionStorage.setItem("blockToTimeState", JSON.stringify({ mode, network, targetBlock, targetTime }));
              signIn("google");
            }}
            className="text-sm px-4 py-2 bg-muted hover:bg-accent text-muted-foreground rounded-lg border border-border transition-all flex items-center gap-2"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="currentColor"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Sign in with Google
          </button>
        )}
      </div>

      {/* Header */}
      <div className="text-center mb-10">
        <h1 className="text-4xl font-bold tracking-tight mb-2">
          <span className="text-primary">Block</span>{" "}
          <span className="text-muted-foreground">⇄</span>{" "}
          <span className="text-secondary">Time</span>
        </h1>
        <p className="text-muted-foreground text-sm">
          Convert between blocks and time on XRPL EVM
        </p>
      </div>

      {/* Mode Toggle */}
      <div className="flex mb-6 bg-card border border-border rounded-xl p-1">
        <button
          onClick={() => setMode("block-to-time")}
          className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all ${
            mode === "block-to-time"
              ? "bg-primary text-primary-foreground shadow"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Block → Time
        </button>
        <button
          onClick={() => setMode("time-to-block")}
          className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all ${
            mode === "time-to-block"
              ? "bg-primary text-primary-foreground shadow"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Time → Block
        </button>
      </div>

      {/* Input Form */}
      <div className="bg-card border border-border rounded-xl p-6 mb-6">
        <div className="grid grid-cols-1 gap-4">
          {/* Network selector */}
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1.5">
              Network
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setNetwork("XRPL_EVM_MAINNET")}
                className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  network === "XRPL_EVM_MAINNET"
                    ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                    : "bg-muted text-muted-foreground hover:bg-accent"
                }`}
              >
                Mainnet
              </button>
              <button
                type="button"
                onClick={() => setNetwork("XRPL_EVM_TESTNET")}
                className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  network === "XRPL_EVM_TESTNET"
                    ? "bg-secondary text-secondary-foreground shadow-lg shadow-secondary/20"
                    : "bg-muted text-muted-foreground hover:bg-accent"
                }`}
              >
                Testnet
              </button>
            </div>
          </div>

          {/* Conditional input based on mode */}
          {mode === "block-to-time" ? (
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1.5">
                Target Block Number
              </label>
              <input
                type="number"
                value={targetBlock}
                onChange={(e) => setTargetBlock(e.target.value)}
                placeholder="e.g. 10000000"
                className="w-full px-4 py-2.5 bg-input border border-border rounded-lg text-foreground placeholder-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                onKeyDown={(e) => e.key === "Enter" && handleEstimate()}
              />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1.5">
                  Target Date & Time
                </label>
                <input
                  type="datetime-local"
                  value={targetTime}
                  onChange={(e) => setTargetTime(e.target.value)}
                  min={new Date().toISOString().slice(0, 16)}
                  className="w-full px-4 py-2.5 bg-input border border-border rounded-lg text-foreground placeholder-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all [color-scheme:dark]"
                  onKeyDown={(e) => e.key === "Enter" && handleTimeToBlock()}
                />
              </div>

              {/* Custom block time toggle */}
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={useCustomBlockTime}
                    onClick={() => setUseCustomBlockTime(!useCustomBlockTime)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                      useCustomBlockTime ? "bg-primary" : "bg-muted-foreground/30"
                    }`}
                  >
                    <span
                      className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform ${
                        useCustomBlockTime ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </button>
                  <label className="text-sm font-medium text-muted-foreground">
                    Custom block time
                  </label>
                </div>
                {useCustomBlockTime && (
                  <div className="animate-fade-in">
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={customBlockTime}
                      onChange={(e) => setCustomBlockTime(e.target.value)}
                      placeholder="e.g. 3.85 (seconds per block)"
                      className="w-full px-4 py-2.5 bg-input border border-border rounded-lg text-foreground placeholder-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                      onKeyDown={(e) => e.key === "Enter" && handleTimeToBlock()}
                    />
                    <p className="text-xs text-muted-foreground/70 mt-1">
                      Override the auto-detected average block time (in seconds).
                    </p>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Timezone */}
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1.5">
              Timezone
            </label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full px-4 py-2.5 bg-input border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
            >
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>

          {/* Action button */}
          <button
            onClick={mode === "block-to-time" ? handleEstimate : handleTimeToBlock}
            disabled={loading || (mode === "block-to-time" ? !targetBlock : !targetTime)}
            className="w-full py-3 bg-gradient-to-r from-primary to-secondary text-primary-foreground font-medium rounded-lg hover:from-primary/90 hover:to-secondary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-primary/10"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg
                  className="animate-spin h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Estimating...
              </span>
            ) : mode === "block-to-time" ? (
              "Estimate Block Time"
            ) : (
              "Estimate Block Number"
            )}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-destructive/20 border border-destructive/40 rounded-xl p-4 mb-6 animate-fade-in">
          <p className="text-destructive-foreground text-sm">{error}</p>
        </div>
      )}

      {/* Results */}
      {estimate && mode === "block-to-time" && (
        <div className="animate-fade-in space-y-4">
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Estimated Time</h2>
              {confidenceBadge(estimate.confidence)}
            </div>

            <div className="bg-muted/50 rounded-lg p-4 mb-4">
              <p className="text-2xl font-bold text-primary">
                {formatDate(estimate.estimatedDate)}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                ~{formatDuration(estimate.estimatedTimeMs)} from now
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-muted/30 rounded-lg p-3">
                <p className="text-muted-foreground/70 text-xs uppercase tracking-wide">
                  Current Block
                </p>
                <p className="text-foreground font-mono mt-0.5">
                  {estimate.currentBlock.toLocaleString()}
                </p>
              </div>
              <div className="bg-muted/30 rounded-lg p-3">
                <p className="text-muted-foreground/70 text-xs uppercase tracking-wide">
                  Target Block
                </p>
                <p className="text-foreground font-mono mt-0.5">
                  {estimate.targetBlock.toLocaleString()}
                </p>
              </div>
              <div className="bg-muted/30 rounded-lg p-3">
                <p className="text-muted-foreground/70 text-xs uppercase tracking-wide">
                  Blocks Remaining
                </p>
                <p className="text-foreground font-mono mt-0.5">
                  {estimate.blocksRemaining.toLocaleString()}
                </p>
              </div>
              <div className="bg-muted/30 rounded-lg p-3">
                <p className="text-muted-foreground/70 text-xs uppercase tracking-wide">
                  Avg Block Time
                </p>
                <p className="text-foreground font-mono mt-0.5">
                  {(estimate.avgBlockTimeMs / 1000).toFixed(2)}s
                </p>
              </div>
            </div>

            {/* Data Sources */}
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground/70 uppercase tracking-wide mb-2">
                Data Sources
              </p>
              <div className="flex flex-wrap gap-2">
                {estimate.sources.ethRpc && (
                  <span className="text-xs bg-chart-2/20 text-chart-2 px-2 py-1 rounded">
                    ETH RPC ✓
                  </span>
                )}
                {!estimate.sources.ethRpc && (
                  <span className="text-xs bg-destructive/20 text-destructive-foreground px-2 py-1 rounded">
                    ETH RPC ✗
                  </span>
                )}
                {estimate.sources.tendermint && (
                  <span className="text-xs bg-chart-2/20 text-chart-2 px-2 py-1 rounded">
                    Tendermint ✓
                  </span>
                )}
                {!estimate.sources.tendermint && (
                  <span className="text-xs bg-destructive/20 text-destructive-foreground px-2 py-1 rounded">
                    Tendermint ✗
                  </span>
                )}
                {estimate.sources.cosmosApi && (
                  <span className="text-xs bg-chart-2/20 text-chart-2 px-2 py-1 rounded">
                    Cosmos API ✓
                  </span>
                )}
                {!estimate.sources.cosmosApi && (
                  <span className="text-xs bg-destructive/20 text-destructive-foreground px-2 py-1 rounded">
                    Cosmos API ✗
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Calendar & Subscribe */}
          <div className="bg-card border border-border rounded-xl p-6">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Save to Calendar
            </h3>
            <div className="flex gap-2 mb-4">
              <a
                href={googleCalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 text-center px-4 py-2.5 bg-muted hover:bg-accent text-foreground text-sm rounded-lg transition-all border border-border"
              >
                📅 Google Calendar
              </a>
              <a
                href={outlookCalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 text-center px-4 py-2.5 bg-muted hover:bg-accent text-foreground text-sm rounded-lg transition-all border border-border"
              >
                📅 Outlook
              </a>
              {subscribeResult && (
                <a
                  href={`/api/calendar/${subscribeResult.id}`}
                  className="flex-1 text-center px-4 py-2.5 bg-muted hover:bg-accent text-foreground text-sm rounded-lg transition-all border border-border"
                >
                  📥 .ics File
                </a>
              )}
            </div>

            {/* Subscribe for notifications */}
            {!subscribeResult && (
              <>
                {!session?.user ? (
                  <button
                    onClick={() => {
                      sessionStorage.setItem("blockToTimeState", JSON.stringify({ mode, network, targetBlock, targetTime, showSubscribe: true }));
                      signIn("google");
                    }}
                    className="w-full py-2.5 bg-muted hover:bg-accent text-muted-foreground text-sm rounded-lg transition-all border border-border"
                  >
                    🔔 Sign in to subscribe for notifications
                  </button>
                ) : !showSubscribe ? (
                  <button
                    onClick={() => setShowSubscribe(true)}
                    className="w-full py-2.5 bg-muted hover:bg-accent text-muted-foreground text-sm rounded-lg transition-all border border-border"
                  >
                    🔔 Subscribe for Notifications
                  </button>
                ) : (
                  <div className="space-y-3 animate-fade-in">
                    <div>
                      <label className="block text-sm text-muted-foreground mb-1">
                        Title <span className="text-muted-foreground/50">(optional)</span>
                      </label>
                      <input
                        type="text"
                        value={watchTitle}
                        onChange={(e) => setWatchTitle(e.target.value)}
                        placeholder="e.g. Mainnet upgrade, Token launch..."
                        className="w-full px-4 py-2.5 bg-input border border-border rounded-lg text-foreground placeholder-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-muted-foreground mb-1">
                        Slack Webhook URL
                      </label>
                      {savedWebhooks.length > 0 && (
                        <div className="mb-2">
                          <p className="text-xs text-muted-foreground/70 mb-1">Saved webhooks:</p>
                          <div className="flex flex-wrap gap-1">
                            {savedWebhooks.map((hook) => (
                              <button
                                key={hook}
                                type="button"
                                onClick={() => setSlackWebhook(hook)}
                                className={`text-xs px-2 py-1 rounded border transition-all ${
                                  slackWebhook === hook
                                    ? "bg-primary/20 border-primary/40 text-primary"
                                    : "bg-muted border-border text-muted-foreground hover:bg-accent"
                                }`}
                              >
                                ...{hook.slice(-12)}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      <input
                        type="url"
                        value={slackWebhook}
                        onChange={(e) => setSlackWebhook(e.target.value)}
                        placeholder="https://hooks.slack.com/services/..."
                        className="w-full px-4 py-2.5 bg-input border border-border rounded-lg text-foreground placeholder-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                      />
                      <p className="text-xs text-muted-foreground/70 mt-1">
                        {(() => {
                          const tiers = [
                            { label: "1 day", ms: 24 * 60 * 60 * 1000 },
                            { label: "6 hours", ms: 6 * 60 * 60 * 1000 },
                            { label: "1 hour", ms: 60 * 60 * 1000 },
                            { label: "15 min", ms: 15 * 60 * 1000 },
                            { label: "5 min", ms: 5 * 60 * 1000 },
                          ];
                          const remaining = estimate?.estimatedTimeMs ?? 0;
                          const applicable = tiers.filter((t) => t.ms < remaining);
                          if (applicable.length === 0) {
                            return "You will be notified when the block is reached.";
                          }
                          return `You will receive ${applicable.length} update${applicable.length > 1 ? "s" : ""} at: ${applicable.map((t) => t.label).join(", ")} before the estimated block time. Each update includes a fresh calendar link.`;
                        })()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleSubscribe}
                        disabled={subscribing || !slackWebhook}
                        className="flex-1 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-sm font-medium rounded-lg transition-all"
                      >
                        {subscribing ? "Subscribing..." : "Subscribe"}
                      </button>
                      <button
                        onClick={() => setShowSubscribe(false)}
                        className="px-4 py-2.5 bg-muted hover:bg-accent text-muted-foreground text-sm rounded-lg transition-all"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Subscription confirmation */}
            {subscribeResult && (
              <div className="bg-chart-2/10 border border-chart-2/30 rounded-lg p-4 animate-fade-in">
                <p className="text-chart-2 text-sm font-medium mb-2">
                  ✓ Subscribed! Watch ID: {subscribeResult.id.slice(0, 8)}...
                </p>
                <div className="space-y-1">
                  {subscribeResult.notifications.map((n) => (
                    <div
                      key={n.tier}
                      className="flex justify-between text-xs text-muted-foreground"
                    >
                      <span>{n.tier.replace(/_/g, " ")}</span>
                      <span>{formatDate(n.scheduledFor)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Time → Block Results */}
      {timeToBlockEstimate && mode === "time-to-block" && (
        <div className="animate-fade-in space-y-4">
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Estimated Block</h2>
              {confidenceBadge(timeToBlockEstimate.confidence)}
            </div>

            <div className="bg-muted/50 rounded-lg p-4 mb-4">
              <p className="text-2xl font-bold text-secondary font-mono">
                Block #{timeToBlockEstimate.estimatedBlock.toLocaleString()}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                ~{timeToBlockEstimate.blocksAway.toLocaleString()} blocks from
                now ({formatDuration(timeToBlockEstimate.timeFromNowMs)})
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-muted/30 rounded-lg p-3">
                <p className="text-muted-foreground/70 text-xs uppercase tracking-wide">
                  Current Block
                </p>
                <p className="text-foreground font-mono mt-0.5">
                  {timeToBlockEstimate.currentBlock.toLocaleString()}
                </p>
              </div>
              <div className="bg-muted/30 rounded-lg p-3">
                <p className="text-muted-foreground/70 text-xs uppercase tracking-wide">
                  Estimated Block
                </p>
                <p className="text-foreground font-mono mt-0.5">
                  {timeToBlockEstimate.estimatedBlock.toLocaleString()}
                </p>
              </div>
              <div className="bg-muted/30 rounded-lg p-3">
                <p className="text-muted-foreground/70 text-xs uppercase tracking-wide">
                  Blocks Away
                </p>
                <p className="text-foreground font-mono mt-0.5">
                  {timeToBlockEstimate.blocksAway.toLocaleString()}
                </p>
              </div>
              <div className="bg-muted/30 rounded-lg p-3">
                <p className="text-muted-foreground/70 text-xs uppercase tracking-wide">
                  Avg Block Time
                </p>
                <p className="text-foreground font-mono mt-0.5">
                  {(timeToBlockEstimate.avgBlockTimeMs / 1000).toFixed(2)}s
                  {useCustomBlockTime && customBlockTime && (
                    <span className="ml-1.5 text-xs text-chart-3">(custom)</span>
                  )}
                </p>
              </div>
            </div>

            {/* Target date display */}
            <div className="mt-3 bg-muted/30 rounded-lg p-3">
              <p className="text-muted-foreground/70 text-xs uppercase tracking-wide">
                Target Date
              </p>
              <p className="text-foreground mt-0.5">
                {formatDate(timeToBlockEstimate.targetDate)}
              </p>
            </div>

            {/* Data Sources */}
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground/70 uppercase tracking-wide mb-2">
                Data Sources
              </p>
              <div className="flex flex-wrap gap-2">
                {timeToBlockEstimate.sources.ethRpc && (
                  <span className="text-xs bg-chart-2/20 text-chart-2 px-2 py-1 rounded">
                    ETH RPC ✓
                  </span>
                )}
                {!timeToBlockEstimate.sources.ethRpc && (
                  <span className="text-xs bg-destructive/20 text-destructive-foreground px-2 py-1 rounded">
                    ETH RPC ✗
                  </span>
                )}
                {timeToBlockEstimate.sources.tendermint && (
                  <span className="text-xs bg-chart-2/20 text-chart-2 px-2 py-1 rounded">
                    Tendermint ✓
                  </span>
                )}
                {!timeToBlockEstimate.sources.tendermint && (
                  <span className="text-xs bg-destructive/20 text-destructive-foreground px-2 py-1 rounded">
                    Tendermint ✗
                  </span>
                )}
                {timeToBlockEstimate.sources.cosmosApi && (
                  <span className="text-xs bg-chart-2/20 text-chart-2 px-2 py-1 rounded">
                    Cosmos API ✓
                  </span>
                )}
                {!timeToBlockEstimate.sources.cosmosApi && (
                  <span className="text-xs bg-destructive/20 text-destructive-foreground px-2 py-1 rounded">
                    Cosmos API ✗
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Block Watches with Active / Completed tabs */}
      {session?.user && watches.length > 0 && (
        <div className="mt-6 animate-fade-in">
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Tracking Blocks</h2>
            </div>

            {/* Tabs */}
            {(() => {
              const activeWatches = watches.filter((w) => {
                const isPast = new Date(w.estimatedTime) < new Date();
                const allSent = w.notifications.every((n) => n.sent);
                return !isPast && !allSent;
              });
              const completedWatches = watches.filter((w) => {
                const isPast = new Date(w.estimatedTime) < new Date();
                const allSent = w.notifications.every((n) => n.sent);
                return isPast || allSent;
              });
              const displayedWatches = watchTab === "active" ? activeWatches : completedWatches;

              return (
                <>
                  <div className="flex gap-1 mb-4 p-1 bg-muted/30 rounded-lg">
                    <button
                      onClick={() => setWatchTab("active")}
                      className={`flex-1 py-1.5 px-3 text-sm rounded-md transition-all ${
                        watchTab === "active"
                          ? "bg-card text-foreground font-medium shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Active
                      {activeWatches.length > 0 && (
                        <span className="ml-1.5 text-xs bg-chart-3/20 text-chart-3 px-1.5 py-0.5 rounded-full">
                          {activeWatches.length}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => setWatchTab("completed")}
                      className={`flex-1 py-1.5 px-3 text-sm rounded-md transition-all ${
                        watchTab === "completed"
                          ? "bg-card text-foreground font-medium shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Completed
                      {completedWatches.length > 0 && (
                        <span className="ml-1.5 text-xs bg-chart-2/20 text-chart-2 px-1.5 py-0.5 rounded-full">
                          {completedWatches.length}
                        </span>
                      )}
                    </button>
                  </div>

                  {displayedWatches.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">
                      {watchTab === "active" ? "No active watches" : "No completed watches"}
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {displayedWatches.map((w) => {
                        const isPast = new Date(w.estimatedTime) < new Date();
                        const allSent = w.notifications.every((n) => n.sent);
                        const isCompleted = isPast || allSent;
                        return (
                          <div
                            key={w.id}
                            className="bg-muted/30 border border-border rounded-lg p-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                {w.title && (
                                  <p className="text-sm font-medium text-foreground mb-1 truncate">
                                    {w.title}
                                  </p>
                                )}
                                <div className="flex items-center gap-2 mb-1">
                                  <p className="text-sm font-mono font-medium text-foreground">
                                    Block {w.targetBlock.toLocaleString()}
                                  </p>
                                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                                    w.network === "XRPL_EVM_MAINNET"
                                      ? "bg-primary/20 text-primary"
                                      : "bg-secondary/20 text-secondary"
                                  }`}>
                                    {w.network === "XRPL_EVM_MAINNET" ? "Mainnet" : "Testnet"}
                                  </span>
                                  {isCompleted ? (
                                    <span className="text-xs bg-chart-2/20 text-chart-2 px-1.5 py-0.5 rounded">
                                      Completed
                                    </span>
                                  ) : (
                                    <span className="text-xs bg-chart-3/20 text-chart-3 px-1.5 py-0.5 rounded">
                                      Active
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  Est. {formatDate(w.estimatedTime)}
                                </p>
                                <div className="flex gap-1 mt-2">
                                  {w.notifications.map((n) => (
                                    <span
                                      key={n.tier}
                                      title={`${n.tier.replace(/_/g, " ")} — ${n.sent ? "Sent" : "Pending"}`}
                                      className={`w-2 h-2 rounded-full ${
                                        n.sent ? "bg-chart-2" : "bg-muted-foreground/30"
                                      }`}
                                    />
                                  ))}
                                </div>
                              </div>
                              {!isCompleted && (
                                <button
                                  onClick={() => handleCancelWatch(w.id)}
                                  disabled={cancellingId === w.id}
                                  className="text-xs px-3 py-1.5 bg-destructive/20 hover:bg-destructive/30 text-destructive-foreground rounded-lg transition-all disabled:opacity-50"
                                >
                                  {cancellingId === w.id ? "..." : "Cancel"}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {session?.user && loadingWatches && watches.length === 0 && (
        <div className="mt-6 text-center">
          <div className="h-8 w-32 mx-auto bg-muted rounded-lg animate-pulse" />
        </div>
      )}

      {/* Footer */}
      <div className="text-center mt-8 text-xs text-muted-foreground/50">
        <p>
          Powered by XRPL EVM • Ethereum JSON RPC + Tendermint RPC + Cosmos API
        </p>
      </div>
    </div>
  );
}
