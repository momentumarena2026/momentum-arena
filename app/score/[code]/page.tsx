import { ScorerConsole } from "./scorer-console";

// On-field scorer console. The unguessable code in the URL is the access
// grant (no login) — shared by the admin, revoked by regenerating it.
export default async function ScorerPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <ScorerConsole code={code.toUpperCase()} />;
}
