import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, Image, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Dimensions, ScrollView,
  Modal, FlatList, Alert, Animated, PanResponder,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '@/constants/Theme';
import { getWardrobeItems, deleteWardrobeItem, mergeWardrobeItems, WardrobeItem } from '@/utils/api';

export const USER_CATS_KEY = '@muse/user_cats';
const DISMISSED_KEY = '@muse/dismissed_suggestions';

// ─── Client-side suggestion matching ─────────────────────────────────────────
type Suggestion = { itemA: WardrobeItem; itemB: WardrobeItem; key: string };

const LABEL_STOP = new Set(['a','an','the','with','and','or','of','in','on','at','by','to']);

function computeSuggestions(allItems: WardrobeItem[], dismissed: Set<string>): Suggestion[] {
  const tok = (s: string) => new Set(
    s.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/)
      .filter(w => w.length > 1 && !LABEL_STOP.has(w))
  );
  const result: Suggestion[] = [];
  for (let i = 0; i < allItems.length; i++) {
    for (let j = i + 1; j < allItems.length; j++) {
      const a = allItems[i], b = allItems[j];
      if (a.category && b.category && a.category !== b.category) continue;
      const tokA = tok(a.label), tokB = tok(b.label);
      let inter = 0;
      for (const w of tokA) if (tokB.has(w)) inter++;
      const union = tokA.size + tokB.size - inter;
      if (union === 0 || inter / union < 0.65) continue;
      const key = [a.id, b.id].sort().join(':');
      if (!dismissed.has(key)) result.push({ itemA: a, itemB: b, key });
    }
  }
  return result;
}
export const AUTO_SCAN_KEY = '@muse/auto_scan';
export const TAG_ORDER_KEY = '@muse/tag_order';

export async function loadUserCats(): Promise<string[]> {
  try {
    const v = await AsyncStorage.getItem(USER_CATS_KEY);
    return v ? JSON.parse(v) : [];
  } catch { return []; }
}

export async function saveUserCat(cat: string, existing: string[]): Promise<string[]> {
  const updated = Array.from(new Set([...existing, cat]));
  try { await AsyncStorage.setItem(USER_CATS_KEY, JSON.stringify(updated)); } catch {}
  return updated;
}

export async function removeUserCat(cat: string, existing: string[]): Promise<string[]> {
  const updated = existing.filter(c => c !== cat);
  try { await AsyncStorage.setItem(USER_CATS_KEY, JSON.stringify(updated)); } catch {}
  return updated;
}

const SCREEN_WIDTH = Math.min(Dimensions.get('window').width, 390);
const GRID_PAD = 20;
const GRID_GAP = 8;
const MERGE_CELL = Math.floor((SCREEN_WIDTH - 32 - 16) / 3);
const COMPARE_IMG = Math.floor((SCREEN_WIDTH - 32 - 12) / 2) - 20;

function GridDotsIcon({ cols }: { cols: 2 | 3 }) {
  if (cols === 2) {
    return (
      <View style={{ gap: 3 }}>
        {[0, 1].map(row => (
          <View key={row} style={{ flexDirection: 'row', gap: 3 }}>
            {[0, 1].map(ci => (
              <View key={ci} style={{ width: 10, height: 10, borderRadius: 2, borderWidth: 1.5, borderColor: Theme.colors.limeText }} />
            ))}
          </View>
        ))}
      </View>
    );
  }
  return (
    <View style={{ gap: 2.5 }}>
      {[0, 1, 2].map(row => (
        <View key={row} style={{ flexDirection: 'row', gap: 2.5 }}>
          {[0, 1, 2].map(ci => (
            <View key={ci} style={{ width: 7, height: 7, borderRadius: 1.5, borderWidth: 1.5, borderColor: Theme.colors.limeText }} />
          ))}
        </View>
      ))}
    </View>
  );
}

function categoryEmoji(cat: string | null): string {
  switch (cat) {
    case 'top': return '👕';
    case 'bottom': return '👖';
    case 'outerwear': return '🧥';
    case 'shoes': return '👟';
    case 'bag': return '👜';
    case 'dress': return '👗';
    case 'accessory': return '💍';
    default: return '🏷️';
  }
}

interface Props {
  userId: string;
  onItemPress: (id: string) => void;
  onLogOutfit?: () => void;
  readOnly?: boolean;
}

const PREDEFINED_CATS = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'bag', 'accessory'];
const REORDER_ROW_H = 52;

interface DraggableTagItemProps {
  tag: string;
  shiftAnim: Animated.Value;
  onDrag: (tag: string, dy: number, done: boolean) => void;
}

