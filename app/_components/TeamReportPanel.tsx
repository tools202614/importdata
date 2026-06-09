"use client";

import { useEffect, useState } from "react";

interface PropRow { property: string; totalChats: number; pct: number }
interface IssueRow { issue: string; count: number; pct: number }
interface TeamBlock {
  name: string;
  title: string;
  properties: PropRow[];
  propertyTotal: number;
  issues: IssueRow[];
  issueTotal: number;
}

const fmtPct = (n: number) => `${n.toFixed(2)}%`;

function escapeCSV(val: string | number) {
  const s = String(val ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCSV(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function TeamReportPanel() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [teams, setTeams] = useState<TeamBlock[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    setFrom(today);
    setTo(today);
  }, []);

  async function generate() {
    if (!from || !to) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/team-report?from=${from}&to=${to}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setTeams(data.teams);
    } catch (err) {
      setError(String(err));
      setTeams(null);
    } finally {
      setLoading(false);
    }
  }

  function downloadAllCSV() {
    if (!teams) return;
    const lines: string[] = [];
    for (const t of teams) {
      lines.push(t.title);
      lines.push("Property Breakdown");
      lines.push(["Property", "Total Chats", "% of Team Chats"].join(","));
      for (const p of t.properties) lines.push([escapeCSV(p.property), p.totalChats, fmtPct(p.pct)].join(","));
      lines.push(["TOTAL", t.propertyTotal, "100.00%"].join(","));
      lines.push("");
      lines.push("Chat Drivers");
      lines.push(["Common Issue", "Total Cases", "Percentage"].join(","));
      for (const i of t.issues) lines.push([escapeCSV(i.issue), i.count, fmtPct(i.pct)].join(","));
      lines.push(["TOTAL", t.issueTotal, "100.00%"].join(","));
      lines.push("");
      lines.push("");
    }
    const range = from === to ? from : `${from}_to_${to}`;
    downloadCSV(`team_report_${range}.csv`, lines.join("\n"));
  }

  return (
    <div className="space-y-5">
      {/* Controls (hidden when printing) */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
          </div>
          <button onClick={() => { const d = new Date().toISOString().slice(0, 10); setFrom(d); setTo(d); }} type="button" className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
            Today
          </button>
          <button onClick={generate} disabled={loading} className="bg-gray-900 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50">
            {loading ? "Generating…" : "Generate"}
          </button>
          {teams && (
            <>
              <div className="flex-1" />
              <button onClick={downloadAllCSV} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700">
                Download CSV
              </button>
              <button onClick={() => window.print()} className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700">
                Download PDF
              </button>
            </>
          )}
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <p className="mt-2 text-xs text-gray-400">
          Total Chats = synced chat volume per property. Common Issues = logged Channel Issue forms. Pick a single day for the daily report.
        </p>
      </div>

      {/* Report (this is what prints) */}
      {teams && (
        <div id="team-report-print" className="space-y-8">
          <div className="hidden print:block text-sm text-gray-600 mb-2">
            Team Report — {from === to ? from : `${from} to ${to}`}
          </div>
          {teams.map((t) => (
            <section key={t.name} className="team-section bg-white rounded-lg border border-gray-200 shadow-sm p-5 space-y-4">
              <h2 className="text-xl font-bold text-gray-900">{t.title}</h2>

              {/* Property Breakdown */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">📌 Property Breakdown</h3>
                <table className="report-table border border-gray-400 text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="border border-gray-400 px-3 py-1 text-left font-semibold">Property</th>
                      <th className="border border-gray-400 px-3 py-1 text-right font-semibold">Total Chats</th>
                      <th className="border border-gray-400 px-3 py-1 text-right font-semibold">% of Team Chats</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.properties.map((p) => (
                      <tr key={p.property}>
                        <td className="border border-gray-400 px-3 py-1">{p.property}</td>
                        <td className="border border-gray-400 px-3 py-1 text-right font-mono">{p.totalChats}</td>
                        <td className="border border-gray-400 px-3 py-1 text-right font-mono">{fmtPct(p.pct)}</td>
                      </tr>
                    ))}
                    <tr className="font-bold">
                      <td className="border border-gray-400 px-3 py-1">TOTAL</td>
                      <td className="border border-gray-400 px-3 py-1 text-right font-mono">{t.propertyTotal}</td>
                      <td className="border border-gray-400 px-3 py-1 text-right font-mono">100.00%</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Chat Drivers */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">📌 Chat Drivers</h3>
                {t.issues.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No Channel Issue forms logged for this team in the range.</p>
                ) : (
                  <table className="report-table border border-gray-400 text-sm">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="border border-gray-400 px-3 py-1 text-left font-semibold">Common Issue</th>
                        <th className="border border-gray-400 px-3 py-1 text-right font-semibold">Total Cases</th>
                        <th className="border border-gray-400 px-3 py-1 text-right font-semibold">Percentage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.issues.map((i) => (
                        <tr key={i.issue}>
                          <td className="border border-gray-400 px-3 py-1">{i.issue}</td>
                          <td className="border border-gray-400 px-3 py-1 text-right font-mono">{i.count}</td>
                          <td className="border border-gray-400 px-3 py-1 text-right font-mono">{fmtPct(i.pct)}</td>
                        </tr>
                      ))}
                      <tr className="font-bold">
                        <td className="border border-gray-400 px-3 py-1">TOTAL</td>
                        <td className="border border-gray-400 px-3 py-1 text-right font-mono">{t.issueTotal}</td>
                        <td className="border border-gray-400 px-3 py-1 text-right font-mono">100.00%</td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      {!teams && !loading && (
        <div className="text-center py-16 text-gray-400 print:hidden">
          <p className="text-lg">Pick a date and click Generate to build the team report.</p>
        </div>
      )}
    </div>
  );
}
