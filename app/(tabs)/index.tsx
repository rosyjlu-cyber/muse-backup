import { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Image,
  Dimensions,
  StatusBar,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import Svg, { Path, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';

import { Theme } from '@/constants/Theme';
import { getMyPosts, Post } from '@/utils/api';
import { useAuth } from '@/utils/auth';
import {
  calculateStreak,
  getLastNDays,
  todayString,
  formatDate,
} from '@/utils/dates';
import { CalendarGrid } from '@/components/CalendarGrid';

const SCREEN_WIDTH = Math.min(Dimensions.get('window').width, 390);
const SCREEN_HEIGHT = Dimensions.get('window').height;

const BLOB_W = Math.round(SCREEN_WIDTH * 0.84); // natural blob width
const BLOB_ASPECT = 477 / 277;                   // viewBox height/width ratio

const PHOTO_R = 20;
const PHOTO_TOP_GAP = 8;   // gap between header and photo top
const PHOTO_BOT_GAP = 14;  // gap between photo bottom and panel

// When no post yet, only show handle bar + streak row (no calendar header)
const STREAK_PEEK = 96;

// Sliding panel: diagonal gradient, yellow top-left → pink bottom-right
const PANEL_COLORS = ['#fdf5b9', '#f0c8e8', '#e9b3ee'] as const;

const BLOB_PATH = 'M30.5054 40.5625C-5.49458 72.5625 17.5054 101.562 17.5054 101.562C17.5054 101.562 29.5174 111.958 30.5054 125.562C33.2106 162.812 6.50542 152.562 0.505417 196.562C8.50541 246.562 34.9904 247.443 44.5054 274.563C56.5302 308.835 25.5054 334.563 17.5054 372.563C17.5054 412.563 29.5676 442.268 65.5054 453.563C127.505 473.048 125.505 414.461 158.505 416.562C189.505 436.562 175.505 475.563 228.505 475.563C263.505 467.562 276.505 411.563 276.505 372.563C276.505 329.269 237.723 317.322 244.505 274.563C249.416 243.605 274.457 189.931 263.505 160.563C256.324 141.304 256.445 142.293 244.505 125.562C215.069 84.3156 311.505 73.5625 238.505 8.56246C160.505 -21.4375 168.505 40.5625 107.505 59.5625C82.9587 67.2082 71.5054 20.5625 30.5054 40.5625Z';

function BlobMirror({ width, height, children }: { width: number; height: number; children?: React.ReactNode }) {
  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height} viewBox="0 0 277 477" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
        <Defs>
          <SvgGradient id="bg" x1="20%" y1="0%" x2="80%" y2="100%">
            <Stop offset="0%" stopColor="#CCE0EE" />
            <Stop offset="50%" stopColor="#A6C2D7" />
            <Stop offset="100%" stopColor="#82A9BF" />
          </SvgGradient>
        </Defs>
        <Path d={BLOB_PATH} fill="url(#bg)" />
      </Svg>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', gap: 14 }]}>
        {children}
      </View>
    </View>
  );
}

function postToEntry(p: Post) {
  return { date: p.date, photoUri: p.photo_url, createdAt: new Date(p.created_at).getTime() };
}

