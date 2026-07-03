import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../../components/ui/Screen";
import { ExpenseFormBody } from "../../components/admin/ExpenseFormBody";
import type { AdminExpensesStackParamList } from "../../navigation/types";

type Rt = RouteProp<AdminExpensesStackParamList, "AdminExpenseForm">;
type Nav = NativeStackNavigationProp<
  AdminExpensesStackParamList,
  "AdminExpenseForm"
>;

/**
 * Thin full-screen host for ExpenseFormBody — GENERAL create/edit and
 * RUNNING edits navigate here (RUNNING creates use the list screen's
 * bottom sheet instead). `expenseId` param: undefined ⇒ create,
 * present ⇒ edit existing. RUNNING hides the Vendor field — running
 * costs (rent, salaries, utilities) have no vendor dimension.
 */
export function AdminExpenseFormScreen() {
  const { params } = useRoute<Rt>();
  const navigation = useNavigation<Nav>();

  return (
    <Screen padded={false}>
      <ExpenseFormBody
        module={params.module}
        showVendor={params.module !== "RUNNING"}
        expenseId={params.expenseId}
        onSaved={() => navigation.goBack()}
        onCancel={() => navigation.goBack()}
      />
    </Screen>
  );
}
