"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { localDayUtcRange } from "@/lib/config";
import { isDriverTag, driverLabel, UNTAGGED } from "@/lib/drivers";
import Link from "next/link";
import EscalationsPanel from "./_components/EscalationsPanel";
import TeamReportPanel from "./_components/TeamReportPanel";
import { useAuth, UserMenu } from "./_components/AuthProvider";

// ─── Types ───────────────────────────────────────────
interface DailyRow {
  date: string;
  dateKey: string;
  property: string;
  totalChats: number;
  totalTickets: number;
  avgAHT: string;
  avgFRT: string;
  missedChats: number;
  hourly: { chats: number; tickets: number }[];
}

function formatHour(h: number): string {
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:00 ${ampm}`;
}

interface TicketRow {
  dateKey: string;
  createdOn: string;
  property: string;
  ticketId: number | null;
  channelUser: string;
  subject: string;
  status: string;
  priority: string;
  source: string;
  assignee: string;
  tag1: string;
  tag2: string;
  allTags: string[];
}

interface DriverApiRow {
  property: string; tag: string; chats: number; tickets: number;
}

interface AttributeRow {
  property: string; object: string; key: string; label: string; dataType: string;
}

interface AgentSummaryRow {
  date: string; agent: string; duration: string; chatCount: number;
  thumbsUp: number; thumbsDown: number;
}

interface AgentDetailRow {
  date: string; agent: string; property: string; duration: string; chatCount: number;
  thumbsUp: number; thumbsDown: number;
}

// ─── CSAT Display Component ─────────────────────────
function CsatBadge({ thumbsUp, thumbsDown, totalChats }: { thumbsUp: number; thumbsDown: number; totalChats: number }) {
  const rated = thumbsUp + thumbsDown;
  if (rated === 0) return <span className="text-gray-300 text-xs italic">No ratings</span>;

  return (
    <span className="inline-flex items-center gap-2 text-sm">
      {thumbsUp > 0 && (
        <span className="inline-flex items-center gap-0.5 text-green-600 font-medium">
          <span>👍</span> {thumbsUp}
        </span>
      )}
      {thumbsDown > 0 && (
        <span className="inline-flex items-center gap-0.5 text-red-500 font-medium">
          <span>👎</span> {thumbsDown}
        </span>
      )}
      <span className="text-xs text-gray-400">({rated}/{totalChats})</span>
    </span>
  );
}

// ─── CSV helpers ─────────────────────────────────────
function downloadCSV(filename: string, csvContent: string) {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeCSV(val: string | number) {
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ─── Component ───────────────────────────────────────
export default function Dashboard() {
  const { user } = useAuth();
  const router = useRouter();
  // Only admins use the reports dashboard. Send others to their home view.
  useEffect(() => {
    if (user.role === "agent") router.replace("/chats");
    else if (user.role === "hr") router.replace("/profiles");
  }, [user.role, router]);

  const [tab, setTab] = useState<"report" | "agent" | "csat" | "tickets" | "drivers" | "escalations" | "teamReport">("report");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");

  const [dailyRows, setDailyRows] = useState<DailyRow[]>([]);
  const [hideZeroRows, setHideZeroRows] = useState(true);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const [agentSummary, setAgentSummary] = useState<AgentSummaryRow[]>([]);
  const [agentDetail, setAgentDetail] = useState<AgentDetailRow[]>([]);
  const [agentSubTab, setAgentSubTab] = useState<"summary" | "detail">("summary");
  const [grandTotal, setGrandTotal] = useState({ duration: "00:00:00", chatCount: 0, thumbsUp: 0, thumbsDown: 0 });

  // CSAT report state
  const [csatRows, setCsatRows] = useState<{ agent: string; positive: number; negative: number; neutral: number }[]>([]);
  const [ticketRows, setTicketRows] = useState<TicketRow[]>([]);

  // Drivers report state
  const [driverRows, setDriverRows] = useState<DriverApiRow[]>([]);
  // Default to "all" tags: this team tags conversations with plain semantic
  // labels (Activation, renewal, …) rather than a `driver:` prefix, so all tags
  // ARE the drivers. "driver" mode is kept for teams that adopt the prefix.
  const [driverMode, setDriverMode] = useState<"driver" | "all">("all");
  const [driverProperty, setDriverProperty] = useState("");
  // Custom attributes reference (loaded on demand, no date range)
  const [attrRows, setAttrRows] = useState<AttributeRow[]>([]);
  const [attrLoading, setAttrLoading] = useState(false);

  // Supabase sync status (header indicator + manual trigger)
  const [syncInfo, setSyncInfo] = useState<{ configured: boolean; lastSyncedAt: string | null } | null>(null);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => {
    fetch("/api/sync-state").then((r) => r.json()).then(setSyncInfo).catch(() => {});
  }, []);

  async function runSyncNow() {
    setSyncing(true);
    setError("");
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      const state = await fetch("/api/sync-state").then((r) => r.json());
      setSyncInfo(state);
    } catch (err) {
      setError(String(err));
    } finally {
      setSyncing(false);
    }
  }

  const [today, setToday] = useState("");
  useEffect(() => { setToday(new Date().toISOString().split("T")[0]); }, []);

  // Set start/end to Monday-Saturday of the current week (in report timezone)
  function setThisWeek() {
    const now = new Date();
    // Get local date parts (in browser tz; for report tz we'd need Intl, but
    // close enough since user picks dates in their own day)
    const day = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const daysSinceMonday = (day + 6) % 7; // Mon=0, ..., Sun=6
    const monday = new Date(now);
    monday.setDate(now.getDate() - daysSinceMonday);
    const saturday = new Date(monday);
    saturday.setDate(monday.getDate() + 5);
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setStartDate(fmt(monday));
    // Cap end at today if Saturday is in the future
    const todayDate = new Date();
    setEndDate(saturday > todayDate ? fmt(todayDate) : fmt(saturday));
  }

  function setLastWeek() {
    const now = new Date();
    const day = now.getDay();
    const daysSinceMonday = (day + 6) % 7;
    const lastMonday = new Date(now);
    lastMonday.setDate(now.getDate() - daysSinceMonday - 7);
    const lastSaturday = new Date(lastMonday);
    lastSaturday.setDate(lastMonday.getDate() + 5);
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setStartDate(fmt(lastMonday));
    setEndDate(fmt(lastSaturday));
  }

  // Split a date range into daily chunks aligned to the configured timezone.
  // Uses IANA timezone (handles DST automatically) so May 10 in Central Time
  // maps to the correct UTC window regardless of standard vs daylight time.
  function getDailyChunks(start: string, end: string): { start: string; end: string }[] {
    const chunks: { start: string; end: string }[] = [];
    // Iterate by local date string to avoid DST shifts changing day length
    const startParts = start.split("-").map(Number);
    const endParts = end.split("-").map(Number);
    const startDate = new Date(Date.UTC(startParts[0], startParts[1] - 1, startParts[2]));
    const endDate = new Date(Date.UTC(endParts[0], endParts[1] - 1, endParts[2]));
    for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      const localDate = `${y}-${m}-${day}`;
      const { startUtc, endUtc } = localDayUtcRange(localDate);
      chunks.push({ start: startUtc.toISOString(), end: endUtc.toISOString() });
    }
    return chunks;
  }

  const [progress, setProgress] = useState("");

  async function fetchReport() {
    if (!startDate || !endDate) { setError("Please select both start and end dates."); return; }
    if (startDate > today || endDate > today) { setError("Dates cannot be in the future."); return; }
    if (startDate > endDate) { setError("Start date must be before end date."); return; }

    setLoading(true);
    setElapsed(0);
    setError("");
    setProgress("");
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);

    const chunks = getDailyChunks(startDate, endDate);

    try {
      if (tab === "report") {
        let allRows: DailyRow[] = [];
        for (let i = 0; i < chunks.length; i++) {
          setProgress(`Day ${i + 1} of ${chunks.length}`);
          const res = await fetch(`/api/hourly-report?startDate=${chunks[i].start}&endDate=${chunks[i].end}`);
          if (!res.ok) throw new Error(await res.text());
          const data = await res.json();
          allRows = allRows.concat(data.rows);
        }
        allRows.sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.property.localeCompare(b.property));
        setDailyRows(allRows);
      } else if (tab === "agent") {
        let allSummary: AgentSummaryRow[] = [];
        let allDetail: AgentDetailRow[] = [];
        for (let i = 0; i < chunks.length; i++) {
          setProgress(`Day ${i + 1} of ${chunks.length}`);
          const res = await fetch(`/api/agent-duration?startDate=${chunks[i].start}&endDate=${chunks[i].end}`);
          if (!res.ok) throw new Error(await res.text());
          const data = await res.json();
          allSummary = allSummary.concat(data.summary);
          allDetail = allDetail.concat(data.detail);
        }
        allSummary.sort((a, b) => a.date.localeCompare(b.date) || a.agent.localeCompare(b.agent));
        allDetail.sort((a, b) => a.date.localeCompare(b.date) || a.agent.localeCompare(b.agent) || a.property.localeCompare(b.property));

        // Recalculate grand totals
        const totalUp = allSummary.reduce((s, r) => s + r.thumbsUp, 0);
        const totalDown = allSummary.reduce((s, r) => s + r.thumbsDown, 0);
        const totalChats = allSummary.reduce((s, r) => s + r.chatCount, 0);
        // Sum duration strings (HH:MM:SS)
        const totalSecs = allSummary.reduce((s, r) => {
          const [h, m, sec] = r.duration.split(":").map(Number);
          return s + h * 3600 + m * 60 + sec;
        }, 0);
        const dh = Math.floor(totalSecs / 3600);
        const dm = Math.floor((totalSecs % 3600) / 60);
        const ds = totalSecs % 60;

        setAgentSummary(allSummary);
        setAgentDetail(allDetail);
        setGrandTotal({
          duration: `${String(dh).padStart(2, "0")}:${String(dm).padStart(2, "0")}:${String(ds).padStart(2, "0")}`,
          chatCount: totalChats,
          thumbsUp: totalUp,
          thumbsDown: totalDown,
        });
      } else if (tab === "csat") {
        // CSAT report
        const ratingMap: Record<string, { positive: number; negative: number; chats: number }> = {};
        for (let i = 0; i < chunks.length; i++) {
          setProgress(`Day ${i + 1} of ${chunks.length}`);
          const res = await fetch(`/api/agent-duration?startDate=${chunks[i].start}&endDate=${chunks[i].end}`);
          if (!res.ok) throw new Error(await res.text());
          const data = await res.json();
          for (const row of data.summary as AgentSummaryRow[]) {
            if (!ratingMap[row.agent]) ratingMap[row.agent] = { positive: 0, negative: 0, chats: 0 };
            ratingMap[row.agent].positive += row.thumbsUp;
            ratingMap[row.agent].negative += row.thumbsDown;
            ratingMap[row.agent].chats += row.chatCount;
          }
        }
        const rows = Object.entries(ratingMap)
          .map(([agent, r]) => ({ agent, positive: r.positive, negative: r.negative, neutral: r.chats - r.positive - r.negative }))
          .sort((a, b) => b.positive - a.positive);
        setCsatRows(rows);
      } else if (tab === "tickets") {
        // Tickets report
        let all: TicketRow[] = [];
        for (let i = 0; i < chunks.length; i++) {
          setProgress(`Day ${i + 1} of ${chunks.length}`);
          const res = await fetch(`/api/tickets?startDate=${chunks[i].start}&endDate=${chunks[i].end}`);
          if (!res.ok) throw new Error(await res.text());
          const data = await res.json();
          all = all.concat(data.rows);
        }
        // Dedup by ticket createdOn+subject (tickets shouldn't dup, but safety)
        const seen = new Set<string>();
        const dedup: TicketRow[] = [];
        for (const t of all) {
          const k = `${t.createdOn}|${t.subject}|${t.channelUser}`;
          if (!seen.has(k)) { seen.add(k); dedup.push(t); }
        }
        dedup.sort((a, b) => b.createdOn.localeCompare(a.createdOn));
        setTicketRows(dedup);
      } else if (tab === "drivers") {
        // Drivers report — tag-based, chats + tickets, merged across day chunks
        const merged = new Map<string, DriverApiRow>();
        for (let i = 0; i < chunks.length; i++) {
          setProgress(`Day ${i + 1} of ${chunks.length}`);
          const res = await fetch(`/api/drivers?startDate=${chunks[i].start}&endDate=${chunks[i].end}`);
          if (!res.ok) throw new Error(await res.text());
          const data = await res.json();
          for (const row of data.rows as DriverApiRow[]) {
            const key = `${row.property}||${row.tag}`;
            const existing = merged.get(key);
            if (existing) {
              existing.chats += row.chats;
              existing.tickets += row.tickets;
            } else {
              merged.set(key, { ...row });
            }
          }
        }
        setDriverRows(Array.from(merged.values()));
      }
    } catch (err) {
      setError(String(err));
    } finally {
      clearInterval(timer);
      setLoading(false);
      setProgress("");
    }
  }

  // ─── CSV Downloads ──────────────────────────────────
  function downloadDailyCSV() {
    const lines = [["Date", "Property", "Total Chats Handled", "Total Tickets", "Average AHT", "Average FRT", "Missed Chats"].map(escapeCSV).join(",")];
    for (const row of dailyRows) {
      lines.push([row.date, escapeCSV(row.property), row.totalChats, row.totalTickets, row.avgAHT, row.avgFRT, row.missedChats].join(","));
    }
    downloadCSV(`tawk_report_${startDate}_to_${endDate}.csv`, lines.join("\n"));
  }

  // Per-hour export from the hourly_counts table (Supabase).
  async function downloadHourlyCSV() {
    if (!startDate || !endDate) { setError("Select a date range first."); return; }
    try {
      const res = await fetch(`/api/hourly-export?from=${startDate}&to=${endDate}`);
      if (!res.ok) throw new Error(await res.text());
      const { rows } = await res.json();
      const lines = [["Date", "Property", "Hour", "Chat Volume", "Missed", "Offline", "Tickets"].map(escapeCSV).join(",")];
      for (const r of rows) {
        lines.push([r.date, escapeCSV(r.property), formatHour(r.hour), r.chat_volume, r.missed, r.offline, r.tickets].join(","));
      }
      if (rows.length === 0) { setError("No hourly data for this range (run a sync first)."); return; }
      downloadCSV(`tawk_hourly_${startDate}_to_${endDate}.csv`, lines.join("\n"));
    } catch (err) {
      setError(String(err));
    }
  }

  function downloadAgentCSV() {
    if (agentSubTab === "summary") {
      const lines = [["Date", "Agent Name", "Total Duration", "Chat Count", "Thumbs Up", "Thumbs Down"].join(",")];
      for (const row of agentSummary) {
        lines.push([row.date, escapeCSV(row.agent), row.duration, row.chatCount, row.thumbsUp, row.thumbsDown].join(","));
      }
      lines.push(["TOTAL", "", grandTotal.duration, grandTotal.chatCount, grandTotal.thumbsUp, grandTotal.thumbsDown].join(","));
      downloadCSV(`agent_duration_summary_${startDate}_to_${endDate}.csv`, lines.join("\n"));
    } else {
      const lines = [["Date", "Agent Name", "Property", "Total Duration", "Chat Count", "Thumbs Up", "Thumbs Down"].join(",")];
      for (const row of agentDetail) {
        lines.push([row.date, escapeCSV(row.agent), escapeCSV(row.property), row.duration, row.chatCount, row.thumbsUp, row.thumbsDown].join(","));
      }
      lines.push(["TOTAL", "", "", grandTotal.duration, grandTotal.chatCount, grandTotal.thumbsUp, grandTotal.thumbsDown].join(","));
      downloadCSV(`agent_duration_detail_${startDate}_to_${endDate}.csv`, lines.join("\n"));
    }
  }

  function downloadTicketsCSV() {
    const lines = [["Date", "Property", "Channel User", "Subject", "Status", "Priority", "Source", "Assignee", "Tag 1", "Tag 2"].map(escapeCSV).join(",")];
    for (const t of ticketRows) {
      const date = new Date(t.createdOn).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "2-digit" });
      lines.push([date, escapeCSV(t.property), escapeCSV(t.channelUser), escapeCSV(t.subject), escapeCSV(t.status), escapeCSV(t.priority), escapeCSV(t.source), escapeCSV(t.assignee), escapeCSV(t.tag1), escapeCSV(t.tag2)].join(","));
    }
    downloadCSV(`tickets_${startDate}_to_${endDate}.csv`, lines.join("\n"));
  }

  function downloadCsatCSV() {
    const lines = [["Agent Name", "Positive Ratings", "Negative Ratings", "Neutral"].join(",")];
    for (const row of csatRows) {
      lines.push([escapeCSV(row.agent), row.positive, row.negative, row.neutral].join(","));
    }
    const totalPos = csatRows.reduce((s, r) => s + r.positive, 0);
    const totalNeg = csatRows.reduce((s, r) => s + r.negative, 0);
    const totalNeu = csatRows.reduce((s, r) => s + r.neutral, 0);
    lines.push(["TOTAL", totalPos, totalNeg, totalNeu].join(","));
    downloadCSV(`agent_ratings_${startDate}_to_${endDate}.csv`, lines.join("\n"));
  }

  // ─── Drivers: aggregate into display rows ───────────
  function aggregatedDrivers() {
    const scoped = driverProperty ? driverRows.filter((r) => r.property === driverProperty) : driverRows;
    const map = new Map<string, { driver: string; chats: number; tickets: number }>();
    for (const r of scoped) {
      if (driverMode === "driver" && !isDriverTag(r.tag)) continue;
      const label = driverMode === "driver" ? driverLabel(r.tag) : r.tag;
      const ex = map.get(label) || { driver: label, chats: 0, tickets: 0 };
      ex.chats += r.chats;
      ex.tickets += r.tickets;
      map.set(label, ex);
    }
    return Array.from(map.values()).sort((a, b) => b.chats + b.tickets - (a.chats + a.tickets));
  }

  function downloadDriversCSV() {
    const rows = aggregatedDrivers();
    const lines = [["Driver", "Chats", "Tickets", "Total"].join(",")];
    for (const r of rows) lines.push([escapeCSV(r.driver), r.chats, r.tickets, r.chats + r.tickets].join(","));
    downloadCSV(`drivers_${startDate}_to_${endDate}.csv`, lines.join("\n"));
  }

  async function loadAttributes() {
    setAttrLoading(true);
    setError("");
    try {
      const res = await fetch("/api/attributes");
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setAttrRows(data.rows);
    } catch (err) {
      setError(String(err));
    } finally {
      setAttrLoading(false);
    }
  }

  // ─── Render ─────────────────────────────────────────
  if (user.role !== "admin") return null; // agents → /chats, hr → /profiles
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Tawk.to Reports</h1>
          </div>
          <div className="flex items-center gap-3 text-sm shrink-0">
            <Link href="/chats" className="bg-gray-900 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-gray-800 transition-colors">
              Chats &amp; Tickets →
            </Link>
            <Link href="/accounts" className="border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg font-medium hover:bg-gray-50 transition-colors">
              Accounts
            </Link>
            <Link href="https://tools.getva365.com/wordpresssite.html" className="border border-green-600 text-green-700 px-3 py-1.5 rounded-lg font-medium hover:bg-green-50 transition-colors">
              WooCommerce Websites Status
            </Link>
            <Link href="/profiles" className="border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg font-medium hover:bg-gray-50 transition-colors">
              Profiles
            </Link>
            {syncInfo?.configured && (
              <>
                <span className="text-gray-500">
                  {syncInfo.lastSyncedAt
                    ? `Synced ${new Date(syncInfo.lastSyncedAt).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`
                    : "Not synced yet"}
                </span>
                <button
                  onClick={runSyncNow}
                  disabled={syncing}
                  className="border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  {syncing ? "Syncing…" : "Sync now"}
                </button>
              </>
            )}
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 py-6">
        {/* Controls */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 mb-6">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Report Type</label>
              <div className="flex rounded-lg border border-gray-300 overflow-hidden">
                <button onClick={() => setTab("report")} className={`px-4 py-2 text-sm font-medium transition-colors ${tab === "report" ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}>
                  Report
                </button>
                <button onClick={() => setTab("agent")} className={`px-4 py-2 text-sm font-medium transition-colors border-l border-gray-300 ${tab === "agent" ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}>
                  Agent Duration
                </button>
                <button onClick={() => setTab("tickets")} className={`px-4 py-2 text-sm font-medium transition-colors border-l border-gray-300 ${tab === "tickets" ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}>
                  Tickets
                </button>
                <button onClick={() => setTab("csat")} className={`px-4 py-2 text-sm font-medium transition-colors border-l border-gray-300 ${tab === "csat" ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}>
                  Agent Ratings
                </button>
                <button onClick={() => setTab("drivers")} className={`px-4 py-2 text-sm font-medium transition-colors border-l border-gray-300 ${tab === "drivers" ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}>
                  Drivers
                </button>
                <button onClick={() => setTab("escalations")} className={`px-4 py-2 text-sm font-medium transition-colors border-l border-gray-300 ${tab === "escalations" ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}>
                  Escalations
                </button>
                <button onClick={() => setTab("teamReport")} className={`px-4 py-2 text-sm font-medium transition-colors border-l border-gray-300 ${tab === "teamReport" ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}>
                  Team Report
                </button>
              </div>
            </div>
            {tab !== "escalations" && tab !== "teamReport" && (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Start Date</label>
                  <input type="date" value={startDate} max={today || undefined} onChange={(e) => setStartDate(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">End Date</label>
                  <input type="date" value={endDate} max={today || undefined} onChange={(e) => setEndDate(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Quick Pick</label>
                  <div className="flex gap-2">
                    <button onClick={setThisWeek} type="button" className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors whitespace-nowrap">
                      This Week (Mon-Sat)
                    </button>
                    <button onClick={setLastWeek} type="button" className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors whitespace-nowrap">
                      Last Week
                    </button>
                  </div>
                </div>
                <button onClick={fetchReport} disabled={loading} className="bg-gray-900 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                  {loading ? `Fetching... ${elapsed}s${progress ? ` (${progress})` : ""}` : "Generate Report"}
                </button>
              </>
            )}
            {tab === "escalations" && (
              <p className="text-sm text-gray-500 pb-2">Log and track support escalations — refunds, chargebacks, channel &amp; VOD issues.</p>
            )}
            {tab === "teamReport" && (
              <p className="text-sm text-gray-500 pb-2">Daily per-team report — property chat volume &amp; common issues, downloadable as CSV/PDF.</p>
            )}
          </div>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </div>

        {/* ─── Daily Report Table ─── */}
        {tab === "report" && dailyRows.length > 0 && (() => {
          const filteredDaily = hideZeroRows
            ? dailyRows.filter((r) => r.totalChats > 0 || r.missedChats > 0 || r.totalTickets > 0)
            : dailyRows;
          return (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div className="flex items-center gap-4">
                <h2 className="text-lg font-semibold text-gray-900">
                  Report — {filteredDaily.length} rows
                  {hideZeroRows && filteredDaily.length < dailyRows.length && (
                    <span className="text-sm font-normal text-gray-400 ml-2">({dailyRows.length - filteredDaily.length} empty rows hidden)</span>
                  )}
                </h2>
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={hideZeroRows} onChange={(e) => setHideZeroRows(e.target.checked)} className="rounded" />
                  Hide empty rows
                </label>
                <span className="text-xs text-gray-400 italic">Click a row to see hourly breakdown</span>
              </div>
              <div className="flex gap-2">
                <button onClick={downloadDailyCSV} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors">
                  Download CSV
                </button>
                <button onClick={downloadHourlyCSV} className="bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-800 transition-colors">
                  Download Hourly CSV
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-900 text-white">
                    <th className="px-4 py-2 text-left font-medium whitespace-nowrap">Date</th>
                    <th className="px-4 py-2 text-left font-medium whitespace-nowrap">Property</th>
                    <th className="px-4 py-2 text-center font-medium whitespace-nowrap">Total Chats Handled</th>
                    <th className="px-4 py-2 text-center font-medium whitespace-nowrap">Total Tickets</th>
                    <th className="px-4 py-2 text-center font-medium whitespace-nowrap">Average AHT</th>
                    <th className="px-4 py-2 text-center font-medium whitespace-nowrap">Average FRT</th>
                    <th className="px-4 py-2 text-center font-medium whitespace-nowrap">Missed Chats</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDaily.map((row, i) => {
                    const rowKey = `${row.dateKey}|${row.property}`;
                    const isExpanded = expandedKey === rowKey;
                    return (
                      <Fragment key={rowKey}>
                        <tr
                          onClick={() => setExpandedKey(isExpanded ? null : rowKey)}
                          className={`cursor-pointer hover:bg-blue-50 ${i % 2 === 0 ? "bg-white" : "bg-gray-50"} ${isExpanded ? "bg-blue-50" : ""}`}
                        >
                          <td className="px-4 py-2 whitespace-nowrap">
                            <span className="inline-block w-4 text-gray-400">{isExpanded ? "▼" : "▶"}</span> {row.date}
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap">{row.property}</td>
                          <td className="px-4 py-2 text-center">{row.totalChats}</td>
                          <td className="px-4 py-2 text-center">{row.totalTickets}</td>
                          <td className="px-4 py-2 text-center font-mono">{row.avgAHT}</td>
                          <td className="px-4 py-2 text-center font-mono">{row.avgFRT}</td>
                          <td className="px-4 py-2 text-center">{row.missedChats}</td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-blue-50/50">
                            <td colSpan={7} className="px-8 py-4">
                              <div className="text-xs font-semibold text-gray-600 mb-2">Hourly breakdown — {row.date} · {row.property}</div>
                              <div className="overflow-x-auto">
                                <table className="text-xs border border-gray-200">
                                  <thead>
                                    <tr className="bg-gray-100">
                                      <th className="px-3 py-1 text-left font-medium">Hour</th>
                                      {Array.from({ length: 24 }, (_, h) => (
                                        <th key={h} className="px-2 py-1 text-center font-medium font-mono whitespace-nowrap">{formatHour(h)}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    <tr>
                                      <td className="px-3 py-1 font-medium text-gray-700">Chats</td>
                                      {row.hourly.map((h, idx) => (
                                        <td key={idx} className={`px-2 py-1 text-center font-mono ${h.chats > 0 ? "text-gray-900" : "text-gray-300"}`}>{h.chats}</td>
                                      ))}
                                    </tr>
                                    <tr className="bg-white">
                                      <td className="px-3 py-1 font-medium text-gray-700">Tickets</td>
                                      {row.hourly.map((h, idx) => (
                                        <td key={idx} className={`px-2 py-1 text-center font-mono ${h.tickets > 0 ? "text-gray-900" : "text-gray-300"}`}>{h.tickets}</td>
                                      ))}
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          );
        })()}

        {/* ─── Agent Duration Report ─── */}
        {tab === "agent" && (agentSummary.length > 0 || agentDetail.length > 0) && (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div className="flex items-center gap-4">
                <h2 className="text-lg font-semibold text-gray-900">Agent Duration</h2>
                <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
                  <button onClick={() => setAgentSubTab("summary")} className={`px-3 py-1 font-medium ${agentSubTab === "summary" ? "bg-gray-900 text-white" : "bg-white text-gray-700"}`}>
                    Per Agent/Day
                  </button>
                  <button onClick={() => setAgentSubTab("detail")} className={`px-3 py-1 font-medium border-l border-gray-300 ${agentSubTab === "detail" ? "bg-gray-900 text-white" : "bg-white text-gray-700"}`}>
                    Per Property
                  </button>
                </div>
              </div>
              <button onClick={downloadAgentCSV} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors">
                Download CSV
              </button>
            </div>

            <div className="overflow-x-auto">
              {agentSubTab === "summary" ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-900 text-white">
                      <th className="px-4 py-2 text-left font-medium">Date</th>
                      <th className="px-4 py-2 text-left font-medium">Agent Name</th>
                      <th className="px-4 py-2 text-center font-medium">Total Duration</th>
                      <th className="px-4 py-2 text-center font-medium">Chat Count</th>
                      <th className="px-4 py-2 text-center font-medium">CSAT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agentSummary.map((row, i) => (
                      <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                        <td className="px-4 py-2">{row.date}</td>
                        <td className="px-4 py-2">{row.agent}</td>
                        <td className="px-4 py-2 text-center font-mono">{row.duration}</td>
                        <td className="px-4 py-2 text-center">{row.chatCount}</td>
                        <td className="px-4 py-2 text-center whitespace-nowrap">
                          <CsatBadge thumbsUp={row.thumbsUp} thumbsDown={row.thumbsDown} totalChats={row.chatCount} />
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-gray-100 font-bold border-t-2 border-gray-300">
                      <td className="px-4 py-2">TOTAL</td>
                      <td></td>
                      <td className="px-4 py-2 text-center font-mono">{grandTotal.duration}</td>
                      <td className="px-4 py-2 text-center">{grandTotal.chatCount}</td>
                      <td className="px-4 py-2 text-center whitespace-nowrap">
                        <CsatBadge thumbsUp={grandTotal.thumbsUp} thumbsDown={grandTotal.thumbsDown} totalChats={grandTotal.chatCount} />
                      </td>
                    </tr>
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-900 text-white">
                      <th className="px-4 py-2 text-left font-medium">Date</th>
                      <th className="px-4 py-2 text-left font-medium">Agent Name</th>
                      <th className="px-4 py-2 text-left font-medium">Property</th>
                      <th className="px-4 py-2 text-center font-medium">Total Duration</th>
                      <th className="px-4 py-2 text-center font-medium">Chat Count</th>
                      <th className="px-4 py-2 text-center font-medium">CSAT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agentDetail.map((row, i) => (
                      <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                        <td className="px-4 py-2">{row.date}</td>
                        <td className="px-4 py-2">{row.agent}</td>
                        <td className="px-4 py-2">{row.property}</td>
                        <td className="px-4 py-2 text-center font-mono">{row.duration}</td>
                        <td className="px-4 py-2 text-center">{row.chatCount}</td>
                        <td className="px-4 py-2 text-center whitespace-nowrap">
                          <CsatBadge thumbsUp={row.thumbsUp} thumbsDown={row.thumbsDown} totalChats={row.chatCount} />
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-gray-100 font-bold border-t-2 border-gray-300">
                      <td className="px-4 py-2">TOTAL</td>
                      <td></td>
                      <td></td>
                      <td className="px-4 py-2 text-center font-mono">{grandTotal.duration}</td>
                      <td className="px-4 py-2 text-center">{grandTotal.chatCount}</td>
                      <td className="px-4 py-2 text-center whitespace-nowrap">
                        <CsatBadge thumbsUp={grandTotal.thumbsUp} thumbsDown={grandTotal.thumbsDown} totalChats={grandTotal.chatCount} />
                      </td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ─── Agent Ratings (CSAT) Report ─── */}
        {tab === "csat" && csatRows.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Agent Ratings</h2>
              <button onClick={downloadCsatCSV} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors">
                Download CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-900 text-white">
                    <th className="px-6 py-3 text-left font-medium">Agent Name</th>
                    <th className="px-6 py-3 text-center font-medium">Positive</th>
                    <th className="px-6 py-3 text-center font-medium">Negative</th>
                    <th className="px-6 py-3 text-center font-medium">Neutral</th>
                  </tr>
                </thead>
                <tbody>
                  {csatRows.map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                      <td className="px-6 py-3">{row.agent}</td>
                      <td className="px-6 py-3 text-center">
                        {row.positive > 0 ? (
                          <span className="font-semibold text-green-600">{row.positive}</span>
                        ) : (
                          <span className="text-gray-300">0</span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-center">
                        {row.negative > 0 ? (
                          <span className="font-semibold text-red-500">{row.negative}</span>
                        ) : (
                          <span className="text-gray-300">0</span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-center">
                        {row.neutral > 0 ? (
                          <span className="font-semibold text-gray-600">{row.neutral}</span>
                        ) : (
                          <span className="text-gray-300">0</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-100 font-bold border-t-2 border-gray-300">
                    <td className="px-6 py-3">TOTAL</td>
                    <td className="px-6 py-3 text-center text-green-700">
                      {csatRows.reduce((s, r) => s + r.positive, 0)}
                    </td>
                    <td className="px-6 py-3 text-center text-red-600">
                      {csatRows.reduce((s, r) => s + r.negative, 0)}
                    </td>
                    <td className="px-6 py-3 text-center text-gray-700">
                      {csatRows.reduce((s, r) => s + r.neutral, 0)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ─── Tickets Report ─── */}
        {tab === "tickets" && ticketRows.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Tickets — {ticketRows.length} rows</h2>
              <button onClick={downloadTicketsCSV} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors">
                Download CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-900 text-white">
                    <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Date</th>
                    <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Property</th>
                    <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Channel User</th>
                    <th className="px-3 py-2 text-left font-medium">Subject</th>
                    <th className="px-3 py-2 text-center font-medium whitespace-nowrap">Status</th>
                    <th className="px-3 py-2 text-center font-medium whitespace-nowrap">Priority</th>
                    <th className="px-3 py-2 text-center font-medium whitespace-nowrap">Source</th>
                    <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Assignee</th>
                    <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Tag 1</th>
                    <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Tag 2</th>
                  </tr>
                </thead>
                <tbody>
                  {ticketRows.map((t, i) => {
                    const date = new Date(t.createdOn).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" });
                    const statusColor =
                      t.status === "closed" ? "text-gray-500" :
                      t.status === "open" ? "text-blue-600 font-semibold" :
                      t.status === "awaiting" ? "text-orange-600 font-semibold" : "text-gray-700";
                    const priorityColor =
                      t.priority === "high" ? "text-red-600 font-semibold" :
                      t.priority === "medium" ? "text-yellow-600" :
                      t.priority === "low" ? "text-gray-500" : "text-gray-700";
                    return (
                      <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                        <td className="px-3 py-2 whitespace-nowrap">{date}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{t.property}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{t.channelUser || <span className="text-gray-300">—</span>}</td>
                        <td className="px-3 py-2 max-w-md truncate" title={t.subject}>{t.subject}</td>
                        <td className={`px-3 py-2 text-center whitespace-nowrap ${statusColor}`}>{t.status}</td>
                        <td className={`px-3 py-2 text-center whitespace-nowrap ${priorityColor}`}>{t.priority}</td>
                        <td className="px-3 py-2 text-center whitespace-nowrap text-gray-600">{t.source}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{t.assignee || <span className="text-gray-300">—</span>}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {t.tag1 ? <span className="inline-block bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs">{t.tag1}</span> : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {t.tag2 ? <span className="inline-block bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs">{t.tag2}</span> : <span className="text-gray-300">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ─── Drivers Report ─── */}
        {tab === "drivers" && (() => {
          const rows = aggregatedDrivers();
          const totalChats = rows.reduce((s, r) => s + r.chats, 0);
          const totalTickets = rows.reduce((s, r) => s + r.tickets, 0);
          const driverProps = Array.from(new Set(driverRows.map((r) => r.property))).sort();
          return (
            <div className="space-y-6">
              {driverRows.length > 0 && (
                <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-gray-200">
                    <div className="flex flex-wrap items-center gap-4">
                      <h2 className="text-lg font-semibold text-gray-900">Drivers — {rows.length}</h2>
                      <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
                        <button onClick={() => setDriverMode("driver")} className={`px-3 py-1 font-medium ${driverMode === "driver" ? "bg-gray-900 text-white" : "bg-white text-gray-700"}`}>
                          Driver tags
                        </button>
                        <button onClick={() => setDriverMode("all")} className={`px-3 py-1 font-medium border-l border-gray-300 ${driverMode === "all" ? "bg-gray-900 text-white" : "bg-white text-gray-700"}`}>
                          All tags
                        </button>
                      </div>
                      <select value={driverProperty} onChange={(e) => setDriverProperty(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
                        <option value="">All properties</option>
                        {driverProps.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    <button onClick={downloadDriversCSV} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors">
                      Download CSV
                    </button>
                  </div>
                  {driverMode === "driver" && (
                    <p className="px-6 py-2 text-xs text-gray-500 bg-gray-50 border-b border-gray-100">
                      Showing conversations tagged <code className="bg-gray-200 px-1 rounded">driver:&lt;name&gt;</code> in tawk.to. Switch to <strong>All tags</strong> to see every tag.
                    </p>
                  )}
                  <div className="overflow-x-auto">
                    {rows.length === 0 ? (
                      <div className="text-center py-12 text-gray-400">
                        No {driverMode === "driver" ? <code>driver:</code> : ""} tags found in this range.
                      </div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-900 text-white">
                            <th className="px-4 py-2 text-left font-medium">Driver{driverMode === "all" ? " / Tag" : ""}</th>
                            <th className="px-4 py-2 text-center font-medium">Chats</th>
                            <th className="px-4 py-2 text-center font-medium">Tickets</th>
                            <th className="px-4 py-2 text-center font-medium">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r, i) => (
                            <tr key={r.driver} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                              <td className="px-4 py-2">{r.driver === UNTAGGED ? <span className="text-gray-400 italic">{UNTAGGED}</span> : r.driver}</td>
                              <td className="px-4 py-2 text-center">{r.chats}</td>
                              <td className="px-4 py-2 text-center">{r.tickets}</td>
                              <td className="px-4 py-2 text-center font-semibold">{r.chats + r.tickets}</td>
                            </tr>
                          ))}
                          <tr className="bg-gray-100 font-bold border-t-2 border-gray-300">
                            <td className="px-4 py-2">TOTAL</td>
                            <td className="px-4 py-2 text-center">{totalChats}</td>
                            <td className="px-4 py-2 text-center">{totalTickets}</td>
                            <td className="px-4 py-2 text-center">{totalChats + totalTickets}</td>
                          </tr>
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )}

              {!loading && driverRows.length === 0 && (
                <div className="text-center py-12 text-gray-400">
                  <p className="text-lg">Select a date range and click Generate Report to see drivers.</p>
                </div>
              )}

              {/* Custom Attributes reference */}
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">Custom Attributes</h2>
                    <p className="text-xs text-gray-500 mt-0.5">Attribute definitions configured in tawk.to (reference — values aren&apos;t exposed by the API).</p>
                  </div>
                  <button onClick={loadAttributes} disabled={attrLoading} className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors">
                    {attrLoading ? "Loading…" : attrRows.length ? "Reload" : "Load Attributes"}
                  </button>
                </div>
                {attrRows.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-900 text-white">
                          <th className="px-4 py-2 text-left font-medium">Property</th>
                          <th className="px-4 py-2 text-left font-medium">Object</th>
                          <th className="px-4 py-2 text-left font-medium">Label</th>
                          <th className="px-4 py-2 text-left font-medium">Key</th>
                          <th className="px-4 py-2 text-left font-medium">Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attrRows.map((a, i) => (
                          <tr key={`${a.property}-${a.object}-${a.key}`} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                            <td className="px-4 py-2">{a.property}</td>
                            <td className="px-4 py-2 text-gray-600">{a.object}</td>
                            <td className="px-4 py-2">{a.label}</td>
                            <td className="px-4 py-2 font-mono text-xs text-gray-600">{a.key}</td>
                            <td className="px-4 py-2 text-gray-600">{a.dataType || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ─── Escalations ─── */}
        {tab === "escalations" && <EscalationsPanel />}

        {/* ─── Team Report ─── */}
        {tab === "teamReport" && <TeamReportPanel />}

        {tab !== "escalations" && tab !== "drivers" && tab !== "teamReport" && !loading && dailyRows.length === 0 && agentSummary.length === 0 && csatRows.length === 0 && ticketRows.length === 0 && (
          <div className="text-center py-20 text-gray-400">
            <p className="text-lg">Select a date range and click Generate Report</p>
          </div>
        )}
      </main>
    </div>
  );
}
