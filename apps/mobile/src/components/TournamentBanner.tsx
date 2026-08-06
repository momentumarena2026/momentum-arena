import { useState, type ReactNode } from "react";
import { Image, View, type StyleProp, type ViewStyle } from "react-native";

/**
 * Tournament banner that renders the WHOLE poster, never a crop of it.
 *
 * These banners are designed artwork: branding on the left, prize panel in
 * the middle, a player on the right. Pinning them to a fixed height with
 * resizeMode="cover" therefore threw away the two things that make the
 * poster work — which is exactly what the screens did before (150pt on
 * detail, 120pt in the list).
 *
 * The box takes the image's real aspect ratio instead, measured on load
 * from nativeEvent.source. Same self-correcting approach as
 * components/promo/PromoBannerSlot — the difference is that promo banners
 * carry a stored ratio to start from and tournaments don't, so 3 is the
 * opening guess (it is what our poster template is) purely to avoid a
 * zero-height flash before the first frame lands.
 */
export function TournamentBanner({
  uri,
  style,
  children,
}: {
  uri: string;
  style?: StyleProp<ViewStyle>;
  /** Overlays drawn on top — the detail screen's bottom fades. */
  children?: ReactNode;
}) {
  const [ratio, setRatio] = useState(3);

  return (
    <View style={[{ width: "100%", aspectRatio: ratio, overflow: "hidden" }, style]}>
      <Image
        source={{ uri }}
        style={{ width: "100%", height: "100%" }}
        // With the box already at the image's own ratio, "cover" and
        // "contain" agree; cover just avoids a hairline gap from rounding.
        resizeMode="cover"
        onLoad={(e) => {
          const s = e.nativeEvent?.source;
          if (s?.width && s?.height) setRatio(s.width / s.height);
        }}
      />
      {children}
    </View>
  );
}
