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

import { Theme } from '@/constants/Theme';
import {
  getProfile,
  getPostsByUser,
  isFollowing,
  followUser,
  unfollowUser,
  likePost,
  unlikePost,
  addComment,
  Profile,
  Post,
} from '@/utils/api';
import { useAuth } from '@/utils/auth';
import { PostCard } from '@/components/PostCard';

export default function UserProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();
  const { session } = useAuth();

  const isOwnProfile = userId === session?.user?.id;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(true);

  const pendingLikes = useRef(new Set<string>());

  const canSeeContent = !!profile?.is_public || following || isOwnProfile;

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      setLoading(true);
      Promise.all([
        getProfile(userId),
        session ? isFollowing(userId) : Promise.resolve(false),
        getPostsByUser(userId),
      ])
        .then(([prof, isFollow, userPosts]) => {
          setProfile(prof);
          setFollowing(isFollow);
          setPosts(userPosts);
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    }, [userId, session?.user?.id])
  );

  const handleFollowToggle = async () => {
    if (!session) { router.push('/auth' as any); return; }
    const wasFollowing = following;
    setFollowing(!wasFollowing);
    try {
      if (wasFollowing) {
        await unfollowUser(userId);
      } else {
        await followUser(userId);
        // Reload posts now that we're following
        getPostsByUser(userId).then(setPosts);
      }
    } catch {
      setFollowing(wasFollowing); // revert on error
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

  const handleComment = async (post: Post, text: string) => {
    await addComment(post.id, text);
    setPosts(prev => prev.map(p =>
      p.id === post.id ? { ...p, comments_count: (p.comments_count ?? 0) + 1 } : p
    ));
  };

  const HeaderBar = ({ title }: { title?: string }) => (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
        <Text style={styles.backText}>‹ back</Text>
      </TouchableOpacity>
      {title ? <Text style={styles.headerTitle}>{title}</Text> : <View />}
      <View style={styles.headerSpacer} />
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor={Theme.colors.background} />
        <HeaderBar />
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
        <HeaderBar />
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
      <HeaderBar title={displayName} />

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

          {/* Stats */}
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statNum}>{posts.length}</Text>
              <Text style={styles.statLabel}>outfits</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Text style={styles.statNum}>{profile.followers_count ?? 0}</Text>
              <Text style={styles.statLabel}>followers</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Text style={styles.statNum}>{profile.following_count ?? 0}</Text>
              <Text style={styles.statLabel}>following</Text>
            </View>
          </View>

          {/* Follow / Unfollow */}
          {!isOwnProfile && session && (
            <TouchableOpacity
              style={[styles.followBtn, following && styles.followBtnActive]}
              onPress={handleFollowToggle}
              activeOpacity={0.8}
            >
              <Text style={[styles.followBtnText, following && styles.followBtnTextActive]}>
                {following ? 'following' : 'follow'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Content ── */}
        {canSeeContent ? (
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
                  onComment={handleComment}
                />
              ))}
            </View>
          ) : (
            <View style={styles.emptyBlock}>
              <Feather name="image" size={32} color={Theme.colors.disabled} />
              <Text style={styles.emptyText}>no public outfits yet</Text>
            </View>
          )
        ) : (
          <View style={styles.privateBlock}>
            <Feather name="lock" size={40} color={Theme.colors.secondary} />
            <Text style={styles.privateTitle}>this account is private</Text>
            <Text style={styles.privateSub}>follow to see their outfits</Text>
          </View>
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
  headerTitle: {
    fontFamily: Theme.font.brand,
    fontSize: 22,
    color: Theme.colors.primary,
    letterSpacing: -0.3,
    maxWidth: 200,
  },
  headerSpacer: { width: 60 },

  profileBlock: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
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
    marginTop: 2, marginBottom: 0,
  },

  statsRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 28, marginTop: 20, marginBottom: 20,
  },
  stat: { alignItems: 'center', gap: 2 },
  statNum: { fontSize: Theme.font.lg, fontWeight: '800', color: Theme.colors.primary },
  statLabel: {
    fontSize: Theme.font.xs, color: Theme.colors.secondary,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  statDivider: { width: 1, height: 28, backgroundColor: Theme.colors.border },

  followBtn: {
    borderRadius: 100,
    paddingHorizontal: 32, paddingVertical: 10,
    borderWidth: 1.5, borderColor: Theme.colors.accent,
  },
  followBtnActive: {
    backgroundColor: Theme.colors.accent,
    borderColor: Theme.colors.accent,
  },
  followBtnText: {
    fontSize: Theme.font.sm, fontWeight: '700',
    color: Theme.colors.accent, letterSpacing: 0.2,
  },
  followBtnTextActive: {
    color: Theme.colors.background,
  },

  postsContainer: { paddingTop: 8 },

  emptyBlock: {
    alignItems: 'center', paddingTop: 48, gap: 12,
  },
  emptyText: {
    fontSize: Theme.font.sm, color: Theme.colors.secondary,
  },

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
