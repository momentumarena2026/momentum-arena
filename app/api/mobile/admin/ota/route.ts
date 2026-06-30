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
 * (getMobileAdmin) holding MANAGE_PRICING (or SUPERADMIN, which bypasses
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
    !hasPermission(admin.permissions ?? [], "MANAGE_PRICING")
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
 * Gated behind MANAGE_PRICING, the same permission the web OTA actions use.
 * The web actions auth via the cookie session (requireAdmin); a mobile bearer
 * request has no such cookie, so we authorize here with getMobileAdmin +
 * hasPermission and call the list actions with `skipAuth: true`.
 */
export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if (auth.error) return auth.error;

  const [releases, gates] = await Promise.all([
    listOtaReleases({ skipAuth: true }),
    listAppVersionGates({ skipAuth: true }),
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
 * We authorize ONCE here (bearer + MANAGE_PRICING) then call each action with
 * `{ skipAuth: true, adminId: admin.id }` so the cookie-based requireAdmin()
 * is bypassed while createdBy/updatedBy attribution stays correct.
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
  const { admin } = auth;
  const authOpts = { skipAuth: true as const, adminId: admin.id };

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
        num(body.percent),
        authOpts
      );
      break;
    case "setPercent":
      result = await setOtaRolloutPercent(
        str(body.releaseId),
        num(body.percent),
        authOpts
      );
      break;
    case "rollback":
      result = await rollbackOtaRelease(str(body.releaseId), authOpts);
      break;
    case "archive":
      result = await archiveOtaRelease(str(body.releaseId), authOpts);
      break;
    case "saveGate":
      result = await upsertAppVersionGate(
        {
          platform: str(body.platform),
          channel: str(body.channel),
          latestBuild: num(body.latestBuild),
          latestVersionName: str(body.latestVersionName),
          storeUrl: str(body.storeUrl),
          message: str(body.message),
        },
        authOpts
      );
      // The web upsert also persists minSupportedBuild only via the dedicated
      // setMin/force actions; if the mobile client sent one explicitly, apply
      // it as a follow-up so the single "Save" gesture matches the web editor's
      // separate-but-co-located controls.
      if ("success" in result && body.minSupportedBuild !== undefined) {
        result = await setMinSupportedBuild(
          str(body.platform),
          str(body.channel),
          num(body.minSupportedBuild),
          authOpts
        );
      }
      break;
    case "setMinBuild":
      result = await setMinSupportedBuild(
        str(body.platform),
        str(body.channel),
        num(body.build),
        authOpts
      );
      break;
    case "forceUpdate":
      result = await forceUpdateToLatest(
        str(body.platform),
        str(body.channel),
        authOpts
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
