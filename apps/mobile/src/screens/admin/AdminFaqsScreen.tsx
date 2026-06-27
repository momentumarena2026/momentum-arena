import { useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HelpCircle, Plus, Trash2, X } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminFaqsApi,
  type AdminFaq,
  type CreateFaqInput,
  type UpdateFaqInput,
} from "../../lib/admin-faqs";
import { AdminApiError } from "../../lib/admin-api";

// Mirrors FAQ_CATEGORIES in web lib/faq-data.ts
const CATEGORIES: { id: string; label: string }[] = [
  { id: "facility", label: "Facility" },
  { id: "booking", label: "Booking" },
  { id: "pricing", label: "Pricing" },
  { id: "payment", label: "Payment" },
  { id: "cancellation", label: "Cancellation" },
  { id: "sports", label: "Sports" },
  { id: "hours", label: "Timing" },
  { id: "location", label: "Location" },
];

function categoryLabel(id: string): string {
  return CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

export function AdminFaqsScreen() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["admin", "faqs"],
    queryFn: () => adminFaqsApi.list(),
  });

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminFaq | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [keywords, setKeywords] = useState("");
  const [category, setCategory] = useState("facility");
  const [sortOrder, setSortOrder] = useState("0");
  const [err, setErr] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setQuestion("");
    setAnswer("");
    setKeywords("");
    setCategory("facility");
    setSortOrder("0");
    setErr(null);
    setFormOpen(true);
  }

  function openEdit(f: AdminFaq) {
    setEditing(f);
    setQuestion(f.question);
    setAnswer(f.answer);
    setKeywords(f.keywords.join(", "));
    setCategory(f.category);
    setSortOrder(String(f.sortOrder));
    setErr(null);
    setFormOpen(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      const q = question.trim();
      const a = answer.trim();
      if (!q) throw new Error("Question is required");
      if (!a) throw new Error("Answer is required");
      const kw = keywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
      const common = {
        question: q,
        answer: a,
        keywords: kw,
        category,
        sortOrder: Number(sortOrder) || 0,
      };
      if (editing) {
        await adminFaqsApi.update(editing.id, common satisfies UpdateFaqInput);
      } else {
        await adminFaqsApi.create(common satisfies CreateFaqInput);
      }
    },
    onSuccess: () => {
      setFormOpen(false);
      void qc.invalidateQueries({ queryKey: ["admin", "faqs"] });
    },
    onError: (e) =>
      setErr(
        e instanceof AdminApiError || e instanceof Error ? e.message : "Failed",
      ),
  });

  const toggle = useMutation({
    mutationFn: (f: AdminFaq) =>
      adminFaqsApi.update(f.id, { isActive: !f.isActive }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "faqs"] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminFaqsApi.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "faqs"] }),
  });

  const faqs = list.data?.faqs ?? [];

  // Group by category, preserving the category order from the data
  const grouped = faqs.reduce<Record<string, AdminFaq[]>>((acc, f) => {
    (acc[f.category] ??= []).push(f);
    return acc;
  }, {});

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching && !list.isLoading}
            onRefresh={() => void list.refetch()}
            tintColor={colors.zinc400}
          />
        }
      >
        <View style={styles.topRow}>
          <Text variant="small" color={colors.zinc400}>
            {faqs.length} {faqs.length === 1 ? "entry" : "entries"}
          </Text>
          <Button
            label="New FAQ"
            onPress={openCreate}
            leadingIcon={<Plus size={16} color={colors.primaryForeground} />}
          />
        </View>

        {list.isLoading ? (
          <View style={styles.list}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.skeleton}>
                <Skeleton width="80%" height={18} />
                <Skeleton width="60%" height={12} />
              </View>
            ))}
          </View>
        ) : faqs.length === 0 ? (
          <View style={styles.empty}>
            <HelpCircle size={34} color={colors.zinc600} />
            <Text
              variant="small"
              color={colors.zinc500}
              style={{ marginTop: spacing["2"] }}
            >
              No FAQs yet.
            </Text>
          </View>
        ) : (
          Object.entries(grouped).map(([cat, items]) => (
            <View key={cat} style={styles.group}>
              <Text variant="tiny" color={colors.zinc500} style={styles.groupLabel}>
                {categoryLabel(cat).toUpperCase()}
              </Text>
              <View style={styles.list}>
                {items.map((f) => (
                  <Card key={f.id} style={styles.faqCard}>
                    <View style={styles.faqHead}>
                      <Pressable onPress={() => openEdit(f)} style={{ flex: 1 }}>
                        <Text variant="bodyStrong" color={colors.foreground}>
                          {f.question}
                        </Text>
                        <Text
                          variant="small"
                          color={colors.zinc400}
                          style={{ marginTop: 2 }}
                          numberOfLines={2}
                        >
                          {f.answer}
                        </Text>
                        <Text
                          variant="tiny"
                          color={colors.zinc600}
                          style={{ marginTop: 4 }}
                        >
                          #{f.sortOrder}
                          {f.keywords.length > 0
                            ? ` · ${f.keywords.join(", ")}`
                            : ""}
                        </Text>
                      </Pressable>
                      <View style={styles.faqActions}>
                        <Switch
                          value={f.isActive}
                          onValueChange={() => toggle.mutate(f)}
                          trackColor={{
                            true: colors.emerald500_10,
                            false: colors.zinc700,
                          }}
                          thumbColor={f.isActive ? colors.emerald400 : colors.zinc400}
                        />
                        <Pressable
                          hitSlop={8}
                          onPress={() =>
                            Alert.alert(
                              "Delete FAQ?",
                              "This permanently removes the FAQ.",
                              [
                                { text: "Cancel", style: "cancel" },
                                {
                                  text: "Delete",
                                  style: "destructive",
                                  onPress: () => remove.mutate(f.id),
                                },
                              ],
                            )
                          }
                        >
                          <Trash2 size={16} color={colors.destructive} />
                        </Pressable>
                      </View>
                    </View>
                  </Card>
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* Create / edit modal */}
      <Modal
        visible={formOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setFormOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text variant="title" weight="700">
                {editing ? "Edit FAQ" : "New FAQ"}
              </Text>
              <Pressable onPress={() => setFormOpen(false)} hitSlop={8}>
                <X size={22} color={colors.zinc400} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.modalBody}>
              <Input
                label="Question"
                placeholder="What time do you open?"
                value={question}
                onChangeText={setQuestion}
              />
              <Input
                label="Answer"
                placeholder="We open at 6 AM…"
                value={answer}
                onChangeText={setAnswer}
                multiline
                numberOfLines={4}
                style={styles.answerInput}
              />
              <Input
                label="Keywords (comma-separated)"
                placeholder="timing, open, hours"
                autoCapitalize="none"
                value={keywords}
                onChangeText={setKeywords}
              />

              <Text variant="tiny" color={colors.zinc500} style={styles.catLabel}>
                CATEGORY
              </Text>
              <View style={styles.catRow}>
                {CATEGORIES.map((c) => {
                  const on = category === c.id;
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => setCategory(c.id)}
                      style={[styles.catChip, on && styles.catChipActive]}
                    >
                      <Text
                        variant="tiny"
                        weight="600"
                        color={on ? colors.emerald400 : colors.zinc400}
                      >
                        {c.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Input
                label="Sort order"
                keyboardType="numeric"
                value={sortOrder}
                onChangeText={setSortOrder}
              />

              {err ? (
                <Text
                  variant="small"
                  color={colors.destructive}
                  style={{ marginTop: spacing["2"] }}
                >
                  {err}
                </Text>
              ) : null}
            </ScrollView>
            <View style={styles.modalFooter}>
              <Button
                label={editing ? "Save changes" : "Create FAQ"}
                onPress={() => save.mutate()}
                loading={save.isPending}
                fullWidth
                size="lg"
              />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["4"],
    paddingBottom: spacing["10"],
    gap: spacing["4"],
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  group: { gap: spacing["2"] },
  groupLabel: { letterSpacing: 1.2, fontWeight: "700" },
  list: { gap: spacing["3"] },
  faqCard: { padding: spacing["4"] },
  faqHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing["3"] },
  faqActions: { alignItems: "center", gap: spacing["2"] },
  skeleton: {
    padding: spacing["4"],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    gap: spacing["2"],
  },
  empty: { alignItems: "center", paddingVertical: spacing["12"] },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: "90%",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  modalHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing["5"],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  modalBody: { padding: spacing["5"], gap: spacing["3"] },
  modalFooter: {
    padding: spacing["5"],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  answerInput: { minHeight: 96, textAlignVertical: "top" },
  catLabel: { letterSpacing: 1.2, fontWeight: "700", marginTop: spacing["1"] },
  catRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing["2"] },
  catChip: {
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.zinc700,
  },
  catChipActive: {
    borderColor: colors.emerald400,
    backgroundColor: colors.emerald500_10,
  },
});
