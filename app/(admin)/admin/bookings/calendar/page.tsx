import { getCalendarData } from "@/actions/admin-calendar";
import BookingCalendar from "../booking-calendar";

export default async function BookingCalendarPage() {
  const today = new Date().toISOString().split("T")[0];
  const calendarData = await getCalendarData(today);

  return <BookingCalendar initialData={calendarData} initialDate={today} />;
}
