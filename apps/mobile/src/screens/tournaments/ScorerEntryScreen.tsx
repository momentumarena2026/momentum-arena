import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ActivityIndicator } from "react-native";
import { Radio, ChevronRight, X } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { colors, radius } from "../../theme";
import { fetchScorerBoot } from "../../lib/tournaments";
import { recentScorerCodes, rememberScorerCode, forgetScorerCode } from "../../lib/scorer-codes";
import type { RootStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** Where an on-field scorer signs in — with the tournament's scorer code,
 *  not an account. The code is validated by actually booting the console,
 *  so a wrong code fails here rather than on an empty screen. */
export function ScorerEntryScreen() {
  const navigation = useNavigation<Nav>();
  const [code, setCode] = useState("");
  const [recent, setRecent] = useState(() => recentScorerCodes());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async (raw: string) => {
    const clean = raw.trim().toUpperCase();
    if (clean.length < 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const boot = await fetchScorerBoot(clean);
      rememberScorerCode(clean, boot.tournament.name);
      setRecent(recentScorerCodes());
      setCode("");
      navigation.navigate("ScorerConsole", { code: clean });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't open that code";
      setError(
        msg.includes("429") || msg.toLowerCase().includes("too many")
          ? "Too many attempts — wait a minute and try again."
          : "That code isn't valid. Check it with the tournament admin."
      );
    } finally {
      setBusy(false);
    }
  };

  const drop = (c: string) => {
    forgetScorerCode(c);
    setRecent(recentScorerCodes());
  };

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <Radio size={26} color="#f87171" />
            <Text style={styles.h1}>Scorer Console</Text>
            <Text style={styles.sub}>
              Enter the scorer code for your tournament. The admin shares it with you — you don&apos;t
              need an account to score.
            </Text>
          </View>

          <TextInput
            style={styles.codeInput}
            placeholder="ABCD2345XY"
            placeholderTextColor={colors.zinc600}
            value={code}
            onChangeText={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={12}
            returnKeyType="go"
            onSubmitEditing={() => open(code)}
          />

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            onPress={() => open(code)}
            disabled={busy || code.trim().length < 6}
            style={[styles.primaryBtn, (busy || code.trim().length < 6) && { opacity: 0.4 }]}
          >
            {busy ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.primaryText}>Open console</Text>
            )}
          </Pressable>

          {recent.length > 0 && (
            <View style={{ marginTop: 8 }}>
              <Text style={styles.section}>Recent</Text>
              {recent.map((r) => (
                <View key={r.code} style={styles.recentRow}>
                  <Pressable style={styles.recentMain} onPress={() => open(r.code)} disabled={busy}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.recentName} numberOfLines={1}>
                        {r.name || "Tournament"}
                      </Text>
                      <Text style={styles.recentCode}>{r.code}</Text>
                    </View>
                    <ChevronRight size={18} color={colors.zinc600} />
                  </Pressable>
                  <Pressable onPress={() => drop(r.code)} hitSlop={10} style={styles.dropBtn}>
                    <X size={15} color={colors.zinc600} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          <Text style={styles.note}>
            Treat the code like a password — anyone with it can score every match in that tournament.
            An admin can rotate it at any time, which instantly revokes the old one.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  hero: { alignItems: "center", gap: 6, paddingVertical: 18 },
  h1: { color: colors.foreground, fontSize: 22, fontWeight: "800" },
  sub: { color: colors.zinc400, fontSize: 13, textAlign: "center", lineHeight: 19, paddingHorizontal: 8 },
  codeInput: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.zinc900,
    color: colors.foreground,
    paddingVertical: 16,
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: 4,
    textAlign: "center",
  },
  error: { color: "#f87171", fontSize: 13, textAlign: "center" },
  primaryBtn: {
    backgroundColor: colors.emerald500,
    borderRadius: radius.lg,
    paddingVertical: 15,
    alignItems: "center",
  },
  primaryText: { color: "#ffffff", fontWeight: "700", fontSize: 15 },
  section: { color: colors.zinc500, fontSize: 12, marginBottom: 6 },
  recentRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 8 },
  recentMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
  },
  recentName: { color: colors.foreground, fontSize: 14, fontWeight: "600" },
  recentCode: { color: colors.zinc500, fontSize: 12, letterSpacing: 1.5, marginTop: 1 },
  dropBtn: { padding: 8 },
  note: { color: colors.zinc600, fontSize: 11, lineHeight: 16, marginTop: 12, textAlign: "center" },
});
