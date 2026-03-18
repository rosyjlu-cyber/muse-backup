import { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
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

  const pendingLikes = useRef(new Set<string>());

  const canSeeContent = !!profile?.is_public || followStatus === 'following' || isOwnProfile;

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
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
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.backText}>‹ back</Text>
          </TouchableOpacity>
          <View style={styles.headerSpacer} />
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
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.backText}>‹ back</Text>
          </TouchableOpacity>
          <View style={styles.headerSpacer} />
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

      {/* Header — back only, no duplicate name */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backText}>‹ back</Text>
        </TouchableOpacity>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* ── Profile block ── */}
        <View style={styles.profileBlock}>
          {/* Avatar */}
          <View style={styles.avatarArea}>
            {profile.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitials}>{initials}</Text>
              </View>
            )}
            {!profile.is_public && (
              <View style={styles.lockBadge}>
                <Feather name="lock" size={10} color={Theme.colors.background} />
              </View>
            )}
          </View>

          <Text style={styles.displayName}>{displayName}</Text>
          <Text style={styles.username}>@{profile.username}</Text>

          {profile.bio ? (
            <Text style={styles.bioText}>{profile.bio}</Text>
          ) : null}

          {/* Stats card */}
          <LinearGradient
            colors={['#F9C74F', '#F77FAD']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={styles.statsCard}
          >
            <View style={styles.statsGrid}>
              <View style={styles.stat}>
                <Text style={styles.statNum}>{posts.length}</Text>
                <Text style={styles.statLabel}>outfits</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statNum}>{communityCount}</Text>
                <Text style={styles.statLabel}>communities</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statNum}>{profile.followers_count ?? 0}</Text>
                <Text style={styles.statLabel}>followers</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statNum}>{profile.following_count ?? 0}</Text>
                <Text style={styles.statLabel}>following</Text>
              </View>
            </View>

            {(profile.style_tags?.length ?? 0) > 0 && (
              <>
                <View style={styles.statsTagDivider} />
                <Text style={styles.statsTagHeader}>my style</Text>
                <View style={styles.tagsRow}>
                  {profile.style_tags!.map(tag => (
                    <View key={tag} style={styles.tagChip}>
                      <Text style={styles.tagChipText}>{tag}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}
          </LinearGradient>

          {/* Follow / Unfollow / Requested */}
          {!isOwnProfile && session && (
            <TouchableOpacity onPress={handleFollowToggle} activeOpacity={0.85} style={styles.followBtnWrap}>
              {followStatus === 'none' ? (
                <LinearGradient
                  colors={['#F9C74F', '#F77FAD']}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={styles.followBtn}
                >
                  <Text style={styles.followBtnText}>follow</Text>
                </LinearGradient>
              ) : (
                <View style={[styles.followBtn, followStatus === 'pending' ? styles.followBtnPending : styles.followBtnActive]}>
                  <Text style={styles.followBtnTextMuted}>
                    {followStatus === 'following' ? 'following' : 'requested'}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          )}

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
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Theme.colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  notFoundText: { fontSize: Theme.font.sm, color: Theme.colors.secondary },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backText: { fontSize: Theme.font.base, color: Theme.colors.primary, fontWeight: '600' },
  headerSpacer: { width: 60 },

  profileBlock: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },

  avatarArea: { marginBottom: 14, position: 'relative' },
  avatar: { width: 88, height: 88, borderRadius: 44 },
  avatarPlaceholder: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: Theme.colors.surface,
    borderWidth: 2, borderColor: Theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitials: { fontSize: 32, fontWeight: '700', color: Theme.colors.primary },
  lockBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: Theme.colors.secondary,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Theme.colors.background,
  },

  displayName: {
    fontSize: Theme.font.xl, fontWeight: '800',
    color: Theme.colors.primary, letterSpacing: -0.5, textAlign: 'center',
  },
  username: {
    fontSize: Theme.font.sm, color: Theme.colors.secondary,
    marginTop: 2, marginBottom: 12,
  },

  statsCard: {
    width: '100%', borderRadius: Theme.radius.lg,
    marginTop: 20, marginBottom: 8, padding: 4,
  },
  statsTagDivider: { height: 1, backgroundColor: 'rgba(0,0,0,0.12)', marginHorizontal: 4, marginVertical: 8 },
  statsTagHeader: {
    fontSize: Theme.font.xs, fontWeight: '800', color: Theme.colors.primary,
    textTransform: 'uppercase', letterSpacing: 0.8, opacity: 0.6,
    paddingHorizontal: 12, marginBottom: 6,
  },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  stat: { width: '50%', alignItems: 'center', paddingVertical: 16, gap: 3 },
  statNum: { fontSize: 22, fontWeight: '800', color: Theme.colors.primary },
  statLabel: { fontSize: Theme.font.xs, color: Theme.colors.primary, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6 },

  bioText: { fontSize: Theme.font.sm, color: Theme.colors.primary, lineHeight: 20, marginBottom: 8, textAlign: 'center' },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingBottom: 8 },
  tagChip: {
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: Theme.colors.background,
    borderWidth: 1, borderColor: Theme.colors.border,
  },
  tagChipText: { fontSize: Theme.font.xs, color: Theme.colors.primary },

  followBtnWrap: { width: '100%', marginBottom: 8 },
  followBtn: {
    width: '100%', borderRadius: Theme.radius.md,
    paddingVertical: 18, alignItems: 'center',
  },
  followBtnActive: {
    backgroundColor: Theme.colors.surface,
    borderWidth: 1.5, borderColor: Theme.colors.border,
  },
  followBtnPending: {
    backgroundColor: Theme.colors.surface,
    borderWidth: 1.5, borderColor: Theme.colors.secondary,
  },
  followBtnText: { fontSize: Theme.font.base, fontWeight: '800', color: '#0B0B0B', letterSpacing: -0.2 },
  followBtnTextMuted: { fontSize: Theme.font.base, fontWeight: '700', color: Theme.colors.secondary },

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
});
