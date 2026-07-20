import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import {
  listOtaReleases,
  rolloutOtaRelease,
  setOtaRolloutPercent,
  rollbackOtaRelease,
  archiveOtaRelease,
} from "@/actions/admin-ota";
import {
  listAppVersionGates,
  upsertAppVersionGate,
  setMinSupportedBuild,
  forceUpdateToLatest,
} from "@/actions/admin-app-version";

/**
 * Authorize a mobile admin request for the OTA surface: a valid bearer token
 * (getMobileAdmin) holding MANAGE_APP_RELEASES (or SUPERADMIN, which bypasses
 * per-permission checks). Returns the admin on success or a 401/403 response
 * to short-circuit on failure.
 */
async function authorize(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], "MANAGE_APP_RELEASES")
  ) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { admin };
}

/**
 * Mobile admin OTA status (READ).
 *
 * Mirrors the web app/(admin)/admin/ota page: returns every OTA release
 * (newest-first per channel × platform slot) plus the native version gates,
 * and the environment THIS deployment manages (prod domain → "production",
 * dev/preview/local → "development").
 *
 * Gated behind MANAGE_APP_RELEASES, the same permission the web OTA actions use.
 * The actions' own requireAdmin resolves the caller from the bearer JWT as well
 * as the cookie session, so they are called plainly; the authorize() check here
 * stays so an unauthorized request gets a 401/403 instead of a thrown 500.
 */
export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if (auth.error) return auth.error;

  const [releases, gates] = await Promise.all([
    listOtaReleases(),
    listAppVersionGates(),
  ]);

  // Lock to THIS deployment's environment: the production domain
  // (VERCEL_ENV=production → prod DB) manages "production"; dev/preview/local
  // manages "development". Each DB only holds its own channel's rows.
  const environment =
    process.env.VERCEL_ENV === "production" ? "production" : "development";

  return NextResponse.json({ environment, releases, gates });
}

/**
 * Mobile admin OTA mutations.
 *
 * Dispatches on the request body's `action` field to the matching web action,
 * mirroring the web /admin/ota controls (rollout management + version gates).
 * We authorize here (bearer + MANAGE_APP_RELEASES) for correct 401/403 status
 * codes; each action independently re-checks MANAGE_APP_RELEASES and resolves
 * the acting admin from the same bearer JWT for createdBy/updatedBy attribution.
 *
 * Supported actions:
 *  - rollout      { releaseId, percent }
 *  - setPercent   { releaseId, percent }
 *  - rollback     { releaseId }
 *  - archive      { releaseId }
 *  - saveGate     { platform, channel, latestBuild, latestVersionName?, storeUrl?, message?, minSupportedBuild? }
 *  - setMinBuild  { platform, channel, build }
 *  - forceUpdate  { platform, channel }
 */
export async function POST(request: NextRequest) {
  const auth = await authorize(request);
  if (auth.error) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v));

  let result: { success: true } | { error: string };

  switch (action) {
    case "rollout":
      result = await rolloutOtaRelease(
        str(body.releaseId),
        num(body.percent)
      );
      break;
    case "setPercent":
      result = await setOtaRolloutPercent(
        str(body.releaseId),
        num(body.percent)
      );
      break;
    case "rollback":
      result = await rollbackOtaRelease(str(body.releaseId));
      break;
    case "archive":
      result = await archiveOtaRelease(str(body.releaseId));
      break;
    case "saveGate":
      result = await upsertAppVersionGate({
        platform: str(body.platform),
        channel: str(body.channel),
        latestBuild: num(body.latestBuild),
        latestVersionName: str(body.latestVersionName),
        storeUrl: str(body.storeUrl),
        message: str(body.message),
      });
      // The web upsert also persists minSupportedBuild only via the dedicated
      // setMin/force actions; if the mobile client sent one explicitly, apply
      // it as a follow-up so the single "Save" gesture matches the web editor's
      // separate-but-co-located controls.
      if ("success" in result && body.minSupportedBuild !== undefined) {
        result = await setMinSupportedBuild(
          str(body.platform),
          str(body.channel),
          num(body.minSupportedBuild)
        );
      }
      break;
    case "setMinBuild":
      result = await setMinSupportedBuild(
        str(body.platform),
        str(body.channel),
        num(body.build)
      );
      break;
    case "forceUpdate":
      result = await forceUpdateToLatest(
        str(body.platform),
        str(body.channel)
      );
      break;
    default:
      return NextResponse.json(
        { error: `Unknown action: ${action || "(none)"}` },
        { status: 400 }
      );
  }

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}
