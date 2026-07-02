import ProfileCard from "../_components/ProfileCard";
import { UserMenu } from "../_components/AuthProvider";

export const metadata = {
  title: "My Profile",
};

// Everyone's own profile. Read-only here; HR/admin edit via /profiles.
export default function MyProfilePage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-[900px] mx-auto px-6 py-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
            <p className="text-sm text-gray-500 mt-1">Your employee details. Contact HR to make changes.</p>
          </div>
          <UserMenu reportsLink />
        </div>
      </header>
      <main className="max-w-[900px] mx-auto px-6 py-6">
        <ProfileCard editable={false} />
      </main>
    </div>
  );
}
