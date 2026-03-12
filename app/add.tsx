import { useState, useRef } from 'react';
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
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as MediaLibrary from 'expo-media-library';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import { Theme } from '@/constants/Theme';
import { upsertPost } from '@/utils/api';
import { formatDate, todayString } from '@/utils/dates';
import { TagInput } from '@/components/TagInput';

const SCREEN_WIDTH = Math.min(Dimensions.get('window').width, 390);
const ADD_BLUE       = '#5A8FA8';           // mirror steel blue
const ADD_BLUE_LIGHT = 'rgba(90,143,168,0.12)'; // icon ring tint
const CARD_W = SCREEN_WIDTH - 32;
const CARD_H = Math.round(CARD_W * (4 / 3));

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
      <View style={cropStyles.header}>
        <TouchableOpacity onPress={onCancel} hitSlop={12} disabled={confirming}>
          <Text style={cropStyles.cancelText}>cancel</Text>
        </TouchableOpacity>
        <Text style={cropStyles.title}>resize photo</Text>
        <TouchableOpacity onPress={handleConfirm} disabled={confirming} hitSlop={12}>
          {confirming
            ? <ActivityIndicator size="small" color={ADD_BLUE} />
            : <Text style={cropStyles.useText}>use</Text>
          }
        </TouchableOpacity>
      </View>

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
    </SafeAreaView>
  );
}

// ─── Add screen ───────────────────────────────────────────────────────────────

export default function AddScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const router = useRouter();
  const [rawAsset, setRawAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fromCamera, setFromCamera] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [saveToRoll, setSaveToRoll] = useState(true);

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('camera access needed', 'allow camera access in your settings to take fit pics.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    if (!result.canceled) {
      setFromCamera(true);
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
      setFromCamera(false);
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

    const ref = await ImageManipulator
      .manipulate(uri)
      .crop({ originX, originY, width: cropW, height: cropH })
      .renderAsync();
    const result = await ref.saveAsync({ compress: 0.85, format: SaveFormat.JPEG });
    setPhotoUri(result.uri);
  };

  const handleSave = async () => {
    if (!photoUri || !date) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (fromCamera && saveToRoll) {
        const { status } = await MediaLibrary.requestPermissionsAsync();
        if (status === 'granted') {
          await MediaLibrary.saveToLibraryAsync(photoUri);
        }
      }
      await upsertPost(date, photoUri, caption, tags, isPrivate);
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
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.cancelText}>cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerDate}>{date ? formatDate(date) : ''}</Text>
          <TouchableOpacity onPress={() => setPhotoUri(null)} hitSlop={12}>
            <Text style={styles.retakeText}>retake</Text>
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={[styles.photoContainer, { height: CARD_H }]}>
            <Image
              source={{ uri: photoUri! }}
              style={{ width: CARD_W, height: CARD_H }}
              resizeMode="cover"
            />
          </View>

          <View style={styles.inputRow}>
            <TextInput
              style={styles.captionInput}
              placeholder="add a caption... (optional)"
              placeholderTextColor={Theme.colors.disabled}
              value={caption}
              onChangeText={setCaption}
              multiline
              submitBehavior="blurAndSubmit"
              maxLength={280}
              returnKeyType="done"
            />
          </View>

          <TagInput value={tags} onChange={setTags} placeholder="add tags, e.g. streetwear, vintage..." />

          <View style={styles.togglesSection}>
            {fromCamera && (
              <View style={styles.toggleRow}>
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
            )}
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
          </View>

          {saveError ? <Text style={styles.errorText}>{saveError}</Text> : null}

          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color={Theme.colors.background} />
            ) : (
              <Text style={styles.saveBtnText}>add this fit</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const cropStyles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  title: {
    fontSize: Theme.font.base, fontWeight: '700',
    color: Theme.colors.primary, letterSpacing: -0.2,
  },
  cancelText: { fontSize: Theme.font.base, color: Theme.colors.secondary, fontWeight: '500' },
  useText: { fontSize: Theme.font.base, color: ADD_BLUE, fontWeight: '700' },

  viewportOuter: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14,
  },
  hint: {
    fontSize: Theme.font.xs, color: Theme.colors.secondary,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },

  corner: { position: 'absolute', width: 22, height: 22 },
  cornerTL: { top: 0, left: 0, borderTopWidth: 2.5, borderLeftWidth: 2.5, borderColor: ADD_BLUE, borderTopLeftRadius: 4 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 2.5, borderRightWidth: 2.5, borderColor: ADD_BLUE, borderTopRightRadius: 4 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 2.5, borderLeftWidth: 2.5, borderColor: ADD_BLUE, borderBottomLeftRadius: 4 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 2.5, borderRightWidth: 2.5, borderColor: ADD_BLUE, borderBottomRightRadius: 4 },
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
    fontFamily: Theme.font.brand, fontSize: 32, color: Theme.colors.primary,
    letterSpacing: -0.5, textAlign: 'center', marginBottom: 6,
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
  cancelText: { fontSize: Theme.font.base, color: Theme.colors.secondary, fontWeight: '500' },
  headerDate: {
    fontSize: Theme.font.sm, color: Theme.colors.primary,
    fontWeight: '700', textAlign: 'center', flex: 1, marginHorizontal: 8,
  },
  retakeText: { fontSize: Theme.font.base, color: ADD_BLUE, fontWeight: '600' },
  photoContainer: { borderRadius: Theme.radius.lg, overflow: 'hidden', marginBottom: 12 },
  inputRow: {
    backgroundColor: Theme.colors.surface, borderRadius: Theme.radius.md,
    borderWidth: 1, borderColor: Theme.colors.border,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10, minHeight: 64,
  },
  captionInput: {
    fontSize: Theme.font.base, color: Theme.colors.primary, lineHeight: 22,
  },
  saveBtn: {
    backgroundColor: ADD_BLUE, borderRadius: Theme.radius.md,
    paddingVertical: 16, alignItems: 'center', justifyContent: 'center',
    marginTop: 12, marginBottom: 8,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: {
    fontSize: Theme.font.base, fontWeight: '700',
    color: '#fff', letterSpacing: -0.2,
  },
  errorText: {
    fontSize: Theme.font.sm, color: '#D9534F',
    textAlign: 'center', marginTop: 8, marginBottom: 4,
  },
  togglesSection: {
    marginTop: 10,
    borderRadius: Theme.radius.md,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    overflow: 'hidden',
  },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Theme.colors.surface,
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Theme.colors.border,
  },
  toggleRowLast: { borderBottomWidth: 0 },
  toggleLabel: { fontSize: Theme.font.base, color: Theme.colors.primary, fontWeight: '500' },
  toggleSub: { fontSize: Theme.font.xs, color: Theme.colors.secondary, marginTop: 2 },
});
