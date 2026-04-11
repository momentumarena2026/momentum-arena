import { getCalendarData } from "@/actions/admin-calendar";
import { CalendarView } from "./calendar-view";
import { getTodayIST } from "@/lib/ist-date";

export default async function AdminCalendarPage() {
  const today = getTodayIST();
  const initialData = await getCalendarData(today);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Booking Calendar</h1>
        <p className="mt-1 text-zinc-400">
          Visual overview of all court bookings and availability
        </p>
      </div>

      <CalendarView initialDate={today} initialData={initialData} />
    </div>
  );
}
