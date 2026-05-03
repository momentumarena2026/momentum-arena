import { listAnalyticsEvents, listEventNames } from "@/actions/admin-insights";
import { EventsClient } from "./events-client";

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{
    name?: string;
    category?: string;
    userId?: string;
    sessionId?: string;
  }>;
}) {
  const sp = await searchParams;
  const filters = {
    name: sp.name,
    category: sp.category,
    userId: sp.userId,
    sessionId: sp.sessionId,
  };
  const [initialPage, eventNames] = await Promise.all([
    listAnalyticsEvents({ ...filters, limit: 100 }),
    listEventNames(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Events</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Live raw event log. Filter by name / category / user / session
          to inspect a specific journey. Newest first.
        </p>
      </div>

      <EventsClient
        initialPage={initialPage}
        initialFilters={filters}
        eventNames={eventNames}
      />
    </div>
  );
}
