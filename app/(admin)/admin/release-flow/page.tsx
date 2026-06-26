import { requireAdmin } from "@/lib/admin-auth";

/**
 * ───────────────────────────────────────────────────────────────────────────
 *  RELEASE FLOW — SINGLE SOURCE OF TRUTH (admin-facing documentation page)
 * ───────────────────────────────────────────────────────────────────────────
 *  Documents how code goes from a push to live, for BOTH worlds
 *  (development = test, main = production) across the three delivery
 *  mechanisms: the website, mobile OTA (JS-only), and mobile native store
 *  builds. Every step is tagged manual vs automated; automated steps name the
 *  exact system that runs them.
 *
 *  ⚠️  KEEP IN SYNC — this is hand-maintained documentation, not generated.
 *  Whenever the real pipeline changes, edit the `FLOW` data below so the page
 *  never lies. The relevant moving parts to mirror:
 *    • Vercel deploys (per-branch domains)
 *    • .github/workflows/ota-publish.yml (the OTA CI robot)
 *    • apps/mobile/fastlane/Fastfile (the native build lanes)
 *    • the /admin/ota rollout + version-gate mechanics
 *  Each step is plain data — adding/editing one is a one-line change.
 *
 *  Last reviewed: 2026-06-26
 * ───────────────────────────────────────────────────────────────────────────
 */

type Tag =
  | { t: "manual"; who: string }
  | { t: "auto"; engine: string }
  | { t: "review"; who: string } // automated checks + a human reviewer
  | { t: "done"; label: string };

interface Step {
  title: string;
  desc: string;
  tags: Tag[];
}

interface Lane {
  heading: string;
  tone: "dev" | "prod";
  steps: Step[];
}

interface Section {
  emoji: string;
  title: string;
  note: string;
  lanes: [Lane, Lane]; // [development, production]
}

