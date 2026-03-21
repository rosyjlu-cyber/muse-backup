import { Image } from 'expo-image';
import { StyleSheet, TouchableOpacity, View, Text, Dimensions } from 'react-native';
import { Theme } from '@/constants/Theme';

const SCREEN_WIDTH = Math.min(Dimensions.get('window').width, 390);
// 7 columns with 4px gaps between them (6 gaps), 32px total horizontal padding
export const CELL_GAP = 4;
export const CELL_SIZE = Math.floor((SCREEN_WIDTH - 32 - CELL_GAP * 6) / 7);
// Portrait 4:3 ratio (taller than wide — standard phone camera portrait)
export const CELL_H = Math.round(CELL_SIZE * (4 / 3));

const CELL_RADIUS = 6;

interface DayCellProps {
  day: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  isFuture: boolean;
  photoUri?: string;
  onPress: () => void;
}

export function DayCell({
  day,
  isCurrentMonth,
  isToday,
  isFuture,
  photoUri,
  onPress,
}: DayCellProps) {
  // Off-month: invisible spacer
  if (!isCurrentMonth) {
    return <View style={styles.cell} />;
  }

  // Has a photo — portrait rounded rectangle crop
  if (photoUri) {
    return (
      <TouchableOpacity style={styles.cell} onPress={onPress} activeOpacity={0.82}>
        <Image
          source={{ uri: photoUri }}
            cachePolicy="disk"
          style={styles.photoImage}
          contentFit="cover"
          cachePolicy="disk"
          transition={150}
          placeholder={{ blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4' }}
        />
      </TouchableOpacity>
    );
  }

  // Future day — ghost, not tappable
  if (isFuture) {
    return (
      <View style={[styles.cell, styles.futureRect]}>
        <Text style={styles.futureText}>{day}</Text>
      </View>
    );
  }

  // Today with no photo — bold black rect (CTA)
  if (isToday) {
    return (
      <TouchableOpacity style={[styles.cell, styles.todayRect]} onPress={onPress} activeOpacity={0.8}>
        <Text style={styles.todayText}>{day}</Text>
      </TouchableOpacity>
    );
  }

  // Past day with no photo — show day number + "+" hint
  return (
    <TouchableOpacity style={[styles.cell, styles.emptyRect]} onPress={onPress} activeOpacity={0.65}>
      <Text style={styles.emptyText}>{day}</Text>
      <Text style={styles.plusText}>+</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  cell: {
    width: CELL_SIZE,
    height: CELL_H,
    borderRadius: CELL_RADIUS,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoImage: {
    width: CELL_SIZE,
    height: CELL_H,
    borderRadius: CELL_RADIUS,
  },
  todayRect: {
    backgroundColor: Theme.colors.circleToday,
  },
  todayText: {
    fontSize: Theme.font.sm,
    fontWeight: '800',
    color: Theme.colors.white,
  },
  emptyRect: {
    backgroundColor: Theme.colors.circleEmpty,
  },
  emptyText: {
    fontSize: Theme.font.sm,
    fontWeight: '500',
    color: Theme.colors.limeText,
    lineHeight: 14,
  },
  plusText: {
    fontSize: 10,
    fontWeight: '700',
    color: Theme.colors.limeMuted,
    lineHeight: 11,
  },
  futureRect: {
    backgroundColor: 'transparent',
  },
  futureText: {
    fontSize: Theme.font.sm,
    fontWeight: '400',
    color: Theme.colors.disabledOnLime,
  },
});
