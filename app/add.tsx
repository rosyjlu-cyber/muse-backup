import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Dimensions,
  ActivityIndicator,
  ScrollView,
  Animated,
  PanResponder,
  Switch,
  FlatList,
  Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as MediaLibrary from 'expo-media-library';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { Theme } from '@/constants/Theme';
import { upsertPost, scanOutfit, generateItemImage, addPostWardrobeItem, getWardrobeItems, type WardrobeItem } from '@/utils/api';
import { useAuth } from '@/utils/auth';
import { formatDate, todayString } from '@/utils/dates';
import { TagInput } from '@/components/TagInput';
import { AUTO_SCAN_KEY } from '@/components/WardrobeGrid';

const SCREEN_WIDTH = Math.min(Dimensions.get('window').width, 390);
const ADD_BLUE       = '#5A8FA8';           // mirror steel blue
const ADD_BLUE_LIGHT = 'rgba(90,143,168,0.12)'; // icon ring tint
const CARD_W = SCREEN_WIDTH - 32;
const CARD_H = Math.round(CARD_W * (4 / 3));
// Picker modal: fixed cell width so odd last item stays half-width (not full-width)
const PICKER_CELL_W = Math.floor((SCREEN_WIDTH - 32 - 12) / 2);

// ─── Crop view ────────────────────────────────────────────────────────────────

function CropView({
  asset,
  onConfirm,
  onCancel,
}: {
  asset: ImagePicker.ImagePickerAsset;
  onConfirm: (panX: number, panY: number, totalDisplayScale: number) => Promise<void>;
  onCancel: () => void;
}) {
  const { width: imgW, height: imgH, uri } = asset;

  const baseScale = Math.max(CARD_W / imgW, CARD_H / imgH);
  const displayW = imgW * baseScale;
  const displayH = imgH * baseScale;
  const initialX = (CARD_W - displayW) / 2;
  const initialY = (CARD_H - displayH) / 2;

  const pan = useRef(new Animated.ValueXY()).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const lastPan = useRef({ x: 0, y: 0 });
  const livePan = useRef({ x: 0, y: 0 });
  const userScaleRef = useRef(1);
  const pinchStartDist = useRef(0);
  const pinchStartScale = useRef(1);
  const prevTouchCount = useRef(0);

  const [confirming, setConfirming] = useState(false);

  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
  const mpX = (s: number) => Math.max(0, (displayW * s - CARD_W) / 2);
  const mpY = (s: number) => Math.max(0, (displayH * s - CARD_H) / 2);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Prevent iOS from stealing the gesture when a second finger lands —
      // this was what caused the "card moves instead of zooming" bug.
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (e, { dx, dy }) => {
        const touches = e.nativeEvent.touches;
        const count = touches.length;

        if (count === 2) {
          // ── Pinch to zoom ────────────────────────────────────────────────
          if (prevTouchCount.current < 2) {
            pinchStartDist.current = Math.hypot(
              touches[1].pageX - touches[0].pageX,
              touches[1].pageY - touches[0].pageY,
            );
            pinchStartScale.current = userScaleRef.current;
          }
          const dist = Math.hypot(
            touches[1].pageX - touches[0].pageX,
            touches[1].pageY - touches[0].pageY,
          );
          const newScale = clamp(pinchStartScale.current * (dist / pinchStartDist.current), 1, 4);
          userScaleRef.current = newScale;
          scaleAnim.setValue(newScale);

          const cx = clamp(livePan.current.x, -mpX(newScale), mpX(newScale));
          const cy = clamp(livePan.current.y, -mpY(newScale), mpY(newScale));
          pan.setValue({ x: cx, y: cy });
          livePan.current = { x: cx, y: cy };
          lastPan.current = { x: cx, y: cy };
        } else if (count === 1) {
          // ── Pan to reposition ────────────────────────────────────────────
          const x = clamp(lastPan.current.x + dx, -mpX(userScaleRef.current), mpX(userScaleRef.current));
          const y = clamp(lastPan.current.y + dy, -mpY(userScaleRef.current), mpY(userScaleRef.current));
          pan.setValue({ x, y });
          livePan.current = { x, y };
        }
        prevTouchCount.current = count;
      },
      onPanResponderRelease: (_, { dx, dy }) => {
        if (prevTouchCount.current === 1) {
          const x = clamp(lastPan.current.x + dx, -mpX(userScaleRef.current), mpX(userScaleRef.current));
          const y = clamp(lastPan.current.y + dy, -mpY(userScaleRef.current), mpY(userScaleRef.current));
          lastPan.current = { x, y };
          livePan.current = { x, y };
        } else {
          lastPan.current = { ...livePan.current };
        }
        prevTouchCount.current = 0;
      },
    })
  ).current;

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await onConfirm(livePan.current.x, livePan.current.y, baseScale * userScaleRef.current);
    } catch (e: any) {
      Alert.alert('error', e?.message ?? 'could not crop photo');
      setConfirming(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={cropStyles.navRow}>
        <TouchableOpacity onPress={onCancel} hitSlop={12} disabled={confirming}>
          <Text style={cropStyles.cancelText}>‹ back</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleConfirm} disabled={confirming} hitSlop={12}>
          {confirming
            ? <ActivityIndicator size="small" color={Theme.colors.brandWarm} />
            : <Text style={cropStyles.useText}>looks good</Text>
          }
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1 }}>
        <Text style={cropStyles.title} pointerEvents="none">resize photo</Text>
        <View style={cropStyles.viewportOuter}>
        <View
          style={{ width: CARD_W, height: CARD_H, overflow: 'hidden', borderRadius: 16 }}
          {...panResponder.panHandlers}
        >
          <Animated.Image
            source={{ uri }}
            style={{
              position: 'absolute',
              left: initialX,
              top: initialY,
              width: displayW,
              height: displayH,
              transform: [{ translateX: pan.x }, { translateY: pan.y }, { scale: scaleAnim }],
            }}
          />
          <View style={[cropStyles.corner, cropStyles.cornerTL]} pointerEvents="none" />
          <View style={[cropStyles.corner, cropStyles.cornerTR]} pointerEvents="none" />
          <View style={[cropStyles.corner, cropStyles.cornerBL]} pointerEvents="none" />
          <View style={[cropStyles.corner, cropStyles.cornerBR]} pointerEvents="none" />
        </View>
        <Text style={cropStyles.hint}>pinch to zoom · drag to reposition</Text>
      </View>
      </View>
    </SafeAreaView>
  );
}