const FLOW: Section[] = [
  {
    emoji: "🌐",
    title: "Website (the booking site)",
    note: "Every push deploys itself — no app store, no waiting. Live in ~2 minutes.",
    lanes: [
      {
        heading: "DEVELOPMENT → development.momentumarena.com",
        tone: "dev",
        steps: [
          { title: "Push code", desc: "Send code to the development branch.", tags: [{ t: "manual", who: "Developer" }] },
          { title: "Site rebuilds itself", desc: "The host notices the push and builds the new site.", tags: [{ t: "auto", engine: "Vercel" }] },
          { title: "Database updates", desc: "Schema migrations run during the build; a robot reseeds test data.", tags: [{ t: "auto", engine: "Vercel + GitHub Actions" }] },
          { title: "Live on the test site", desc: "Anyone with the test link sees it instantly.", tags: [{ t: "auto", engine: "Vercel" }] },
        ],
      },
      {
        heading: "PRODUCTION → www.momentumarena.com",
        tone: "prod",
        steps: [
          { title: "Merge to main", desc: "Code is merged into main (usually via a reviewed Pull Request).", tags: [{ t: "manual", who: "Developer" }] },
          { title: "Site rebuilds itself", desc: "The host builds the production site.", tags: [{ t: "auto", engine: "Vercel" }] },
          { title: "Database updates", desc: "Migrations run on the real database.", tags: [{ t: "auto", engine: "Vercel" }] },
          { title: "Live for everyone", desc: "All real users see it instantly.", tags: [{ t: "auto", engine: "Vercel" }] },
        ],
      },
    ],
  },
  {
    emoji: "📲",
    title: "Mobile app — small updates (OTA, JavaScript only)",
    note: "Use when only screens/logic change. Skips the app stores — reaches phones in minutes.",
    lanes: [
      {
        heading: "DEVELOPMENT — channel “development”",
        tone: "dev",
        steps: [
          { title: "Push code", desc: "Send code to development.", tags: [{ t: "manual", who: "Developer" }] },
          { title: "Robot wakes up", desc: "Starts automatically when the app code changes (push to development).", tags: [{ t: "auto", engine: "GitHub Actions · ota-publish.yml" }] },
          { title: "“Did native code change?”", desc: "Robot compares a fingerprint to the saved baseline. Native changed → it auto-starts the store build (next section). Only JS → continues here.", tags: [{ t: "auto", engine: "GitHub Actions" }] },
          { title: "Package, sign, upload", desc: "Robot bundles the JS, signs it, uploads to storage, saves a DRAFT. Nothing on phones yet.", tags: [{ t: "auto", engine: "GitHub Actions → Vercel Blob" }] },
          { title: "Roll out", desc: "Admin opens OTA Updates and clicks “Roll out” (e.g. 10% → 100%).", tags: [{ t: "manual", who: "Admin" }] },
          { title: "Phone fetches it", desc: "On next open the app downloads it; applies on the following open.", tags: [{ t: "auto", engine: "In the app · Expo" }] },
          { title: "Done", desc: "Testers see the change in minutes.", tags: [{ t: "done", label: "Live for testers" }] },
        ],
      },
      {
        heading: "PRODUCTION — channel “production”",
        tone: "prod",
        steps: [
          { title: "Merge to main", desc: "Send code to main.", tags: [{ t: "manual", who: "Developer" }] },
          { title: "Robot wakes up", desc: "Runs when the app code changes (push to main).", tags: [{ t: "auto", engine: "GitHub Actions · ota-publish.yml" }] },
          { title: "“Did native code change?”", desc: "The same fingerprint check. Only JS → continues; native → a store build is needed (started manually for production).", tags: [{ t: "auto", engine: "GitHub Actions" }] },
          { title: "Package, sign, upload", desc: "Builds a DRAFT production release. Nothing on phones yet.", tags: [{ t: "auto", engine: "GitHub Actions → Vercel Blob" }] },
          { title: "Roll out", desc: "Admin rolls out on the production row of OTA Updates.", tags: [{ t: "manual", who: "Admin" }] },
          { title: "Phone fetches it", desc: "Every real user’s app downloads it on next open.", tags: [{ t: "auto", engine: "In the app · Expo" }] },
          { title: "Done", desc: "All users updated — no store needed.", tags: [{ t: "done", label: "Live for everyone" }] },
        ],
      },
    ],
  },
  {
    emoji: "📱",
    title: "Mobile app — big updates (native, needs the stores)",
    note: "Use when native code changes (new library, permission, SDK/runtime bump). On development the build now auto-fires from the native-change check; production stays a deliberate dispatch. Apple/Google still review.",
    lanes: [
      {
        heading: "DEVELOPMENT → TestFlight (iOS) + Play Internal (Android)",
        tone: "dev",
        steps: [
          { title: "Push the native change", desc: "Push a change that touches native code to development.", tags: [{ t: "manual", who: "Developer" }] },
          { title: "CI detects it's native", desc: "The OTA robot sees the fingerprint differ from the baseline.", tags: [{ t: "auto", engine: "GitHub Actions · ota-publish.yml" }] },
          { title: "Native build auto-fires", desc: "The robot builds the signed app and uploads it — iOS → TestFlight, Android → Play internal.", tags: [{ t: "auto", engine: "GitHub Actions → TestFlight / Play" }] },
          { title: "Store processes the build", desc: "Format / safety scans of the binary.", tags: [{ t: "auto", engine: "Apple / Google" }] },
          { title: "Baseline + version gate updated", desc: "Robot refreshes the OTA baseline (so OTA resumes) and records the new build in the version gate.", tags: [{ t: "auto", engine: "GitHub Actions" }] },
          { title: "Testers install", desc: "Update from TestFlight / Play. (iOS external testers wait on a quick Apple beta review.)", tags: [{ t: "manual", who: "Testers" }] },
        ],
      },
      {
        heading: "PRODUCTION → App Store + Play production",
        tone: "prod",
        steps: [
          { title: "Start the build", desc: "Click Run on the iOS/Android workflow with track = production (a deliberate manual step).", tags: [{ t: "manual", who: "Developer" }] },
          { title: "Build + upload", desc: "Builds the signed app and uploads to App Store Connect / Play production.", tags: [{ t: "auto", engine: "GitHub Actions" }] },
          { title: "Baseline + version gate updated", desc: "Robot refreshes the production OTA baseline + version gate.", tags: [{ t: "auto", engine: "GitHub Actions" }] },
          { title: "Submit for review", desc: "Send the build for approval.", tags: [{ t: "manual", who: "Developer" }] },
          { title: "Store review", desc: "Automated checks + a human reviewer approve it (hours to ~2 days).", tags: [{ t: "review", who: "Apple / Google" }] },
          { title: "Release", desc: "Approve & release (optionally phased %).", tags: [{ t: "manual", who: "Developer" }] },
          { title: "Users update", desc: "Delivered through the store (auto-update or tap “Update”).", tags: [{ t: "auto", engine: "App Store / Play" }] },
          { title: "Force old apps (optional)", desc: "Set a minimum build in OTA Updates → old apps show a blocking “Update now” screen.", tags: [{ t: "manual", who: "Admin sets it" }, { t: "auto", engine: "version-check API" }] },
        ],
      },
    ],
  },
];

