import { ScrollView, StyleSheet, View } from "react-native";
import { Globe, Smartphone, Store, Hash } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { colors, spacing } from "../../theme";

/**
 * READ-ONLY reference summary of the code → live pipeline, condensed from the
 * web /admin/release-flow documentation page. Hardcoded reference content —
 * keep in sync with the web page when the real pipeline changes.
 */

type Tone = "dev" | "prod";

interface Lane {
  heading: string;
  tone: Tone;
  steps: string[];
}

interface FlowSection {
  icon: "globe" | "phone" | "store";
  title: string;
  note: string;
  lanes: [Lane, Lane];
}

const SECTIONS: FlowSection[] = [
  {
    icon: "globe",
    title: "Website (booking site)",
    note: "Every push deploys itself via Vercel — no store, live in ~2 min.",
    lanes: [
      {
        heading: "DEV → development.momentumarena.com",
        tone: "dev",
        steps: [
          "Push code to development (manual · developer).",
          "Vercel rebuilds the site automatically.",
          "Migrations run + test data reseeded (Vercel + GitHub Actions).",
          "Live on the test site instantly.",
        ],
      },
      {
        heading: "PROD → www.momentumarena.com",
        tone: "prod",
        steps: [
          "Merge to main, usually via reviewed PR (manual · developer).",
          "Vercel rebuilds the production site.",
          "Migrations run on the real database.",
          "Live for all users instantly.",
        ],
      },
    ],
  },
  {
    icon: "phone",
    title: "Mobile — small updates (OTA, JS only)",
    note: "Screens/logic only. Skips the stores — reaches phones in minutes.",
    lanes: [
      {
        heading: "DEV — channel “development”",
        tone: "dev",
        steps: [
          "Push to development (manual · developer).",
          "ota-publish.yml robot wakes on app-code change.",
          "Native-change check: native → store build; JS only → continue.",
          "Robot bundles, signs, uploads, saves a DRAFT (nothing live yet).",
          "Admin rolls out from OTA Updates, e.g. 10% → 100% (manual).",
          "App fetches on next open; applies on the following open.",
        ],
      },
      {
        heading: "PROD — channel “production”",
        tone: "prod",
        steps: [
          "Merge to main (manual · developer).",
          "ota-publish.yml robot runs on app-code change.",
          "Same native-change fingerprint check.",
          "Builds + auto-canaries to ~20% of users automatically.",
          "Admin promotes to 100% once healthy; rollback lives here too.",
          "App fetches on next open — canary first, rest after promotion.",
        ],
      },
    ],
  },
  {
    icon: "store",
    title: "Mobile — big updates (native, needs stores)",
    note: "New library/permission/SDK or runtime bump. Apple/Google review.",
    lanes: [
      {
        heading: "DEV → TestFlight + Play Internal",
        tone: "dev",
        steps: [
          "Push a native change to development (manual · developer).",
          "CI detects it's native (fingerprint differs from baseline).",
          "Native build auto-fires → TestFlight / Play internal.",
          "Store scans the binary (Apple / Google).",
          "OTA baseline + version gate refreshed automatically.",
          "Testers install from TestFlight / Play.",
        ],
      },
      {
        heading: "PROD → App Store + Play production",
        tone: "prod",
        steps: [
          "Manually run the iOS/Android workflow with track = production.",
          "Builds + uploads to App Store Connect / Play production.",
          "OTA baseline + version gate refreshed automatically.",
          "Submit for review (manual · developer).",
          "Store review: automated checks + human reviewer (hrs–~2 days).",
          "Approve & release; optionally force old apps via min build.",
        ],
      },
    ],
  },
];

