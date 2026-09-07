import {
  getCafeMenuOptions,
  listCafeAliases,
} from "@/actions/admin-cafe-register";
import { CafeRegisterClient } from "./register-client";

export const dynamic = "force-dynamic";

/**
 * /admin/cafe-register — the paper book, typed for you.
 *
 * The cafe records every counter sale by hand in a daily register.
 * Re-keying that into the system is the tedious part, and tedium is where
 * takings go missing. This reads the page and hands back a table to check.
 *
 * It reads; it does not decide. Every row is editable, every row says how
 * it was matched, and no order exists until a human presses the button —
 * because these lines are real money against real tills, and the value
 * here is saving the typing, not skipping the checking.
 */
export default async function AdminCafeRegisterPage() {
  const [menu, aliases] = await Promise.all([
    getCafeMenuOptions(),
    listCafeAliases(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Register → Orders</h1>
        <p className="mt-1 max-w-3xl text-zinc-400">
          Photograph a page of the daily cafe register and it comes back as a
          table you can check and correct. Whatever you correct, it remembers —
          so the shorthand your staff actually write gets understood without
          being configured.
        </p>
      </div>

      <CafeRegisterClient menu={menu} aliases={aliases} />
    </div>
  );
}