function Code({ children }: { children: string }) {
  return <code className="rounded bg-zinc-800 px-1 py-0.5 text-[11.5px] text-zinc-300">{children}</code>;
}

function Pill({ cls, children }: { cls: string; children: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {children}
    </span>
  );
}

const ENGINE_CLS = "border-zinc-700 bg-zinc-800 text-zinc-400";

function TagBadges({ tag }: { tag: Tag }) {
  if (tag.t === "manual")
    return (
      <>
        <Pill cls="border-amber-500/30 bg-amber-500/15 text-amber-300">✋ Manual</Pill>
        <Pill cls={ENGINE_CLS}>{tag.who}</Pill>
      </>
    );
  if (tag.t === "auto")
    return (
      <>
        <Pill cls="border-emerald-500/30 bg-emerald-500/15 text-emerald-300">🤖 Automated</Pill>
        <Pill cls={ENGINE_CLS}>{tag.engine}</Pill>
      </>
    );
  if (tag.t === "review")
    return (
      <>
        <Pill cls="border-violet-500/30 bg-violet-500/15 text-violet-300">🤖 + 👤 Review</Pill>
        <Pill cls={ENGINE_CLS}>{tag.who}</Pill>
      </>
    );
  return <Pill cls="border-blue-500/30 bg-blue-500/15 text-blue-300">{`✓ ${tag.label}`}</Pill>;
}

function LaneColumn({ lane }: { lane: Lane }) {
  const tone =
    lane.tone === "dev"
      ? "border-blue-500/20 bg-blue-500/10 text-blue-300"
      : "border-rose-500/20 bg-rose-500/10 text-rose-300";
  return (
    <div>
      <div className={`mb-2 rounded-lg border px-3 py-2 text-xs font-medium ${tone}`}>{lane.heading}</div>
      <ol>
        {lane.steps.map((step, i) => (
          <li key={i}>
            <div className="flex gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950 text-[11px] text-zinc-400">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-100">{step.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">{step.desc}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {step.tags.map((tag, j) => (
                    <TagBadges key={j} tag={tag} />
                  ))}
                </div>
              </div>
            </div>
            {i < lane.steps.length - 1 && <div className="py-0.5 text-center text-xs text-zinc-700">↓</div>}
          </li>
        ))}
      </ol>
    </div>
  );
}

const VERSIONS: {
  key: string;
  example: string;
  auto: boolean;
  what: string;
  when: string;
}[] = [
  {
    key: "App version",
    example: "1.0.0",
    auto: false,
    what: "The human-facing version (iOS CFBundleShortVersionString / Android versionName).",
    when: "You bump it for a meaningful release (1.0.0 → 1.1.0). Constant otherwise.",
  },
  {
    key: "Native build #",
    example: "29707758",
    auto: true,
    what: "Unique ID of the binary on the store — what the Version Gate compares.",
    when: "Every native build = unix-epoch-minutes, so it's always strictly higher and never collides.",
  },
  {
    key: "OTA #",
    example: "7",
    auto: true,
    what: "Which over-the-air JS bundle the app has loaded.",
    when: "+1 on every OTA publish, per channel × platform × runtime.",
  },
  {
    key: "Runtime version",
    example: "2",
    auto: false,
    what: "Compatibility key — an OTA only installs on an app whose runtime matches.",
    when: "Bump only on a native breaking change; it starts a fresh OTA line (old apps then need a store update).",
  },
];

