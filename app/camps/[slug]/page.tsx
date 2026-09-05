import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isDqrConfigured } from "@/lib/phonepe-dqr";
import { areCampsEnabled, getPublicCamp, hasJoinedCampBefore } from "@/lib/camps";
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

  // Whether the one-time joining fee applies to THIS visitor. Computed
  // here, on the server, because the answer depends on who is asking and
  // the page is already per-request. A visitor the venue cannot
  // recognise sees the fee, which is the correct quote for them.
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const phone = (session?.user as { phone?: string } | undefined)?.phone ?? null;
  const joiningFee =
    camp.registrationFee > 0 && !(await hasJoinedCampBefore(camp.id, { userId, phone }))
      ? camp.registrationFee
      : 0;

  return (
    <CampRegisterClient
      camp={JSON.parse(JSON.stringify(camp))}
      joiningFee={joiningFee}
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
