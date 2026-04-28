import { useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ShieldCheck, X } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { colors, radius, spacing } from "../../theme";
import { adminAuthApi, AdminAuthError } from "../../lib/admin-auth";
import { useAdminAuth } from "../../providers/AdminAuthProvider";
import type { RootStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList, "AdminLogin">;

/**
 * Admin sign-in form. Reached via the 5-tap easter-egg on the Account
 * screen footer (see AccountScreen → version footer). Same credential
 * shape as the web /godmode page; on success we store the bearer
 * token in the admin-only Keychain slot and bounce to the placeholder
 * AdminHome screen.
 */
export function AdminLoginScreen() {
  const navigation = useNavigation<Nav>();
  const { signIn } = useAdminAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canSubmit = username.trim().length > 0 && password.length > 0 && !loading;

  async function handleSubmit() {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const admin = await adminAuthApi.login(username.trim(), password);
      signIn(admin);
      // Stash for replacement once AdminHome lands. For now bounce
      // back to wherever the user came from with a confirmation.
      Alert.alert(
        "Signed in",
        `Welcome, ${admin.username}. Admin screens are coming next.`,
        [{ text: "OK", onPress: () => navigation.goBack() }],
      );
    } catch (err) {
      setError(
        err instanceof AdminAuthError
          ? err.message
          : "Sign-in failed. Try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <X size={22} color={colors.zinc400} />
        </Pressable>
      </View>

      <View style={styles.body}>
        <View style={styles.iconWrap}>
          <ShieldCheck size={28} color={colors.yellow400} />
        </View>
        <Text variant="title" style={styles.title}>
          Admin sign in
        </Text>
        <Text variant="small" color={colors.mutedForeground} style={styles.subtitle}>
          Authorized personnel only. Use the same credentials as the web
          admin panel.
        </Text>

        <View style={styles.form}>
          <View style={styles.field}>
            <Text variant="tiny" color={colors.zinc500} style={styles.label}>
              USERNAME
            </Text>
            <Input
              value={username}
              onChangeText={setUsername}
              placeholder="username"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              textContentType="username"
              editable={!loading}
            />
          </View>

          <View style={styles.field}>
            <Text variant="tiny" color={colors.zinc500} style={styles.label}>
              PASSWORD
            </Text>
            <Input
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="password"
              textContentType="password"
              editable={!loading}
              onSubmitEditing={handleSubmit}
            />
          </View>

          {error ? (
            <View style={styles.error}>
              <Text variant="small" color={colors.destructive}>
                {error}
              </Text>
            </View>
          ) : null}

          <Button
            label="Sign in"
            onPress={handleSubmit}
            loading={loading}
            disabled={!canSubmit}
            size="lg"
            fullWidth
            style={styles.cta}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: spacing["6"],
    paddingTop: spacing["3"],
  },
  body: {
    flex: 1,
    paddingHorizontal: spacing["6"],
    paddingTop: spacing["8"],
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(245, 158, 11, 0.10)", // amber-500/10
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.30)", // amber-500/30
    marginBottom: spacing["5"],
  },
  title: { marginBottom: spacing["2"] },
  subtitle: { marginBottom: spacing["6"] },
  form: { gap: spacing["4"] },
  field: { gap: spacing["1.5"] },
  label: { letterSpacing: 1, fontWeight: "700" },
  error: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.30)",
    backgroundColor: "rgba(239, 68, 68, 0.10)",
    padding: spacing["3"],
  },
  cta: { marginTop: spacing["2"] },
});