export default function JournalHome() {
  const router = useRouter();
  const { session, profile } = useAuth();
  const now = new Date();
  const [posts, setPosts] = useState<Post[]>([]);
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [containerH, setContainerH] = useState(0);
  const [scrollY, setScrollY] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (session) {
        getMyPosts().then(all => {
          setPosts([...all].sort((a, b) => b.date.localeCompare(a.date)));
        });
      }
    }, [session])
  );

  const entries = posts.map(postToEntry);
  const todayStr = todayString();
  const todayPost = posts.find(p => p.date === todayStr) ?? null;
  const streak = calculateStreak(entries);
  const last7 = getLastNDays(entries, 7);
  const isCurrentMonth = viewYear === now.getFullYear() && viewMonth === now.getMonth();

  const handleDayPress = (date: string, hasEntry: boolean) => {
    if (hasEntry) {
      router.push({ pathname: '/entry/[date]' as any, params: { date } });
      return;
    }
    const [y, m, d] = date.split('-').map(Number);
    const dayMs = new Date(y, m - 1, d).getTime();
    const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (dayMs <= todayMs) {
      router.push({ pathname: '/add' as any, params: { date } });
    }
  };

  const handlePrevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else { setViewMonth(m => m - 1); }
  };

  const handleNextMonth = () => {
    if (!isCurrentMonth) {
      if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
      else { setViewMonth(m => m + 1); }
    }
  };

  const thisMonthPrefix = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`;
  const thisMonthCount = posts.filter(p => p.date.startsWith(thisMonthPrefix)).length;

  const goToAdd = () => router.push({ pathname: '/add' as any, params: { date: todayStr } });
  const goToTodayEntry = () => router.push({ pathname: '/entry/[date]' as any, params: { date: todayStr } });

  const insets = useSafeAreaInsets();
  const headerH = insets.top + 64;
  // Photo: 3:4 portrait ratio, width-first. 78% screen width, height derived from that.
  // Capped so panel always shows at least the streak row on short devices.
  const photoW_target = Math.round(SCREEN_WIDTH * 0.78);
  const photoH_target = Math.round(photoW_target * 4 / 3);
  const photoH_max = containerH > 0
    ? containerH - headerH - PHOTO_TOP_GAP - 190 - PHOTO_BOT_GAP
    : photoH_target;
  const photoH = (todayPost != null && containerH > 0)
    ? Math.min(photoH_target, photoH_max)
    : photoH_target;
  const photoW = Math.round(photoH * 3 / 4);
  // Panel starts right below the photo.
  const panelPeek = todayPost != null && containerH > 0
    ? containerH - headerH - PHOTO_TOP_GAP - photoH - PHOTO_BOT_GAP
    : STREAK_PEEK;
  const spacerH = containerH > 0 ? containerH - panelPeek : SCREEN_HEIGHT - panelPeek;
  const blobAreaH = spacerH - headerH;
  // Scale blob proportionally — never squish vertically
  const naturalBlobH = Math.round(BLOB_W * BLOB_ASPECT);
  const maxBlobH = Math.round(blobAreaH * 0.88);
  const blobH = Math.min(naturalBlobH, maxBlobH);
  const blobW = blobH < naturalBlobH ? Math.round(blobH / BLOB_ASPECT) : BLOB_W;

  const initials = (profile?.display_name ?? profile?.username ?? '?')[0].toUpperCase();

  return (
    <SafeAreaView
      style={styles.safe}
      onLayout={e => setContainerH(e.nativeEvent.layout.height)}
    >
      <StatusBar barStyle="dark-content" backgroundColor={Theme.colors.background} />

      {/* Hero background — visual only, no interactions */}
      <View style={[styles.heroLayer, { height: spacerH }]} pointerEvents="none">
        <View style={{ height: headerH }} />
        <View style={[styles.blobWrapper, !!todayPost && styles.blobWrapperPosted]}>
          {!session ? (
            <BlobMirror width={blobW} height={blobH}>
              <Text style={styles.blobTitle}>{'SIGN IN\nTO START'}</Text>
            </BlobMirror>
          ) : !todayPost ? (
            <BlobMirror width={blobW} height={blobH}>
              <View style={styles.cameraRing}>
                <Feather name="camera" size={28} color="#0B0B0B" />
              </View>
              <Text style={styles.blobTitle}>{'ADD\nTODAY\'S\nLOOK'}</Text>
            </BlobMirror>
          ) : (
            <View style={[styles.photoTouchable, { width: photoW, height: photoH }]}>
              <Image
                source={{ uri: todayPost.photo_url }}
                style={[styles.photoImage, { width: photoW, height: photoH }]}
                resizeMode="cover"
              />
              <LinearGradient
                colors={['transparent', 'rgba(11,11,11,0.82)']}
                style={styles.photoOverlay}
              >
                <Text style={styles.photoDate}>{formatDate(todayStr)}</Text>
                <View style={styles.photoLoggedRow}>
                  <Text style={styles.photoLoggedText}>today's look</Text>
                  <View style={styles.checkBadge}>
                    <Feather name="check" size={11} color="#0B0B0B" />
                  </View>
                </View>
                {!!todayPost.caption && (
                  <Text style={styles.overlayCaptionText} numberOfLines={2}>
                    {todayPost.caption}
                  </Text>
                )}
                {todayPost.tags && todayPost.tags.length > 0 && (
                  <View style={styles.overlayTagsRow}>
                    {todayPost.tags.slice(0, 5).map((tag, i) => (
                      <View key={i} style={styles.overlayTagChip}>
                        <Text style={styles.overlayTagText}>#{tag}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </LinearGradient>
            </View>
          )}
        </View>
      </View>

      {/* Scroll overlay — starts below header so panel can never cover it */}
      <ScrollView
        style={[StyleSheet.absoluteFill, { top: headerH }]}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        scrollsToTop={false}
        onScroll={e => setScrollY(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
      >
        <View style={{ height: spacerH - headerH }} pointerEvents="none" />

        <LinearGradient
          colors={PANEL_COLORS}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.limeCard, { minHeight: containerH || SCREEN_HEIGHT }]}
        >
          <View style={styles.handleBarContainer}>
            <View style={styles.handleBar} />
          </View>

          <View style={styles.streakRow}>
            <View style={styles.streakLeft}>
              <Text style={styles.streakEmoji}>🔥</Text>
              <View>
                <Text style={styles.streakNumber}>{streak > 0 ? streak : '—'}</Text>
                <Text style={styles.streakLabel}>day streak</Text>
              </View>
            </View>
            <View style={styles.dotsCol}>
              <View style={styles.dotsRow}>
                {last7.map((d, i) => (
                  <View
                    key={i}
                    style={[styles.dot, d.hasEntry ? styles.dotFilled : styles.dotEmpty]}
                  />
                ))}
              </View>
              <Text style={styles.dotsLabel}>last 7 days</Text>
            </View>
          </View>

          <CalendarGrid
            year={viewYear}
            month={viewMonth}
            entries={entries}
            onDayPress={handleDayPress}
            onPrevMonth={handlePrevMonth}
            onNextMonth={handleNextMonth}
            canGoNext={!isCurrentMonth}
          />

          <View style={styles.summary}>
            <Text style={styles.summaryText}>
              {thisMonthCount === 0
                ? 'no looks logged yet this month'
                : <>{thisMonthCount} look{thisMonthCount !== 1 ? 's' : ''} this month <Text style={styles.summaryEmoji}>🎉</Text></>}
            </Text>
          </View>
        </LinearGradient>
      </ScrollView>

      {/* Hero interactive overlay — rendered after ScrollView so taps reach it.
          Disabled when scrolled so the lime card content stays tappable. */}
      <View
        style={[styles.heroLayer, { height: spacerH }]}
        pointerEvents={scrollY < 50 ? 'box-none' : 'none'}
      >
        <View style={{ height: headerH }} />
        <View style={[styles.blobWrapper, !!todayPost && styles.blobWrapperPosted]}>
          {!session ? (
            <TouchableOpacity
              onPress={() => router.push('/auth' as any)}
              activeOpacity={0.86}
              style={[styles.blobTouchable, { width: blobW, height: blobH }]}
            />
          ) : !todayPost ? (
            <TouchableOpacity
              onPress={goToAdd}
              activeOpacity={0.86}
              style={[styles.blobTouchable, { width: blobW, height: blobH }]}
            />
          ) : (
            <TouchableOpacity
              onPress={goToTodayEntry}
              activeOpacity={0.9}
              style={[styles.photoTouchable, { width: photoW, height: photoH }]}
            />
          )}
        </View>
      </View>

      {/* Header rendered last = above scroll, touches reach it */}
      <View style={[styles.header, { paddingTop: insets.top + 2 }]} pointerEvents="box-none">
        <Text style={styles.wordmark}>muse</Text>
        <TouchableOpacity
          style={styles.avatarBtn}
          onPress={() => router.push('/profile' as any)}
          activeOpacity={0.8}
        >
          {profile?.avatar_url ? (
            <Image source={{ uri: profile.avatar_url }} style={styles.avatarImg} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitials}>{initials}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Theme.colors.background },
  scrollContent: {},

  heroLayer: { position: 'absolute', top: 0, left: 0, right: 0 },

  header: {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  wordmark: {
    fontFamily: Theme.font.brand, fontSize: 40,
    color: Theme.colors.brandWarm, letterSpacing: -0.5,
  },
  avatarBtn: {},
  avatarImg: { width: 34, height: 34, borderRadius: 17 },
  avatarPlaceholder: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: Theme.colors.surface,
    borderWidth: 1.5, borderColor: Theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitials: { fontSize: Theme.font.sm, fontWeight: '700', color: Theme.colors.primary },

  blobWrapper: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  blobWrapperPosted: { justifyContent: 'flex-start', paddingTop: PHOTO_TOP_GAP },
  blobTouchable: { width: BLOB_W },
  blobContent: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  cameraRing: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(11,11,11,0.12)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: 'rgba(11,11,11,0.22)',
  },
  blobTitle: {
    fontSize: 26, fontWeight: '900', color: '#0B0B0B',
    textAlign: 'center', textTransform: 'uppercase', letterSpacing: -0.5, lineHeight: 29,
  },

  limeCard: {
    borderTopLeftRadius: 44, borderTopRightRadius: 44, paddingBottom: 56,
  },
  handleBarContainer: { alignItems: 'center', paddingTop: 12, paddingBottom: 16 },
  handleBar: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.18)' },

  streakRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, marginBottom: 24,
  },
  streakLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  streakEmoji: { fontSize: 28 },
  streakNumber: {
    fontSize: Theme.font.xl, fontWeight: '800', color: Theme.colors.limeText,
    letterSpacing: -1, lineHeight: Theme.font.xl + 2,
  },
  streakLabel: {
    fontSize: Theme.font.xs, color: Theme.colors.limeMuted,
    fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.6,
  },
  dotsCol: { alignItems: 'flex-end', gap: 4 },
  dotsRow: { flexDirection: 'row', gap: 5 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotFilled: { backgroundColor: Theme.colors.limeText },
  dotEmpty: { backgroundColor: 'rgba(0,0,0,0.15)', borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.25)' },
  dotsLabel: {
    fontSize: 9, color: Theme.colors.limeMuted,
    fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5,
  },

  summary: { paddingHorizontal: 20, paddingTop: 18, alignItems: 'center' },
  summaryText: { fontSize: Theme.font.sm, color: Theme.colors.limeMuted, textAlign: 'center' },
  summaryEmoji: { fontSize: Theme.font.sm + 2 },

  // Hero photo (when today is posted — top-aligned, dynamic portrait)
  photoTouchable: { borderRadius: PHOTO_R, overflow: 'hidden' },
  photoImage: {},
  photoOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 20, paddingBottom: 24, paddingTop: 60,
  },
  photoDate: { fontSize: Theme.font.xs, color: 'rgba(255,255,255,0.65)', marginBottom: 4 },
  photoLoggedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  photoLoggedText: { fontSize: Theme.font.md, fontWeight: '700', color: Theme.colors.white },
  checkBadge: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: Theme.colors.accent, alignItems: 'center', justifyContent: 'center',
  },
  overlayCaptionText: {
    fontSize: Theme.font.sm, color: 'rgba(255,255,255,0.82)',
    fontStyle: 'italic', marginTop: 8, lineHeight: 18,
  },
  overlayTagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 8 },
  overlayTagChip: {
    paddingHorizontal: 9, paddingVertical: 3, borderRadius: 100,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  overlayTagText: { fontSize: 10, color: 'rgba(255,255,255,0.88)', fontWeight: '500' },
});
