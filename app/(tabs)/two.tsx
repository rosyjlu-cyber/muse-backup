import { useCallback, useRef, useState } from 'react';
import { Image } from 'expo-image';
import {
  View,
  Text,
  TextInput,
  FlatList,
  ScrollView,
  StyleSheet,
  StatusBar,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Theme } from '@/constants/Theme';
import { getFeed, getMyCommunities, searchProfiles, searchPosts, likePost, unlikePost, savePost, unsavePost, addComment, Post, Profile, Community, FeedFilters } from '@/utils/api';
import { useAuth } from '@/utils/auth';
import { PostCard } from '@/components/PostCard';
import { FeedFiltersBar } from '@/components/FeedFilters';

export default function FeedScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [filters, setFilters] = useState<FeedFilters>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Search modal
  const [searchQuery, setSearchQuery] = useState('');
  const [searchPeople, setSearchPeople] = useState<Profile[]>([]);
  const [searchPostResults, setSearchPostResults] = useState<Post[]>([]);
  const [searching, setSearching] = useState(false);
  const [showAllPeople, setShowAllPeople] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    setShowAllPeople(false);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!text.trim()) { setSearchPeople([]); setSearchPostResults([]); return; }
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const [people, postResults] = await Promise.all([
          searchProfiles(text.trim()),
          searchPosts(text.trim()),
        ]);
        setSearchPeople(people);
        setSearchPostResults(postResults);
      } catch {}
      finally { setSearching(false); }
    }, 400);
  };

  const userId = session?.user.id;
  // Track post IDs with in-flight like/unlike so a concurrent getFeed can't overwrite them
  const pendingLikes = useRef(new Set<string>());
  const nextCursor = useRef<string | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    const [result, myCommunities] = await Promise.all([
      getFeed(filters).catch(() => ({ posts: [] as Post[], nextCursor: undefined })),
      getMyCommunities().catch(() => [] as Community[]),
    ]);
    nextCursor.current = result.nextCursor;
    setPosts(prev => {
      const pending = pendingLikes.current;
      if (pending.size === 0) return result.posts;
      const prevMap = new Map(prev.map(p => [p.id, p]));
      return result.posts.map(p => {
        if (!pending.has(p.id)) return p;
        const cur = prevMap.get(p.id);
        return cur ? { ...p, liked_by_me: cur.liked_by_me, likes_count: cur.likes_count } : p;
      });
    });
    setCommunities(myCommunities);
    setLoading(false);
  }, [userId, filters]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    nextCursor.current = undefined;
    await load();
    setRefreshing(false);
  };

  const loadMore = async () => {
    if (loadingMore || !nextCursor.current) return;
    setLoadingMore(true);
    try {
      const result = await getFeed(filters, nextCursor.current);
      nextCursor.current = result.nextCursor;
      setPosts(prev => [...prev, ...result.posts]);
    } catch {}
    finally { setLoadingMore(false); }
  };



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
          activeOpacity={0.8}
        >
          <View style={styles.communityBtn}>
            <Text style={styles.communityBtnText}>join a community</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <Feather name="search" size={15} color={Theme.colors.secondary} />
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={handleSearchChange}
          placeholder="search outfits, tags, people..."
          placeholderTextColor={Theme.colors.disabled}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchPeople([]); setSearchPostResults([]); }} hitSlop={8}>
            <Feather name="x" size={15} color={Theme.colors.secondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Filters — always visible; when searching, shown inside results */}
      {!searchQuery.trim() && <FeedFiltersBar
        filters={filters}
        onChange={setFilters}
        communities={communities}
        availableTags={[]}
        onCommunityLongPress={(id) => router.push({ pathname: '/community/[id]' as any, params: { id } })}
      />}

      {searchQuery.trim() ? (
        /* Search results inline */
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {searching && <View style={{ alignItems: 'center', marginTop: 20 }}><ActivityIndicator color={Theme.colors.brandWarm} /></View>}
          {!searching && searchPeople.length === 0 && searchPostResults.length === 0 && (
            <Text style={styles.searchHint}>no results found</Text>
          )}

          {/* People section */}
          {searchPeople.length > 0 && (
            <View style={styles.searchSection}>
              <Text style={styles.searchSectionLabel}>people</Text>
              {(showAllPeople ? searchPeople : searchPeople.slice(0, 3)).map(p => (
                <TouchableOpacity
                  key={p.id}
                  style={styles.personRow}
                  onPress={() => {
                    if (p.id === session?.user?.id) router.push('/profile' as any);
                    else router.push({ pathname: '/profile/[userId]' as any, params: { userId: p.id } });
                  }}
                  activeOpacity={0.7}
                >
                  {p.avatar_url ? (
                    <Image source={{ uri: p.avatar_url }} style={styles.personAvatar} cachePolicy="disk" />
                  ) : (
                    <View style={styles.personAvatarPlaceholder}>
                      <Text style={styles.personInitial}>{(p.display_name ?? p.username ?? '?')[0].toUpperCase()}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.personName}>{p.display_name ?? p.username}</Text>
                    <Text style={styles.personUsername}>@{p.username}</Text>
                  </View>
                </TouchableOpacity>
              ))}
              {!showAllPeople && searchPeople.length > 3 && (
                <TouchableOpacity onPress={() => setShowAllPeople(true)} activeOpacity={0.7} style={styles.viewMoreBtn}>
                  <Text style={styles.viewMoreText}>view all {searchPeople.length} people</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Posts section */}
          {searchPostResults.length > 0 && (
            <View style={styles.searchSection}>
              <Text style={[styles.searchSectionLabel, { marginBottom: 0 }]}>outfits</Text>
              <View style={{ marginHorizontal: -20 }}>
                <FeedFiltersBar
                  filters={filters}
                  onChange={setFilters}
                  communities={communities}
                  availableTags={[...new Set(searchPostResults.flatMap(p => p.tags ?? []))].filter(t => t.toLowerCase().includes(searchQuery.trim().toLowerCase()))}
                  onCommunityLongPress={(id) => router.push({ pathname: '/community/[id]' as any, params: { id } })}
                />
              </View>
              {searchPostResults.map(post => (
                <PostCard
                  key={post.id}
                  post={post}
                  onPress={() => handlePostPress(post)}
                  onLike={handleLike}
                  onSave={handleSave}
                  onComment={handleComment}
                  onUserPress={(uid) => {
                    if (uid === session?.user?.id) router.push('/profile' as any);
                    else router.push({ pathname: '/profile/[userId]' as any, params: { userId: uid } });
                  }}
                />
              ))}
            </View>
          )}
        </ScrollView>
      ) : (
        /* Feed */
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
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Theme.colors.accent}
            />
          }
          ListFooterComponent={loadingMore ? (
            <View style={{ paddingVertical: 20, alignItems: 'center' }}>
              <ActivityIndicator color={Theme.colors.brandWarm} />
            </View>
          ) : null}
          ListEmptyComponent={loading ? null : (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Feather name="image" size={28} color={Theme.colors.disabled} />
              </View>
              <Text style={styles.emptyTitle}>you're all caught up</Text>
              <Text style={styles.emptyBody}>check back later for new looks</Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Theme.colors.background },

  header: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 4,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 8, marginBottom: 4,
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.radius.md,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  wordmark: {
    fontFamily: 'Caprasimo_400Regular',
    fontSize: 40,
    color: Theme.colors.brandWarm,
    letterSpacing: -0.5,
  },

  communityBtn: {
    backgroundColor: Theme.colors.brandWarm,
    borderRadius: 100,
    paddingHorizontal: 14, paddingVertical: 6, marginBottom: 8,
  },
  communityBtnText: { fontSize: Theme.font.xs, fontWeight: '700', color: '#fff' },

  list: { flex: 1, backgroundColor: Theme.colors.background },
  listContent: { paddingTop: 5, paddingBottom: 32 },

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

  searchHint: { fontSize: Theme.font.sm, color: Theme.colors.secondary, textAlign: 'center', marginTop: 32 },
  personRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Theme.colors.border,
  },
  personAvatar: { width: 44, height: 44, borderRadius: 22 },
  personAvatarPlaceholder: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Theme.colors.surface, borderWidth: 1, borderColor: Theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  personInitial: { fontSize: Theme.font.base, fontWeight: '700', color: Theme.colors.primary },
  personName: { fontSize: Theme.font.base, fontWeight: '600', color: Theme.colors.primary },
  personUsername: { fontSize: Theme.font.xs, color: Theme.colors.secondary, marginTop: 1 },
  searchSectionLabel: {
    fontSize: Theme.font.xs, fontWeight: '700', color: Theme.colors.secondary,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6,
  },
  viewMoreBtn: { paddingVertical: 10 },
  viewMoreText: { fontSize: Theme.font.xs, fontWeight: '600', color: Theme.colors.accent },
  searchSection: { paddingHorizontal: 20, marginBottom: 8, marginTop: 8 },
  searchInput: { flex: 1, fontSize: Theme.font.sm, color: Theme.colors.primary, padding: 0 },
});
