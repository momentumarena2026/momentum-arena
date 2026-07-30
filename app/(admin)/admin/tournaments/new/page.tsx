import { TournamentWizard } from "../tournament-wizard";

export default function NewTournamentPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">New Tournament</h1>
        <p className="mt-1 text-zinc-400">
          Everything is editable later from the tournament&apos;s Settings tab.
        </p>
      </div>
      <TournamentWizard />
    </div>
  );
}
