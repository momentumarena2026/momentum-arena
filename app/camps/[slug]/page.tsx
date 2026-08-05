import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isDqrConfigured } from "@/lib/phonepe-dqr";
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
  // UPI is offered only when PhonePe DQR is both configured and switched
  // on — same gate the tournament and pass funnels use.
  const gatewayCfg = await db.paymentGatewayConfig
    .findUnique({ where: { id: "singleton" }, select: { dqrEnabled: true } })
    .catch(() => null);
  const dqrAvailable = isDqrConfigured() && !!gatewayCfg?.dqrEnabled;

  return (
    <CampRegisterClient
      camp={JSON.parse(JSON.stringify(camp))}
      signedIn={!!session?.user}
      dqrAvailable={dqrAvailable}
      prefill={{
        name: session?.user?.name ?? "",
        phone: (session?.user as { phone?: string } | undefined)?.phone ?? "",
        email: session?.user?.email ?? "",
      }}
    />
  );
}
