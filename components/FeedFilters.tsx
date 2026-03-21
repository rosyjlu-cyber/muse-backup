import { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Modal,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Theme } from '@/constants/Theme';
import { Community, FeedFilters } from '@/utils/api';

interface FeedFiltersProps {
  filters: FeedFilters;
  onChange: (f: FeedFilters) => void;
  communities: Community[];
  availableTags: string[];
  onCommunityLongPress?: (communityId: string) => void;
}

export function FeedFiltersBar({ filters, onChange, communities, availableTags, onCommunityLongPress }: FeedFiltersProps) {
  const set = (patch: Partial<FeedFilters>) => onChange({ ...filters, ...patch });

  const toggleCommunity = (id: string) =>
    set({ communityId: filters.communityId === id ? undefined : id, explore: undefined });

  const toggleTag = (tag: string) =>
    set({ tag: filters.tag === tag ? undefined : tag });

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={styles.scroll}
    >
      {/* Date picker pill */}
      <DatePickerPill
        date={filters.date}
        dateRange={filters.dateRange}
        onDateChange={(d) => onChange({ ...filters, date: d, dateRange: undefined })}
        onDateRangeChange={(r) => onChange({ ...filters, dateRange: r, date: undefined })}
      />

      {communities.length > 0 && <Divider />}

      {/* Community pills */}
      {communities.map(c => (
        <Pill
          key={c.id}
          label={c.name}
          active={filters.communityId === c.id}
          onPress={() => toggleCommunity(c.id)}
          onLongPress={onCommunityLongPress ? () => onCommunityLongPress(c.id) : undefined}
          variant="community"
        />
      ))}

      <Divider />

      {/* Explore pill */}
      <Pill
        label="explore"
        active={!!filters.explore}
        onPress={() => set({ explore: filters.explore ? undefined : true, communityId: undefined })}
        variant="explore"
      />

      {/* Tag pills */}
      {availableTags.length > 0 && <Divider />}
      {availableTags.map(tag => (
        <Pill
          key={tag}
          label={tag}
          active={filters.tag === tag}
          onPress={() => toggleTag(tag)}
          variant="tag"
        />
      ))}

    </ScrollView>
  );
}

