import { listOtaReleases } from "@/actions/admin-ota";
import { listAppVersionGates } from "@/actions/admin-app-version";
import { OtaMatrix } from "./ota-matrix";

export default async function AdminOtaPage() {
  // Fetch in parallel — both are admin-guarded reads on the same surface.
  const [releases, gates] = await Promise.all([
    listOtaReleases(),
    listAppVersionGates(),
  ]);

  // Lock the UI to THIS deployment's environment: the production domain
  // (VERCEL_ENV=production → prod DB) manages "production"; the dev/preview
  // deployment (development.momentumarena.com, and local) manages "development".
  // Each DB only holds its own channel, so there's nothing to show for the other.
  const environment =
    process.env.VERCEL_ENV === "production" ? "production" : "development";

  return (
    <OtaMatrix releases={releases} gates={gates} environment={environment} />
  );
}
