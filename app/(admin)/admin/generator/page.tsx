import { getGenerators, getGeneratorConfig, getGeneratorDashboard } from "@/actions/generator";
import { GeneratorAdmin } from "./generator-admin";

export default async function AdminGeneratorPage() {
  const [generators, config] = await Promise.all([
    getGenerators(),
    getGeneratorConfig(),
  ]);

  // Pre-fetch dashboard for first generator (if any)
  const initialDashboard =
    generators.length > 0
      ? await getGeneratorDashboard(generators[0].id)
      : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Generator Management</h1>
        <p className="mt-1 text-zinc-400">
          Track petrol, oil changes, running hours, and costs for generators
        </p>
      </div>

      <GeneratorAdmin
        initialGenerators={JSON.parse(JSON.stringify(generators))}
        initialConfig={JSON.parse(JSON.stringify(config))}
        initialDashboard={initialDashboard ? JSON.parse(JSON.stringify(initialDashboard)) : null}
      />
    </div>
  );
}
