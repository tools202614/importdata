import EscalationsPanel from "../_components/EscalationsPanel";
import { UserMenu } from "../_components/AuthProvider";

export const metadata = {
  title: "Chargebacks & Refunds",
};

export default function EscalationsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Chargebacks &amp; Refunds</h1>
            <p className="text-sm text-gray-500 mt-1">Log chargeback &amp; refund records. Agents see only their own; admins see everyone&apos;s.</p>
          </div>
          <UserMenu reportsLink />
        </div>
      </header>
      <main className="max-w-[1400px] mx-auto px-6 py-6">
        <EscalationsPanel />
      </main>
    </div>
  );
}
