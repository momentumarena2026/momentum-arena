import { cookies } from "next/headers";

export async function isGeneratorPinVerified(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get("generator_access")?.value;
  if (!token) return false;

  try {
    const data = JSON.parse(Buffer.from(token, "base64").toString());
    if (!data.verified || !data.ts) return false;

    // Check if token is less than 24 hours old
    const age = Date.now() - data.ts;
    if (age > 24 * 60 * 60 * 1000) return false;

    return true;
  } catch {
    return false;
  }
}
