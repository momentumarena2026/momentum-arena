import type { Metadata } from "next";
import { BackButton } from "@/components/back-button";
import { ScrollText } from "lucide-react";

export const metadata: Metadata = {
  title: "Policies · Momentum Arena",
  description:
    "Terms and Conditions, Privacy Policy, and Refund & Cancellation Policy for Momentum Arena, operated by Sportive Ventures.",
};

const LAST_UPDATED = "April 23, 2026";

// Keeping copy inline rather than in a data module — it's a static legal
// page that changes rarely and the plain JSX is easier to audit when the
// text gets reviewed.
export default function PoliciesPage() {
  return (
    <div className="min-h-screen bg-black">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <BackButton
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
          label="Back"
        />

        <div className="mb-8 flex items-center gap-3">
          <div className="rounded-xl bg-emerald-500/10 p-3">
            <ScrollText className="h-6 w-6 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Policies</h1>
            <p className="text-zinc-400">
              Terms, privacy, and refunds for Momentum Arena
            </p>
          </div>
        </div>

        <nav
          aria-label="Policies"
          className="mb-8 rounded-xl border border-zinc-800 bg-zinc-950/50 p-4"
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Jump to
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            <li>
              <a
                href="#terms"
                className="text-emerald-400 hover:text-emerald-300"
              >
                1. Terms and Conditions
              </a>
            </li>
            <li>
              <a
                href="#privacy"
                className="text-emerald-400 hover:text-emerald-300"
              >
                2. Privacy Policy
              </a>
            </li>
            <li>
              <a
                href="#refunds"
                className="text-emerald-400 hover:text-emerald-300"
              >
                3. Refund &amp; Cancellation Policy
              </a>
            </li>
            <li>
              <a
                href="#contact"
                className="text-emerald-400 hover:text-emerald-300"
              >
                Contact Information
              </a>
            </li>
          </ul>
        </nav>

        <div className="space-y-12 text-zinc-300">
          {/* ─────────────────────────── TERMS ─────────────────────────── */}
          <section id="terms" className="scroll-mt-8">
            <h2 className="text-xl font-semibold text-white">
              1. Terms and Conditions
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Last Updated: {LAST_UPDATED}
            </p>

            <p className="mt-4 leading-relaxed">
              Welcome to Momentum Arena, operated by Sportive Ventures. By
              booking our facilities or using our website, you agree to the
              following:
            </p>

            <dl className="mt-4 space-y-4">
              <div>
                <dt className="font-semibold text-white">
                  Booking &amp; Payments
                </dt>
                <dd className="mt-1 leading-relaxed">
                  All bookings for Cricket, Football, or Pickleball must be
                  made via our website or authorized channels. Payments must be
                  made in full at the time of booking to secure the slot.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-white">Facility Use</dt>
                <dd className="mt-1 leading-relaxed">
                  Users must adhere to the allocated time slots. Overstaying
                  may result in additional charges. Proper sports attire and
                  non-marking shoes are mandatory on the turf.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-white">Conduct</dt>
                <dd className="mt-1 leading-relaxed">
                  We reserve the right to remove any individual displaying
                  unruly behavior, or anyone under the influence of alcohol or
                  illegal substances, without a refund.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-white">Liability</dt>
                <dd className="mt-1 leading-relaxed">
                  Sportive Ventures is not responsible for any personal injury,
                  loss, or damage to personal property sustained while using
                  the arena facilities.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-white">Amendments</dt>
                <dd className="mt-1 leading-relaxed">
                  We reserve the right to modify these terms at any time.
                </dd>
              </div>
            </dl>
          </section>

          {/* ─────────────────────────── PRIVACY ─────────────────────────── */}
          <section id="privacy" className="scroll-mt-8">
            <h2 className="text-xl font-semibold text-white">
              2. Privacy Policy
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Last Updated: {LAST_UPDATED}
            </p>

            <p className="mt-4 leading-relaxed">
              At Sportive Ventures, we value your privacy. This policy outlines
              how we handle your data:
            </p>

            <dl className="mt-4 space-y-4">
              <div>
                <dt className="font-semibold text-white">
                  Information Collection
                </dt>
                <dd className="mt-1 leading-relaxed">
                  We collect personal information (name, phone number, email)
                  when you register or book a court.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-white">Usage</dt>
                <dd className="mt-1 leading-relaxed">
                  Your data is used to process bookings, send confirmation
                  alerts, and notify you of special offers (like our Flat ₹100
                  OFF for new users).
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-white">Data Protection</dt>
                <dd className="mt-1 leading-relaxed">
                  We implement industry-standard security measures to protect
                  your information. We do not sell your personal data to third
                  parties.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-white">Cookies</dt>
                <dd className="mt-1 leading-relaxed">
                  Our website uses cookies to enhance user experience and
                  analyze site traffic.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-white">Third-Party Links</dt>
                <dd className="mt-1 leading-relaxed">
                  Our site may contain links to social media (Instagram,
                  YouTube, WhatsApp). We are not responsible for the privacy
                  practices of those external sites.
                </dd>
              </div>
            </dl>
          </section>

          {/* ─────────────────────────── REFUNDS ─────────────────────────── */}
          <section id="refunds" className="scroll-mt-8">
            <h2 className="text-xl font-semibold text-white">
              3. Refund &amp; Cancellation Policy
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Last Updated: {LAST_UPDATED}
            </p>

            <p className="mt-4 leading-relaxed">
              At Sportive Ventures, we understand plans change. Our refund
              policy for Momentum Arena is as follows:
            </p>

            <h3 className="mt-6 text-base font-semibold text-white">
              Cancellations
            </h3>
            <ul className="mt-2 space-y-2 leading-relaxed">
              <li>
                <span className="font-semibold text-white">
                  More than 72 hours before slot:
                </span>{" "}
                Full refund or a one-time free rescheduling to an available
                slot.
              </li>
              <li>
                <span className="font-semibold text-white">
                  Less than 24 hours before slot:
                </span>{" "}
                No refund or rescheduling permitted.
              </li>
            </ul>

            <h3 className="mt-6 text-base font-semibold text-white">
              Weather &amp; Maintenance
            </h3>
            <p className="mt-2 leading-relaxed">
              In the event of extreme weather situations or technical issues
              (e.g., floodlight failure) that make the turf unplayable, we will
              offer a full refund or a free reschedule.
            </p>

            <h3 className="mt-6 text-base font-semibold text-white">
              Cafe Orders
            </h3>
            <p className="mt-2 leading-relaxed">
              Orders placed via the Momentum Cafe are non-refundable once the
              preparation has started.
            </p>

            <h3 className="mt-6 text-base font-semibold text-white">
              Processing Refunds
            </h3>
            <p className="mt-2 leading-relaxed">
              Approved refunds will be credited back to the original payment
              method within 5–7 business days.
            </p>
          </section>

          {/* ─────────────────────────── CONTACT ─────────────────────────── */}
          <section id="contact" className="scroll-mt-8">
            <h2 className="text-xl font-semibold text-white">
              Contact Information
            </h2>
            <p className="mt-4 leading-relaxed">
              For any queries regarding these policies, please contact:
            </p>

            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
                <dt className="w-24 shrink-0 text-zinc-500">Entity</dt>
                <dd className="text-white">Sportive Ventures</dd>
              </div>
              <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
                <dt className="w-24 shrink-0 text-zinc-500">Address</dt>
                <dd className="text-white">
                  Khasra no. 293/5, Mouja Ganeshra Radhapuram Road, Mathura, UP
                  281004
                </dd>
              </div>
              <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
                <dt className="w-24 shrink-0 text-zinc-500">Phone</dt>
                <dd>
                  <a
                    href="tel:+916396177261"
                    className="text-emerald-400 hover:text-emerald-300"
                  >
                    +91 63961 77261
                  </a>
                </dd>
              </div>
              <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
                <dt className="w-24 shrink-0 text-zinc-500">Email</dt>
                <dd>
                  <a
                    href="mailto:momentumarena2026@gmail.com"
                    className="text-emerald-400 hover:text-emerald-300"
                  >
                    momentumarena2026@gmail.com
                  </a>
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
