import { getInfoBarConfig } from "@/actions/admin-arena-settings";
import { InfoBarEditor } from "./info-bar-editor";

/**
 * Web & App Config → Information Bar. The strip at the very top of the
 * home page (web + app) — by default the new-user ₹100 offer, but the
 * copy is whatever the admin wants to announce.
 */
export default async function AdminInfoBarPage() {
  const infoBar = await getInfoBarConfig();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Information Bar</h1>
        <p className="mt-1 text-zinc-400">
          The announcement strip at the very top of the home page — web and
          app. Leave the text empty to use the default new-user offer.
        </p>
      </div>
      <InfoBarEditor
        initialEnabled={infoBar.enabled}
        initialText={infoBar.text}
        defaultText={infoBar.defaultText}
      />
    </div>
  );
}
