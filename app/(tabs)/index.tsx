import { useCallback, useState, useRef, useEffect } from 'react';
import { Image } from 'expo-image';
import {
  View,
  Text,
  ScrollView,
  Animated,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  StatusBar,
  Modal,
  TextInput,
  Share,
  Linking,
  FlatList,
} from 'react-native';
import * as Contacts from 'expo-contacts';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import Svg, { Path, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';

import { Theme } from '@/constants/Theme';
import { getMyPosts, getNotificationsBadgeCount, getPostWardrobeItems, createReferral, Post, WardrobeItem, createWardrobeItem, addWardrobeItemPhoto } from '@/utils/api';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '@/utils/auth';
import {
  calculateStreak,
  getLastNDays,
  todayString,
  formatDate,
} from '@/utils/dates';
import { CalendarGrid } from '@/components/CalendarGrid';
import { WardrobeGrid } from '@/components/WardrobeGrid';

const SCREEN_WIDTH = Math.min(Dimensions.get('window').width, 390);
const SCREEN_HEIGHT = Dimensions.get('window').height;

const BLOB_W = Math.round(SCREEN_WIDTH * 0.84); // natural blob width
const BLOB_ASPECT = 477 / 277;                   // viewBox height/width ratio

const PHOTO_R = 20;

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
  const [activeTab, setActiveTab] = useState<'journal' | 'closet'>('journal');
  const [pendingCount, setPendingCount] = useState(0);
  const [todayItems, setTodayItems] = useState<WardrobeItem[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [contactsPermission, setContactsPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [contacts, setContacts] = useState<{ name: string; phone: string }[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [invitedPhones, setInvitedPhones] = useState<Set<string>>(new Set());

  // Check if contacts were already granted (e.g. during onboarding)
  useEffect(() => {
    Contacts.getPermissionsAsync().then(({ status }) => {
      if (status === 'granted') {
        setContactsPermission('granted');
        Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name] }).then(({ data }) => {
          const parsed = data
            .filter(c => c.phoneNumbers && c.phoneNumbers.length > 0 && c.name)
            .map(c => ({ name: c.name!, phone: c.phoneNumbers![0].number! }))
            .sort((a, b) => a.name.localeCompare(b.name));
          setContacts(parsed);
        });
      }
    }).catch(() => {});
  }, []);

  const handleRequestContacts = async () => {
    const { status } = await Contacts.requestPermissionsAsync();
    setContactsPermission(status === 'granted' ? 'granted' : 'denied');
    if (status === 'granted') {
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
      });
      const parsed = data
        .filter(c => c.phoneNumbers && c.phoneNumbers.length > 0 && c.name)
        .map(c => ({ name: c.name!, phone: c.phoneNumbers![0].number! }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setContacts(parsed);
    }
  };

  const handleInviteContact = (phone: string, name: string) => {
    const msg = `hey ${name.split(' ')[0].toLowerCase()}! i've been using muse to log my daily outfits — you should join 💌 https://bemymuse.app`;
    Linking.openURL(`sms:${phone}&body=${encodeURIComponent(msg)}`);
    setInvitedPhones(prev => new Set(prev).add(phone));
    createReferral(phone).catch(() => {});
  };

  const handleShareInvite = () => {
    Share.share({ message: "be my muse 💌 https://bemymuse.app" });
  };

  useFocusEffect(
    useCallback(() => {
      if (session) {
        getMyPosts().then(all => {
          const sorted = [...all].sort((a, b) => b.date.localeCompare(a.date));
          setPosts(sorted);
          // Fetch wardrobe items for today's post
          const today = sorted.find(p => p.date === todayString());
          if (today) {
            getPostWardrobeItems(today.id).then(setTodayItems).catch(() => {});
          } else {
            setTodayItems([]);
          }
        });
        getNotificationsBadgeCount().then(({ followRequests, unread }) => setPendingCount(followRequests + unread)).catch(() => {});
      }
    }, [session?.user.id])
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

  const handleAddClosetItem = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled) return;
    try {
      const item = await createWardrobeItem('untitled');
      await addWardrobeItemPhoto(item.id, result.assets[0].uri);
      router.push({ pathname: '/wardrobe/[id]' as any, params: { id: item.id } });
    } catch {}
  };
  const goToTodayEntry = () => router.push({ pathname: '/entry/[date]' as any, params: { date: todayStr } });

  const insets = useSafeAreaInsets();
  const headerH = insets.top + 72;
  // Panel peek stays the same regardless of posted state
  const panelPeek = STREAK_PEEK;
  const spacerH = containerH > 0 ? containerH - panelPeek : SCREEN_HEIGHT - panelPeek;
  const blobAreaH = spacerH - headerH;
  // Scale blob proportionally — never squish vertically
  const naturalBlobH = Math.round(BLOB_W * BLOB_ASPECT);
  const maxBlobH = Math.round(blobAreaH * 0.88);
  const blobH = Math.min(naturalBlobH, maxBlobH);
  const blobW = blobH < naturalBlobH ? Math.round(blobH / BLOB_ASPECT) : BLOB_W;
  // Photo: 3:4 portrait, sized to fit inside the blob with blue peeking out
  const photoW = Math.round(blobW * 0.78);
  const photoH = Math.round(photoW * 4 / 3);

  // Carousel: cards same size as the photo, centered with side cards peeking
  const screenW = Dimensions.get('window').width;
  const CARD_GAP = 33;
  const cardW = photoW;
  const cardH = photoH;
  const snapInterval = cardW + CARD_GAP;
  const carouselScrollX = useRef(new Animated.Value(0)).current;

  // Build the logical card list: [invite, main, ...wardrobe items]
  type CardEntry = { key: string; type: 'invite' | 'main' | 'item'; item?: WardrobeItem };
  const baseCards: CardEntry[] = [];
  if (todayPost) {
    baseCards.push({ key: 'invite', type: 'invite' });
  }
  baseCards.push({ key: 'main', type: 'main' });
  if (todayPost) {
    todayItems.forEach(item => baseCards.push({ key: `item-${item.id}`, type: 'item', item }));
  }
  const cardCount = baseCards.length;

  // For 3+ cards, create infinite wheel: repeat 3x, start in the middle copy
  const needsWheel = cardCount >= 3;
  const wheelCards = needsWheel
    ? [...baseCards.map((c, i) => ({ ...c, key: `pre-${c.key}`, idx: i })),
       ...baseCards.map((c, i) => ({ ...c, key: `mid-${c.key}`, idx: i + cardCount })),
       ...baseCards.map((c, i) => ({ ...c, key: `post-${c.key}`, idx: i + cardCount * 2 }))]
    : baseCards.map((c, i) => ({ ...c, idx: i }));

  // Main card is index 1 in baseCards (or 0 if no invite), in the middle copy
  const mainBaseIndex = todayPost ? 1 : 0;
  const mainWheelIndex = needsWheel ? cardCount + mainBaseIndex : mainBaseIndex;
  const initialScrollX = mainWheelIndex * snapInterval;

  const carouselRef = useRef<any>(null);
  const touchCarouselRef = useRef<any>(null);

  // Scroll both carousels to center card on mount/post change
  useEffect(() => {
    const t = setTimeout(() => {
      carouselRef.current?.scrollTo({ x: initialScrollX, animated: false });
      touchCarouselRef.current?.scrollTo({ x: initialScrollX, animated: false });
      carouselScrollX.setValue(initialScrollX);
    }, 50);
    return () => clearTimeout(t);
  }, [todayPost?.id, todayItems.length]);
  const isAdjusting = useRef(false);

  // Sync visual carousel when touch overlay scrolls
  const onTouchCarouselScroll = (e: any) => {
    const x = e.nativeEvent.contentOffset.x;
    carouselRef.current?.scrollTo({ x, animated: false });
  };

  // When user scrolls past first or third copy, silently jump to middle copy
  const onCarouselScrollEnd = (e: any) => {
    if (!needsWheel || isAdjusting.current) return;
    const x = e.nativeEvent.contentOffset.x;
    const page = Math.round(x / snapInterval);
    if (page < cardCount || page >= cardCount * 2) {
      isAdjusting.current = true;
      const targetPage = cardCount + (page % cardCount);
      const targetX = targetPage * snapInterval;
      touchCarouselRef.current?.scrollTo({ x: targetX, animated: false });
      carouselRef.current?.scrollTo({ x: targetX, animated: false });
      carouselScrollX.setValue(targetX);
      setTimeout(() => { isAdjusting.current = false; }, 50);
    }
  };

  const getCardAnimStyle = (wheelIndex: number) => {
    const inputRange = [
      (wheelIndex - 1) * snapInterval,
      wheelIndex * snapInterval,
      (wheelIndex + 1) * snapInterval,
    ];
    const scale = carouselScrollX.interpolate({
      inputRange,
      outputRange: [0.85, 1, 0.85],
      extrapolate: 'clamp',
    });
    const opacity = carouselScrollX.interpolate({
      inputRange,
      outputRange: [0.5, 1, 0.5],
      extrapolate: 'clamp',
    });
    return { transform: [{ scale }], opacity };
  };

  const initials = (profile?.display_name ?? profile?.username ?? '?')[0].toUpperCase();

  return (
    <SafeAreaView
      style={styles.safe}
      onLayout={e => setContainerH(e.nativeEvent.layout.height)}
    >
      <StatusBar barStyle="dark-content" backgroundColor={Theme.colors.background} />

      {/* Hero background — blob mirror, behind everything */}
      <View style={[styles.heroLayer, { height: spacerH }]} pointerEvents="none">
        <View style={{ height: headerH }} />
        <View style={styles.blobFixed}>
          <BlobMirror width={blobW} height={blobH} />
        </View>
      </View>

      {/* Carousel — fixed layer, rendered before ScrollView so panel covers it.
          Touch overlay rendered after ScrollView handles swipes/taps. */}
      <View style={[styles.heroLayer, { height: spacerH }]} pointerEvents="none">
        <View style={{ height: headerH }} />
        <View style={styles.carouselWrapper}>
          <Animated.ScrollView
            scrollEnabled={false}
            ref={carouselRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={snapInterval}
            decelerationRate="fast"
            contentOffset={{ x: initialScrollX, y: 0 }}
            contentContainerStyle={{
              paddingHorizontal: (screenW - cardW) / 2,
              gap: CARD_GAP,
              alignItems: 'center',
            }}
            onScroll={Animated.event(
              [{ nativeEvent: { contentOffset: { x: carouselScrollX } } }],
              { useNativeDriver: true },
            )}
            onMomentumScrollEnd={onCarouselScrollEnd}
            scrollEventThrottle={16}
          >
            {wheelCards.map(card => {
              const animStyle = (todayPost || card.type !== 'main') ? getCardAnimStyle(card.idx) : undefined;

              if (card.type === 'invite') {
                return (
                  <Animated.View key={card.key} style={[styles.carouselCard, { width: cardW, height: cardH }, animStyle]}>
                    <LinearGradient
                      colors={['#F9C74F', '#F77FAD'] as const}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.engagementCardBg}
                    >
                      <Text style={styles.engagementEmoji}>💌</Text>
                      <Text style={styles.engagementTitle}>{'invite\n5 friends'}</Text>
                      <View style={styles.inviteDots}>
                        {[0, 1, 2, 3, 4].map(i => (
                          <View key={i} style={[styles.inviteDot, i < invitedPhones.size && styles.inviteDotFilled]} />
                        ))}
                      </View>
                      <Text style={styles.engagementSub}>unlock features as they join</Text>
                    </LinearGradient>
                  </Animated.View>
                );
              }

              if (card.type === 'main') {
                return (
                  <Animated.View key={card.key} style={[styles.carouselCard, { width: cardW, height: cardH }, animStyle]}>
                    {!session ? (
                      <View style={[StyleSheet.absoluteFill, styles.mainCardContent]}>
                        <Text style={styles.blobTitle}>{'SIGN IN\nTO START'}</Text>
                      </View>
                    ) : !todayPost ? (
                      <View style={[StyleSheet.absoluteFill, styles.mainCardContent]}>
                        <View style={styles.cameraRing}>
                          <Feather name="camera" size={28} color="#0B0B0B" />
                        </View>
                        <Text style={styles.blobTitle}>{'ADD\nTODAY\'S\nLOOK'}</Text>
                      </View>
                    ) : (
                      <View style={[styles.photoTouchable, { width: cardW, height: cardH }]}>
                        <Image
                          source={{ uri: todayPost.photo_url }}
                            cachePolicy="disk"
                          style={[styles.photoImage, { width: cardW, height: cardH }]}
                          resizeMode="cover"
                        />
                        <LinearGradient
                          colors={['transparent', 'rgba(11,11,11,0.55)']}
                          style={styles.photoOverlay}
                        >
                          <Text style={styles.photoDate}>{formatDate(todayStr)}</Text>
                          <View style={styles.photoLoggedRow}>
                            <Text style={styles.photoLoggedText}>today's look</Text>
                            <View style={styles.checkBadge}>
                              <Feather name="check" size={11} color="#fff" />
                            </View>
                          </View>
                        </LinearGradient>
                      </View>
                    )}
                  </Animated.View>
                );
              }

              const item = card.item!;
              return (
                <Animated.View key={card.key} style={[styles.carouselCard, { width: cardW, height: cardH }, animStyle]}>
                  {item.generated_image_url ? (
                    <View style={styles.itemCardBg}>
                      <Image
                        source={{ uri: item.generated_image_url }}
                          cachePolicy="disk"
                        style={styles.itemCardImage}
                        resizeMode="contain"
                      />
                      <View style={styles.itemCardFooter}>
                        <Text style={styles.itemCardLabel} numberOfLines={1}>{item.label}</Text>
                        {item.brand && <Text style={styles.itemCardBrand} numberOfLines={1}>{item.brand}</Text>}
                      </View>
                    </View>
                  ) : (
                    <View style={[styles.itemCardBg, { backgroundColor: Theme.colors.surface }]}>
                      <Text style={styles.itemCardPlaceholderEmoji}>👕</Text>
                      <Text style={styles.itemCardLabel}>{item.label}</Text>
                    </View>
                  )}
                </Animated.View>
              );
            })}
          </Animated.ScrollView>
        </View>
      </View>

      {/* Scroll overlay — panel slides over blob + carousel */}
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

          {/* Journal / Wardrobe underline tabs */}
          <View style={styles.tabRow}>
            {(['journal', 'closet'] as const).map(tab => (
              <TouchableOpacity
                key={tab}
                onPress={() => { setActiveTab(tab); }}
                style={styles.tabItem}
                activeOpacity={0.7}
              >
                <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                  {tab}
                </Text>
                <View style={[styles.tabUnderline, activeTab === tab && styles.tabUnderlineActive]} />
              </TouchableOpacity>
            ))}
          </View>

          {activeTab !== 'closet' ? (
            <>
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
            </>
          ) : (
            <WardrobeGrid
              userId={session?.user.id ?? ''}
              onItemPress={(id) => router.push({ pathname: '/wardrobe/[id]' as any, params: { id } })}
              onAddItem={handleAddClosetItem}
              onLogOutfit={goToAdd}
            />
          )}
        </LinearGradient>
      </ScrollView>

      {/* Carousel touch overlay — on top of ScrollView for swipe/tap, transparent */}
      <View
        style={[styles.heroLayer, { height: spacerH }]}
        pointerEvents={scrollY < 50 ? 'box-none' : 'none'}
      >
        <View style={{ height: headerH }} pointerEvents="none" />
        <View style={styles.carouselWrapper}>
          <Animated.ScrollView
            ref={touchCarouselRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={snapInterval}
            decelerationRate="fast"
            contentOffset={{ x: initialScrollX, y: 0 }}
            contentContainerStyle={{
              paddingHorizontal: (screenW - cardW) / 2,
              gap: CARD_GAP,
              alignItems: 'center',
            }}
            onScroll={Animated.event(
              [{ nativeEvent: { contentOffset: { x: carouselScrollX } } }],
              { useNativeDriver: true, listener: onTouchCarouselScroll },
            )}
            onMomentumScrollEnd={onCarouselScrollEnd}
            scrollEventThrottle={16}
          >
            {wheelCards.map(card => (
              <TouchableOpacity
                key={card.key}
                style={{ width: cardW, height: cardH }}
                activeOpacity={1}
                onPress={
                  card.type === 'invite' ? () => setShowInvite(true)
                  : card.type === 'main' ? (!session ? () => router.push('/auth' as any) : !todayPost ? goToAdd : goToTodayEntry)
                  : () => router.push({ pathname: '/wardrobe/[id]' as any, params: { id: card.item!.id } })
                }
              />
            ))}
          </Animated.ScrollView>
        </View>
      </View>

      {/* Header rendered last = above scroll, touches reach it */}
      <View style={[styles.header, { paddingTop: insets.top + 4 }]} pointerEvents="box-none">
        <Text style={styles.wordmark}>muse</Text>
        <View style={styles.headerRight}>
          {session && (
            <>
              <TouchableOpacity
                style={styles.bellBtn}
                onPress={() => router.push('/notifications' as any)}
                activeOpacity={0.8}
              >
                <Feather name="bell" size={22} color={Theme.colors.primary} />
                {pendingCount > 0 && (
                  <View style={styles.bellBadge}>
                    <Text style={styles.bellBadgeText}>{pendingCount > 9 ? '9+' : pendingCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.bellBtn}
                onPress={() => router.push('/saved' as any)}
                activeOpacity={0.8}
              >
                <Feather name="bookmark" size={21} color={Theme.colors.primary} />
              </TouchableOpacity>
            </>
          )}
          <TouchableOpacity
            style={styles.avatarBtn}
            onPress={() => router.push('/profile' as any)}
            activeOpacity={0.8}
          >
            {profile?.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatarImg} cachePolicy="disk" />
            ) : profile ? (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitials}>{initials}</Text>
              </View>
            ) : (
              <View style={styles.avatarPlaceholder} />
            )}
          </TouchableOpacity>
        </View>
      </View>
      {/* Invite friends modal */}
      <Modal visible={showInvite} animationType="slide" transparent>
        <View style={styles.inviteOverlay}>
          <View style={styles.inviteSheet}>
            <View style={styles.inviteHeader}>
              <View style={{ width: 40 }} />
              <Text style={styles.inviteTitle}>invite friends</Text>
              <TouchableOpacity onPress={() => setShowInvite(false)} hitSlop={12} style={{ width: 40, alignItems: 'flex-end' }}>
                <Text style={styles.inviteDone}>done</Text>
              </TouchableOpacity>
            </View>

            {contactsPermission !== 'granted' ? (
              <View style={styles.inviteEmptyState}>
                <Text style={{ fontSize: 36 }}>📱</Text>
                <Text style={styles.inviteEmptyTitle}>connect with your people</Text>
                <Text style={styles.inviteEmptyBody}>see who's already here and invite the rest</Text>
                <TouchableOpacity style={styles.inviteSyncBtn} onPress={handleRequestContacts} activeOpacity={0.8}>
                  <LinearGradient
                    colors={['#F9C74F', '#F77FAD']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.inviteSyncGradient}
                  >
                    <Text style={styles.inviteSyncText}>sync contacts</Text>
                  </LinearGradient>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleShareInvite} style={styles.inviteShareLink}>
                  <Text style={styles.inviteShareLinkText}>or share invite link</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <View style={styles.inviteSearchRow}>
                  <Feather name="search" size={16} color={Theme.colors.secondary} />
                  <TextInput
                    style={styles.inviteSearchInput}
                    placeholder="search contacts"
                    placeholderTextColor={Theme.colors.secondary}
                    value={contactSearch}
                    onChangeText={setContactSearch}
                  />
                </View>
                <FlatList
                  data={contacts.filter(c =>
                    !contactSearch.trim() || c.name.toLowerCase().includes(contactSearch.toLowerCase())
                  )}
                  keyExtractor={(item, i) => `${item.phone}-${i}`}
                  renderItem={({ item }) => {
                    const invited = invitedPhones.has(item.phone);
                    return (
                      <View style={styles.inviteContactRow}>
                        <View style={styles.inviteContactAvatar}>
                          <Text style={styles.inviteContactInitial}>{item.name[0].toUpperCase()}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.inviteContactName}>{item.name}</Text>
                          <Text style={styles.inviteContactPhone}>{item.phone}</Text>
                        </View>
                        <TouchableOpacity
                          style={[styles.inviteBtn, invited && styles.inviteBtnSent]}
                          onPress={() => handleInviteContact(item.phone, item.name)}
                          activeOpacity={0.8}
                          disabled={invited}
                        >
                          <Text style={[styles.inviteBtnText, invited && styles.inviteBtnTextSent]}>
                            {invited ? 'sent' : 'invite'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    );
                  }}
                  ListEmptyComponent={
                    <Text style={styles.inviteEmptyBody}>no contacts found</Text>
                  }
                  contentContainerStyle={{ paddingBottom: 32 }}
                />
                <TouchableOpacity onPress={handleShareInvite} activeOpacity={0.8} style={{ borderRadius: 100, overflow: 'hidden', marginHorizontal: 20, marginBottom: 8 }}>
                  <LinearGradient
                    colors={['#F9C74F', '#F77FAD']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.inviteShareBar}
                  >
                    <Feather name="link" size={14} color="#fff" />
                    <Text style={styles.inviteShareBarText}>share invite link</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
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
    fontFamily: 'Caprasimo_400Regular', fontSize: 40,
    color: Theme.colors.brandWarm, letterSpacing: -0.5,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bellBtn: { position: 'relative' },
  bellBadge: {
    position: 'absolute', top: -4, right: -4,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: Theme.colors.brandWarm,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3,
  },
  bellBadgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },
  avatarBtn: {},
  avatarImg: { width: 34, height: 34, borderRadius: 17 },
  avatarPlaceholder: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: Theme.colors.surface,
    borderWidth: 1.5, borderColor: Theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitials: { fontSize: Theme.font.sm, fontWeight: '700', color: Theme.colors.primary },

  blobFixed: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  carouselWrapper: { flex: 1, justifyContent: 'center' },
  mainCardContent: { alignItems: 'center', justifyContent: 'center', gap: 14 },
  carouselCard: { borderRadius: 28, overflow: 'hidden' },
  postedHero: { alignItems: 'center', justifyContent: 'center' },
  engagementCardBg: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10,
    borderRadius: 28, paddingHorizontal: 32,
    borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.06)',
  },
  engagementEmoji: { fontSize: 36 },
  engagementTitle: {
    fontFamily: 'Caprasimo_400Regular', fontSize: 20,
    color: '#0B0B0B', textAlign: 'center', letterSpacing: -0.3, lineHeight: 26,
  },
  inviteDots: { flexDirection: 'row', gap: 8, marginTop: 4 },
  inviteDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: 'rgba(0,0,0,0.12)', borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.18)',
  },
  inviteDotFilled: { backgroundColor: Theme.colors.brandWarm, borderColor: Theme.colors.brandWarm },
  engagementSub: {
    fontSize: Theme.font.sm, color: 'rgba(11,11,11,0.5)',
    textAlign: 'center', fontWeight: '500', marginTop: 2,
  },
  itemCardBg: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff', borderRadius: 28,
    borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.08)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 8, elevation: 3,
  },
  itemCardImage: {
    width: '75%', height: '65%',
  },
  itemCardFooter: {
    position: 'absolute', bottom: 20, left: 16, right: 16,
    alignItems: 'center',
  },
  itemCardLabel: {
    fontSize: Theme.font.sm, fontWeight: '700', color: Theme.colors.primary,
    textAlign: 'center',
  },
  itemCardBrand: {
    fontSize: Theme.font.xs, color: Theme.colors.secondary,
    marginTop: 2, textTransform: 'lowercase',
  },
  itemCardPlaceholderEmoji: { fontSize: 44, marginBottom: 10 },
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

  tabRow: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  tabItem: { flex: 1, alignItems: 'center', paddingBottom: 0 },
  tabText: {
    fontSize: Theme.font.sm, fontWeight: '500',
    color: 'rgba(0,0,0,0.3)', textTransform: 'lowercase', letterSpacing: 0.3,
    paddingBottom: 8,
  },
  tabTextActive: { color: Theme.colors.limeText, fontWeight: '600' },
  tabUnderline: {
    alignSelf: 'stretch', marginHorizontal: 16,
    height: 1.5, borderRadius: 1, backgroundColor: 'transparent',
  },
  tabUnderlineActive: { backgroundColor: Theme.colors.limeText },

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
    backgroundColor: Theme.colors.brandWarm,
    alignItems: 'center', justifyContent: 'center',
  },

  // Invite modal
  inviteOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'flex-end',
  },
  inviteSheet: {
    backgroundColor: Theme.colors.background,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    maxHeight: '85%', paddingBottom: 32,
  },
  inviteHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 20, paddingBottom: 12,
  },
  inviteTitle: {
    fontFamily: 'Caprasimo_400Regular', fontSize: 20,
    color: Theme.colors.primary,
  },
  inviteDone: { fontSize: Theme.font.base, fontWeight: '600', color: Theme.colors.accent },
  inviteEmptyState: {
    alignItems: 'center', paddingHorizontal: 32, paddingVertical: 40, gap: 10,
  },
  inviteEmptyTitle: {
    fontSize: Theme.font.md, fontWeight: '700', color: Theme.colors.primary,
    textAlign: 'center',
  },
  inviteEmptyBody: {
    fontSize: Theme.font.sm, color: Theme.colors.secondary,
    textAlign: 'center', lineHeight: 20,
  },
  inviteSyncBtn: { marginTop: 12, borderRadius: 100, overflow: 'hidden' },
  inviteSyncGradient: { paddingHorizontal: 28, paddingVertical: 12, borderRadius: 100 },
  inviteSyncText: { fontSize: Theme.font.sm, fontWeight: '700', color: '#fff' },
  inviteShareLink: { marginTop: 8 },
  inviteShareLinkText: { fontSize: Theme.font.sm, fontWeight: '600', color: Theme.colors.accent },
  inviteSearchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 20, marginBottom: 8,
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.radius.md,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  inviteSearchInput: { flex: 1, fontSize: Theme.font.sm, color: Theme.colors.primary, padding: 0 },
  inviteContactRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingVertical: 10,
  },
  inviteContactAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Theme.colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  inviteContactInitial: { fontSize: Theme.font.sm, fontWeight: '700', color: Theme.colors.primary },
  inviteContactName: { fontSize: Theme.font.sm, fontWeight: '600', color: Theme.colors.primary },
  inviteContactPhone: { fontSize: Theme.font.xs, color: Theme.colors.secondary, marginTop: 1 },
  inviteBtn: {
    backgroundColor: Theme.colors.brandWarm,
    paddingHorizontal: 16, paddingVertical: 6, borderRadius: 100,
  },
  inviteBtnText: { fontSize: Theme.font.xs, fontWeight: '700', color: '#fff' },
  inviteBtnSent: { backgroundColor: Theme.colors.surface },
  inviteBtnTextSent: { color: Theme.colors.secondary },
  inviteShareBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 100,
  },
  inviteShareBarText: { fontSize: Theme.font.sm, fontWeight: '700', color: '#fff' },
});