// ─── Add screen ───────────────────────────────────────────────────────────────

const categoryEmoji = (cat: string | null) => {
  const m: Record<string, string> = { top: '👕', bottom: '👖', outerwear: '🧥', shoes: '👟', bag: '👜', accessory: '💍', dress: '👗' };
  return cat ? (m[cat] ?? '🛍️') : '🛍️';
};

export default function AddScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const router = useRouter();
  const [rawAsset, setRawAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [saveToRoll, setSaveToRoll] = useState(true);
  const { session, profile } = useAuth();
  const [selectedItems, setSelectedItems] = useState<WardrobeItem[]>([]);
  const [itemPickerVisible, setItemPickerVisible] = useState(false);
  const [allWardrobeItems, setAllWardrobeItems] = useState<WardrobeItem[]>([]);
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [autoScan, setAutoScan] = useState(true);
  const [pendingPickerItems, setPendingPickerItems] = useState<WardrobeItem[]>([]);
  const [tagInput, setTagInput] = useState('');
  const tagInputRef = useRef<TextInput>(null);

  useEffect(() => {
    AsyncStorage.getItem(AUTO_SCAN_KEY).then(v => {
      setAutoScan(v === null || v === 'true');
    });
  }, []);

  const handleOpenItemPicker = async () => {
    if (!session?.user.id) return;
    const items = await getWardrobeItems(session.user.id).catch(() => []);
    setAllWardrobeItems(items.filter(i => !selectedItems.some(s => s.id === i.id)));
    setPendingPickerItems([]);
    setFilterCat(null);
    setFilterTag(null);
    setItemPickerVisible(true);
  };

  const handleTogglePickerItem = (item: WardrobeItem) => {
    setPendingPickerItems(prev =>
      prev.some(i => i.id === item.id) ? prev.filter(i => i.id !== item.id) : [...prev, item]
    );
  };

  const handleConfirmPickerItems = () => {
    setSelectedItems(prev => [...prev, ...pendingPickerItems]);
    setPendingPickerItems([]);
    setItemPickerVisible(false);
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('camera access needed', 'allow camera access in your settings to take fit pics.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    if (!result.canceled) {
      setSaveToRoll(true);
      setRawAsset(result.assets[0]);
    }
  };

  const pickFromLibrary = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('photo library access needed', 'allow photo library access in your settings.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (!result.canceled) {
      setSaveToRoll(false);
      setRawAsset(result.assets[0]);
    }
  };

  const applyCrop = async (panX: number, panY: number, displayScale: number) => {
    if (!rawAsset) return;
    const { uri, width: imgW, height: imgH } = rawAsset;

    const cropW = Math.min(Math.round(CARD_W / displayScale), imgW);
    const cropH = Math.min(Math.round(CARD_H / displayScale), imgH);
    const panX_img = panX / displayScale;
    const panY_img = panY / displayScale;

    let originX = Math.round(imgW / 2 - panX_img - cropW / 2);
    let originY = Math.round(imgH / 2 - panY_img - cropH / 2);
    originX = Math.max(0, Math.min(imgW - cropW, originX));
    originY = Math.max(0, Math.min(imgH - cropH, originY));

    const MAX_WIDTH = 1200;
    const needsResize = cropW > MAX_WIDTH;
    const manipulator = ImageManipulator
      .manipulate(uri)
      .crop({ originX, originY, width: cropW, height: cropH });
    if (needsResize) manipulator.resize({ width: MAX_WIDTH });
    const ref = await manipulator.renderAsync();
    const result = await ref.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
    setPhotoUri(result.uri);
  };

  const handleSave = async () => {
    if (!photoUri || !date) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (saveToRoll) {
        const { status } = await MediaLibrary.requestPermissionsAsync();
        if (status === 'granted') {
          const asset = await MediaLibrary.createAssetAsync(photoUri);
          const album = await MediaLibrary.getAlbumAsync('Muse OOTD');
          if (album) {
            await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
          } else {
            await MediaLibrary.createAlbumAsync('Muse OOTD', asset, false);
          }
        }
      }
      const savedPost = await upsertPost(date, photoUri, caption, tags, isPrivate);
      // Always link manually-selected items first (safe even if scan fails)
      if (selectedItems.length > 0) {
        await Promise.all(selectedItems.map(i => addPostWardrobeItem(savedPost.id, i.id))).catch(() => {});
      }
      const autoScanVal = await AsyncStorage.getItem(AUTO_SCAN_KEY);
      const autoScanOn = autoScanVal === null || autoScanVal === 'true';
      if (autoScanOn) {
        scanOutfit(
          savedPost.id,
          savedPost.photo_url,
          selectedItems.map(i => ({ id: i.id, label: i.label, ai_description: i.ai_description })),
        ).catch(() => {});
      }
      router.replace({ pathname: '/entry/[date]' as any, params: { date } });
    } catch (e: any) {
      setSaveError(e?.message ?? 'could not save your fit. try again?');
      setSaving(false);
    }
  };

  // ── Picker screen ──────────────────────────────────────────────────────────
  if (!rawAsset && !photoUri) {
    return (
      <SafeAreaView style={styles.safe}>
        <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()} hitSlop={16}>
          <Feather name="x" size={22} color={Theme.colors.primary} />
        </TouchableOpacity>
        <View style={styles.pickerContent}>
          <Text style={styles.pickerDate}>{date ? formatDate(date) : ''}</Text>
          <Text style={styles.pickerTitle}>
            {date === todayString() ? "add today's look" : 'add a look'}
          </Text>
          <View style={styles.pickerButtons}>
            <TouchableOpacity style={styles.pickerBtn} onPress={takePhoto} activeOpacity={0.82}>
              <View style={styles.pickerIconRing}>
                <Feather name="camera" size={28} color={ADD_BLUE} />
              </View>
              <Text style={styles.pickerBtnLabel}>take photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.pickerBtn} onPress={pickFromLibrary} activeOpacity={0.82}>
              <View style={styles.pickerIconRing}>
                <Feather name="image" size={28} color={ADD_BLUE} />
              </View>
              <Text style={styles.pickerBtnLabel}>choose from library</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Crop screen ────────────────────────────────────────────────────────────
  if (rawAsset && !photoUri) {
    return (
      <CropView
        asset={rawAsset}
        onConfirm={applyCrop}
        onCancel={() => setRawAsset(null)}
      />
    );
  }

  // ── Preview + save screen ──────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kav}
      >
        <View style={styles.navRow}>
          <TouchableOpacity onPress={() => setPhotoUri(null)} hitSlop={12}>
            <Text style={styles.cancelText}>‹ back</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.headerDate}>{date ? formatDate(date) : ''}</Text>

        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={[styles.photoContainer, { height: CARD_H }]}>
            <Image
              source={{ uri: photoUri! }}
                cachePolicy="disk"
              style={{ width: CARD_W, height: CARD_H }}
              resizeMode="cover"
            />
          </View>

          <View style={styles.formSection}>
            <Text style={styles.fieldLabel}>caption</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.captionInput}
                placeholder="what's the vibe today?"
                placeholderTextColor={Theme.colors.disabled}
                value={caption}
                onChangeText={setCaption}
                multiline
                submitBehavior="blurAndSubmit"
                maxLength={280}
                returnKeyType="done"
              />
            </View>
          </View>

          <View style={styles.formSection}>
            <Text style={styles.fieldLabel}>tags</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.tagScroll}
              contentContainerStyle={styles.tagScrollContent}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.tagAddPill}>
                <TextInput
                  ref={tagInputRef}
                  style={styles.tagAddInput}
                  value={tagInput}
                  placeholder="+ add"
                  placeholderTextColor={Theme.colors.accent}
                  onChangeText={text => {
                    if (text.endsWith(',') || text.endsWith(' ')) {
                      const t = text.slice(0, -1).trim().toLowerCase();
                      if (t && !tags.includes(t)) setTags([...tags, t]);
                      setTagInput('');
                    } else {
                      setTagInput(text);
                    }
                  }}
                  onSubmitEditing={() => {
                    const t = tagInput.trim().toLowerCase();
                    if (t && !tags.includes(t)) setTags([...tags, t]);
                    setTagInput('');
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  submitBehavior="blurAndSubmit"
                />
              </View>
              {tags.map(tag => (
                <TouchableOpacity key={tag} style={styles.tagChipSelected} onPress={() => setTags(tags.filter(t => t !== tag))} activeOpacity={0.7}>
                  <Text style={styles.tagChipSelectedText}>{tag} ×</Text>
                </TouchableOpacity>
              ))}
              {(profile?.style_tags ?? []).filter(t => !tags.includes(t.toLowerCase())).map(tag => (
                <TouchableOpacity key={tag} style={styles.tagChipSuggestion} onPress={() => { const t = tag.toLowerCase(); if (!tags.includes(t)) setTags([...tags, t]); }} activeOpacity={0.7}>
                  <Text style={styles.tagChipSuggestionText}>{tag}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <View style={styles.itemsSection}>
            <Text style={styles.fieldLabel}>items in this look</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.itemsGrid} style={{ marginTop: 6 }}>
              {selectedItems.map(item => (
                <View key={item.id} style={styles.itemCell}>
                  {item.generated_image_url
                    ? <Image source={{ uri: item.generated_image_url }} style={styles.itemCellImg} resizeMode="cover" cachePolicy="disk" />
                    : <View style={[styles.itemCellImg, styles.itemCellPlaceholder]}>
                        <Text style={{ fontSize: 22 }}>{categoryEmoji(item.category)}</Text>
                      </View>
                  }
                  <TouchableOpacity style={styles.itemCellX} onPress={() => setSelectedItems(prev => prev.filter(i => i.id !== item.id))} hitSlop={4}>
                    <Feather name="x" size={11} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity style={styles.itemCellAdd} onPress={handleOpenItemPicker} activeOpacity={0.7}>
                <Feather name="plus" size={22} color={Theme.colors.accent} />
              </TouchableOpacity>
            </ScrollView>
            <TouchableOpacity
              onPress={() => {
                const v = !autoScan;
                setAutoScan(v);
                AsyncStorage.setItem(AUTO_SCAN_KEY, String(v));
              }}
              activeOpacity={0.75}
              style={styles.autoScanRow}
            >
              {autoScan ? (
                <LinearGradient colors={['#F9C74F', '#F77FAD']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.autoScanPill}>
                  <View style={styles.autoScanThumbRight} />
                </LinearGradient>
              ) : (
                <View style={[styles.autoScanPill, styles.autoScanPillOff]}>
                  <View style={styles.autoScanThumbLeft} />
                </View>
              )}
              <Text style={styles.autoScanLabel}>auto-detect additional items</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.toggleRow, styles.toggleFirst]}>
            <View>
              <Text style={styles.toggleLabel}>save to camera roll</Text>
              <Text style={styles.toggleSub}>keep a copy on your phone</Text>
            </View>
            <Switch
              value={saveToRoll}
              onValueChange={setSaveToRoll}
              trackColor={{ false: Theme.colors.border, true: ADD_BLUE }}
              thumbColor={Theme.colors.background}
              ios_backgroundColor={Theme.colors.border}
            />
          </View>
          <View style={[styles.toggleRow, styles.toggleRowLast]}>
            <View>
              <Text style={styles.toggleLabel}>hide from feed</Text>
              <Text style={styles.toggleSub}>only you can see this</Text>
            </View>
            <Switch
              value={isPrivate}
              onValueChange={setIsPrivate}
              trackColor={{ false: Theme.colors.border, true: ADD_BLUE }}
              thumbColor={Theme.colors.background}
              ios_backgroundColor={Theme.colors.border}
            />
          </View>

          {saveError ? <Text style={styles.errorText}>{saveError}</Text> : null}

          <TouchableOpacity
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.85}
            style={saving ? styles.saveBtnDisabled : undefined}
          >
            <LinearGradient
              colors={['#F9C74F', '#F77FAD']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.saveBtn}
            >
              {saving ? (
                <ActivityIndicator color="#0B0B0B" />
              ) : (
                <Text style={styles.saveBtnText}>add this fit ✨</Text>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={itemPickerVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setItemPickerVisible(false)}
      >
        <SafeAreaView style={styles.itemPickerSafe}>
          {/* Fixed top section — never moves */}
          <View>
            <View style={styles.itemPickerHeader}>
              <TouchableOpacity onPress={() => setItemPickerVisible(false)} hitSlop={12}>
                <Feather name="x" size={20} color={Theme.colors.primary} />
              </TouchableOpacity>
              <Text style={styles.itemPickerTitle}>add items</Text>
              <View style={{ width: 20 }} />
            </View>
            {allWardrobeItems.length > 0 && (() => {
              const cats = [...new Set(allWardrobeItems.map(i => i.category).filter(Boolean))] as string[];
              const tags = [...new Set(allWardrobeItems.flatMap(i => i.tags ?? []))];
              return (
                <>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
                    <TouchableOpacity style={[styles.filterChip, !filterCat && styles.filterChipActive]} onPress={() => setFilterCat(null)} activeOpacity={0.75}>
                      <Text style={[styles.filterChipText, !filterCat && styles.filterChipTextActive]}>all</Text>
                    </TouchableOpacity>
                    {cats.map(cat => (
                      <TouchableOpacity key={cat} style={[styles.filterChip, filterCat === cat && styles.filterChipActive]} onPress={() => setFilterCat(filterCat === cat ? null : cat)} activeOpacity={0.75}>
                        <Text style={[styles.filterChipText, filterCat === cat && styles.filterChipTextActive]}>{categoryEmoji(cat)} {cat}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  {tags.length > 0 && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tagFilterScroll} contentContainerStyle={styles.filterContent}>
                      {filterTag && (
                        <TouchableOpacity style={[styles.filterChip, styles.filterChipActive]} onPress={() => setFilterTag(null)} activeOpacity={0.75}>
                          <Text style={[styles.filterChipText, styles.filterChipTextActive]}>✕ {filterTag}</Text>
                        </TouchableOpacity>
                      )}
                      {tags.filter(t => t !== filterTag).map(tag => (
                        <TouchableOpacity key={tag} style={styles.tagFilterChip} onPress={() => setFilterTag(filterTag === tag ? null : tag)} activeOpacity={0.75}>
                          <Text style={styles.tagFilterChipText}>{tag}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}
                </>
              );
            })()}
          </View>
          {/* Scrollable content fills remaining space */}
          {allWardrobeItems.length === 0 ? (
            <View style={styles.itemPickerEmpty}>
              <Text style={styles.itemPickerEmptyText}>your closet is empty — log your first look to start building 👀</Text>
            </View>
          ) : (
            <FlatList
              style={{ flex: 1 }}
              data={allWardrobeItems.filter(i => {
                if (filterCat && i.category !== filterCat) return false;
                if (filterTag && !(i.tags ?? []).includes(filterTag)) return false;
                return true;
              })}
              keyExtractor={item => item.id}
              numColumns={2}
              columnWrapperStyle={{ gap: 12 }}
              contentContainerStyle={{ padding: 16, gap: 12 }}
              renderItem={({ item }) => {
                const selected = pendingPickerItems.some(i => i.id === item.id);
                return (
                  <TouchableOpacity
                    style={[styles.itemPickerCell, selected && styles.itemPickerCellSelected]}
                    onPress={() => handleTogglePickerItem(item)}
                    activeOpacity={0.8}
                  >
                    {item.generated_image_url ? (
                      <Image source={{ uri: item.generated_image_url }} style={styles.itemPickerImg} resizeMode="cover" cachePolicy="disk" />
                    ) : (
                      <View style={[styles.itemPickerImg, styles.itemPickerPlaceholder]}>
                        <Text style={styles.itemPickerEmoji}>{categoryEmoji(item.category)}</Text>
                      </View>
                    )}
                    {selected && (
                      <View style={styles.itemPickerCheck}>
                        <Feather name="check" size={14} color="#fff" />
                      </View>
                    )}
                    <Text style={[styles.itemPickerLabel, selected && styles.itemPickerLabelSelected]} numberOfLines={2}>{item.label}</Text>
                  </TouchableOpacity>
                );
              }}
            />
          )}
          {pendingPickerItems.length > 0 && (
            <TouchableOpacity onPress={handleConfirmPickerItems} activeOpacity={0.85} style={styles.pickerFooter}>
              <LinearGradient colors={['#F9C74F', '#F77FAD']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.pickerFooterBtn}>
                <Text style={styles.pickerFooterText}>
                  add {pendingPickerItems.length} item{pendingPickerItems.length > 1 ? 's' : ''}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const cropStyles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  navRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 14, paddingBottom: 4,
  },
  headerSide: { flex: 1, minWidth: 70 },
  title: {
    position: 'absolute', top: 32, left: 0, right: 0, zIndex: 1,
    fontFamily: 'Caprasimo_400Regular',
    fontSize: 17, color: Theme.colors.primary, letterSpacing: -0.3,
    textAlign: 'center',
  },
  cancelText: { fontSize: Theme.font.base, color: Theme.colors.secondary, fontWeight: '500' },
  useText: { fontSize: Theme.font.base, color: Theme.colors.brandWarm, fontWeight: '700' },

  viewportOuter: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14,
  },
  hint: {
    fontSize: Theme.font.xs, color: Theme.colors.secondary,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },

  corner: { position: 'absolute', width: 22, height: 22 },
  cornerTL: { top: 0, left: 0, borderTopWidth: 2.5, borderLeftWidth: 2.5, borderColor: Theme.colors.brandWarm, borderTopLeftRadius: 4 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 2.5, borderRightWidth: 2.5, borderColor: Theme.colors.brandWarm, borderTopRightRadius: 4 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 2.5, borderLeftWidth: 2.5, borderColor: Theme.colors.brandWarm, borderBottomLeftRadius: 4 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 2.5, borderRightWidth: 2.5, borderColor: Theme.colors.brandWarm, borderBottomRightRadius: 4 },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Theme.colors.background },

  // Picker
  closeBtn: {
    position: 'absolute', top: 56, right: 20, zIndex: 10,
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
  },
  pickerContent: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 32, paddingBottom: 40,
  },
  pickerDate: {
    fontSize: Theme.font.xs, color: Theme.colors.secondary,
    marginBottom: 8, letterSpacing: 0.3, textTransform: 'uppercase',
  },
  pickerTitle: {
    fontFamily: 'Caprasimo_400Regular', fontSize: 32, color: Theme.colors.primary,
    letterSpacing: -0.5, textAlign: 'center', marginTop: 6, marginBottom: 6,
  },
  pickerButtons: { flexDirection: 'row', gap: 16, marginTop: 40 },
  pickerBtn: {
    flex: 1, backgroundColor: Theme.colors.surface, borderRadius: Theme.radius.lg,
    borderWidth: 1, borderColor: Theme.colors.border,
    alignItems: 'center', justifyContent: 'center', paddingVertical: 24, gap: 12,
  },
  pickerIconRing: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: ADD_BLUE_LIGHT,
    alignItems: 'center', justifyContent: 'center',
  },
  pickerBtnLabel: {
    fontSize: Theme.font.sm, fontWeight: '600',
    color: Theme.colors.primary, textAlign: 'center',
  },

  // Preview
  kav: { flex: 1, paddingHorizontal: 16 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingVertical: 12,
  },
  navRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 0, paddingTop: 14, paddingBottom: 4,
  },
  headerSide: { flex: 1, minWidth: 70 },
  cancelText: { fontSize: Theme.font.base, color: Theme.colors.secondary, fontWeight: '500' },
  headerDate: {
    fontFamily: 'Caprasimo_400Regular',
    fontSize: 20, color: Theme.colors.primary,
    textAlign: 'center', marginTop: 10, paddingBottom: 10,
  },
  retakeText: { fontSize: Theme.font.base, color: Theme.colors.brandWarm, fontWeight: '600' },
  photoContainer: { borderRadius: Theme.radius.lg, overflow: 'hidden', marginBottom: 12, marginTop: 16 },

  // Form sections
  formSection: { marginTop: 20 },
  fieldLabel: {
    fontSize: 10, fontWeight: '600', color: Theme.colors.secondary,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6,
  },
  inputRow: {
    backgroundColor: Theme.colors.surface, borderRadius: Theme.radius.md,
    borderWidth: 1, borderColor: Theme.colors.border,
    paddingHorizontal: 14, paddingVertical: 12, minHeight: 64,
  },
  captionInput: {
    fontSize: Theme.font.base, color: Theme.colors.primary, lineHeight: 22,
    textAlignVertical: 'top', paddingTop: 0, paddingBottom: 0,
    minHeight: 40,
  },

  // Save button
  saveBtn: {
    borderRadius: Theme.radius.md, overflow: 'hidden',
    paddingVertical: 16, alignItems: 'center', justifyContent: 'center',
    marginTop: 16, marginBottom: 8,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: {
    fontSize: Theme.font.base, fontWeight: '700',
    color: '#0B0B0B', letterSpacing: -0.2,
  },
  errorText: {
    fontSize: Theme.font.sm, color: '#D9534F',
    textAlign: 'center', marginTop: 8, marginBottom: 4,
  },

  // Toggle rows (borderless, clean)
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: Theme.colors.border,
  },
  toggleFirst: { marginTop: 28 },
  toggleRowLast: { marginBottom: 8 },
  toggleLabel: { fontSize: Theme.font.base, color: Theme.colors.primary, fontWeight: '500' },
  toggleSub: { fontSize: Theme.font.xs, color: Theme.colors.secondary, marginTop: 2 },

  // Tags
  tagScroll: { height: 44, marginTop: 2 },
  tagScrollContent: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  tagAddPill: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 100, borderWidth: 1.5, borderStyle: 'dashed' as any,
    borderColor: Theme.colors.accent,
    justifyContent: 'center',
  },
  tagAddInput: {
    fontSize: Theme.font.xs, fontWeight: '700', color: Theme.colors.accent,
    minWidth: 36, padding: 0, margin: 0, height: 16,
  },
  tagChipSelected: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 100, backgroundColor: Theme.colors.accentLight,
    borderWidth: 1, borderColor: 'rgba(58,135,181,0.25)',
  },
  tagChipSelectedText: { fontSize: Theme.font.sm, fontWeight: '600', color: Theme.colors.accent },
  tagChipSuggestion: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 100, borderWidth: 1, borderColor: Theme.colors.border,
    backgroundColor: Theme.colors.surface,
  },
  tagChipSuggestionText: { fontSize: Theme.font.sm, color: Theme.colors.secondary },

  // Items in this look
  itemsSection: { marginTop: 20 },
  itemsGrid: { flexDirection: 'row', gap: 8, paddingBottom: 2 },
  itemCell: { width: 72, height: 72, borderRadius: 10, overflow: 'hidden', position: 'relative' },
  itemCellImg: { width: 72, height: 72, borderRadius: 10, backgroundColor: Theme.colors.surface },
  itemCellPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  itemCellX: {
    position: 'absolute', top: 4, right: 4,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  itemCellAdd: {
    width: 72, height: 72, borderRadius: 10,
    borderWidth: 1.5, borderStyle: 'dashed' as any,
    borderColor: Theme.colors.accent,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Theme.colors.accentLight,
  },

  // Auto-scan toggle (same as closet)
  autoScanRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, marginTop: 18,
  },
  autoScanPill: {
    width: 36, height: 20, borderRadius: 10,
    justifyContent: 'center', paddingHorizontal: 2,
  },
  autoScanPillOff: { backgroundColor: 'rgba(0,0,0,0.15)' },
  autoScanThumbRight: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff', alignSelf: 'flex-end' },
  autoScanThumbLeft: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff', alignSelf: 'flex-start' },
  autoScanLabel: { fontSize: Theme.font.sm, color: Theme.colors.secondary },

  // Item picker modal
  itemPickerSafe: { flex: 1, backgroundColor: Theme.colors.background },
  itemPickerHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Theme.colors.border,
  },
  itemPickerTitle: {
    fontFamily: 'Caprasimo_400Regular', fontSize: 20, color: Theme.colors.primary, letterSpacing: -0.3,
  },
  itemPickerCell: { width: PICKER_CELL_W },
  itemPickerImg: {
    width: '100%', aspectRatio: 1, borderRadius: Theme.radius.md,
    backgroundColor: Theme.colors.surface,
  } as any,
  itemPickerPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  itemPickerEmoji: { fontSize: 32 },
  itemPickerLabel: { fontSize: Theme.font.xs, color: Theme.colors.primary, marginTop: 4, textAlign: 'center' },
  itemPickerLabelSelected: { color: Theme.colors.accent, fontWeight: '600' },
  itemPickerCellSelected: { opacity: 0.9 },
  itemPickerCheck: {
    position: 'absolute', top: 6, right: 6,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: Theme.colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  itemPickerEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  itemPickerEmptyText: { fontSize: Theme.font.sm, color: Theme.colors.secondary, textAlign: 'center', lineHeight: 20 },
  pickerFooter: { paddingHorizontal: 16, paddingVertical: 12 },
  pickerFooterBtn: {
    borderRadius: Theme.radius.md, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  pickerFooterText: { fontSize: Theme.font.base, fontWeight: '700', color: '#0B0B0B' },

  // Filter rows — explicit height required so horizontal ScrollViews don't collapse to 0
  filterScroll: { height: 44, marginTop: 8, marginBottom: 2 },
  tagFilterScroll: { height: 40, marginBottom: 4 },
  filterContent: { paddingHorizontal: 16, gap: 7, flexDirection: 'row', alignItems: 'center' },
  filterChip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 100, borderWidth: 1, borderColor: 'rgba(0,0,0,0.18)',
    backgroundColor: 'transparent',
  },
  filterChipActive: { backgroundColor: 'rgba(0,0,0,0.75)', borderColor: 'transparent' },
  filterChipText: { fontSize: Theme.font.sm, fontWeight: '600', color: Theme.colors.primary },
  filterChipTextActive: { color: '#fff' },
  tagFilterChip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 100, borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)',
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  tagFilterChipText: { fontSize: Theme.font.sm, fontWeight: '500', color: Theme.colors.primary },
});
