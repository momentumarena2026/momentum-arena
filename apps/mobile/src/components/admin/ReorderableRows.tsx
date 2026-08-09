import { useRef, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { colors } from "../../theme";

/**
 * Press-and-hold a row, drag it, drop it somewhere else.
 *
 * The web list uses HTML5 drag, which has no equivalent here, so this is
 * a long-press pan. The long press matters for a second reason: these
 * rows live inside the admin screen's vertical ScrollView, and a pan that
 * activated immediately would fight every scroll. Requiring the hold
 * first means a normal swipe still scrolls the page and only a deliberate
 * hold starts a drag.
 *
 * Row heights are measured rather than assumed — the cards here vary
 * (a scheduled fixture carries an extra line) and a fixed row height
 * would drift further down the list with every mismatch.
 */

export function ReorderableRows<T>({
  items,
  keyOf,
  renderItem,
  onReorder,
  disabled,
  canDrag,
}: {
  items: T[];
  keyOf: (item: T) => string;
  renderItem: (item: T, dragging: boolean) => React.ReactNode;
  /** Fired once on drop, with the keys in their new order. */
  onReorder: (orderedKeys: string[]) => void;
  disabled?: boolean;
  /** Per-row opt-out — e.g. a row whose edit form is open. */
  canDrag?: (item: T) => boolean;
}) {
  const heights = useRef<Record<string, number>>({});
  const [draggingKey, setDraggingKey] = useState<string | null>(null);

  const measure = (key: string) => (e: LayoutChangeEvent) => {
    heights.current[key] = e.nativeEvent.layout.height;
  };

  /** Where a row lands after being dragged `dy` from index `from`. */
  const targetIndex = (from: number, dy: number) => {
    const keys = items.map(keyOf);
    let i = from;
    let travelled = 0;
    if (dy > 0) {
      while (i < keys.length - 1) {
        const next = heights.current[keys[i + 1]] ?? 64;
        // Move past a neighbour only once the drag clears half of it,
        // so the row settles where it visually sits.
        if (dy - travelled < next / 2) break;
        travelled += next;
        i += 1;
      }
    } else {
      while (i > 0) {
        const prev = heights.current[keys[i - 1]] ?? 64;
        if (-dy - travelled < prev / 2) break;
        travelled += prev;
        i -= 1;
      }
    }
    return i;
  };

  const commit = (key: string, from: number, dy: number) => {
    setDraggingKey(null);
    const to = targetIndex(from, dy);
    if (to === from) return;
    const keys = items.map(keyOf);
    keys.splice(to, 0, keys.splice(from, 1)[0]);
    onReorder(keys);
  };

  return (
    <View>
      {items.map((item, index) => (
        <Row
          key={keyOf(item)}
          itemKey={keyOf(item)}
          index={index}
          disabled={disabled || canDrag?.(item) === false}
          dragging={draggingKey === keyOf(item)}
          onMeasure={measure(keyOf(item))}
          onLift={setDraggingKey}
          onDrop={commit}
        >
          {renderItem(item, draggingKey === keyOf(item))}
        </Row>
      ))}
    </View>
  );
}

function Row({
  itemKey,
  index,
  disabled,
  dragging,
  onMeasure,
  onLift,
  onDrop,
  children,
}: {
  itemKey: string;
  index: number;
  disabled?: boolean;
  dragging: boolean;
  onMeasure: (e: LayoutChangeEvent) => void;
  onLift: (key: string | null) => void;
  onDrop: (key: string, from: number, dy: number) => void;
  children: React.ReactNode;
}) {
  const y = useSharedValue(0);

  const pan = Gesture.Pan()
    .enabled(!disabled)
    // Hold before the drag takes over, so ordinary scrolling still works.
    .activateAfterLongPress(250)
    .onStart(() => {
      runOnJS(onLift)(itemKey);
    })
    .onUpdate((e) => {
      y.value = e.translationY;
    })
    .onEnd((e) => {
      runOnJS(onDrop)(itemKey, index, e.translationY);
      y.value = 0;
    })
    .onFinalize(() => {
      y.value = 0;
      runOnJS(onLift)(null);
    });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        onLayout={onMeasure}
        style={[
          style,
          // Lift the dragged row above its neighbours, or it slides
          // underneath them and looks like nothing is happening.
          dragging && styles.lifted,
        ]}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  lifted: {
    zIndex: 10,
    elevation: 10,
    opacity: 0.95,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.emerald400,
    backgroundColor: colors.background,
  },
});
