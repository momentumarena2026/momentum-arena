"use client";

// FIRST, and deliberately so: React Native code reads Metro's `__DEV__`,
// which no web bundler defines. ES imports evaluate in order, so this has to
// sit above anything that reaches React Native or the preview dies with a
// client-side exception that names nothing useful.
import "@/lib/rn-web-stubs/globals";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PreviewRoute } from "@/lib/rn-web-stubs/react-navigation";
// Opaque to TypeScript, real at runtime — see types/preview-modules.d.ts
// for why the boundary has to be at the import rather than the file list.
import { ChallengeDetailScreen } from "@preview/challenge-screen";
import { SafeAreaProvider } from "@preview/safe-area";

/**
 * The app's challenge screen, rendered in the browser, once per viewer.
 *
 * `ChallengeDetailScreen` below is the file `apps/mobile` ships to phones —
 * imported, not copied. There is no admin version of this screen to keep in
 * step, which is the entire point: a preview that is a separate
 * implementation is a preview that is wrong within a month, and the venue
 * asked specifically for one that could not drift.
 *
 * Three things are supplied around it, and only three:
 *
 *   ROUTE       the challenge id the screen reads from `useRoute()`.
 *   QUERY CACHE the payload, pre-seeded, with fetching switched off. The
 *               screen's `useQuery` therefore never calls the API — which
 *               matters because the app's api client points at the REAL
 *               backend, and an admin opening a preview must not fire
 *               customer-shaped requests at production.
 *   AUTH        a null viewer. The screen reads auth only to prefill
 *               Razorpay, which a preview never reaches; WHO is looking is
 *               decided by the payload's `viewerId`.
 *
 * Everything visible — every panel, sentence, button, price and colour — is
 * the app deciding, not this file.
 */

type View = {
  viewerId: string;
  label: string;
  note: string;
  person: { id: string; name: string | null; phone: string | null } | null;
  payload: Record<string, unknown> | null;
};

/**
 * A query client that will not fetch.
 *
 * `staleTime: Infinity` plus the refetch flags is what stops the screen's
 * own `useQuery` running its `queryFn` against the live backend the moment
 * it mounts. Getting this wrong would not show a broken preview — it would
 * show a correct one, while quietly making authenticated calls to
 * production from an admin's browser.
 */
function seededClient(payload: Record<string, unknown> | null, challengeId: string) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        gcTime: Infinity,
        retry: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  });
  if (payload) qc.setQueryData(["challenge", challengeId], payload);
  // The screen also asks which payment methods are running. Seeded from the
  // payload's own settings rather than fetched, for the same reason.
  qc.setQueryData(["payment-config"], {
    activeGateway: "RAZORPAY",
    onlineEnabled: true,
    upiQrEnabled: true,
    advanceEnabled: true,
    dqrEnabled: true,
  });
  return qc;
}

/** A phone, so the venue is looking at the shape their customer is. */
function Phone({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[390px] overflow-hidden rounded-[28px] border-4 border-zinc-800 bg-black shadow-2xl">
      <div className="h-[780px] overflow-y-auto">{children}</div>
    </div>
  );
}

function OneView({ view, challengeId }: { view: View; challengeId: string }) {
  const qc = useMemo(
    () => seededClient(view.payload, challengeId),
    [view.payload, challengeId],
  );

  if (!view.payload) {
    return (
      <Phone>
        <div className="flex h-full items-center justify-center p-8 text-center">
          <p className="text-sm text-zinc-400">
            This person cannot open the challenge at all — the server answers &ldquo;not
            found&rdquo;. Once a match is taken it is private to the two captains in it.
          </p>
        </div>
      </Phone>
    );
  }

  return (
    <Phone>
      <QueryClientProvider client={qc}>
          <SafeAreaProvider
            initialMetrics={{
              frame: { x: 0, y: 0, width: 390, height: 780 },
              insets: { top: 0, left: 0, right: 0, bottom: 0 },
            }}
          >
            <PreviewRoute params={{ id: challengeId }}>
              <ChallengeDetailScreen />
            </PreviewRoute>
          </SafeAreaProvider>
      </QueryClientProvider>
    </Phone>
  );
}

export function PreviewClient({
  challengeId,
  teamName,
  status,
  views,
}: {
  challengeId: string;
  teamName: string | null;
  status: string;
  views: View[];
}) {
  const [active, setActive] = useState(0);
  const view = views[active];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 pb-24 sm:px-6">
      <Link
        href={`/admin/challenges/${challengeId}`}
        className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" /> Back to the challenge
      </Link>

      <h1 className="mt-4 break-words text-xl font-bold text-white sm:text-2xl">
        {teamName || "(no team name)"} — what each person sees
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        This is the app&apos;s own screen, not a drawing of it. Status:{" "}
        <span className="text-zinc-300">{status.toLowerCase().replace("_", " ")}</span>.
      </p>

      {/* Scrolled, not wrapped: a venue on a phone gets a strip they can
          swipe rather than three lines of chips pushing the screen itself
          below the fold. */}
      <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {views.map((v, i) => (
          <button
            key={v.viewerId}
            onClick={() => setActive(i)}
            className={`shrink-0 whitespace-nowrap rounded-lg border px-3 py-1.5 text-left text-sm ${
              i === active
                ? "border-emerald-500/40 bg-emerald-600/10 text-emerald-300"
                : "border-zinc-800 text-zinc-400 hover:bg-zinc-900"
            }`}
          >
            {v.person?.name || v.label}
          </button>
        ))}
      </div>

      {view ? (
        <>
          <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <p className="text-sm text-white">
              {view.person?.name || view.label}
              {view.person?.phone ? (
                <span className="ml-2 text-zinc-500">{view.person.phone}</span>
              ) : null}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">{view.note}</p>
          </div>

          <div className="mt-4">
            {/* KEYED BY VIEWER, so switching tabs unmounts the screen and
                mounts a fresh one. Without the key React keeps the same
                instance alive across viewpoints: the query client prop
                changes but the screen's own state does not, and the venue
                reads the poster's panel while the tab says they are looking
                at somebody else — a preview that lies, which is worse than
                no preview. A remount is also what a real customer gets:
                they open the screen, they do not morph into another user. */}
            <OneView key={view.viewerId} view={view} challengeId={challengeId} />
          </div>
        </>
      ) : null}

      <p className="mt-6 text-center text-xs text-zinc-600">
        Read-only. Buttons here do nothing — this renders the screen, it does not drive it.
      </p>
    </div>
  );
}
