import { auth } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function DashboardPage() {
  const session = await auth();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Dashboard</h1>
        <p className="text-zinc-400 mt-1">
          Welcome back, {session?.user?.name || "Player"}!
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card className="bg-zinc-950 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-white">My Bookings</CardTitle>
            <CardDescription className="text-zinc-400">
              Your upcoming court reservations
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-zinc-500">No upcoming bookings</p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-950 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-white">Book a Court</CardTitle>
            <CardDescription className="text-zinc-400">
              Reserve your spot for Cricket, Football, Pickleball, or Badminton
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-zinc-500">Booking coming soon</p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-950 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-white">Booking History</CardTitle>
            <CardDescription className="text-zinc-400">
              View your past bookings and receipts
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-zinc-500">No past bookings</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
