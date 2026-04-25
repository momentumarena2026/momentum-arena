import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { SafeAreaView, type Edges } from "react-native-safe-area-context";
import { colors, spacing } from "../../theme";
import type { PropsWithChildren } from "react";

interface ScreenProps {
  /** Add horizontal padding (defaults on). */
  padded?: boolean;
  /** Wrap children in a ScrollView. */
  scrollable?: boolean;
  /** Wrap in KeyboardAvoidingView — turn on for screens with text inputs. */
  avoidKeyboard?: boolean;
  /** Which safe-area edges to respect. Default: top + bottom. */
  edges?: Edges;
  contentStyle?: ViewStyle;
  style?: ViewStyle;
}

export function Screen({
  padded = true,
  scrollable = false,
  avoidKeyboard = false,
  edges = ["top", "bottom"],
  contentStyle,
  style,
  children,
}: PropsWithChildren<ScreenProps>) {
  const inner = (
    <View
      style={[
        styles.content,
        padded ? styles.padded : null,
        contentStyle,
      ]}
    >
      {children}
    </View>
  );

  const body = scrollable ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[padded ? styles.padded : null, contentStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    inner
  );

  const wrapped = avoidKeyboard ? (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {body}
    </KeyboardAvoidingView>
  ) : (
    body
  );

  return (
    <SafeAreaView style={[styles.safe, style]} edges={edges}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      {wrapped}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  padded: {
    paddingHorizontal: spacing["6"],
    paddingVertical: spacing["4"],
  },
});
