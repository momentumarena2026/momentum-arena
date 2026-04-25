import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Pressable,
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
import { useSmsUserConsent } from "@eabdullazyanov/react-native-sms-user-consent";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { colors, radius, spacing } from "../../theme";
import { authApi } from "../../lib/auth";
import { ApiError } from "../../lib/api";
import { useAuth } from "../../providers/AuthProvider";
import type { RootStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList, "Otp">;
type Rt = RouteProp<RootStackParamList, "Otp">;

const OTP_LENGTH = 6;
const RESEND_SECONDS = 30;

export function OtpScreen() {
  const { params } = useRoute<Rt>();
  const navigation = useNavigation<Nav>();
  const { signIn } = useAuth();

  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);
  const [autoSubmitted, setAutoSubmitted] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // Android auto-fill via SMS User Consent API. Returns "" on iOS (iOS uses
  // the OS-level QuickType suggestion wired up through textContentType
  // below) and the parsed 6-digit code on Android after the user approves
  // the system consent dialog.
  const autoFilledCode = useSmsUserConsent(OTP_LENGTH);

  const code = digits.join("");
  const isComplete = code.length === OTP_LENGTH;

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [secondsLeft]);

  // When the Android consent dialog returns a code, paint the boxes and
  // submit automatically — the user already expressed intent by approving
  // the OS dialog, asking them to tap Verify again would be noise. Guarded
  // with autoSubmitted so a failed verify doesn't re-trigger while the hook
  // still remembers the same code.
  useEffect(() => {
    if (autoFilledCode.length === OTP_LENGTH && !autoSubmitted) {
      setAutoSubmitted(true);
      handleChange(autoFilledCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFilledCode]);

  // Companion effect that actually fires verify once digits reflect the
  // auto-filled code. Splitting paint-then-verify into two effects lets us
  // use the real post-setState `isComplete` value instead of racing it.
  useEffect(() => {
    if (autoSubmitted && isComplete && !loading) {
      handleVerify();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSubmitted, isComplete]);

  function handleChange(raw: string) {
    const next = raw.replace(/\D/g, "").slice(0, OTP_LENGTH);
    const arr = Array(OTP_LENGTH).fill("");
    for (let i = 0; i < next.length; i++) arr[i] = next[i];
    setDigits(arr);
    if (error) setError(null);
  }

  async function handleVerify() {
    if (!isComplete) return;
    setLoading(true);
    setError(null);
    try {
      const user = await authApi.verifyOtp(params.phone, code);
      signIn(user);
      // Drop the user back to Main. Phone/Otp live in the root stack with
      // `presentation: "modal"` as a screen option — there's no wrapping
      // modal navigator, so getParent() is a no-op here. popToTop() correctly
      // pops both Otp and Phone, returning to Main underneath.
      navigation.popToTop();
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Couldn't verify the OTP.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (secondsLeft > 0) return;
    try {
      await authApi.sendOtp(params.phone);
      setSecondsLeft(RESEND_SECONDS);
      setDigits(Array(OTP_LENGTH).fill(""));
      setAutoSubmitted(false);
      inputRef.current?.focus();
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Couldn't resend OTP.";
      Alert.alert("Resend failed", message);
    }
  }

  return (
    <Screen avoidKeyboard>
      <View style={styles.header}>
        <Text variant="title">Enter OTP</Text>
        <Text variant="body" color={colors.mutedForeground}>
          We sent a 6-digit code to +91 {params.phone}.
        </Text>
      </View>

      <View style={styles.boxesRow}>
        {/* Hidden input collects keystrokes; visible boxes mirror it. */}
        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={handleChange}
          keyboardType="number-pad"
          maxLength={OTP_LENGTH}
          autoFocus
          textContentType="oneTimeCode"
          style={styles.hiddenInput}
          caretHidden
        />
        {digits.map((d, i) => (
          <Pressable
            key={i}
            onPress={() => inputRef.current?.focus()}
            style={[styles.box, code.length === i && styles.boxActive, !!error && styles.boxError]}
          >
            <Text variant="heading" style={styles.boxDigit}>
              {d || ""}
            </Text>
          </Pressable>
        ))}
      </View>

      {error ? (
        <Text variant="small" color={colors.destructive} style={styles.errorMsg}>
          {error}
        </Text>
      ) : null}

      <Button
        label="Verify"
        onPress={handleVerify}
        loading={loading}
        disabled={!isComplete}
        fullWidth
        size="lg"
        style={styles.verify}
      />

      <View style={styles.resendRow}>
        <Text variant="small" color={colors.mutedForeground}>
          Didn't receive it?{" "}
        </Text>
        <Pressable onPress={handleResend} disabled={secondsLeft > 0}>
          <Text
            variant="small"
            color={secondsLeft > 0 ? colors.subtleForeground : colors.primary}
            weight="600"
          >
            {secondsLeft > 0 ? `Resend in ${secondsLeft}s` : "Resend OTP"}
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    marginTop: spacing["8"],
    gap: spacing["2"],
  },
  boxesRow: {
    marginTop: spacing["8"],
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing["2"],
  },
  hiddenInput: {
    position: "absolute",
    opacity: 0,
    width: 1,
    height: 1,
  },
  box: {
    flex: 1,
    height: 56,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    backgroundColor: colors.inputBackground,
    alignItems: "center",
    justifyContent: "center",
  },
  boxActive: {
    borderColor: colors.primary,
  },
  boxError: {
    borderColor: colors.destructive,
  },
  boxDigit: {
    fontSize: 22,
    fontWeight: "600",
  },
  errorMsg: {
    marginTop: spacing["3"],
  },
  verify: {
    marginTop: spacing["8"],
  },
  resendRow: {
    marginTop: spacing["5"],
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
});
