import { Linking, StyleSheet, View } from "react-native";
import { Text } from "./Text";
import { colors, spacing } from "../../theme";
import {
  inlineRuns,
  looksLikeRichText,
  toBlocks,
  tokenize,
  type Inline,
} from "../../lib/rich-text";

export { looksLikeRichText };

/**
 * Draws the small HTML vocabulary the admin rich-text editor produces.
 *
 * Hand-written rather than react-native-render-html because the tag set
 * is fixed and tiny — see lib/rich-text.ts on the server, which is both
 * what the editor can emit and what the sanitiser allows through. A
 * general HTML engine would be a large dependency, most of it unused,
 * for one field on one screen.
 *
 * The input is trusted in the XSS sense: it was scrubbed to the
 * allowlist before it reached the database, and React Native has no
 * script context anyway. What this still has to be careful about is
 * MALFORMED markup — unclosed tags, junk from a paste — which must
 * degrade to readable text rather than blank the screen.
 *
 * Anything outside the vocabulary loses its tag and keeps its words, so
 * a widened allowlist on the server shows up here as unstyled text, not
 * as missing content.
 */

function Runs({ runs, color }: { runs: Inline[]; color: string }) {
  return (
    <>
      {runs.map((r, i) => (
        <Text
          key={i}
          variant="small"
          color={r.href ? colors.emerald400 : color}
          weight={r.bold ? "600" : undefined}
          style={{
            fontStyle: r.italic ? "italic" : "normal",
            textDecorationLine: r.strike
              ? "line-through"
              : r.underline
                ? "underline"
                : "none",
          }}
          onPress={r.href ? () => void Linking.openURL(r.href!) : undefined}
        >
          {r.text}
        </Text>
      ))}
    </>
  );
}

export function RichText({
  html,
  color = colors.zinc400,
}: {
  html: string;
  color?: string;
}) {
  const blocks = toBlocks(tokenize(html));
  if (blocks.length === 0) return null;

  return (
    <View>
      {blocks.map((b, i) => {
        const runs = inlineRuns(b.tokens);
        if (runs.length === 0) return null;

        if (b.tag === "li") {
          return (
            <View key={i} style={styles.listRow}>
              <Text variant="small" color={color} style={styles.marker}>
                {b.ordinal ? `${b.ordinal}.` : "•"}
              </Text>
              <Text variant="small" color={color} style={styles.listBody}>
                <Runs runs={runs} color={color} />
              </Text>
            </View>
          );
        }

        if (b.tag === "h3" || b.tag === "h4") {
          return (
            <Text
              key={i}
              variant={b.tag === "h3" ? "body" : "small"}
              weight="600"
              color={colors.foreground}
              style={styles.heading}
            >
              <Runs runs={runs} color={colors.foreground} />
            </Text>
          );
        }

        if (b.tag === "blockquote") {
          return (
            <View key={i} style={styles.quote}>
              <Text variant="small" color={colors.zinc500}>
                <Runs runs={runs} color={colors.zinc500} />
              </Text>
            </View>
          );
        }

        return (
          <Text key={i} variant="small" color={color} style={styles.para}>
            <Runs runs={runs} color={color} />
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  para: { marginTop: spacing["2"], lineHeight: 21 },
  heading: { marginTop: spacing["3"], marginBottom: 2 },
  listRow: { flexDirection: "row", marginTop: 4, paddingRight: spacing["2"] },
  marker: { width: 18, lineHeight: 21 },
  listBody: { flex: 1, lineHeight: 21 },
  quote: {
    marginTop: spacing["2"],
    borderLeftWidth: 2,
    borderLeftColor: colors.zinc700,
    paddingLeft: spacing["3"],
  },
});