function DraggableTagItem({ tag, shiftAnim, onDrag }: DraggableTagItemProps) {
  const selfY = useRef(new Animated.Value(0)).current;
  const isDragging = useRef(false);
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => { selfY.setValue(0); isDragging.current = true; },
      onPanResponderMove: (_, gs) => { selfY.setValue(gs.dy); onDrag(tag, gs.dy, false); },
      onPanResponderRelease: (_, gs) => { isDragging.current = false; selfY.setValue(0); onDrag(tag, gs.dy, true); },
      onPanResponderTerminate: () => { isDragging.current = false; selfY.setValue(0); onDrag(tag, 0, true); },
    })
  ).current;

  // Animated.add so selfY drives the dragged item from frame 1 (no setState re-render gap).
  // shiftAnim stays 0 for the item being dragged; selfY stays 0 for items not being dragged.
  const combinedY = useRef(Animated.add(selfY, shiftAnim)).current;

  return (
    <Animated.View
      {...responder.panHandlers}
      style={[reorderRowStyle, { transform: [{ translateY: combinedY }] }]}
    >
      <Text style={reorderLabelStyle}>{tag}</Text>
      <Feather name="menu" size={18} color={Theme.colors.limeMuted} />
    </Animated.View>
  );
}

const reorderRowStyle: object = {
  flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  height: REORDER_ROW_H, paddingHorizontal: 20,
  borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.07)',
  backgroundColor: Theme.colors.background,
};
const reorderLabelStyle: object = {
  fontSize: 15, color: Theme.colors.primary, fontWeight: '500',
};

