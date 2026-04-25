import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { colors, spacing } from "../../theme";
import { authApi } from "../../lib/auth";
import { ApiError } from "../../lib/api";
import { useAuth } from "../../providers/AuthProvider";
import type { AccountStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<AccountStackParamList, "EditName">;

export function EditNameScreen() {
  const navigation = useNavigation<Nav>();
  const { state, signIn } = useAuth();
  const currentName = state.status === "signedIn" ? state.user.name ?? "" : "";

  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const trimmed = name.trim();
  const isValid = trimmed.length >= 2;
  const dirty = trimmed !== currentName.trim();

  async function handleSave() {
    if (!isValid) {
      setError("Enter at least 2 characters");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const user = await authApi.updateName(trimmed);
      signIn(user);
      navigation.goBack();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save your name.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen avoidKeyboard>
      <View style={styles.header}>
        <Text variant="title">Your name</Text>
        <Text variant="body" color={colors.mutedForeground}>
          This shows up on bookings, orders, and receipts.
        </Text>
      </View>

      <View style={styles.form}>
        <Input
          label="Full name"
          placeholder="Your name"
          autoCapitalize="words"
          autoFocus
          maxLength={80}
          value={name}
          onChangeText={(v) => {
            setName(v);
            if (error) setError(null);
          }}
          error={error}
        />
        <Button
          label="Save"
          onPress={handleSave}
          loading={loading}
          disabled={!isValid || !dirty}
          fullWidth
          size="lg"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    marginTop: spacing["6"],
    gap: spacing["2"],
  },
  form: {
    marginTop: spacing["8"],
    gap: spacing["5"],
  },
});