const VERSIONS: { key: string; example: string; auto: boolean; what: string }[] =
  [
    {
      key: "App version",
      example: "1.0.0",
      auto: false,
      what: "Human-facing version. Bumped for meaningful releases.",
    },
    {
      key: "Native build #",
      example: "29707758",
      auto: true,
      what: "Binary ID on the store — what the Version Gate compares.",
    },
    {
      key: "OTA #",
      example: "7",
      auto: true,
      what: "Which OTA JS bundle the app has loaded (+1 per publish).",
    },
    {
      key: "Runtime version",
      example: "2",
      auto: false,
      what: "Compatibility key — an OTA only installs on a matching runtime.",
    },
  ];

const ICONS = {
  globe: Globe,
  phone: Smartphone,
  store: Store,
} as const;

function LaneCard({ lane }: { lane: Lane }) {
  return (
    <Card style={styles.laneCard}>
      <Badge
        label={lane.heading}
        tone={lane.tone === "dev" ? "primary" : "destructive"}
      />
      <View style={styles.steps}>
        {lane.steps.map((s, i) => (
          <View key={i} style={styles.stepRow}>
            <View style={styles.stepNum}>
              <Text variant="tiny" weight="700" color={colors.zinc400}>
                {i + 1}
              </Text>
            </View>
            <Text
              variant="small"
              color={colors.zinc300}
              style={styles.stepText}
            >
              {s}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

export function AdminReleaseFlowScreen() {
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text variant="title" weight="700" color={colors.foreground}>
          Release Flow
        </Text>
        <Text variant="small" color={colors.zinc400}>
          How code goes from a push to live — the test world (development) and
          the real world (main / production) side by side. Reference summary;
          full detail lives on the web admin.
        </Text>

        <Card style={styles.startCard}>
          <Text variant="small" color={colors.zinc300}>
            <Text variant="small" weight="700" color={colors.foreground}>
              START (same for everything):{" "}
            </Text>
            a developer writes code and pushes to GitHub. The branch decides the
            world — development = test, main = production.
          </Text>
        </Card>

        {SECTIONS.map((section) => {
          const Icon = ICONS[section.icon];
          return (
            <View key={section.title} style={styles.section}>
              <View style={styles.sectionHead}>
                <Icon size={18} color={colors.foreground} />
                <Text variant="bodyStrong" color={colors.foreground}>
                  {section.title}
                </Text>
              </View>
              <Text variant="tiny" color={colors.zinc500}>
                {section.note}
              </Text>
              {section.lanes.map((lane) => (
                <LaneCard key={lane.heading} lane={lane} />
              ))}
            </View>
          );
        })}

        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Hash size={18} color={colors.foreground} />
            <Text variant="bodyStrong" color={colors.foreground}>
              Version numbers — what each means
            </Text>
          </View>
          {VERSIONS.map((v) => (
            <Card key={v.key} style={styles.versionCard}>
              <View style={styles.versionHead}>
                <Text variant="small" weight="600" color={colors.foreground}>
                  {v.key}
                </Text>
                <Badge
                  label={v.auto ? "automatic" : "manual"}
                  tone={v.auto ? "success" : "warning"}
                />
              </View>
              <Text variant="bodyStrong" color={colors.foreground}>
                {v.example}
              </Text>
              <Text variant="tiny" color={colors.zinc400}>
                {v.what}
              </Text>
            </Card>
          ))}
          <Text variant="tiny" color={colors.zinc500} style={{ marginTop: spacing["1"] }}>
            In the app they show as: 1.0.0 · build 29707758 · OTA 7 · prod.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["4"],
    paddingBottom: spacing["10"],
    gap: spacing["3"],
  },
  startCard: { padding: spacing["4"] },
  section: { gap: spacing["2"], marginTop: spacing["3"] },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  laneCard: { padding: spacing["4"], gap: spacing["3"] },
  steps: { gap: spacing["2"] },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing["2"],
  },
  stepNum: {
    width: 20,
    height: 20,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    backgroundColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  stepText: { flex: 1 },
  versionCard: { padding: spacing["4"], gap: spacing["1"] },
  versionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
