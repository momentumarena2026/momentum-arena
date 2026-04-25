import Svg, { Path } from "react-native-svg";
import type { Sport } from "../../lib/types";

/**
 * Material Design sport icons ported from `react-icons/md` so the native
 * booking screen renders the exact same glyphs as the web's Book a Court
 * page (`components/booking/sport-card.tsx`).
 *
 * The SVG path data is lifted verbatim from Material Design:
 *   CRICKET   → MdSportsCricket
 *   FOOTBALL  → MdSportsSoccer
 *   PICKLEBALL → MdSportsTennis
 *
 * All three share the standard Material viewBox of "0 0 24 24".
 */
const SPORT_PATHS: Record<Sport, string> = {
  CRICKET:
    "M15.05 12.81 6.56 4.32a.996.996 0 0 0-1.41 0L2.32 7.15a.996.996 0 0 0 0 1.41l8.49 8.49c.39.39 1.02.39 1.41 0l2.83-2.83a.996.996 0 0 0 0-1.41zM14.341 17.756l1.414-1.414 4.243 4.243-1.414 1.414z",
  FOOTBALL:
    "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 3.3 1.35-.95a8.01 8.01 0 0 1 4.38 3.34l-.39 1.34-1.35.46L13 6.7V5.3zm-3.35-.95L11 5.3v1.4L7.01 9.49l-1.35-.46-.39-1.34a8.103 8.103 0 0 1 4.38-3.34zM7.08 17.11l-1.14.1A7.938 7.938 0 0 1 4 12c0-.12.01-.23.02-.35l1-.73 1.38.48 1.46 4.34-.78 1.37zm7.42 2.48c-.79.26-1.63.41-2.5.41s-1.71-.15-2.5-.41l-.69-1.49.64-1.1h5.11l.64 1.11-.7 1.48zM14.27 15H9.73l-1.35-4.02L12 8.44l3.63 2.54L14.27 15zm3.79 2.21-1.14-.1-.79-1.37 1.46-4.34 1.39-.47 1 .73c.01.11.02.22.02.34 0 1.99-.73 3.81-1.94 5.21z",
  PICKLEBALL:
    "M19.52 2.49C17.18.15 12.9.62 9.97 3.55c-1.6 1.6-2.52 3.87-2.54 5.46-.02 1.58.26 3.89-1.35 5.5l-4.24 4.24 1.42 1.42 4.24-4.24c1.61-1.61 3.92-1.33 5.5-1.35s3.86-.94 5.46-2.54c2.92-2.93 3.4-7.21 1.06-9.55zm-9.2 9.19c-1.53-1.53-1.05-4.61 1.06-6.72s5.18-2.59 6.72-1.06c1.53 1.53 1.05 4.61-1.06 6.72s-5.18 2.59-6.72 1.06zM18 17c.53 0 1.04.21 1.41.59.78.78.78 2.05 0 2.83-.37.37-.88.58-1.41.58s-1.04-.21-1.41-.59c-.78-.78-.78-2.05 0-2.83.37-.37.88-.58 1.41-.58m0-2a3.998 3.998 0 0 0-2.83 6.83c.78.78 1.81 1.17 2.83 1.17a3.998 3.998 0 0 0 2.83-6.83A3.998 3.998 0 0 0 18 15z",
};

export interface SportIconProps {
  sport: Sport;
  size?: number;
  color: string;
}

export function SportIcon({ sport, size = 32, color }: SportIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={SPORT_PATHS[sport]} fill={color} />
    </Svg>
  );
}