export function WardrobeGrid({ userId, onItemPress, onLogOutfit, readOnly = false }: Props) {
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [userCats, setUserCats] = useState<string[]>([]);
  const [tagOrder, setTagOrder] = useState<string[]>([]);
  const [cols, setCols] = useState<2 | 3>(3);
  const [reorderVisible, setReorderVisible] = useState(false);
  const [draftOrder, setDraftOrder] = useState<string[]>([]);
  const draftRef = useRef<string[]>([]);
  const itemShiftAnims = useRef<Record<string, Animated.Value>>({});

  const getShiftAnim = (tag: string) => {
    if (!itemShiftAnims.current[tag]) itemShiftAnims.current[tag] = new Animated.Value(0);
    return itemShiftAnims.current[tag];
  };

  // Suggestion state
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [reviewSuggestion, setReviewSuggestion] = useState<Suggestion | null>(null);
  const [reviewVisible, setReviewVisible] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewStep, setReviewStep] = useState<1 | 2>(1); // 1 = confirm, 2 = pick photo
  const [reviewKeepA, setReviewKeepA] = useState(true);

  // Merge state
  const [mergeSource, setMergeSource] = useState<WardrobeItem | null>(null);
  const [mergeTarget, setMergeTarget] = useState<WardrobeItem | null>(null);
  const [keepCurrentImage, setKeepCurrentImage] = useState(true);
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    loadUserCats().then(setUserCats);
    AsyncStorage.getItem(TAG_ORDER_KEY).then(v => {
      if (v) setTagOrder(JSON.parse(v));
    });
  }, []);

  const loadItems = useCallback(async () => {
    if (!userId) return;
    const loaded = await getWardrobeItems(userId);
    // Auto-delete items that never got an image after 5 minutes (failed generation)
    const FIVE_MIN = 5 * 60 * 1000;
    const stale = loaded.filter(i =>
      !i.generated_image_url && !i.photos?.length &&
      Date.now() - new Date(i.created_at).getTime() > FIVE_MIN
    );
    stale.forEach(i => deleteWardrobeItem(i.id).catch(() => {}));
    const clean = stale.length ? loaded.filter(i => !stale.some(s => s.id === i.id)) : loaded;
    setItems(clean);
    // Auto-persist any item categories not yet in userCats
    const current = await loadUserCats();
    let updated = [...current];
    for (const item of loaded) {
      if (item.category && !PREDEFINED_CATS.includes(item.category) && !updated.includes(item.category)) {
        updated.push(item.category);
      }
    }
    if (updated.length !== current.length) {
      await AsyncStorage.setItem(USER_CATS_KEY, JSON.stringify(updated));
      setUserCats(updated);
    }
    return clean;
  }, [userId]);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    loadItems().catch(() => {}).finally(() => setLoading(false));
  }, [userId, loadItems]);

  // Recompute suggestions on every focus using loaded items + AsyncStorage dismissed set
  useFocusEffect(
    useCallback(() => {
      const run = async () => {
        const loaded = await loadItems().catch(() => undefined);
        if (!loaded) return;
        const withImg = loaded.filter(i => i.generated_image_url || i.photos?.[0]?.photo_url);
        const raw = await AsyncStorage.getItem(DISMISSED_KEY).catch(() => null);
        const dismissed = new Set<string>(raw ? JSON.parse(raw) : []);
        setSuggestions(computeSuggestions(withImg, dismissed));
      };
      run();
    }, [loadItems])
  );

  // Poll every 8s while any items are still missing their image
  useEffect(() => {
    const pending = items.filter(i => !i.generated_image_url && !(i.photos?.length));
    if (pending.length === 0) return;
    const interval = setInterval(() => loadItems().catch(() => {}), 8000);
    return () => clearInterval(interval);
  }, [items, loadItems]);

  const openReorder = useCallback(() => {
    const tags = Array.from(new Set(items.flatMap((i: WardrobeItem) => (i.tags ?? []) as string[])));
    const order = [
      ...tagOrder.filter((t: string) => tags.includes(t)),
      ...tags.filter((t: string) => !tagOrder.includes(t)),
    ];
    draftRef.current = order;
    setDraftOrder(order);
    order.forEach((t: string) => getShiftAnim(t).setValue(0));
    setReorderVisible(true);
  }, [tagOrder, items]);

  const handleItemDrag = useCallback((tag: string, dy: number, done: boolean) => {
    const current = draftRef.current;
    const fromIdx = current.indexOf(tag);
    const toIdx = Math.max(0, Math.min(current.length - 1, fromIdx + Math.round(dy / REORDER_ROW_H)));
    if (!done) {
      current.forEach((t, i) => {
        if (t === tag) return;
        let shift = 0;
        if (toIdx < fromIdx && i >= toIdx && i < fromIdx) shift = REORDER_ROW_H;
        else if (toIdx > fromIdx && i > fromIdx && i <= toIdx) shift = -REORDER_ROW_H;
        Animated.timing(getShiftAnim(t), { toValue: shift, duration: 120, useNativeDriver: false }).start();
      });
    } else {
      const next = [...current];
      const [item] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, item);
      current.forEach(t => getShiftAnim(t).setValue(0));
      draftRef.current = next;
      setDraftOrder([...next]);
    }
  }, []);

  const saveReorder = useCallback(() => {
    const final = draftRef.current;
    setTagOrder(final);
    AsyncStorage.setItem(TAG_ORDER_KEY, JSON.stringify(final)).catch(() => {});
    setReorderVisible(false);
  }, []);

  const handleLongPress = (item: WardrobeItem) => {
    setMergeSource(item);
    setMergeTarget(null);
    setKeepCurrentImage(true);
  };

  const handleMerge = async () => {
    if (!mergeSource || !mergeTarget) return;
    setMerging(true);
    try {
      await mergeWardrobeItems(mergeSource.id, mergeTarget.id, !keepCurrentImage);
      setMergeSource(null);
      setMergeTarget(null);
      loadItems().catch(() => {});
    } catch (e: any) {
      Alert.alert('error', e?.message ?? 'could not merge items');
    } finally {
      setMerging(false);
    }
  };

  const advanceReview = (done: Suggestion) => {
    const remaining = suggestions.filter(s => s.key !== done.key);
    setSuggestions(remaining);
    setReviewStep(1);
    setReviewKeepA(true);
    if (remaining.length > 0) {
      setReviewSuggestion(remaining[0]);
    } else {
      setReviewVisible(false);
      setReviewSuggestion(null);
    }
  };

  const persistDismiss = async (key: string) => {
    const raw = await AsyncStorage.getItem(DISMISSED_KEY).catch(() => null);
    const arr: string[] = raw ? JSON.parse(raw) : [];
    if (!arr.includes(key)) arr.push(key);
    await AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify(arr));
  };

  const handleConfirmMerge = async () => {
    if (!reviewSuggestion || reviewLoading) return;
    setReviewLoading(true);
    try {
      const keepId = reviewKeepA ? reviewSuggestion.itemA.id : reviewSuggestion.itemB.id;
      const deleteId = reviewKeepA ? reviewSuggestion.itemB.id : reviewSuggestion.itemA.id;
      await mergeWardrobeItems(keepId, deleteId, false);
      advanceReview(reviewSuggestion);
      loadItems().catch(() => {});
    } catch (e: any) {
      Alert.alert('error', e?.message ?? 'could not merge');
    } finally {
      setReviewLoading(false);
    }
  };

  const handleDifferentItem = async () => {
    if (!reviewSuggestion || reviewLoading) return;
    setReviewLoading(true);
    try {
      await persistDismiss(reviewSuggestion.key);
      advanceReview(reviewSuggestion);
    } catch {} finally {
      setReviewLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="small" color={Theme.colors.limeText} />
      </View>
    );
  }

  // Predefined + user-created custom categories
  const allFilterCats = [...PREDEFINED_CATS, ...userCats.filter(c => !PREDEFINED_CATS.includes(c))];

  // All unique tags across items, respecting user-defined order
  const allTags = Array.from(new Set(items.flatMap(i => i.tags ?? [])));
  const orderedTags = [
    ...tagOrder.filter(t => allTags.includes(t)),
    ...allTags.filter(t => !tagOrder.includes(t)),
  ];

  // Only show items that have an image (AI-generated or user-uploaded)
  const withImages = items.filter(i => i.generated_image_url || i.photos?.[0]?.photo_url);

  const filtered = withImages.filter(item => {
    if (search) {
      const q = search.toLowerCase();
      const haystack = [
        item.label,
        item.description,
        item.brand,
        item.category,
        item.link_url,
        ...(item.tags ?? []),
      ].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (filterCat && item.category !== filterCat) return false;
    if (filterTag && !(item.tags ?? []).includes(filterTag)) return false;
    return true;
  });

  const cellSize = Math.floor((SCREEN_WIDTH - GRID_PAD * 2 - GRID_GAP * (cols - 1)) / cols);

  const rows: WardrobeItem[][] = [];
  for (let i = 0; i < filtered.length; i += cols) {
    rows.push(filtered.slice(i, i + cols));
  }

  const mergeOtherItems = mergeSource
    ? (() => {
        const sourceWords = new Set(mergeSource.label.toLowerCase().split(/\s+/).filter(Boolean));
        return items
          .filter(i => i.id !== mergeSource.id && (i.generated_image_url || i.photos?.[0]?.photo_url))
          .sort((a, b) => {
            const score = (mi: WardrobeItem) => {
              let s = 0;
              const words = mi.label.toLowerCase().split(/\s+/).filter(Boolean);
              if (words.some(w => sourceWords.has(w))) s += 2;
              if (mi.category && mergeSource.category && mi.category === mergeSource.category) s += 1;
              return s;
            };
            const diff = score(b) - score(a);
            if (diff !== 0) return diff;
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          });
      })()
    : [];

  const suggestionsByItemId = new Map<string, Suggestion>();
  for (const s of suggestions) {
    if (!suggestionsByItemId.has(s.itemA.id)) suggestionsByItemId.set(s.itemA.id, s);
    if (!suggestionsByItemId.has(s.itemB.id)) suggestionsByItemId.set(s.itemB.id, s);
  }

  return (
    <>
      <View style={styles.container}>
        {/* Top row: search + grid toggle */}
        <View style={styles.topRow}>
          <View style={styles.searchBar}>
            <Feather name="search" size={13} color={Theme.colors.limeMuted} />
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder={`search ${withImages.length} items`}
              placeholderTextColor={Theme.colors.limeMuted}
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
                <Feather name="x" size={12} color={Theme.colors.limeMuted} />
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity onPress={() => setCols(c => c === 3 ? 2 : 3)} hitSlop={8} style={styles.gridToggleBtn}>
            <GridDotsIcon cols={cols === 3 ? 2 : 3} />
          </TouchableOpacity>
        </View>

        {/* Category filter chips — always show all types */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScroll}
          contentContainerStyle={styles.filterContent}
        >
          <TouchableOpacity
            style={[styles.filterChip, !filterCat && styles.filterChipActive]}
            onPress={() => setFilterCat(null)}
            activeOpacity={0.75}
          >
            <Text style={[styles.filterChipText, !filterCat && styles.filterChipTextActive]}>all</Text>
          </TouchableOpacity>
          {allFilterCats.map((cat: string) => (
            <TouchableOpacity
              key={cat}
              style={[styles.filterChip, filterCat === cat && styles.filterChipActive]}
              onPress={() => setFilterCat(filterCat === cat ? null : cat)}
              activeOpacity={0.75}
            >
              <Text style={[styles.filterChipText, filterCat === cat && styles.filterChipTextActive]}>
                {categoryEmoji(cat)} {cat}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Tag filter chips — only when items have tags */}
        {orderedTags.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tagFilterScroll}
            contentContainerStyle={styles.filterContent}
          >
            {filterTag && (
              <TouchableOpacity
                style={[styles.filterChip, styles.filterChipActive]}
                onPress={() => setFilterTag(null)}
                activeOpacity={0.75}
              >
                <Text style={[styles.filterChipText, styles.filterChipTextActive]}>✕ {filterTag}</Text>
              </TouchableOpacity>
            )}
            {orderedTags.filter(t => t !== filterTag).map(tag => (
              <TouchableOpacity
                key={tag}
                style={[styles.tagFilterChip, filterTag === tag && styles.tagFilterChipActive]}
                onPress={() => setFilterTag(filterTag === tag ? null : tag)}
                onLongPress={openReorder}
                delayLongPress={400}
                activeOpacity={0.75}
              >
                <Text style={[styles.tagFilterChipText, filterTag === tag && styles.tagFilterChipTextActive]}>
                  {tag}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Suggestion banner */}
        {!readOnly && items.length > 0 && suggestions.length > 0 && (
          <TouchableOpacity
            style={styles.suggestionBanner}
            onPress={() => { setReviewSuggestion(suggestions[0]); setReviewVisible(true); }}
            activeOpacity={0.8}
          >
            <View style={styles.suggestionBannerLeft}>
              <View style={styles.suggestionDotSm} />
              <Text style={styles.suggestionBannerText}>
                {suggestions.length === 1 ? 'already in your closet?' : `${suggestions.length} items might already be in your closet`}
              </Text>
            </View>
            <Text style={styles.suggestionBannerAction}>review →</Text>
          </TouchableOpacity>
        )}

        {/* Empty state */}
        {items.length === 0 ? (
          <View style={styles.empty}>
            {readOnly ? (
              <Text style={styles.noMatchText}>no items yet</Text>
            ) : (
              <TouchableOpacity onPress={onLogOutfit} activeOpacity={0.75} style={styles.logOutfitBtnWrap}>
                <LinearGradient colors={['#F9C74F', '#F77FAD']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.logOutfitBtn}>
                  <Feather name="zap" size={13} color={Theme.colors.primary} />
                  <Text style={styles.logOutfitText}>log outfit to add items</Text>
                </LinearGradient>
              </TouchableOpacity>
            )}
          </View>
        ) : withImages.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator size="small" color={Theme.colors.limeText} style={{ marginBottom: 8 }} />
            <Text style={styles.noMatchText}>growing your wardrobe...</Text>
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.noMatchText}>no items match</Text>
          </View>
        ) : (
          <>
            {rows.map((row, ri) => (
              <View key={ri} style={styles.row}>
                {row.map(item => {
                  const imageUrl = item.generated_image_url ?? item.photos?.[0]?.photo_url ?? null;
                  const isUserPhoto = !item.generated_image_url && !!item.photos?.[0]?.photo_url;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[styles.cell, { width: cellSize }]}
                      onPress={() => onItemPress(item.id)}
                      onLongPress={() => { if (!readOnly) handleLongPress(item); }}
                      activeOpacity={0.82}
                    >
                      {imageUrl ? (
                        <View style={[styles.cellImage, styles.cellImageWhiteBg, !isUserPhoto && styles.cellImagePad, { width: cellSize, height: cellSize }]}>
                          <Image
                            source={{ uri: imageUrl }}
                            style={styles.cellImageFill}
                            resizeMode="contain"
                          />
                        </View>
                      ) : (
                        <View style={[styles.cellImage, styles.cellPlaceholder, { width: cellSize, height: cellSize }]}>
                          <Text style={styles.cellEmoji}>{categoryEmoji(item.category)}</Text>
                        </View>
                      )}
                      {item.category && (
                        <View style={styles.catBadge}>
                          <Text style={styles.catBadgeText}>{categoryEmoji(item.category)}</Text>
                        </View>
                      )}
                      {suggestionsByItemId.has(item.id) && (
                        <TouchableOpacity
                          style={styles.suggestionBadge}
                          onPress={() => {
                            const sug = suggestionsByItemId.get(item.id)!;
                            setReviewSuggestion(sug);
                            setReviewVisible(true);
                          }}
                          hitSlop={6}
                        >
                          <View style={styles.suggestionDot} />
                        </TouchableOpacity>
                      )}
                    </TouchableOpacity>
                  );
                })}
                {row.length < cols && Array.from({ length: cols - row.length }).map((_, i) => (
                  <View key={`filler-${i}`} style={[styles.cell, { width: cellSize }]} />
                ))}
              </View>
            ))}
            {!readOnly && <Text style={styles.autoScanLabel}>log more outfits to grow your closet 👀</Text>}
          </>
        )}
      </View>

      {/* Tag reorder modal */}
      <Modal
        visible={reorderVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={saveReorder}
      >
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <View style={{ width: 20 }} />
            <Text style={styles.modalTitle}>reorder tags</Text>
            <TouchableOpacity onPress={saveReorder} hitSlop={12}>
              <Text style={styles.reorderDone}>done</Text>
            </TouchableOpacity>
          </View>
          <View>
            {draftOrder.map(tag => (
              <DraggableTagItem
                key={tag}
                tag={tag}
                shiftAnim={getShiftAnim(tag)}
                onDrag={handleItemDrag}
              />
            ))}
          </View>
        </SafeAreaView>
      </Modal>

      {/* Suggestion review modal */}
      <Modal
        visible={reviewVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => { setReviewStep(1); setReviewKeepA(true); setReviewVisible(false); setReviewSuggestion(null); }}
      >
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <TouchableOpacity
              onPress={() => {
                if (reviewStep === 2) { setReviewStep(1); }
                else { setReviewStep(1); setReviewKeepA(true); setReviewVisible(false); setReviewSuggestion(null); }
              }}
              hitSlop={12}
            >
              <Feather name={reviewStep === 2 ? 'arrow-left' : 'x'} size={20} color={Theme.colors.primary} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              {reviewStep === 2 ? 'pick your fave photo' : 'already in your closet?'}
            </Text>
            <View style={{ width: 20 }} />
          </View>

          {reviewSuggestion && reviewStep === 1 && (
            <ScrollView contentContainerStyle={styles.mergeConfirmContent}>
              {suggestions.length > 1 && (
                <Text style={styles.reviewProgress}>
                  {suggestions.findIndex(s => s.key === reviewSuggestion.key) + 1} of {suggestions.length}
                </Text>
              )}
              <Text style={styles.mergeHint}>we think these might be the same piece — are they?</Text>
              <View style={styles.mergeCompare}>
                {[reviewSuggestion.itemA, reviewSuggestion.itemB].map(wi => {
                  const imgUrl = wi.generated_image_url ?? wi.photos?.[0]?.photo_url;
                  return (
                    <View key={wi.id} style={styles.mergeCompareCol}>
                      {imgUrl ? (
                        <Image source={{ uri: imgUrl }} style={styles.mergeCompareImg} resizeMode="contain" />
                      ) : (
                        <View style={[styles.mergeCompareImg, styles.mergePlaceholder]}>
                          <Text style={{ fontSize: 36 }}>{categoryEmoji(wi.category)}</Text>
                        </View>
                      )}
                      <Text style={styles.mergeCompareLabel} numberOfLines={2}>{wi.label}</Text>
                    </View>
                  );
                })}
              </View>
              <TouchableOpacity onPress={() => { setReviewStep(2); setReviewKeepA(true); }} activeOpacity={0.82}>
                <LinearGradient
                  colors={['#fdf5b9', '#f0c8e8', '#e9b3ee']}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={styles.mergeConfirmBtn}
                >
                  <Text style={styles.mergeConfirmBtnText}>same piece →</Text>
                </LinearGradient>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleDifferentItem}
                disabled={reviewLoading}
                activeOpacity={0.82}
                style={[styles.reviewBtnSecondary, { marginTop: 10 }, reviewLoading && { opacity: 0.5 }]}
              >
                <Text style={styles.reviewBtnSecondaryText}>different items</Text>
              </TouchableOpacity>
            </ScrollView>
          )}

          {reviewSuggestion && reviewStep === 2 && (
            <ScrollView contentContainerStyle={styles.mergeConfirmContent}>
              <Text style={styles.mergeHint}>
                pick the photo you love most and we'll combine all your outfits ✨
              </Text>
              <View style={styles.mergeCompare}>
                {([
                  { wi: reviewSuggestion.itemA, keepA: true },
                  { wi: reviewSuggestion.itemB, keepA: false },
                ] as const).map(({ wi, keepA }) => {
                  const imgUrl = wi.generated_image_url ?? wi.photos?.[0]?.photo_url;
                  const selected = reviewKeepA === keepA;
                  return (
                    <TouchableOpacity
                      key={wi.id}
                      style={[styles.mergeCompareCol, selected && styles.mergeCompareColActive]}
                      onPress={() => setReviewKeepA(keepA)}
                      activeOpacity={0.85}
                    >
                      {imgUrl ? (
                        <Image source={{ uri: imgUrl }} style={styles.mergeCompareImg} resizeMode="contain" />
                      ) : (
                        <View style={[styles.mergeCompareImg, styles.mergePlaceholder]}>
                          <Text style={{ fontSize: 36 }}>{categoryEmoji(wi.category)}</Text>
                        </View>
                      )}
                      <Text style={styles.mergeCompareLabel} numberOfLines={2}>{wi.label}</Text>
                      {selected && (
                        <View style={styles.mergeCheck}>
                          <Feather name="check" size={12} color="#fff" />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.mergeWarning}>the other item quietly disappears after merging</Text>
              <TouchableOpacity
                onPress={handleConfirmMerge}
                disabled={reviewLoading}
                activeOpacity={0.82}
                style={reviewLoading ? { opacity: 0.5 } : undefined}
              >
                <LinearGradient
                  colors={['#fdf5b9', '#f0c8e8', '#e9b3ee']}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={styles.mergeConfirmBtn}
                >
                  {reviewLoading
                    ? <ActivityIndicator color="#9B4D7E" />
                    : <Text style={styles.mergeConfirmBtnText}>merge ✨</Text>}
                </LinearGradient>
              </TouchableOpacity>
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>

      {/* Merge modal — opens directly from long press, no screen navigation */}
      <Modal
        visible={mergeSource !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => { if (mergeTarget) setMergeTarget(null); else setMergeSource(null); }}
      >
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <TouchableOpacity
              onPress={() => { if (mergeTarget) setMergeTarget(null); else setMergeSource(null); }}
              hitSlop={12}
            >
              <Feather name={mergeTarget ? 'arrow-left' : 'x'} size={20} color={Theme.colors.primary} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              {mergeTarget ? 'pick your fave photo' : 'merge with...'}
            </Text>
            <View style={{ width: 20 }} />
          </View>

          {!mergeTarget ? (
            /* Step 1: pick item to merge with */
            <FlatList
              data={mergeOtherItems}
              keyExtractor={i => i.id}
              numColumns={3}
              contentContainerStyle={styles.mergeGrid}
              columnWrapperStyle={styles.mergeGridRow}
              renderItem={({ item: mi }) => {
                const imgUrl = mi.generated_image_url ?? mi.photos?.[0]?.photo_url;
                return (
                  <TouchableOpacity
                    style={styles.mergeCell}
                    onPress={() => { setMergeTarget(mi); setKeepCurrentImage(true); }}
                    activeOpacity={0.8}
                  >
                    {imgUrl ? (
                      <Image source={{ uri: imgUrl }} style={styles.mergeCellImage} resizeMode="contain" />
                    ) : (
                      <View style={[styles.mergeCellImage, styles.mergePlaceholder]}>
                        <Text style={{ fontSize: 28 }}>{categoryEmoji(mi.category)}</Text>
                      </View>
                    )}
                    <Text style={styles.mergeCellLabel} numberOfLines={2}>{mi.label}</Text>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={styles.mergeEmpty}>
                  <Text style={styles.mergeEmptyText}>no other items to merge with</Text>
                </View>
              }
            />
          ) : (
            /* Step 2: choose image + confirm */
            <ScrollView contentContainerStyle={styles.mergeConfirmContent}>
              <Text style={styles.mergeHint}>
                these two are the same thing — pick the photo you love most and we'll combine all your outfits ✨
              </Text>
              <View style={styles.mergeCompare}>
                {([
                  { wi: mergeSource!, isCurrent: true },
                  { wi: mergeTarget, isCurrent: false },
                ] as const).map(({ wi, isCurrent }) => {
                  const imgUrl = wi.generated_image_url ?? wi.photos?.[0]?.photo_url;
                  const selected = isCurrent ? keepCurrentImage : !keepCurrentImage;
                  return (
                    <TouchableOpacity
                      key={wi.id}
                      style={[styles.mergeCompareCol, selected && styles.mergeCompareColActive]}
                      onPress={() => setKeepCurrentImage(isCurrent)}
                      activeOpacity={0.85}
                    >
                      {imgUrl ? (
                        <Image source={{ uri: imgUrl }} style={styles.mergeCompareImg} resizeMode="contain" />
                      ) : (
                        <View style={[styles.mergeCompareImg, styles.mergePlaceholder]}>
                          <Text style={{ fontSize: 36 }}>{categoryEmoji(wi.category)}</Text>
                        </View>
                      )}
                      <Text style={styles.mergeCompareLabel} numberOfLines={2}>{wi.label}</Text>
                      {selected && (
                        <View style={styles.mergeCheck}>
                          <Feather name="check" size={12} color="#fff" />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.mergeWarning}>
                the other item quietly disappears after merging
              </Text>
              <TouchableOpacity
                onPress={handleMerge}
                disabled={merging}
                activeOpacity={0.82}
                style={merging ? { opacity: 0.5 } : undefined}
              >
                <LinearGradient
                  colors={['#fdf5b9', '#f0c8e8', '#e9b3ee']}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={styles.mergeConfirmBtn}
                >
                  {merging
                    ? <ActivityIndicator color="#9B4D7E" />
                    : <Text style={styles.mergeConfirmBtnText}>merge ✨</Text>
                  }
                </LinearGradient>
              </TouchableOpacity>
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: GRID_PAD, paddingBottom: 32 },
  center: { paddingVertical: 32, alignItems: 'center' },

  // Top row
  topRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14,
  },
  searchBar: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: 'rgba(0,0,0,0.07)', borderRadius: Theme.radius.sm,
    paddingHorizontal: 10, paddingVertical: 10,
  },
  searchInput: {
    flex: 1, fontSize: Theme.font.xs, color: Theme.colors.limeText,
    padding: 0, margin: 0, height: 16,
  },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: Theme.radius.sm,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.18)',
  },
  addBtnText: {
    fontSize: Theme.font.xs, fontWeight: '600',
    color: Theme.colors.limeText,
  },

  // Category filters
  filterScroll: { marginHorizontal: -GRID_PAD, marginBottom: 16 },
  filterContent: { paddingHorizontal: GRID_PAD, gap: 7, flexDirection: 'row' },
  filterChip: {
    paddingHorizontal: 11, paddingVertical: 5,
    borderRadius: 100, borderWidth: 1, borderColor: 'rgba(0,0,0,0.18)',
    backgroundColor: 'transparent',
  },
  filterChipActive: { backgroundColor: 'rgba(0,0,0,0.75)', borderColor: 'transparent' },
  filterChipText: {
    fontSize: Theme.font.xs, fontWeight: '600', color: Theme.colors.limeText,
  },
  filterChipTextActive: { color: '#fff' },
  // Tag filters
  tagFilterScroll: { marginHorizontal: -GRID_PAD, marginBottom: 12 },
  tagFilterChip: {
    paddingHorizontal: 11, paddingVertical: 5,
    borderRadius: 100, borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  tagFilterChipText: { fontSize: Theme.font.xs, fontWeight: '500', color: Theme.colors.limeText },
  tagFilterChipActive: { backgroundColor: 'rgba(0,0,0,0.75)', borderColor: 'transparent' },
  tagFilterChipTextActive: { color: '#fff' },
  reorderDone: { fontSize: Theme.font.sm, fontWeight: '600', color: Theme.colors.primary },

  // Empty
  empty: { paddingVertical: 40, alignItems: 'center' },
  logOutfitBtnWrap: { borderRadius: Theme.radius.sm, overflow: 'hidden' },
  logOutfitBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 16,
  },
  logOutfitText: {
    fontSize: Theme.font.xs, fontWeight: '700', color: Theme.colors.primary,
  },
  noMatchText: {
    fontSize: Theme.font.sm, color: Theme.colors.limeMuted,
  },

  // Grid
  row: { flexDirection: 'row', gap: GRID_GAP, marginBottom: GRID_GAP },
  cell: {},
  cellImage: {
    borderRadius: Theme.radius.md,
  },
  gridToggleBtn: {
    padding: 6,
  },
  cellImageWhiteBg: { backgroundColor: '#FFFFFF', overflow: 'hidden' },
  cellImagePad: { padding: 8 },
  cellImageFill: { flex: 1 },
  cellPlaceholder: {
    backgroundColor: 'rgba(0,0,0,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  cellEmoji: { fontSize: 36 },
  catBadge: {
    position: 'absolute', bottom: 6, right: 6,
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius: 10, paddingHorizontal: 4, paddingVertical: 2,
  },
  catBadgeText: { fontSize: 12 },

  autoScanRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, marginTop: 20, alignSelf: 'center',
  },
  autoScanPill: {
    width: 36, height: 20, borderRadius: 10,
    justifyContent: 'center', paddingHorizontal: 2,
  },
  autoScanPillOff: { backgroundColor: 'rgba(0,0,0,0.15)' },
  autoScanThumbRight: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: '#fff', alignSelf: 'flex-end',
  },
  autoScanThumbLeft: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: '#fff', alignSelf: 'flex-start',
  },
  autoScanLabel: {
    fontSize: Theme.font.sm, color: Theme.colors.limeMuted,
    textAlign: 'center', paddingTop: 18,
  },

  // Merge modal
  modalSafe: { flex: 1, backgroundColor: Theme.colors.background },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Theme.colors.border,
  },
  modalTitle: {
    fontFamily: 'Caprasimo_400Regular', fontSize: Theme.font.md,
    color: Theme.colors.primary,
  },
  mergeGrid: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32 },
  mergeGridRow: { gap: 8, marginBottom: 8 },
  mergeCell: { width: MERGE_CELL },
  mergeCellImage: {
    width: MERGE_CELL, height: MERGE_CELL, borderRadius: 12,
    backgroundColor: '#fff', overflow: 'hidden',
  },
  mergePlaceholder: { backgroundColor: Theme.colors.surface, alignItems: 'center', justifyContent: 'center' },
  mergeCellLabel: {
    fontSize: 10, color: Theme.colors.primary, fontWeight: '500',
    marginTop: 4, textAlign: 'center',
  },
  mergeEmpty: { flex: 1, alignItems: 'center', paddingTop: 48 },
  mergeEmptyText: { fontSize: Theme.font.sm, color: Theme.colors.disabled },
  mergeConfirmContent: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 40 },
  mergeHint: {
    fontSize: Theme.font.sm, color: Theme.colors.secondary,
    textAlign: 'center', lineHeight: 20, marginBottom: 24,
  },
  mergeCompare: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  mergeCompareCol: {
    flex: 1, alignItems: 'center', borderRadius: 16, padding: 8,
    borderWidth: 2, borderColor: 'transparent', position: 'relative',
  },
  mergeCompareColActive: {
    borderColor: '#E879A8', backgroundColor: 'rgba(240,168,212,0.10)',
  },
  mergeCompareImg: {
    width: COMPARE_IMG, height: COMPARE_IMG, borderRadius: 12, backgroundColor: '#fff',
  },
  mergeCompareLabel: {
    fontSize: Theme.font.xs, color: Theme.colors.primary,
    fontWeight: '500', textAlign: 'center', marginTop: 8,
  },
  mergeCheck: {
    position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#E879A8', alignItems: 'center', justifyContent: 'center',
  },
  mergeWarning: {
    fontSize: Theme.font.xs, color: Theme.colors.disabled,
    textAlign: 'center', lineHeight: 18, marginBottom: 20,
  },
  mergeConfirmBtn: {
    borderRadius: Theme.radius.md, paddingVertical: 16, alignItems: 'center',
  },
  mergeConfirmBtnText: { fontSize: Theme.font.base, fontWeight: '700', color: '#7C3060' },

  // Suggestion banner
  suggestionBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(232,39,45,0.05)',
    borderRadius: Theme.radius.sm,
    paddingHorizontal: 12, paddingVertical: 10,
    marginBottom: 14,
    borderWidth: 1, borderColor: 'rgba(232,39,45,0.15)',
  },
  suggestionBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  suggestionDotSm: { width: 6, height: 6, borderRadius: 3, backgroundColor: Theme.colors.brandWarm },
  suggestionBannerText: { fontSize: Theme.font.xs, color: Theme.colors.primary, fontWeight: '500', flex: 1 },
  suggestionBannerAction: { fontSize: Theme.font.xs, color: Theme.colors.brandWarm, fontWeight: '600' },

  // Card badge
  suggestionBadge: {
    position: 'absolute', top: 6, right: 6,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center', justifyContent: 'center',
  },
  suggestionDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Theme.colors.brandWarm },

  // Review modal
  reviewContent: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 40 },
  reviewProgress: {
    fontSize: Theme.font.xs, color: Theme.colors.disabled,
    textAlign: 'center', marginBottom: 12,
  },
  reviewHint: {
    fontSize: Theme.font.sm, color: Theme.colors.secondary,
    textAlign: 'center', lineHeight: 20, marginBottom: 24,
  },
  reviewRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  reviewItem: { flex: 1, alignItems: 'center' },
  reviewImg: { width: COMPARE_IMG, height: COMPARE_IMG, borderRadius: 12, backgroundColor: '#fff' },
  reviewItemLabel: {
    fontSize: Theme.font.xs, color: Theme.colors.primary,
    fontWeight: '500', textAlign: 'center', marginTop: 8,
  },
  reviewItemSub: {
    fontSize: 10, color: Theme.colors.disabled, textAlign: 'center',
    marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  reviewBtn: {
    borderRadius: Theme.radius.md, paddingVertical: 14, alignItems: 'center',
    marginBottom: 10, backgroundColor: 'rgba(232,39,45,0.07)',
    borderWidth: 1, borderColor: 'rgba(232,39,45,0.18)',
  },
  reviewBtnText: { fontSize: Theme.font.sm, fontWeight: '700', color: Theme.colors.brandWarm },
  reviewBtnSecondary: {
    borderRadius: Theme.radius.md, paddingVertical: 14, alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)',
  },
  reviewBtnSecondaryText: { fontSize: Theme.font.sm, fontWeight: '500', color: Theme.colors.secondary },
});
