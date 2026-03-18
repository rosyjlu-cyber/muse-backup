import { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  StatusBar,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { Theme } from '@/constants/Theme';
import { getFeed, getMyCommunities, likePost, unlikePost, savePost, unsavePost, addComment, Post, Community, FeedFilters } from '@/utils/api';
import { useAuth } from '@/utils/auth';
import { PostCard } from '@/components/PostCard';
import { FeedFiltersBar } from '@/components/FeedFilters';

export default function FeedScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [filters, setFilters] = useState<FeedFilters>({});
  const [refreshing, setRefreshing] = useState(false);

  const userId = session?.user.id;
  // Track post IDs with in-flight like/unlike so a concurrent getFeed can't overwrite them
  const pendingLikes = useRef(new Set<string>());

  const load = useCallback(async () => {
    if (!userId) return;
    const [feedPosts, myCommunities] = await Promise.all([
      getFeed(filters).catch(() => [] as Post[]),
      getMyCommunities().catch(() => [] as Community[]),
    ]);
    setPosts(prev => {
      const pending = pendingLikes.current;
      if (pending.size === 0) return feedPosts;
      // Preserve optimistic like state for any posts still being processed
      const prevMap = new Map(prev.map(p => [p.id, p]));
      return feedPosts.map(p => {
        if (!pending.has(p.id)) return p;
        const cur = prevMap.get(p.id);
        return cur ? { ...p, liked_by_me: cur.liked_by_me, likes_count: cur.likes_count } : p;
      });
    });
    setCommunities(myCommunities);
  }, [userId, filters]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // Collect unique tags from current feed for the filter bar
  const availableTags = Array.from(
    new Set(posts.flatMap(p => p.tags))
  ).slice(0, 20);

  const handlePostPress = (post: Post) => {
    router.push({
      pathname: '/entry/[date]' as any,
      params: { date: post.date, userId: post.user_id },
    });
  };


  const handleComment = async (postId: string, content: string, parentCommentId?: string) => {
    await addComment(postId, content, parentCommentId);
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

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={Theme.colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.wordmark}>muse</Text>
        <TouchableOpacity
          onPress={() => router.push('/communities' as any)}
          hitSlop={12}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={['#F9C74F', '#F77FAD']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.communityBtn}
          >
            <Text style={styles.communityBtnText}>join a community</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* Filters */}
      <FeedFiltersBar
        filters={filters}
        onChange={setFilters}
        communities={communities}
        availableTags={availableTags}
      />

      {/* Feed list */}
      <FlatList
        data={posts}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <PostCard
            post={item}
            onPress={() => handlePostPress(item)}
            onLike={handleLike}
            onSave={handleSave}
            onComment={handleComment}
            onAuthorPress={() => {
              if (item.user_id === session?.user?.id) {
                router.push('/profile' as any);
              } else {
                router.push({ pathname: '/profile/[userId]' as any, params: { userId: item.user_id } });
              }
            }}
            onUserPress={(userId) => {
              if (userId === session?.user?.id) {
                router.push('/profile' as any);
              } else {
                router.push({ pathname: '/profile/[userId]' as any, params: { userId } });
              }
            }}
          />
        )}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Theme.colors.accent}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Feather name="image" size={28} color={Theme.colors.disabled} />
            </View>
            <Text style={styles.emptyTitle}>nothing here yet</Text>
            <Text style={styles.emptyBody}>
              looks from public profiles and your{'\n'}communities will show up here
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Theme.colors.background },

  header: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  wordmark: {
    fontFamily: 'Caprasimo_400Regular',
    fontSize: 40,
    color: Theme.colors.brandWarm,
    letterSpacing: -0.5,
  },

  communityBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Theme.colors.accent, borderRadius: 100,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  communityBtnText: { fontSize: Theme.font.xs, fontWeight: '700', color: Theme.colors.background },

  list: { flex: 1, backgroundColor: Theme.colors.background },
  listContent: { paddingTop: 8, paddingBottom: 32 },

  empty: {
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: 40,
    gap: 10,
  },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: Theme.colors.surface,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: Theme.font.md, fontWeight: '700',
    color: Theme.colors.primary, letterSpacing: -0.2,
  },
  emptyBody: {
    fontSize: Theme.font.sm, color: Theme.colors.secondary,
    textAlign: 'center', lineHeight: 20,
  },
});
