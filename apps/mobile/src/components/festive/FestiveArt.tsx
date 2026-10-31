import Svg, { Circle, Ellipse, G, Path, Polygon, Rect } from "react-native-svg";
import type { FestiveThemeId } from "../../lib/festive-themes";

/**
 * The app twin of web's `components/festive/festive-art.tsx` — the same
 * shapes, redrawn with react-native-svg.
 *
 * The two files cannot share code (no path alias into /lib from the RN
 * bundle, and the primitives are different objects entirely), but they
 * must stay recognisably the same artwork: the marigold has twelve
 * petals in both, the diya is the same bowl-and-flame, Santa is the
 * same silhouette. Numbers that define the SHAPE are therefore kept
 * identical on purpose, and only sizes differ.
 *
 * As on web, everything is built from primitives rather than long
 * hand-authored path data, so it can be adjusted by changing a number.
 */

export function Marigold({ size = 20, outer = "#f97316", inner = "#fde047" }: {
  size?: number;
  outer?: string;
  inner?: string;
}) {
  const petals = Array.from({ length: 12 }, (_, i) => i * 30);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G>
        {petals.map((deg) => (
          <Ellipse
            key={deg}
            cx="12"
            cy="5.6"
            rx="2.5"
            ry="4.4"
            fill={outer}
            transform={`rotate(${deg} 12 12)`}
          />
        ))}
        <Circle cx="12" cy="12" r="4.6" fill={inner} />
        <Circle cx="12" cy="12" r="2.2" fill={outer} opacity={0.75} />
      </G>
    </Svg>
  );
}

export function MangoLeaf({ size = 16, color = "#15803d" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size * 1.3} viewBox="0 0 24 32">
      <Path d="M12 1 C19 9, 19 23, 12 31 C5 23, 5 9, 12 1 Z" fill={color} />
      <Path d="M12 3 L12 29" stroke="#052e16" strokeWidth="1" opacity={0.5} />
    </Svg>
  );
}

export function Bauble({ size = 16, color = "#ef4444" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size * 1.25} viewBox="0 0 20 25">
      <Rect x="8" y="0" width="4" height="4" rx="1" fill="#d4d4d8" />
      <Circle cx="10" cy="14" r="9" fill={color} />
      <Ellipse cx="6.5" cy="10" rx="2.2" ry="3" fill="#ffffff" opacity={0.35} />
    </Svg>
  );
}

export function PineSprig({ size = 22, color = "#166534" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 28 28">
      {[0, 1, 2].map((r) => (
        <Polygon
          key={r}
          points={`14,${2 + r * 7} 6,${12 + r * 6} 22,${12 + r * 6}`}
          fill={color}
          opacity={0.9 - r * 0.1}
        />
      ))}
    </Svg>
  );
}

export function Flag({ size = 18, color = "#e879f9" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size * 1.2} viewBox="0 0 20 24">
      <Polygon points="0,0 20,0 10,22" fill={color} />
    </Svg>
  );
}

/** An oil lamp with a flame. */
export function Diya({ size = 30 }: { size?: number }) {
  return (
    <Svg width={size} height={size * 0.8} viewBox="0 0 40 32">
      <Ellipse cx="20" cy="24" rx="15" ry="6" fill="#b45309" />
      <Path d="M5 23 q 15 10 30 0 z" fill="#78350f" />
      <Ellipse cx="20" cy="12" rx="6" ry="9" fill="#fbbf24" opacity={0.35} />
      <Path d="M20 4 q 4.5 6 0 13 q -4.5 -7 0 -13 Z" fill="#fde68a" />
    </Svg>
  );
}

/** Santa's sleigh, as a silhouette — see the web twin for why. */
export function SantaSleigh({ width = 150, color = "#f87171", trim = "#ffffff" }: {
  width?: number;
  color?: string;
  trim?: string;
}) {
  return (
    <Svg width={width} height={width * 0.42} viewBox="0 0 190 80">
      <G fill={color}>
        <Ellipse cx="38" cy="44" rx="20" ry="9" />
        <Ellipse cx="17" cy="35" rx="8" ry="6.5" />
        <Polygon points="9,31 2,22 8,27 7,18 12,27" />
        <Polygon points="23,30 28,20 25,27 32,23 26,31" />
        <Rect x="26" y="50" width="3" height="14" rx="1.5" />
        <Rect x="36" y="51" width="3" height="13" rx="1.5" />
        <Rect x="46" y="50" width="3" height="14" rx="1.5" />
        <Rect x="53" y="51" width="3" height="12" rx="1.5" />
        <Path d="M56 40 q 10 -4 14 4" stroke={color} strokeWidth="2.5" fill="none" />
      </G>
      <G fill={color}>
        <Path d="M86 58 q -4 -22 16 -22 h 48 q 10 0 10 12 v 10 z" />
        <Path
          d="M80 62 q 10 8 26 8 h 54 q 10 0 14 -8"
          stroke={color}
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
        />
      </G>
      <Circle cx="124" cy="26" r="9" fill={color} />
      <Circle cx="124" cy="15" r="5" fill={trim} />
      <Rect x="112" y="30" width="24" height="8" rx="4" fill={trim} opacity={0.85} />
      <Path d="M136 24 q 10 -6 14 -16" stroke={color} strokeWidth="4" fill="none" strokeLinecap="round" />
    </Svg>
  );
}

/** What hangs from the garland, per theme — mirrors web's `garlandUnit`. */
export function GarlandUnit({ theme, i }: { theme: FestiveThemeId; i: number }) {
  if (theme === "diwali") {
    return i % 2 === 0 ? <Marigold size={i % 4 === 0 ? 21 : 17} /> : <MangoLeaf size={14} />;
  }
  if (theme === "christmas") {
    return i % 3 === 1 ? (
      <Bauble size={15} color={i % 2 === 0 ? "#ef4444" : "#fbbf24"} />
    ) : (
      <PineSprig size={20} />
    );
  }
  const colours = ["#e879f9", "#38bdf8", "#facc15", "#4ade80", "#fb7185"];
  return <Flag size={17} color={colours[i % colours.length]} />;
}