export default async function ReleaseFlowPage() {
  // Same gate as OTA Updates — this documents the privileged release pipeline.
  await requireAdmin("MANAGE_PRICING");

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-white">Release Flow</h1>
        <p className="mt-1 max-w-3xl text-zinc-400">
          How code goes from a push to live — the test world (<Code>development</Code>) and the real world (<Code>main</Code> /
          production) side by side. Every step is tagged manual or automated, and automated steps name the exact system that
          runs them.
        </p>
      </header>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          <Pill cls="border-amber-500/30 bg-amber-500/15 text-amber-300">✋ Manual</Pill> a person does it
        </span>
        <span className="flex items-center gap-1.5">
          <Pill cls="border-emerald-500/30 bg-emerald-500/15 text-emerald-300">🤖 Automated</Pill> happens by itself
        </span>
        <span className="flex items-center gap-1.5">
          <Pill cls={ENGINE_CLS}>grey</Pill> which system / who
        </span>
      </div>

      {/* START */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-300">
        <span className="font-semibold text-white">START (same for everything):</span> a developer writes code and pushes to
        GitHub. The branch decides the world — <Code>development</Code> = test (left column below), <Code>main</Code> =
        production (right column).
        <div className="mt-2 flex flex-wrap gap-1.5">
          <TagBadges tag={{ t: "manual", who: "Developer" }} />
        </div>
      </div>

      {FLOW.map((section) => (
        <section key={section.title} className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-white">
              {section.emoji} {section.title}
            </h2>
            <p className="text-sm text-zinc-500">{section.note}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {section.lanes.map((lane) => (
              <LaneColumn key={lane.heading} lane={lane} />
            ))}
          </div>
        </section>
      ))}

      {/* Version system */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-white">🔢 Version numbers — what each one means</h2>
          <p className="text-sm text-zinc-500">
            Every install carries three numbers plus one compatibility key. Some bump automatically, some you set.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {VERSIONS.map((v) => (
            <div key={v.key} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-zinc-100">{v.key}</span>
                {v.auto ? (
                  <Pill cls="border-emerald-500/30 bg-emerald-500/15 text-emerald-300">🤖 automatic</Pill>
                ) : (
                  <Pill cls="border-amber-500/30 bg-amber-500/15 text-amber-300">✋ manual</Pill>
                )}
              </div>
              <div className="mt-1 font-mono text-lg text-white">{v.example}</div>
              <p className="mt-1 text-xs leading-relaxed text-zinc-400">{v.what}</p>
              <p className="mt-1.5 text-xs text-zinc-500">
                <span className="text-zinc-400">Increments:</span> {v.when}
              </p>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3.5">
          <p className="text-sm text-zinc-300">
            In the app (Account screen) they show together as{" "}
            <span className="font-mono text-zinc-100">1.0.0 · build 29707758 · OTA 7 · prod</span>.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-zinc-400">
            How they interact: the <span className="text-zinc-200">native build #</span> drives the Version Gate (soft /
            forced update). The <span className="text-zinc-200">OTA #</span> tracks the JS bundle layered on top of that
            build. The <span className="text-zinc-200">runtime version</span> decides which OTAs an app may receive — bump
            it on a native breaking change and older apps stop getting new OTAs until they take a store update.
          </p>
        </div>
      </section>

      <p className="border-t border-zinc-900 pt-4 text-xs text-zinc-600">
        This page mirrors the live CI/CD pipeline (Vercel deploys, <Code>.github/workflows/ota-publish.yml</Code>, and the
        fastlane lanes). Keep it in sync when the pipeline changes. Last reviewed 26 Jun 2026.
      </p>
    </div>
  );
}
