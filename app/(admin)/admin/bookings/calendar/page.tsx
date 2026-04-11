import { getCalendarData } from "@/actions/admin-calendar";
import BookingCalendar from "../booking-calendar";
import { getTodayIST } from "@/lib/ist-date";

export default async function BookingCalendarPage() {
  const today = getTodayIST();
  const calendarData = await getCalendarData(today);

  return <BookingCalendar initialData={calendarData} initialDate={today} />;
}
