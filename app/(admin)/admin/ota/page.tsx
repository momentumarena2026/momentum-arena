import { listOtaReleases } from "@/actions/admin-ota";
import { listAppVersionGates } from "@/actions/admin-app-version";
import { OtaMatrix } from "./ota-matrix";

export default async function AdminOtaPage() {
  // Fetch in parallel — both are admin-guarded reads on the same surface.
  const [releases, gates] = await Promise.all([
    listOtaReleases(),
    listAppVersionGates(),
  ]);

  return <OtaMatrix releases={releases} gates={gates} />;
}
