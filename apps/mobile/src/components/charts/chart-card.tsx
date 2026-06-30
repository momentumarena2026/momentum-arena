import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Card, Text } from "../ui";
import { colors, spacing } from "../../theme";

export interface ChartCardProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

/**
 * Titled wrapper around the app's `Card` for consistent section framing
 * around a chart. Header (title + optional subtitle) sits above the chart body.
 */
export function ChartCard({ title, subtitle, children }: ChartCardProps) {
  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text variant="heading">{title}</Text>
        {subtitle ? (
          <Text variant="small" color={colors.mutedForeground}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View>{children}</View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing["4"],
  },
  header: {
    gap: spacing["1"],
  },
});
