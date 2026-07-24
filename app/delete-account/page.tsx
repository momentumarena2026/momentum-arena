import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";

export const metadata: Metadata = {
  title: "Delete Your Account — Momentum Arena",
  description:
    "How to delete your Momentum Arena account and what data is removed or retained.",
};

/**
 * Public account-deletion instructions page. Required by the Google Play
 * Data safety form (and good practice for the App Store): a URL, reachable
 * without signing in, that names the app, lists the steps to delete an
 * account, and states what data is deleted vs retained.
 */
export default function DeleteAccountPage() {
  return (
    <div className="min-h-screen bg-black">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Momentum Arena
        </Link>

        <div className="mb-8 flex items-center gap-3">
          <div className="rounded-xl bg-emerald-500/10 p-3">
            <Trash2 className="h-6 w-6 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">
              Delete Your Account
            </h1>
            <p className="text-sm text-zinc-400">Momentum Arena</p>
          </div>
        </div>

        <p className="text-zinc-300">
          You can delete your Momentum Arena account and its associated data at
          any time. There are two ways to do it.
        </p>

        <section className="mt-8">
          <h2 className="text-lg font-semibold text-white">
            Delete it yourself, in the app or on the website
          </h2>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-zinc-300">
            <li>Sign in to Momentum Arena (app or momentumarena.com).</li>
            <li>
              Go to <span className="text-white">Account</span>.
            </li>
            <li>
              Tap <span className="text-white">Delete account</span> and
              confirm.
            </li>
          </ol>
          <p className="mt-3 text-sm text-zinc-400">
            Your account and personal data are removed right away.
          </p>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-semibold text-white">
            Prefer to ask us?
          </h2>
          <p className="mt-3 text-zinc-300">
            Email{" "}
            <a
              href="mailto:admin@momentumarena.com?subject=Delete%20my%20account"
              className="text-emerald-400 hover:text-emerald-300"
            >
              admin@momentumarena.com
            </a>{" "}
            from your registered email address with the subject &ldquo;Delete my
            account&rdquo;, and we will delete it within 7 days.
          </p>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-semibold text-white">What is deleted</h2>
          <p className="mt-3 text-zinc-300">
            When you delete your account we permanently remove your personal
            data: your name, phone number, email address, saved preferences,
            reward points, active passes, and cart.
          </p>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-semibold text-white">
            What we keep, and why
          </h2>
          <p className="mt-3 text-zinc-300">
            For legal, tax, and accounting obligations we retain records of your
            past bookings and payment transactions (which may include your name
            and amounts paid) for up to 8 years, as required under Indian law.
            These records are not linked to an active account and are never used
            to contact you.
          </p>
        </section>

        <p className="mt-10 text-xs text-zinc-500">
          Questions about your data? Write to admin@momentumarena.com.
        </p>
      </div>
    </div>
  );
}
