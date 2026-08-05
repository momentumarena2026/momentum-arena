import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-unified";
import {
  areCampsEnabled,
  listPublicCamps,
  getPublicCamp,
  listMyCampRegistrations,
} from "@/lib/camps";

/**
 * GET /api/mobile/camps            → open camps
 * GET /api/mobile/camps?slug=x     → one camp
 * GET /api/mobile/camps?mine=1     → the signed-in user's registrations
 *
 * One route rather than three: the app's camp surface is small, and this
 * keeps the client to a single fetch helper.
 */
export async function GET(request: NextRequest) {
  if (!(await areCampsEnabled())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const url = new URL(request.url);

  if (url.searchParams.get("mine")) {
    const userId = await getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ registrations: [] });
    }
    const rows = await listMyCampRegistrations(userId);
    return NextResponse.json({
      registrations: rows.map((r) => ({
        id: r.id,
        status: r.status,
        participantName: r.participantName,
        paidAmount: r.paidAmount,
        dueAmount: r.dueAmount,
        createdAt: r.createdAt.toISOString(),
        camp: {
          slug: r.camp.slug,
          name: r.camp.name,
          sport: r.camp.sport,
          startDate: r.camp.startDate.toISOString(),
          endDate: r.camp.endDate.toISOString(),
          startHour: r.camp.startHour,
          endHour: r.camp.endHour,
          daysOfWeek: r.camp.daysOfWeek,
        },
      })),
    });
  }

  const slug = url.searchParams.get("slug");
  if (slug) {
    const camp = await getPublicCamp(slug);
    if (!camp) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({
      camp: {
        ...camp,
        startDate: camp.startDate.toISOString(),
        endDate: camp.endDate.toISOString(),
        regOpenAt: camp.regOpenAt?.toISOString() ?? null,
        regCloseAt: camp.regCloseAt?.toISOString() ?? null,
      },
    });
  }

  const camps = await listPublicCamps();
  return NextResponse.json({
    camps: camps.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      sport: c.sport,
      status: c.status,
      description: c.description,
      bannerImageUrl: c.bannerImageUrl,
      startDate: c.startDate.toISOString(),
      endDate: c.endDate.toISOString(),
      daysOfWeek: c.daysOfWeek,
      startHour: c.startHour,
      endHour: c.endHour,
      ageMin: c.ageMin,
      ageMax: c.ageMax,
      coachName: c.coachName,
      capacity: c.capacity,
      fee: c.fee,
      feeMode: c.feeMode,
      advancePct: c.advancePct,
      waitlistEnabled: c.waitlistEnabled,
      seatsTaken: c._count.registrations,
      seatsLeft: Math.max(0, c.capacity - c._count.registrations),
    })),
  });
}
