import { useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { X } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { colors, spacing } from "../../theme";
import { authApi } from "../../lib/auth";
import { ApiError } from "../../lib/api";
import type { RootStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList, "Phone">;

export function PhoneScreen() {
  const navigation = useNavigation<Nav>();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const phoneDigits = phone.replace(/\D/g, "");
  const isValid = phoneDigits.length === 10;

  async function handleContinue() {
    if (!isValid) {
      setError("Enter a 10-digit mobile number");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await authApi.sendOtp(phoneDigits);
      navigation.navigate("Otp", { phone: phoneDigits });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Something went wrong. Try again.";
      Alert.alert("Couldn't send OTP", message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen avoidKeyboard>
      <Pressable
        onPress={() => navigation.goBack()}
        style={styles.close}
        hitSlop={12}
      >
        <X size={22} color={colors.foreground} />
      </Pressable>

      <View style={styles.header}>
        <Text variant="display" style={styles.title}>
          Welcome to{"\n"}Momentum Arena
        </Text>
        <Text variant="body" color={colors.mutedForeground}>
          Enter your mobile number to sign in or create an account.
        </Text>
      </View>

      <View style={styles.form}>
        <Input
          label="Mobile number"
          placeholder="98765 43210"
          keyboardType="number-pad"
          autoFocus
          maxLength={12}
          value={phone}
          onChangeText={(v) => {
            setPhone(v);
            if (error) setError(null);
          }}
          error={error}
          leadingAddon={
            <Text variant="body" color={colors.mutedForeground} weight="600">
              +91
            </Text>
          }
        />
        <Button
          label="Send OTP"
          onPress={handleContinue}
          loading={loading}
          disabled={!isValid}
          fullWidth
          size="lg"
        />
      </View>

      <Text variant="small" color={colors.subtleForeground} style={styles.footer}>
        By continuing you agree to our Terms & Privacy Policy.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  close: {
    alignSelf: "flex-end",
    padding: spacing["2"],
  },
  header: {
    marginTop: spacing["4"],
    gap: spacing["3"],
  },
  title: {
    marginBottom: spacing["1"],
  },
  form: {
    marginTop: spacing["10"],
    gap: spacing["5"],
  },
  footer: {
    marginTop: "auto",
    textAlign: "center",
  },
});
