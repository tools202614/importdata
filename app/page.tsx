"use client";

import { useEffect, useState } from "react";
import { TZ_OFFSET_HOURS } from "@/lib/config";

// ─── Types ───────────────────────────────────────────
interface DailyRow {
  date: string;
  dateKey: string;
  property: string;
  totalChats: number;
  avgAHT: string;
  avgFRT: string;
  missedChats: number;
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
  const [tab, setTab] = useState<"report" | "agent" | "csat">("report");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");

  const [dailyRows, setDailyRows] = useState<DailyRow[]>([]);
  const [hideZeroRows, setHideZeroRows] = useState(true);

  const [agentSummary, setAgentSummary] = useState<AgentSummaryRow[]>([]);
  const [agentDetail, setAgentDetail] = useState<AgentDetailRow[]>([]);
  const [agentSubTab, setAgentSubTab] = useState<"summary" | "detail">("summary");
  const [grandTotal, setGrandTotal] = useState({ duration: "00:00:00", chatCount: 0, thumbsUp: 0, thumbsDown: 0 });

  // CSAT report state
  const [csatRows, setCsatRows] = useState<{ agent: string; positive: number; negative: number; neutral: number }[]>([]);

  const [today, setToday] = useState("");
  useEffect(() => { setToday(new Date().toISOString().split("T")[0]); }, []);

  // Split a date range into daily chunks aligned to the configured timezone.
  // The user picks a local date like "May 10"; we convert to the UTC range that
  // covers that full local day so chats near midnight aren't split across rows.
  function getDailyChunks(start: string, end: string): { start: string; end: string }[] {
    const chunks: { start: string; end: string }[] = [];
    const offsetMs = TZ_OFFSET_HOURS * 60 * 60 * 1000;
    const dayMs = 24 * 60 * 60 * 1000;

    const startUtcMs = Date.parse(`${start}T00:00:00Z`) - offsetMs;
    const endUtcMs = Date.parse(`${end}T00:00:00Z`) - offsetMs + dayMs - 1000;

    for (let cursorMs = startUtcMs; cursorMs <= endUtcMs; cursorMs += dayMs) {
      const chunkEndMs = Math.min(cursorMs + dayMs - 1000, endUtcMs);
      chunks.push({
        start: new Date(cursorMs).toISOString(),
        end: new Date(chunkEndMs).toISOString(),
      });
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
      } else {
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
    const lines = [["Date", "Property", "Total Chats Handled", "Average AHT", "Average FRT", "Missed Chats"].map(escapeCSV).join(",")];
    for (const row of dailyRows) {
      lines.push([row.date, escapeCSV(row.property), row.totalChats, row.avgAHT, row.avgFRT, row.missedChats].join(","));
    }
    downloadCSV(`tawk_report_${startDate}_to_${endDate}.csv`, lines.join("\n"));
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

  // ─── Render ─────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-[1400px] mx-auto px-6 py-4">
          <h1 className="text-2xl font-bold text-gray-900">Tawk.to Reports</h1>
          <p className="text-sm text-gray-500 mt-1">Generate daily chat volume and agent reports</p>
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
                <button onClick={() => setTab("csat")} className={`px-4 py-2 text-sm font-medium transition-colors border-l border-gray-300 ${tab === "csat" ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}>
                  Agent Ratings
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Start Date</label>
              <input type="date" value={startDate} max={today || undefined} onChange={(e) => setStartDate(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">End Date</label>
              <input type="date" value={endDate} max={today || undefined} onChange={(e) => setEndDate(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
            <button onClick={fetchReport} disabled={loading} className="bg-gray-900 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              {loading ? `Fetching... ${elapsed}s${progress ? ` (${progress})` : ""}` : "Generate Report"}
            </button>
          </div>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </div>

        {/* ─── Daily Report Table ─── */}
        {tab === "report" && dailyRows.length > 0 && (() => {
          const filteredDaily = hideZeroRows
            ? dailyRows.filter((r) => r.totalChats > 0 || r.missedChats > 0)
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
              </div>
              <button onClick={downloadDailyCSV} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors">
                Download CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-900 text-white">
                    <th className="px-4 py-2 text-left font-medium whitespace-nowrap">Date</th>
                    <th className="px-4 py-2 text-left font-medium whitespace-nowrap">Property</th>
                    <th className="px-4 py-2 text-center font-medium whitespace-nowrap">Total Chats Handled</th>
                    <th className="px-4 py-2 text-center font-medium whitespace-nowrap">Average AHT</th>
                    <th className="px-4 py-2 text-center font-medium whitespace-nowrap">Average FRT</th>
                    <th className="px-4 py-2 text-center font-medium whitespace-nowrap">Missed Chats</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDaily.map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                      <td className="px-4 py-2 whitespace-nowrap">{row.date}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{row.property}</td>
                      <td className="px-4 py-2 text-center">{row.totalChats}</td>
                      <td className="px-4 py-2 text-center font-mono">{row.avgAHT}</td>
                      <td className="px-4 py-2 text-center font-mono">{row.avgFRT}</td>
                      <td className="px-4 py-2 text-center">{row.missedChats}</td>
                    </tr>
                  ))}
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

        {!loading && dailyRows.length === 0 && agentSummary.length === 0 && csatRows.length === 0 && (
          <div className="text-center py-20 text-gray-400">
            <p className="text-lg">Select a date range and click Generate Report</p>
          </div>
        )}
      </main>
    </div>
  );
}
