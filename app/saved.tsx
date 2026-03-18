import { useCallback, useState } from 'react';
import {
  View, Text, Image, TouchableOpacity,
  StyleSheet, FlatList, ScrollView, ActivityIndicator, Dimensions,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import { Theme } from '@/constants/Theme';
import {
  getSavedPosts, getSavedWardrobeItems,
  likePost, unlikePost, savePost, unsavePost, addComment,
  Post, WardrobeItem,
} from '@/utils/api';
import { useAuth } from '@/utils/auth';
import { PostCard } from '@/components/PostCard';

const SW = Math.min(Dimensions.get('window').width, 390);
const CELL = Math.floor((SW - 32 - 12) / 2);

function catEmoji(cat: string | null) {
  const map: Record<string, string> = {
    top: '👕', bottom: '👖', outerwear: '🧥', shoes: '👟',
    bag: '👜', dress: '👗', accessory: '💍',
  };
  return cat ? (map[cat] ?? '🏷️') : '🏷️';
}

export default function SavedScreen() {
  const router = useRouter();
  const { session } = useAuth();

  const [activeTab, setActiveTab] = useState<'looks' | 'clothing'>('looks');
  const [posts, setPosts] = useState<Post[]>([]);
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      setLoading(true);
      Promise.all([getSavedPosts(), getSavedWardrobeItems()])
        .then(([p, w]) => { setPosts(p); setItems(w); })
        .finally(() => setLoading(false));
    }, [session?.user.id])
  );

  const handleLike = (post: Post) => {
    const liked = post.liked_by_me ?? false;
    setPosts(prev => prev.map(p =>
      p.id === post.id
        ? { ...p, liked_by_me: !liked, likes_count: Math.max((p.likes_count ?? 0) + (liked ? -1 : 1), 0) }
        : p
    ));
    (liked ? unlikePost(post.id) : likePost(post.id)).catch(() => {
      setPosts(prev => prev.map(p =>
        p.id === post.id ? { ...p, liked_by_me: liked, likes_count: post.likes_count } : p
      ));
    });
  };

  const handleSave = (post: Post) => {
    const saved = post.saved_by_me ?? false;
    if (saved) {
      setPosts(prev => prev.filter(p => p.id !== post.id));
      unsavePost(post.id).catch(() => {
        setPosts(prev => [{ ...post, saved_by_me: true }, ...prev]);
      });
    } else {
      setPosts(prev => prev.map(p => p.id === post.id ? { ...p, saved_by_me: true } : p));
      savePost(post.id).catch(() => {
        setPosts(prev => prev.map(p => p.id === post.id ? { ...p, saved_by_me: false } : p));
      });
    }
  };

  const handleComment = async (postId: string, text: string, parentCommentId?: string) => {
    await addComment(postId, text, parentCommentId);
    setPosts(prev => prev.map(p =>
      p.id === postId ? { ...p, comments_count: (p.comments_count ?? 0) + 1 } : p
    ));
  };

  // Item grid rows (2 cols)
  const itemRows: WardrobeItem[][] = [];
  for (let i = 0; i < items.length; i += 2) itemRows.push(items.slice(i, i + 2));

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backText}>‹ back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>saved</Text>
        <View style={{ width: 48 }} />
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        {(['looks', 'clothing'] as const).map(tab => (
          <TouchableOpacity
            key={tab}
            style={styles.tabItem}
            onPress={() => setActiveTab(tab)}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab}</Text>
            {activeTab === tab && <View style={styles.tabUnderline} />}
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Theme.colors.brandWarm} />
        </View>
      ) : activeTab === 'looks' ? (
        <FlatList
          data={posts}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <PostCard
              post={item}
              onPress={() => router.push({ pathname: '/entry/[date]' as any, params: { date: item.date, userId: item.user_id } })}
              onLike={handleLike}
              onSave={handleSave}
              onComment={handleComment}
              onUserPress={(uid) => router.push({ pathname: '/profile/[userId]' as any, params: { userId: uid } })}
            />
          )}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.center}>
              <Feather name="bookmark" size={36} color={Theme.colors.border} style={{ marginBottom: 12 }} />
              <Text style={styles.emptyText}>no saved looks yet</Text>
              <Text style={styles.emptySubText}>bookmark outfits from the feed to find them here</Text>
            </View>
          }
        />
      ) : activeTab === 'clothing' ? (
        <ScrollView contentContainerStyle={styles.itemScrollContent} showsVerticalScrollIndicator={false}>
          {items.length === 0 ? (
            <View style={styles.center}>
              <Feather name="bookmark" size={36} color={Theme.colors.border} style={{ marginBottom: 12 }} />
              <Text style={styles.emptyText}>no saved items yet</Text>
              <Text style={styles.emptySubText}>bookmark wardrobe items from other people's clothings to find them here</Text>
            </View>
          ) : (
            <View style={styles.itemGrid}>
              {itemRows.map((row, ri) => (
                <View key={ri} style={styles.itemRow}>
                  {row.map(item => {
                    const imageUrl = item.generated_image_url ?? item.photos?.[0]?.photo_url ?? null;
                    return (
                      <TouchableOpacity
                        key={item.id}
                        style={styles.itemCell}
                        onPress={() => router.push({ pathname: '/wardrobe/[id]' as any, params: { id: item.id } })}
                        activeOpacity={0.82}
                      >
                        {imageUrl ? (
                          <View style={styles.itemCellImg}>
                            <Image source={{ uri: imageUrl }} style={styles.itemCellImgFill} resizeMode="contain" />
                          </View>
                        ) : (
                          <View style={[styles.itemCellImg, styles.itemCellPlaceholder]}>
                            <Text style={styles.itemEmoji}>{catEmoji(item.category)}</Text>
                          </View>
                        )}
                        <Text style={styles.itemLabel} numberOfLines={1}>{item.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                  {row.length < 2 && <View style={styles.itemCell} />}
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Theme.colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  backText: { fontSize: Theme.font.base, color: Theme.colors.primary, fontWeight: '600' },
  title: { fontSize: 22, fontFamily: 'Caprasimo_400Regular', color: Theme.colors.primary },

  tabRow: {
    flexDirection: 'row',
    marginHorizontal: '3%',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.border,
    marginBottom: 4,
  },
  tabItem: { flex: 1, alignItems: 'center', paddingTop: 10, paddingBottom: 0 },
  tabText: { fontSize: Theme.font.sm, fontWeight: '600', color: Theme.colors.secondary, paddingBottom: 8 },
  tabTextActive: { color: Theme.colors.primary },
  tabUnderline: {
    alignSelf: 'stretch', marginHorizontal: 16,
    height: 1.5, backgroundColor: Theme.colors.primary, borderRadius: 1,
  },

  list: { paddingTop: 12, paddingBottom: 48 },
  itemScrollContent: { paddingBottom: 48, flexGrow: 1 },

  itemGrid: { paddingHorizontal: 16, paddingTop: 12 },
  itemRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  itemCell: { width: CELL },
  itemCellImg: {
    width: CELL, height: CELL,
    backgroundColor: '#F8F8F8',
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Theme.colors.border,
  },
  itemCellImgFill: { width: CELL - 16, height: CELL - 16 },
  itemCellPlaceholder: { backgroundColor: Theme.colors.surface },
  itemEmoji: { fontSize: 32 },
  itemLabel: {
    fontSize: Theme.font.xs, color: Theme.colors.primary,
    fontWeight: '500', marginTop: 5, textAlign: 'center',
  },

  emptyText: { fontSize: Theme.font.sm, color: Theme.colors.secondary, textAlign: 'center', fontWeight: '600' },
  emptySubText: { fontSize: Theme.font.xs, color: Theme.colors.secondary, textAlign: 'center', marginTop: 6, lineHeight: 18 },
});
