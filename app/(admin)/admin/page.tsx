import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function AdminDashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Admin Dashboard</h1>
        <p className="text-zinc-400 mt-1">
          Manage your sports facility
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-zinc-950 border-zinc-800">
          <CardHeader>
            <CardDescription className="text-zinc-400">
              Total Bookings
            </CardDescription>
            <CardTitle className="text-3xl text-white">0</CardTitle>
          </CardHeader>
        </Card>

        <Card className="bg-zinc-950 border-zinc-800">
          <CardHeader>
            <CardDescription className="text-zinc-400">
              Active Users
            </CardDescription>
            <CardTitle className="text-3xl text-white">0</CardTitle>
          </CardHeader>
        </Card>

        <Card className="bg-zinc-950 border-zinc-800">
          <CardHeader>
            <CardDescription className="text-zinc-400">
              Revenue (Today)
            </CardDescription>
            <CardTitle className="text-3xl text-white">₹0</CardTitle>
          </CardHeader>
        </Card>

        <Card className="bg-zinc-950 border-zinc-800">
          <CardHeader>
            <CardDescription className="text-zinc-400">
              Courts Available
            </CardDescription>
            <CardTitle className="text-3xl text-white">4</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="bg-zinc-950 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-white">Recent Bookings</CardTitle>
            <CardDescription className="text-zinc-400">
              Latest court reservations
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-zinc-500">No bookings yet</p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-950 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-white">Manage Courts</CardTitle>
            <CardDescription className="text-zinc-400">
              Configure courts, pricing, and availability
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-zinc-500">Coming soon</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
