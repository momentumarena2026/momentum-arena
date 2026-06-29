import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import { formatDateLong } from "../../lib/format";
import { adminProfileApi, type AdminProfile } from "../../lib/admin-profile";
import { AdminApiError } from "../../lib/admin-api";
import { useAdminAuth } from "../../providers/AdminAuthProvider";

export function AdminProfileScreen() {
  const { state, signIn } = useAdminAuth();
  const query = useQuery({
    queryKey: ["admin", "profile"],
    queryFn: () => adminProfileApi.get(),
  });

  const profile = query.data?.profile;

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setUsername(profile.username);
      setEmail(profile.email);
    }
  }, [profile]);

  const save = useMutation({
    mutationFn: async (): Promise<AdminProfile> => {
      const wantsPasswordChange = !!(
        currentPassword ||
        newPassword ||
        confirmPassword
      );
      // Mirror web's confirm-password check: validate the match client-side
      // before hitting the server (the server never sees the confirm field).
      if (wantsPasswordChange && newPassword !== confirmPassword) {
        throw new Error("New passwords do not match");
      }
      const res = await adminProfileApi.update({
        username: username.trim(),
        email: email.trim(),
        currentPassword: wantsPasswordChange ? currentPassword : undefined,
        newPassword: wantsPasswordChange ? newPassword : undefined,
      });
      return res.profile;
    },
    onSuccess: (next) => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setErr(null);
      // Keep the local auth session (nav header, More hub) in sync with the
      // edited username/email.
      if (state.status === "signedIn") {
        signIn({
          id: next.id,
          username: next.username,
          email: next.email,
          role: next.role,
          permissions: next.permissions,
        });
      }
      void query.refetch();
      Alert.alert("Saved", "Your profile has been updated.");
    },
    onError: (e) =>
      setErr(
        e instanceof AdminApiError || e instanceof Error ? e.message : "Failed",
      ),
  });

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {query.isLoading || !profile ? (
          <Card style={styles.card}>
            <Skeleton width="50%" height={18} />
            <Skeleton width="80%" height={12} />
            <Skeleton width="80%" height={12} />
          </Card>
        ) : (
          <>
            <Card style={styles.card}>
              <View style={styles.roleRow}>
                <ShieldCheck size={16} color={colors.emerald400} />
                <Text variant="small" weight="600" color={colors.foreground}>
                  {profile.role}
                </Text>
              </View>
              <Row
                label="Last login"
                value={
                  profile.lastLoginAt
                    ? formatDateLong(profile.lastLoginAt)
                    : "Never"
                }
              />
              <Row label="Member since" value={formatDateLong(profile.createdAt)} />
            </Card>

            <Text variant="tiny" color={colors.zinc500} style={styles.section}>
              ACCOUNT
            </Text>
            <Card style={styles.card}>
              <Input
                label="Username"
                autoCapitalize="none"
                autoCorrect={false}
                value={username}
                onChangeText={setUsername}
              />
              <Input
                label="Email"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />
            </Card>

            <Text variant="tiny" color={colors.zinc500} style={styles.section}>
              CHANGE PASSWORD
            </Text>
            <Card style={styles.card}>
              <Input
                label="Current password"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Required to set a new password"
                value={currentPassword}
                onChangeText={setCurrentPassword}
              />
              <Input
                label="New password"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="10+ chars, letter, number, symbol"
                value={newPassword}
                onChangeText={setNewPassword}
              />
              <Input
                label="Confirm new password"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Re-enter the new password"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                error={
                  confirmPassword && newPassword !== confirmPassword
                    ? "Passwords do not match"
                    : null
                }
              />
              <Text variant="tiny" color={colors.zinc600}>
                Leave all blank to keep your current password.
              </Text>
            </Card>

            {profile.role !== "SUPERADMIN" ? (
              <>
                <Text variant="tiny" color={colors.zinc500} style={styles.section}>
                  PERMISSIONS
                </Text>
                <Card style={styles.card}>
                  {profile.permissions.length === 0 ? (
                    <Text variant="small" color={colors.zinc500}>
                      No granular permissions assigned.
                    </Text>
                  ) : (
                    <View style={styles.permWrap}>
                      {profile.permissions.map((p) => (
                        <View key={p} style={styles.permPill}>
                          <Text variant="tiny" color={colors.zinc300}>
                            {p}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </Card>
              </>
            ) : (
              <Text variant="tiny" color={colors.zinc600} style={styles.allPerms}>
                As superadmin you have every permission.
              </Text>
            )}

            {err ? (
              <Text variant="small" color={colors.destructive}>
                {err}
              </Text>
            ) : null}

            <Button
              label="Save changes"
              onPress={() => save.mutate()}
              loading={save.isPending}
              fullWidth
              size="lg"
            />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text variant="small" color={colors.zinc500}>
        {label}
      </Text>
      <Text variant="small" weight="500" color={colors.foreground}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["4"],
    paddingBottom: spacing["10"],
    gap: spacing["2"],
  },
  card: { padding: spacing["4"], gap: spacing["3"] },
  section: { letterSpacing: 1.2, fontWeight: "700", marginTop: spacing["3"] },
  roleRow: { flexDirection: "row", alignItems: "center", gap: spacing["2"] },
  metaRow: { flexDirection: "row", justifyContent: "space-between" },
  permWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing["2"] },
  permPill: {
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["1.5"],
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc700,
    backgroundColor: colors.zinc900,
  },
  allPerms: { marginTop: spacing["3"], marginLeft: spacing["1"] },
});
