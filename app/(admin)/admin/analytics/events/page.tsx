import {
  listAnalyticsEvents,
  listEventNames,
  listServerActionLogs,
  listServerActionNames,
  listServerLogUsers,
} from "@/actions/admin-insights";
import { parseAnalyticsCategory } from "@/lib/server-log";
import { EventsClient } from "./events-client";
import { EventsViewTabs, ServerLogsClient } from "./server-logs-client";

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    name?: string;
    category?: string;
    userId?: string;
    sessionId?: string;
    action?: string;
    outcome?: string;
  }>;
}) {
  const sp = await searchParams;
  const view = sp.view === "server" ? "server" : "client";

  if (view === "server") {
    const filters = {
      action: sp.action,
      category: parseAnalyticsCategory(sp.category),
      userId: sp.userId,
      outcome: sp.outcome,
    };
    const [initialPage, actionNames, userOptions] = await Promise.all([
      listServerActionLogs({ ...filters, limit: 100 }),
      listServerActionNames(),
      listServerLogUsers(),
    ]);

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Events</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Server-side audit log — API routes and server actions with
            user, outcome, and request metadata. Newest first.
          </p>
        </div>

        <EventsViewTabs view="server" />

        <ServerLogsClient
          key={JSON.stringify(filters)}
          initialPage={initialPage}
          initialFilters={filters}
          actionNames={actionNames}
          userOptions={userOptions}
        />
      </div>
    );
  }

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
          Client-side event log. Filter by name / category / user / session
          to inspect a specific journey. Newest first.
        </p>
      </div>

      <EventsViewTabs view="client" />

      <EventsClient
        initialPage={initialPage}
        initialFilters={filters}
        eventNames={eventNames}
      />
    </div>
  );
}
