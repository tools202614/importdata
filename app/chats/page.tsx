import Link from "next/link";
import ChatsPanel from "../_components/ChatsPanel";

export const metadata = {
  title: "Chats & Tickets",
};

export default function ChatsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Chats &amp; Tickets</h1>
            <p className="text-sm text-gray-500 mt-1">
              Tag Chat Drivers &amp; Channel Issue per row; click a row to view the conversation.
            </p>
          </div>
          <Link
            href="/"
            className="shrink-0 border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            ← Reports
          </Link>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 py-6">
        <ChatsPanel />
      </main>
    </div>
  );
}
