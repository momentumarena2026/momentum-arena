import { useEffect, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, ChevronDown, ChevronUp, RotateCcw } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminPushApi,
  type PushTemplateVariable,
  type PushTemplateView,
  type UpdatePushTemplateInput,
} from "../../lib/admin-push";
import { AdminApiError } from "../../lib/admin-api";

// Server-enforced copy limits (actions/admin-push.ts validate()).
const TITLE_MAX = 120;
const BODY_MAX = 300;

const QUERY_KEY = ["admin-push-templates"] as const;

function showError(e: unknown) {
  Alert.alert(
    "Couldn't save",
    e instanceof AdminApiError || e instanceof Error
      ? e.message
      : "Please try again.",
  );
}

/** Replace each declared {placeholder} with its example for the preview. */
function substituteExamples(
  text: string,
  variables: PushTemplateVariable[],
): string {
  let out = text;
  for (const v of variables) {
    out = out.split(`{${v.name}}`).join(v.example);
  }
  return out;
}

/**
 * Automated push messages — mirrors the web /admin/push templates panel.
 * Every template the code can fire is listed; admins can switch one off
 * or rewrite its copy (placeholders validated server-side).
 */
export function AdminPushTemplatesScreen() {
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => adminPushApi.templates(),
  });

  // One card expanded at a time keeps the list scannable.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const templates = query.data?.templates ?? [];
  const customer = templates.filter((t) => t.audience === "customer");
  const admin = templates.filter((t) => t.audience === "admin");

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching && !query.isLoading}
            onRefresh={() => void query.refetch()}
            tintColor={colors.zinc400}
          />
        }
      >
        <Text variant="tiny" color={colors.zinc500}>
          Sent automatically when events fire (booking confirmed, order ready,
          …). Toggle one off or rewrite its copy — placeholders like{" "}
          <Text variant="tiny" color={colors.zinc400} style={styles.mono}>
            {"{name}"}
          </Text>{" "}
          are filled in at send time.
        </Text>

        {query.isLoading ? (
          <View style={styles.list}>
            {[0, 1, 2, 3].map((i) => (
              <Card key={i} style={styles.skeletonCard}>
                <Skeleton width="55%" height={16} />
                <Skeleton width="80%" height={11} />
              </Card>
            ))}
          </View>
        ) : templates.length === 0 ? (
          <Card style={styles.emptyCard}>
            <BellRing size={28} color={colors.zinc600} />
            <Text
              variant="small"
              color={colors.zinc500}
              style={{ marginTop: spacing["2"] }}
            >
              No automated templates registered.
            </Text>
          </Card>
        ) : (
          <>
            <Section
              title="Customer notifications"
              templates={customer}
              expandedKey={expandedKey}
              onToggleExpand={(k) =>
                setExpandedKey((cur) => (cur === k ? null : k))
              }
            />
            <Section
              title="Admin notifications"
              templates={admin}
              expandedKey={expandedKey}
              onToggleExpand={(k) =>
                setExpandedKey((cur) => (cur === k ? null : k))
              }
            />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function Section({
  title,
  templates,
  expandedKey,
  onToggleExpand,
}: {
  title: string;
  templates: PushTemplateView[];
  expandedKey: string | null;
  onToggleExpand: (key: string) => void;
}) {
  if (templates.length === 0) return null;
  return (
    <View>
      <Text variant="tiny" color={colors.zinc500} style={styles.section}>
        {title.toUpperCase()}
      </Text>
      <View style={styles.list}>
        {templates.map((t) => (
          <TemplateCard
            key={t.key}
            template={t}
            expanded={expandedKey === t.key}
            onToggleExpand={() => onToggleExpand(t.key)}
          />
        ))}
      </View>
    </View>
  );
}

function TemplateCard({
  template: t,
  expanded,
  onToggleExpand,
}: {
  template: PushTemplateView;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const qc = useQueryClient();

  // Local drafts of the copy; re-synced whenever the server copy changes
  // (successful save / pull-to-refresh) so "dirty" compares against truth.
  const [title, setTitle] = useState(t.title);
  const [body, setBody] = useState(t.body);
  useEffect(() => {
    setTitle(t.title);
    setBody(t.body);
  }, [t.title, t.body]);

  // POST returns the refreshed full list — write it straight into the cache.
  const setTemplates = (data: { templates: PushTemplateView[] }) =>
    qc.setQueryData(QUERY_KEY, data);

  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      adminPushApi.updateTemplate({ key: t.key, enabled }),
    onSuccess: setTemplates,
    onError: showError,
  });

  const save = useMutation({
    mutationFn: (input: UpdatePushTemplateInput) =>
      adminPushApi.updateTemplate(input),
    onSuccess: setTemplates,
    onError: showError,
  });

  const busy = toggle.isPending || save.isPending;
  const dirty = title !== t.title || body !== t.body;
  const atDefault =
    !t.isCustomized && title === t.defaultTitle && body === t.defaultBody;

  return (
    <Card style={styles.card}>
      {/* Collapsed header row — always visible, taps expand/collapse. */}
      <Pressable onPress={onToggleExpand} style={styles.headRow} hitSlop={4}>
        <View
          style={[
            styles.stateDot,
            { backgroundColor: t.enabled ? colors.emerald400 : colors.zinc600 },
          ]}
        />
        <Text
          variant="small"
          weight="600"
          color={colors.foreground}
          numberOfLines={1}
          style={{ flex: 1 }}
        >
          {t.label}
        </Text>
        {t.isCustomized ? (
          <View style={styles.customBadge}>
            <Text variant="tiny" weight="700" color={colors.warning}>
              Customized
            </Text>
          </View>
        ) : null}
        {expanded ? (
          <ChevronUp size={16} color={colors.zinc500} />
        ) : (
          <ChevronDown size={16} color={colors.zinc500} />
        )}
      </Pressable>

      {expanded ? (
        <View style={styles.bodyWrap}>
          <Text variant="tiny" color={colors.zinc500}>
            {t.trigger}
          </Text>

          {/* Enabled toggle — same Switch pattern as payment settings. */}
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text variant="small" weight="500" color={colors.foreground}>
                Enabled
              </Text>
              <Text variant="tiny" color={colors.zinc500}>
                Off = this notification is never sent.
              </Text>
            </View>
            <Switch
              value={t.enabled}
              disabled={busy}
              onValueChange={(v) => toggle.mutate(v)}
              trackColor={{ true: colors.emerald500_10, false: colors.zinc700 }}
              thumbColor={t.enabled ? colors.emerald400 : colors.zinc400}
            />
          </View>

          <Input
            label="Title"
            value={title}
            onChangeText={setTitle}
            maxLength={TITLE_MAX}
            hint={`${title.length}/${TITLE_MAX}`}
          />
          <Input
            label="Body"
            value={body}
            onChangeText={setBody}
            maxLength={BODY_MAX}
            multiline
            style={styles.bodyInput}
            hint={`${body.length}/${BODY_MAX}`}
          />

          {t.variables.length > 0 ? (
            <View style={styles.varsWrap}>
              <Text variant="tiny" color={colors.zinc500} style={styles.varsLabel}>
                VARIABLES — TAP TO INSERT
              </Text>
              <View style={styles.chipRow}>
                {t.variables.map((v) => (
                  <Pressable
                    key={v.name}
                    onPress={() => setBody((b) => `${b}{${v.name}}`)}
                    style={styles.chip}
                  >
                    <Text
                      variant="tiny"
                      weight="600"
                      color={colors.emerald400}
                      style={styles.mono}
                    >
                      {`{${v.name}}`}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {t.variables.map((v) => (
                <Text key={v.name} variant="tiny" color={colors.zinc600}>
                  <Text
                    variant="tiny"
                    color={colors.zinc400}
                    style={styles.mono}
                  >
                    {`{${v.name}}`}
                  </Text>
                  {` — ${v.description} (e.g. ${v.example})`}
                </Text>
              ))}
            </View>
          ) : null}

          {/* Live preview with example values substituted in. */}
          <View style={styles.preview}>
            <Text variant="tiny" color={colors.zinc500} style={styles.varsLabel}>
              PREVIEW
            </Text>
            <Text variant="small" weight="600" color={colors.foreground}>
              {substituteExamples(title, t.variables) || "(no title)"}
            </Text>
            <Text variant="tiny" color={colors.zinc400}>
              {substituteExamples(body, t.variables) || "(no body)"}
            </Text>
          </View>

          <Button
            label="Save"
            onPress={() =>
              save.mutate({ key: t.key, title: title.trim(), body: body.trim() })
            }
            disabled={!dirty || busy}
            loading={save.isPending}
            fullWidth
          />
          <Pressable
            onPress={() => {
              setTitle(t.defaultTitle);
              setBody(t.defaultBody);
              save.mutate({
                key: t.key,
                title: t.defaultTitle,
                body: t.defaultBody,
              });
            }}
            disabled={busy || atDefault}
            style={[styles.resetBtn, (busy || atDefault) && { opacity: 0.4 }]}
            hitSlop={6}
          >
            <RotateCcw size={13} color={colors.zinc400} />
            <Text variant="tiny" weight="600" color={colors.zinc400}>
              Reset to default
            </Text>
          </Pressable>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["4"],
    paddingBottom: spacing["10"],
    gap: spacing["3"],
  },
  section: {
    letterSpacing: 1.2,
    fontWeight: "700",
    marginTop: spacing["2"],
    marginBottom: spacing["2"],
  },
  list: { gap: spacing["3"] },
  card: { padding: spacing["4"], gap: spacing["3"] },
  headRow: { flexDirection: "row", alignItems: "center", gap: spacing["2"] },
  stateDot: { width: 8, height: 8, borderRadius: 999 },
  customBadge: {
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.warningSoft,
  },
  bodyWrap: { gap: spacing["3"] },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: spacing["3"] },
  bodyInput: {
    minHeight: 72,
    textAlignVertical: "top",
    paddingTop: spacing["2"],
  },
  varsWrap: { gap: spacing["1.5"] },
  varsLabel: { letterSpacing: 1.2, fontWeight: "700" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing["2"] },
  chip: {
    paddingHorizontal: spacing["2.5"],
    paddingVertical: spacing["1.5"],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_05,
  },
  mono: { fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }) },
  preview: {
    gap: spacing["1"],
    padding: spacing["3"],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  resetBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["1.5"],
    paddingVertical: spacing["1"],
  },
  skeletonCard: { padding: spacing["4"], gap: spacing["2"] },
  emptyCard: { alignItems: "center", paddingVertical: spacing["10"] },
});
