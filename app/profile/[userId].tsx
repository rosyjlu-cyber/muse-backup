import { useCallback, useRef, useState } from 'react';
import { Image } from 'expo-image';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Animated,
  Modal,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { Theme } from '@/constants/Theme';
import {
  getProfile,
  getPostsByUser,
  getFollowStatus,
  followUser,
  unfollowUser,
  sendFollowRequest,
  cancelFollowRequest,
  likePost,
  unlikePost,
  savePost,
  unsavePost,
  addComment,
  getFollowers,
  getFollowing,
  Profile,
  Post,
} from '@/utils/api';
import { supabase } from '@/utils/supabase';
import { useAuth } from '@/utils/auth';
import { PostCard } from '@/components/PostCard';
import { WardrobeGrid } from '@/components/WardrobeGrid';


export default function UserProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();
  const { session } = useAuth();

  const isOwnProfile = userId === session?.user?.id;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [followStatus, setFollowStatus] = useState<'following' | 'pending' | 'none'>('none');
  const [loading, setLoading] = useState(true);
  const [communityCount, setCommunityCount] = useState(0);
  const [activeTab, setActiveTab] = useState<'journal' | 'closet'>('journal');
  const [statsOpen, setStatsOpen] = useState(false);

  const [popupType, setPopupType] = useState<'followers' | 'following' | null>(null);
  const [popupProfiles, setPopupProfiles] = useState<Profile[]>([]);
  const [popupLoading, setPopupLoading] = useState(false);

  const openPopup = async (type: 'followers' | 'following') => {
    if (!canSeeContent) return;
    setPopupType(type);
    setPopupLoading(true);
    try {
      if (type === 'followers') setPopupProfiles(await getFollowers(userId));
      else setPopupProfiles(await getFollowing(userId));
    } catch {}
    finally { setPopupLoading(false); }
  };

  const pendingLikes = useRef(new Set<string>());
  const hasLoaded = useRef(false);
  const scrollY = useRef(new Animated.Value(0)).current;

  const SCROLL_THRESHOLD = 60;
  const titleFontSize = scrollY.interpolate({
    inputRange: [0, SCROLL_THRESHOLD],
    outputRange: [28, 20],
    extrapolate: 'clamp',
  });
  const usernameFontSize = scrollY.interpolate({
    inputRange: [0, SCROLL_THRESHOLD],
    outputRange: [14, 10],
    extrapolate: 'clamp',
  });
  const headerCenterMarginTop = scrollY.interpolate({
    inputRange: [0, SCROLL_THRESHOLD],
    outputRange: [28, 0],
    extrapolate: 'clamp',
  });
  const headerPaddingBottom = scrollY.interpolate({
    inputRange: [0, SCROLL_THRESHOLD],
    outputRange: [10, 4],
    extrapolate: 'clamp',
  });

  const canSeeContent = !!profile?.is_public || followStatus === 'following' || isOwnProfile;

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      if (hasLoaded.current) return;
      hasLoaded.current = true;
      setLoading(true);
      Promise.all([
        getProfile(userId),
        session ? getFollowStatus(userId) : Promise.resolve('none' as const),
        getPostsByUser(userId),
        supabase.from('community_members').select('*', { count: 'exact', head: true }).eq('user_id', userId),
      ])
        .then(([prof, status, userPosts, { count }]) => {
          setProfile(prof);
          setFollowStatus(status);
          setPosts(userPosts);
          setCommunityCount(count ?? 0);
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    }, [userId, session?.user?.id])
  );

  const handleFollowToggle = async () => {
    if (!session) { router.push('/auth' as any); return; }
    const prev = followStatus;
    if (prev === 'following') {
      setFollowStatus('none');
      try { await unfollowUser(userId); } catch { setFollowStatus('following'); }
    } else if (prev === 'pending') {
      setFollowStatus('none');
      try { await cancelFollowRequest(userId); } catch { setFollowStatus('pending'); }
    } else {
      if (!profile?.is_public) {
        setFollowStatus('pending');
        try { await sendFollowRequest(userId); } catch { setFollowStatus('none'); }
      } else {
        setFollowStatus('following');
        try { await followUser(userId); getPostsByUser(userId).then(setPosts); } catch { setFollowStatus('none'); }
      }
    }
  };

  const handleLike = (post: Post) => {
    const liked = post.liked_by_me ?? false;
    pendingLikes.current.add(post.id);
    setPosts(prev => prev.map(p =>
      p.id === post.id
        ? { ...p, liked_by_me: !liked, likes_count: Math.max((p.likes_count ?? 0) + (liked ? -1 : 1), 0) }
        : p
    ));
    (liked ? unlikePost(post.id) : likePost(post.id))
      .then(() => pendingLikes.current.delete(post.id))
      .catch(() => {
        pendingLikes.current.delete(post.id);
        setPosts(prev => prev.map(p =>
          p.id === post.id
            ? { ...p, liked_by_me: liked, likes_count: post.likes_count }
            : p
        ));
      });
  };

  const handleSave = (post: Post) => {
    const saved = post.saved_by_me ?? false;
    setPosts(prev => prev.map(p => p.id === post.id ? { ...p, saved_by_me: !saved } : p));
    (saved ? unsavePost(post.id) : savePost(post.id)).catch(() => {
      setPosts(prev => prev.map(p => p.id === post.id ? { ...p, saved_by_me: saved } : p));
    });
  };

  const handleComment = async (post: Post, text: string) => {
    await addComment(post.id, text);
    setPosts(prev => prev.map(p =>
      p.id === post.id ? { ...p, comments_count: (p.comments_count ?? 0) + 1 } : p
    ));
  };


  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor={Theme.colors.background} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.headerLeft}>
            <Text style={styles.backText}>‹ back</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator color={Theme.colors.brandWarm} />
        </View>
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor={Theme.colors.background} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.headerLeft}>
            <Text style={styles.backText}>‹ back</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <Text style={styles.notFoundText}>user not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const displayName = profile.display_name ?? profile.username;
  const initials = displayName[0].toUpperCase();


  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={Theme.colors.background} />

      {/* Header */}
      <Animated.View style={[styles.header, { paddingBottom: headerPaddingBottom }]}>
        <Animated.View style={[styles.headerCenter, { marginTop: headerCenterMarginTop }]}>
          <Animated.Text style={[styles.headerTitle, { fontSize: titleFontSize }]}>{displayName}</Animated.Text>
          <Animated.Text style={[styles.headerUsername, { fontSize: usernameFontSize }]}>@{profile.username}</Animated.Text>
        </Animated.View>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.headerLeft}>
          <Text style={styles.backText}>‹ back</Text>
        </TouchableOpacity>
        {!isOwnProfile && session ? (
          <TouchableOpacity onPress={handleFollowToggle} activeOpacity={0.85} hitSlop={8} style={styles.headerRight}>
            {followStatus === 'none' ? (
              <LinearGradient
                colors={['#F9C74F', '#F77FAD']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={styles.headerFollowBtn}
              >
                <Text style={styles.headerFollowText}>follow</Text>
              </LinearGradient>
            ) : (
              <View style={[styles.headerFollowBtn, styles.headerFollowBtnMuted]}>
                <Text style={styles.headerFollowTextMuted}>
                  {followStatus === 'following' ? 'following' : 'requested'}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        ) : null}
      </Animated.View>

      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: false }
        )}
        scrollEventThrottle={16}
      >
        {/* ── Profile block ── */}
        <View style={styles.profileBlock}>
          {/* Avatar */}
          <View style={styles.avatarArea}>
            {profile.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatar} cachePolicy="disk" />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitials}>{initials}</Text>
              </View>
            )}
          </View>

          {profile.bio ? (
            <Text style={styles.bioText}>{profile.bio}</Text>
          ) : null}

          {/* Stats card (collapsible) */}
          <LinearGradient
            colors={['#F9C74F', '#F77FAD']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={styles.statsCard}
          >
            {!statsOpen && (
              <TouchableOpacity style={styles.statsCardHeader} onPress={() => setStatsOpen(true)} activeOpacity={0.8}>
                <Text style={styles.statsCardTitle}>
                  {posts.length} outfits · {communityCount} communities
                </Text>
                <Feather name="chevron-down" size={14} color="rgba(0,0,0,0.5)" />
              </TouchableOpacity>
            )}

            {statsOpen && (
              <>
                <TouchableOpacity style={styles.statsCollapseHint} onPress={() => setStatsOpen(false)} activeOpacity={0.7}>
                  <Feather name="chevron-up" size={14} color="rgba(0,0,0,0.35)" />
                </TouchableOpacity>
                <View style={styles.statsGrid}>
                  <TouchableOpacity style={styles.stat} onPress={() => setActiveTab('journal')} activeOpacity={0.7}>
                    <Text style={styles.statNum}>{posts.length}</Text>
                    <Text style={styles.statLabel}>outfits</Text>
                  </TouchableOpacity>
                  <View style={styles.stat}>
                    <Text style={styles.statNum}>{communityCount}</Text>
                    <Text style={styles.statLabel}>communities</Text>
                  </View>
                  <TouchableOpacity style={styles.stat} onPress={() => openPopup('followers')} activeOpacity={0.7}>
                    <Text style={styles.statNum}>{profile.followers_count ?? 0}</Text>
                    <Text style={styles.statLabel}>followers</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.stat} onPress={() => openPopup('following')} activeOpacity={0.7}>
                    <Text style={styles.statNum}>{profile.following_count ?? 0}</Text>
                    <Text style={styles.statLabel}>following</Text>
                  </TouchableOpacity>
                </View>

                  {(profile.style_tags?.length ?? 0) > 0 && (
                    <>
                      <View style={styles.statsTagDivider} />
                      <Text style={styles.statsTagHeader}>my style</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tagsScroll} contentContainerStyle={styles.tagsScrollContent}>
                        {profile.style_tags!.map(tag => (
                          <View key={tag} style={styles.tagChip}>
                            <Text style={styles.tagChipText}>{tag}</Text>
                          </View>
                        ))}
                      </ScrollView>
                    </>
                  )}
                </>
              )}
          </LinearGradient>

        </View>

        {/* Journal | Closet tabs — outside profileBlock so it spans the full width */}
        <View style={styles.tabRow}>
          {(['journal', ...(isOwnProfile || profile.share_closet ? ['closet'] : [])] as const).map(tab => (
            <TouchableOpacity
              key={tab}
              onPress={() => setActiveTab(tab as 'journal' | 'closet')}
              style={styles.tabItem}
            >
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                {tab}
              </Text>
              {activeTab === tab && <View style={styles.tabUnderline} />}
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Tab content ── */}
        {activeTab === 'journal' ? (
          canSeeContent ? (
            posts.length > 0 ? (
              <View style={styles.postsContainer}>
                {posts.map(post => (
                  <PostCard
                    key={post.id}
                    post={post}
                    onPress={() =>
                      router.push({
                        pathname: '/entry/[date]' as any,
                        params: { date: post.date, userId: post.user_id },
                      })
                    }
                    onLike={handleLike}
                    onSave={handleSave}
                    onComment={handleComment}
                    onUserPress={(uid) => {
                      if (uid === userId) return;
                      router.push({ pathname: '/profile/[userId]' as any, params: { userId: uid } });
                    }}
                  />
                ))}
              </View>
            ) : (
              <View style={styles.emptyBlock}>
                <Feather name="image" size={32} color={Theme.colors.disabled} />
                <Text style={styles.emptyText}>nothing here yet</Text>
              </View>
            )
          ) : (
            <View style={styles.privateBlock}>
              <Feather name="lock" size={40} color={Theme.colors.secondary} />
              <Text style={styles.privateTitle}>this account is private</Text>
              <Text style={styles.privateSub}>follow to see their outfits</Text>
            </View>
          )
        ) : (
          // Closet tab
          !canSeeContent ? (
            <View style={styles.privateBlock}>
              <Feather name="lock" size={40} color={Theme.colors.secondary} />
              <Text style={styles.privateTitle}>this account is private</Text>
              <Text style={styles.privateSub}>follow to see their closet</Text>
            </View>
          ) : profile.share_closet === false ? (
            <View style={styles.privateBlock}>
              <Feather name="lock" size={40} color={Theme.colors.secondary} />
              <Text style={styles.privateTitle}>this closet is private</Text>
              <Text style={styles.privateSub}>they haven't shared their wardrobe</Text>
            </View>
          ) : (
            <WardrobeGrid
              userId={userId}
              readOnly
              onItemPress={(id) => router.push({ pathname: '/wardrobe/[id]' as any, params: { id } })}
            />
          )
        )}

        <View style={{ height: 48 }} />
      </Animated.ScrollView>

      {/* Followers / Following popup */}
      <Modal visible={popupType !== null} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.safe}>
          <View style={styles.popupHeader}>
            <View style={{ width: 40 }} />
            <Text style={styles.popupTitle}>{popupType ?? ''}</Text>
            <TouchableOpacity onPress={() => setPopupType(null)} hitSlop={12}>
              <Text style={styles.popupClose}>done</Text>
            </TouchableOpacity>
          </View>
          {popupLoading ? (
            <View style={styles.popupCenter}>
              <ActivityIndicator color={Theme.colors.brandWarm} />
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.popupList}>
              {popupProfiles.length === 0 ? (
                <Text style={styles.popupEmpty}>no {popupType} yet</Text>
              ) : popupProfiles.map(p => (
                <TouchableOpacity
                  key={p.id}
                  style={styles.popupRow}
                  onPress={() => {
                    setPopupType(null);
                    if (p.id === userId) return;
                    router.push({ pathname: '/profile/[userId]' as any, params: { userId: p.id } });
                  }}
                  activeOpacity={0.7}
                >
                  {p.avatar_url ? (
                    <Image source={{ uri: p.avatar_url }} style={styles.popupAvatar} cachePolicy="disk" />
                  ) : (
                    <View style={styles.popupAvatarPlaceholder}>
                      <Text style={styles.popupAvatarInitial}>{(p.display_name ?? p.username ?? '?')[0].toUpperCase()}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.popupName}>{p.display_name ?? p.username}</Text>
                    <Text style={styles.popupSub}>@{p.username}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Theme.colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  notFoundText: { fontSize: Theme.font.sm, color: Theme.colors.secondary },

  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
  },
  headerLeft: { position: 'absolute', left: 16, top: 8 },
  headerRight: { position: 'absolute', right: 16, top: 10 },
  backText: { fontSize: Theme.font.base, color: Theme.colors.primary, fontWeight: '600' },
  headerCenter: { alignItems: 'center' },
  headerTitle: {
    fontFamily: 'Caprasimo_400Regular',
    color: Theme.colors.primary, letterSpacing: -0.3,
  },
  headerUsername: { color: Theme.colors.secondary, marginTop: 1 },
  headerFollowBtn: {
    paddingHorizontal: 16, paddingVertical: 7,
    borderRadius: 100, alignItems: 'center',
  },
  headerFollowBtnMuted: {
    backgroundColor: Theme.colors.surface,
    borderWidth: 1.5, borderColor: Theme.colors.border,
  },
  headerFollowText: { fontSize: Theme.font.xs, fontWeight: '800', color: '#0B0B0B' },
  headerFollowTextMuted: { fontSize: Theme.font.xs, fontWeight: '700', color: Theme.colors.secondary },

  profileBlock: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },

  avatarArea: { marginBottom: 10 },
  avatar: { width: 88, height: 88, borderRadius: 44 },
  avatarPlaceholder: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: Theme.colors.surface,
    borderWidth: 2, borderColor: Theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitials: { fontSize: 32, fontWeight: '700', color: Theme.colors.primary },


  statsCard: {
    width: '100%', borderRadius: Theme.radius.lg,
    marginTop: 14, marginBottom: 14, padding: 4, overflow: 'hidden',
  },
  statsCardHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, paddingHorizontal: 12, gap: 6,
  },
  statsCardTitle: {
    fontSize: Theme.font.xs, fontWeight: '700', color: 'rgba(0,0,0,0.5)',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  statsTagDivider: { height: 1, backgroundColor: 'rgba(0,0,0,0.08)', marginHorizontal: 4, marginTop: 8, marginBottom: 14 },
  statsTagHeader: {
    fontSize: Theme.font.xs, fontWeight: '800', color: Theme.colors.primary,
    textTransform: 'uppercase', letterSpacing: 0.8, opacity: 0.6,
    paddingHorizontal: 12, marginBottom: 6, textAlign: 'center',
  },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  stat: { width: '50%', alignItems: 'center', paddingVertical: 16, gap: 3 },
  statNum: { fontSize: 22, fontWeight: '800', color: Theme.colors.primary },
  statLabel: { fontSize: Theme.font.xs, color: Theme.colors.primary, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6 },

  bioText: {
    fontSize: Theme.font.base, fontWeight: '500', color: Theme.colors.primary,
    lineHeight: 21, marginTop: 6, textAlign: 'center',
  },
  tagsScroll: { paddingHorizontal: 8 },
  tagsScrollContent: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 8, paddingRight: 12 },
  tagChip: {
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)',
  },
  tagChipText: { fontSize: Theme.font.xs, fontWeight: '600', color: Theme.colors.primary },

  statsCollapseHint: { alignItems: 'center', paddingTop: 6 },

  // Tabs
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: '3%',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.border,
    marginBottom: 4,
  },
  tabItem: {
    flex: 1, alignItems: 'center', paddingTop: 10, paddingBottom: 0,
  },
  tabText: {
    fontSize: Theme.font.sm, fontWeight: '600', color: Theme.colors.secondary, paddingBottom: 8,
  },
  tabTextActive: { color: Theme.colors.primary },
  tabUnderline: {
    alignSelf: 'stretch', marginHorizontal: 16,
    height: 1.5, backgroundColor: Theme.colors.primary, borderRadius: 1,
  },

  postsContainer: { paddingTop: 8 },

  emptyBlock: { alignItems: 'center', paddingTop: 48, gap: 12 },
  emptyText: { fontSize: Theme.font.sm, color: Theme.colors.secondary },

  privateBlock: {
    alignItems: 'center', paddingTop: 48, gap: 10,
    paddingHorizontal: 40,
  },
  privateTitle: {
    fontSize: Theme.font.md, fontWeight: '700',
    color: Theme.colors.primary, marginTop: 4,
  },
  privateSub: {
    fontSize: Theme.font.sm, color: Theme.colors.secondary,
    textAlign: 'center', lineHeight: 20,
  },

  // Popup modal
  popupHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Theme.colors.border,
  },
  popupTitle: {
    fontFamily: 'Caprasimo_400Regular', fontSize: 20,
    color: Theme.colors.primary, textAlign: 'center', flex: 1,
  },
  popupClose: { fontSize: Theme.font.sm, fontWeight: '600', color: Theme.colors.accent, width: 40, textAlign: 'right' },
  popupCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  popupList: { padding: 16 },
  popupEmpty: { fontSize: Theme.font.sm, color: Theme.colors.secondary, textAlign: 'center', marginTop: 32 },
  popupRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Theme.colors.border,
  },
  popupAvatar: { width: 40, height: 40, borderRadius: 20 },
  popupAvatarPlaceholder: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Theme.colors.surface, borderWidth: 1, borderColor: Theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  popupAvatarInitial: { fontSize: Theme.font.sm, fontWeight: '700', color: Theme.colors.primary },
  popupName: { fontSize: Theme.font.sm, fontWeight: '600', color: Theme.colors.primary },
  popupSub: { fontSize: Theme.font.xs, color: Theme.colors.secondary, marginTop: 1 },
});
