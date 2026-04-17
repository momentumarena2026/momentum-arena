import { redirect } from "next/navigation";

// Legacy path-based URL. Kept as a 307 redirect so SMS / email links that
// were already sent before we switched to the DLT-whitelistable query-string
// form (/book/confirmation?id=<bookingId>) continue to work. All new links
// from the codebase go directly to the query-string route.
export default async function LegacyConfirmationRedirect({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  redirect(`/book/confirmation?id=${encodeURIComponent(bookingId)}`);
}
