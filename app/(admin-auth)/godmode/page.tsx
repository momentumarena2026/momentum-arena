import { GodmodeLoginForm } from "./login-form";

export default async function GodmodePage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  const safeCallback = callbackUrl && callbackUrl.startsWith("/") ? callbackUrl : "/admin";

  return <GodmodeLoginForm callbackUrl={safeCallback} />;
}
