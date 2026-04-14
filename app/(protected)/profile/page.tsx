import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getProfile } from "@/actions/profile";
import { ProfileForm } from "./profile-form";
import {
  User,
  Mail,
  Phone,
  Shield,
  Calendar,
  CheckCircle2,
  Ticket,
} from "lucide-react";
import { BackButton } from "@/components/back-button";

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const profile = await getProfile();
  if (!profile) redirect("/login");

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <BackButton className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors" label="Back" />
        <h1 className="text-2xl font-bold text-white">My Profile</h1>
        <p className="mt-1 text-zinc-400">Manage your account information</p>
      </div>

      {/* Profile Header */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-2xl font-bold text-emerald-400">
            {profile.name?.charAt(0)?.toUpperCase() || "?"}
          </div>
          <div>
            <h2 className="text-xl font-semibold text-white">
              {profile.name || "Player"}
            </h2>
            <div className="mt-1 flex items-center gap-3 text-sm">
              <span
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                  profile.role === "ADMIN"
                    ? "border-red-500/30 bg-red-500/10 text-red-400"
                    : "border-blue-500/30 bg-blue-500/10 text-blue-400"
                }`}
              >
                <Shield className="h-3 w-3" />
                {profile.role}
              </span>
              <span className="flex items-center gap-1 text-zinc-500">
                <Ticket className="h-3 w-3" />
                {profile._count.bookings} bookings
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Account Info (Read-Only) */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-3">
        <h3 className="text-sm font-medium text-zinc-500 uppercase tracking-wider">
          Account Info
        </h3>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-zinc-400">
              <Mail className="h-4 w-4" />
              Email
            </span>
            <div className="flex items-center gap-2">
              <span className="text-white">{profile.email || "Not set"}</span>
              {profile.emailVerified && (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              )}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-zinc-400">
              <Phone className="h-4 w-4" />
              Phone
            </span>
            <div className="flex items-center gap-2">
              <span className="text-white">{profile.phone || "Not set"}</span>
              {profile.phoneVerified && (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              )}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-zinc-400">
              <Calendar className="h-4 w-4" />
              Member since
            </span>
            <span className="text-white">
              {profile.createdAt.toLocaleDateString("en-IN", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
          </div>
        </div>
      </div>

      {/* Editable Profile Form */}
      <ProfileForm
        name={profile.name || ""}
        email={profile.email || ""}
        phone={profile.phone || ""}
      />
    </div>
  );
}
