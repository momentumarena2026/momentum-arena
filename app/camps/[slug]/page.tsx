import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { areCampsEnabled, getPublicCamp } from "@/lib/camps";
import { CampRegisterClient } from "./register-client";

export const dynamic = "force-dynamic";

export default async function CampDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  if (!(await areCampsEnabled())) notFound();
  const { slug } = await params;
  const camp = await getPublicCamp(slug);
  if (!camp) notFound();

  const session = await auth().catch(() => null);

  return (
    <CampRegisterClient
      camp={JSON.parse(JSON.stringify(camp))}
      signedIn={!!session?.user}
      prefill={{
        name: session?.user?.name ?? "",
        phone: (session?.user as { phone?: string } | undefined)?.phone ?? "",
        email: session?.user?.email ?? "",
      }}
    />
  );
}