// ─── Date pill ────────────────────────────────────────────────────────────────

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_LABELS  = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function formatPillDate(dateStr: string): string {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${MONTH_SHORT[m - 1]} ${d}`;
}

function DatePickerPill({ date, dateRange, onDateChange, onDateRangeChange }: {
  date?: string;
  dateRange?: "week" | "month";
  onDateChange: (d?: string) => void;
  onDateRangeChange: (r?: "week" | "month") => void;
}) {
  const [open, setOpen] = useState(false);
  const hasFilter = !!date || !!dateRange;

  const label = date
    ? formatPillDate(date)
    : dateRange === "week"
      ? "this week"
      : dateRange === "month"
        ? "this month"
        : "date";

  const handleClear = () => { onDateChange(undefined); onDateRangeChange(undefined); };

  return (
    <View style={styles.datePillRow}>
      <TouchableOpacity
        style={[styles.pill, hasFilter && styles.pillActiveRed]}
        onPress={() => setOpen(true)}
        activeOpacity={0.75}
      >
        <Feather
          name="calendar"
          size={11}
          color={hasFilter ? '#9B4DA8' : 'rgba(0,0,0,0.45)'}
          style={{ marginRight: 4 }}
        />
        <Text style={[styles.pillText, hasFilter && styles.pillTextActive]}>
          {label}
        </Text>
      </TouchableOpacity>

      {hasFilter && (
        <TouchableOpacity style={styles.clearBtn} onPress={handleClear} hitSlop={8}>
          <Feather name="x" size={11} color={Theme.colors.secondary} />
        </TouchableOpacity>
      )}

      <DatePickerModal
        visible={open}
        selected={date}
        dateRange={dateRange}
        onSelect={(d) => { onDateChange(d); setOpen(false); }}
        onRangeSelect={(r) => { onDateRangeChange(r); setOpen(false); }}
        onClose={() => setOpen(false)}
      />
    </View>
  );
}

// ─── Calendar modal ───────────────────────────────────────────────────────────

function DatePickerModal({ visible, selected, dateRange, onSelect, onRangeSelect, onClose }: {
  visible: boolean;
  selected?: string;
  dateRange?: "week" | "month";
  onSelect: (date: string) => void;
  onRangeSelect: (r: "week" | "month") => void;
  onClose: () => void;
}) {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());

  // When opening, jump to the selected date's month (or today)
  useEffect(() => {
    if (!visible) return;
    if (selected) {
      const [sy, sm] = selected.split('-').map(Number);
      setViewYear(sy);
      setViewMonth(sm - 1);
    } else {
      setViewYear(now.getFullYear());
      setViewMonth(now.getMonth());
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth    = new Date(viewYear, viewMonth + 1, 0).getDate();
  const isCurrentMonth = viewYear === now.getFullYear() && viewMonth === now.getMonth();

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const isFuture = (d: number) => new Date(viewYear, viewMonth, d) > now;

  const isSelected = (d: number) => {
    if (!selected) return false;
    const [sy, sm, sd] = selected.split('-').map(Number);
    return sy === viewYear && sm === viewMonth + 1 && sd === d;
  };

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };

  const nextMonth = () => {
    if (isCurrentMonth) return;
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  const handleDay = (d: number) => {
    const m   = String(viewMonth + 1).padStart(2, '0');
    const day = String(d).padStart(2, '0');
    onSelect(`${viewYear}-${m}-${day}`);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        {/* Tap outside to dismiss */}
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />

        <View style={styles.modalCard}>
          {/* Quick range options */}
          <View style={styles.quickRow}>
            {(['week', 'month'] as const).map(r => (
              <TouchableOpacity
                key={r}
                style={[styles.quickBtn, dateRange === r && styles.quickBtnActive]}
                onPress={() => onRangeSelect(r)}
                activeOpacity={0.75}
              >
                <Text style={[styles.quickBtnText, dateRange === r && styles.quickBtnTextActive]}>
                  this {r}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.modalDivider} />

          {/* Month navigation */}
          <View style={styles.monthNav}>
            <TouchableOpacity onPress={prevMonth} hitSlop={12}>
              <Feather name="chevron-left" size={20} color={Theme.colors.primary} />
            </TouchableOpacity>
            <Text style={styles.monthLabel}>{MONTH_FULL[viewMonth]} {viewYear}</Text>
            <TouchableOpacity
              onPress={nextMonth}
              hitSlop={12}
              style={{ opacity: isCurrentMonth ? 0.2 : 1 }}
            >
              <Feather name="chevron-right" size={20} color={Theme.colors.primary} />
            </TouchableOpacity>
          </View>

          {/* Day-of-week headers */}
          <View style={styles.weekHeaders}>
            {DAY_LABELS.map(d => (
              <Text key={d} style={styles.weekHeader}>{d}</Text>
            ))}
          </View>

          {/* Calendar grid */}
          <View style={styles.calGrid}>
            {cells.map((cell, i) => {
              if (cell === null) return <View key={i} style={styles.calCell} />;
              const future = isFuture(cell);
              const sel    = isSelected(cell);
              return (
                <View key={i} style={styles.calCell}>
                  <TouchableOpacity
                    style={[styles.calDayInner, sel && styles.calDayInnerSel]}
                    onPress={() => handleDay(cell)}
                    activeOpacity={future ? 1 : 0.7}
                    disabled={future}
                  >
                    <Text style={[
                      styles.calDayNum,
                      future && styles.calDayFuture,
                      sel    && styles.calDayNumSel,
                    ]}>
                      {cell}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Shared sub-components ────────────────────────────────────────────────────

const PILL_MAX_CHARS = 14;

function Pill({ label, active, onPress, onLongPress, variant = 'default' }: { label: string; active: boolean; onPress: () => void; onLongPress?: () => void; variant?: 'tag' | 'default' | 'explore' | 'community' }) {
  const variantStyles: Record<string, { bg: any; text: any }> = {
    default: { bg: styles.pillActiveRed, text: styles.pillTextActive },
    tag: { bg: styles.pillActiveTag, text: styles.pillTextActiveTag },
    explore: { bg: styles.pillActiveExplore, text: styles.pillTextActiveExplore },
    community: { bg: styles.pillActiveCommunity, text: styles.pillTextActiveCommunity },
  };
  const { bg: activeStyle, text: activeTextStyle } = variantStyles[variant] ?? variantStyles.default;
  const displayLabel = active || label.length <= PILL_MAX_CHARS
    ? label
    : label.slice(0, PILL_MAX_CHARS).trimEnd() + '…';
  return (
    <TouchableOpacity
      style={[styles.pill, active && activeStyle]}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.75}
    >
      <Text style={[styles.pillText, active && activeTextStyle]}>{displayLabel}</Text>
    </TouchableOpacity>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, backgroundColor: Theme.colors.background },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 100,
    backgroundColor: Theme.colors.background,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.18)',
  },
  pillActiveRed: {
    backgroundColor: 'rgba(233,179,238,0.20)',
    borderColor: '#e9b3ee',
  },
  pillActiveTag: {
    backgroundColor: 'rgba(58,135,181,0.10)',
    borderColor: Theme.colors.accent,
  },
  pillText: {
    fontSize: Theme.font.xs,
    fontWeight: '600',
    color: 'rgba(0,0,0,0.55)',
    letterSpacing: 0.2,
  },
  pillTextActive: { color: '#9B4DA8' },
  pillTextActiveTag: { color: Theme.colors.accent },
  pillActiveExplore: {
    backgroundColor: 'rgba(249,199,79,0.20)',
    borderColor: '#F9C74F',
  },
  pillTextActiveExplore: { color: '#9B6B00' },
  pillActiveCommunity: {
    backgroundColor: 'rgba(247,127,173,0.15)',
    borderColor: '#F77FAD',
  },
  pillTextActiveCommunity: { color: '#D4578A' },

  divider: {
    width: 1,
    height: 18,
    backgroundColor: Theme.colors.border,
    marginHorizontal: 2,
  },

  datePillRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  clearBtn: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: Theme.colors.surface,
    borderWidth: 1, borderColor: Theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
  },

  quickRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  quickBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 100,
    backgroundColor: Theme.colors.surface,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    alignItems: 'center',
  },
  quickBtnActive: {
    backgroundColor: Theme.colors.brandWarm,
    borderColor: Theme.colors.brandWarm,
  },
  quickBtnText: {
    fontSize: Theme.font.xs,
    fontWeight: '600',
    color: 'rgba(0,0,0,0.55)',
  },
  quickBtnTextActive: { color: '#fff' },
  modalDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Theme.colors.border,
    marginBottom: 14,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    width: '100%',
    maxWidth: 340,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },

  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  monthLabel: {
    fontSize: Theme.font.base,
    fontWeight: '700',
    color: Theme.colors.primary,
    letterSpacing: -0.3,
  },

  weekHeaders: { flexDirection: 'row', marginBottom: 2 },
  weekHeader: {
    width: '14.28%',
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(0,0,0,0.3)',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    paddingBottom: 4,
  },

  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: {
    width: '14.28%',
    alignItems: 'center',
    paddingVertical: 2,
  },
  calDayInner: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  calDayInnerSel: { backgroundColor: Theme.colors.brandWarm },
  calDayNum: {
    fontSize: 13,
    fontWeight: '500',
    color: Theme.colors.primary,
  },
  calDayFuture: { color: 'rgba(0,0,0,0.2)' },
  calDayNumSel: { color: '#fff', fontWeight: '700' },
});
