import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Check,
  IndianRupee,
  Save,
  Tag,
  Trash2,
  XCircle,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminExpensesApi,
  type AdminExpenseInput,
  type ExpenseOptionField,
} from "../../lib/admin-expenses";
import { AdminApiError } from "../../lib/admin-api";
import { getTodayIST } from "../../lib/ist-date";
import type { AdminExpensesStackParamList } from "../../navigation/types";

type Rt = RouteProp<AdminExpensesStackParamList, "AdminExpenseForm">;
type Nav = NativeStackNavigationProp<
  AdminExpensesStackParamList,
  "AdminExpenseForm"
>;

/**
 * Single screen for both create and edit. Distinguishes via the
 * `expenseId` param — undefined ⇒ create, present ⇒ edit existing.
 *
 * Form fields mirror the web /admin/expenses create modal:
 *   date, amount, description, paymentType, doneBy, toName, vendor,
 *   spentType, note. The five string fields use chip pickers seeded
 *   from the active ExpenseOption rows on the server, with a "custom"
 *   text input fallback for one-off labels.
 *
 * Edit mode also surfaces a Delete button — it confirms via Alert
 * because expense rows cascade-delete their audit history.
 */
export function AdminExpenseFormScreen() {
  const { params } = useRoute<Rt>();
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();
  const isEdit = !!params.expenseId;

  // Detail query (skipped for create flow). Seeds the form on mount.
  const detail = useQuery({
    queryKey: ["admin-expense", params.expenseId],
    queryFn: () => adminExpensesApi.detail(params.expenseId!),
    enabled: isEdit,
  });

  const optionsQuery = useQuery({
    queryKey: ["admin-expense-options"],
    queryFn: () => adminExpensesApi.options(),
  });

  const [date, setDate] = useState<string>(getTodayIST());
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [paymentType, setPaymentType] = useState("");
  const [doneBy, setDoneBy] = useState("");
  const [toName, setToName] = useState("");
  const [vendor, setVendor] = useState("");
  const [spentType, setSpentType] = useState("");
  const [note, setNote] = useState("");
  const [editNote, setEditNote] = useState("");
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!isEdit) {
      setSeeded(true);
      return;
    }
    if (!detail.data || seeded) return;
    const e = detail.data.expense;
    setDate(e.date.slice(0, 10));
    setAmount(String(e.amount));
    setDescription(e.description);
    setPaymentType(e.paymentType);
    setDoneBy(e.doneBy);
    setToName(e.toName);
    setVendor(e.vendor);
    setSpentType(e.spentType);
    setNote(e.note ?? "");
    setSeeded(true);
  }, [detail.data, isEdit, seeded]);

  const submit = useMutation({
    mutationFn: () => {
      const body: AdminExpenseInput = {
        date,
        amount: Math.trunc(parseFloat(amount) || 0),
        description: description.trim(),
        paymentType: paymentType.trim(),
        doneBy: doneBy.trim(),
        toName: toName.trim(),
        vendor: vendor.trim(),
        spentType: spentType.trim(),
        note: note.trim() || null,
      };
      return isEdit
        ? adminExpensesApi.update(params.expenseId!, {
            ...body,
            editNote: editNote.trim() || undefined,
          })
        : adminExpensesApi.create(body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-expenses"] });
      void qc.invalidateQueries({ queryKey: ["admin-expense", params.expenseId] });
      void qc.invalidateQueries({ queryKey: ["admin-expense-analytics"] });
      Alert.alert(
        isEdit ? "Saved" : "Added",
        isEdit ? "Expense updated." : "Expense recorded.",
      );
      navigation.goBack();
    },
    onError: (err) =>
      Alert.alert(
        "Couldn't save",
        err instanceof AdminApiError ? err.message : "Try again.",
      ),
  });

  const remove = useMutation({
    mutationFn: () => adminExpensesApi.remove(params.expenseId!),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-expenses"] });
      void qc.invalidateQueries({ queryKey: ["admin-expense-analytics"] });
      navigation.goBack();
    },
    onError: (err) =>
      Alert.alert(
        "Couldn't delete",
        err instanceof AdminApiError ? err.message : "Try again.",
      ),
  });

  const opts = optionsQuery.data?.options;
  const canSubmit = useMemo(() => {
    const a = parseFloat(amount);
    return (
      !!date &&
      Number.isFinite(a) &&
      a > 0 &&
      description.trim().length > 0 &&
      paymentType.trim().length > 0 &&
      doneBy.trim().length > 0 &&
      toName.trim().length > 0 &&
      vendor.trim().length > 0 &&
      spentType.trim().length > 0
    );
  }, [date, amount, description, paymentType, doneBy, toName, vendor, spentType]);

  if (isEdit && (detail.isLoading || !seeded)) {
    return <FormSkeleton />;
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text variant="title">{isEdit ? "Edit expense" : "Add expense"}</Text>
        <Text variant="small" color={colors.zinc500}>
          {isEdit
            ? "Update any field — every change writes a row in the audit log."
            : "Record a new expense. Picker fields seed from your existing labels; type into the input below to use a fresh value."}
        </Text>

        {/* Amount + Date */}
        <View style={styles.row2}>
          <Field
            label="Date"
            icon={<CalendarDays size={14} color={colors.zinc500} />}
          >
            <TextInput
              value={date}
              onChangeText={setDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.zinc600}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
          </Field>
          <Field
            label="Amount (₹)"
            icon={<IndianRupee size={14} color={colors.zinc500} />}
          >
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="0"
              placeholderTextColor={colors.zinc600}
              keyboardType="numeric"
              style={styles.input}
            />
          </Field>
        </View>

        <Field label="Description">
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Brief description"
            placeholderTextColor={colors.zinc600}
            style={styles.input}
            maxLength={500}
          />
        </Field>

        <ChipField
          label="Spent type"
          tag="SPENT_TYPE"
          options={opts?.SPENT_TYPE}
          value={spentType}
          onChange={setSpentType}
        />
        <ChipField
          label="Paid to"
          tag="TO_NAME"
          options={opts?.TO_NAME}
          value={toName}
          onChange={setToName}
        />
        <ChipField
          label="Vendor"
          tag="VENDOR"
          options={opts?.VENDOR}
          value={vendor}
          onChange={setVendor}
        />
        <ChipField
          label="Payment type"
          tag="PAYMENT_TYPE"
          options={opts?.PAYMENT_TYPE}
          value={paymentType}
          onChange={setPaymentType}
        />
        <ChipField
          label="Done by"
          tag="DONE_BY"
          options={opts?.DONE_BY}
          value={doneBy}
          onChange={setDoneBy}
        />

        <Field label="Note (optional)">
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Anything worth remembering later"
            placeholderTextColor={colors.zinc600}
            style={[styles.input, styles.textarea]}
            multiline
            maxLength={1000}
          />
        </Field>

        {isEdit ? (
          <Field label="Why this edit? (optional)">
            <TextInput
              value={editNote}
              onChangeText={setEditNote}
              placeholder="Brief audit note"
              placeholderTextColor={colors.zinc600}
              style={styles.input}
              maxLength={1000}
            />
          </Field>
        ) : null}

        {/* Actions */}
        <View style={styles.actionRow}>
          <Pressable
            onPress={() => navigation.goBack()}
            style={[styles.actionBtn, styles.actionNeutral]}
          >
            <XCircle size={14} color={colors.zinc300} />
            <Text variant="small" color={colors.zinc300} weight="600">
              Cancel
            </Text>
          </Pressable>
          <Pressable
            onPress={() => submit.mutate()}
            disabled={!canSubmit || submit.isPending}
            style={[
              styles.actionBtn,
              styles.actionPrimary,
              (!canSubmit || submit.isPending) && { opacity: 0.5 },
            ]}
          >
            <Save size={14} color={colors.emerald400} />
            <Text variant="small" color={colors.emerald400} weight="600">
              {submit.isPending
                ? "Saving…"
                : isEdit
                  ? "Save changes"
                  : "Add expense"}
            </Text>
          </Pressable>
        </View>

        {isEdit ? (
          <Pressable
            onPress={() =>
              Alert.alert(
                "Delete expense?",
                "This will remove the expense and its audit history.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: () => remove.mutate(),
                  },
                ],
              )
            }
            disabled={remove.isPending}
            style={({ pressed }) => [
              styles.deleteBtn,
              remove.isPending && { opacity: 0.5 },
              pressed && { opacity: 0.6 },
            ]}
          >
            <Trash2 size={14} color={colors.destructive} />
            <Text variant="small" color={colors.destructive} weight="600">
              {remove.isPending ? "Deleting…" : "Delete this expense"}
            </Text>
          </Pressable>
        ) : null}

        {/* Audit history (edit mode only) */}
        {isEdit && detail.data?.expense.editHistory?.length ? (
          <View style={styles.auditCard}>
            <View style={styles.auditHead}>
              <Tag size={12} color={colors.zinc500} />
              <Text variant="tiny" color={colors.zinc500} style={styles.auditTitle}>
                AUDIT ({detail.data.expense.editHistory.length})
              </Text>
            </View>
            {detail.data.expense.editHistory.slice(0, 5).map((h) => (
              <View key={h.id} style={styles.auditRow}>
                <Text variant="tiny" color={colors.zinc400}>
                  {h.editType.toLowerCase()} · {h.adminUsername ?? "—"}
                </Text>
                <Text variant="tiny" color={colors.zinc500}>
                  {new Date(h.createdAt).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    timeZone: "Asia/Kolkata",
                  })}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Field({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: spacing["1.5"] }}>
      <View style={styles.fieldHead}>
        {icon}
        <Text variant="tiny" color={colors.zinc500} style={styles.fieldLabel}>
          {label.toUpperCase()}
        </Text>
      </View>
      {children}
    </View>
  );
}

function ChipField({
  label,
  tag,
  options,
  value,
  onChange,
}: {
  label: string;
  tag: ExpenseOptionField;
  options?: string[];
  value: string;
  onChange: (next: string) => void;
}) {
  const known = options ?? [];
  const isCustom = !!value && !known.includes(value);
  return (
    <Field label={label}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
        keyboardShouldPersistTaps="handled"
      >
        {known.length === 0 ? (
          <Text variant="tiny" color={colors.zinc600}>
            No saved {tag.toLowerCase()} options yet — type below.
          </Text>
        ) : (
          known.map((opt) => {
            const active = value === opt;
            return (
              <Pressable
                key={opt}
                onPress={() => onChange(opt)}
                style={[styles.chip, active && styles.chipActive]}
              >
                {active ? <Check size={12} color={colors.yellow400} /> : null}
                <Text
                  variant="tiny"
                  color={active ? colors.yellow400 : colors.zinc300}
                  weight="600"
                >
                  {opt}
                </Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>
      <TextInput
        value={isCustom || known.length === 0 ? value : ""}
        onChangeText={onChange}
        placeholder={`Custom ${label.toLowerCase()}`}
        placeholderTextColor={colors.zinc600}
        style={styles.input}
        autoCapitalize="words"
      />
    </Field>
  );
}

function FormSkeleton() {
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Skeleton width="60%" height={28} />
        <Skeleton width="100%" height={11} />
        <View style={styles.row2}>
          <Skeleton width="48%" height={48} rounded="md" />
          <Skeleton width="48%" height={48} rounded="md" />
        </View>
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} width="100%" height={56} rounded="md" />
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["8"],
    gap: spacing["3"],
  },
  row2: {
    flexDirection: "row",
    gap: spacing["2"],
  },
  fieldHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
  },
  fieldLabel: { letterSpacing: 1.5, fontWeight: "700" },
  input: {
    borderWidth: 1,
    borderColor: colors.zinc700,
    borderRadius: 8,
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2.5"],
    color: colors.foreground,
    backgroundColor: colors.background,
    fontSize: 14,
  },
  textarea: { minHeight: 60, textAlignVertical: "top" },
  chipRow: { flexDirection: "row", gap: spacing["1.5"], paddingVertical: 2 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["1.5"],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  chipActive: {
    borderColor: "rgba(250, 204, 21, 0.40)",
    backgroundColor: "rgba(250, 204, 21, 0.10)",
  },
  actionRow: {
    flexDirection: "row",
    gap: spacing["2"],
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["1.5"],
    paddingVertical: spacing["3"],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  actionNeutral: {
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  actionPrimary: {
    borderColor: "rgba(34, 197, 94, 0.30)",
    backgroundColor: "rgba(34, 197, 94, 0.10)",
  },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["1.5"],
    paddingVertical: spacing["3"],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.30)",
    backgroundColor: "rgba(239, 68, 68, 0.06)",
  },
  auditCard: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["3"],
    gap: spacing["1.5"],
  },
  auditHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
  },
  auditTitle: { letterSpacing: 1.5, fontWeight: "700" },
  auditRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
});
