import { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Platform,
  Share,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import * as Linking from 'expo-linking';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import { Theme } from '@/constants/Theme';
import { getCommunity, getCommunityPosts, joinCommunity, leaveCommunity, deleteCommunity, likePost, unlikePost, addComment, Community, Post } from '@/utils/api';
import { useAuth } from '@/utils/auth';
import { PostCard } from '@/components/PostCard';

export default function CommunityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const [community, setCommunity] = useState<Community | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [joining, setJoining] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      Promise.all([getCommunity(id), getCommunityPosts(id)]).then(([c, ps]) => {
        setCommunity(c);
        setPosts(ps);
      });
    }, [id])
  );

  const handleJoinLeave = async () => {
    if (!community || !session) return;
    setJoining(true);
    try {
      if (community.is_member) {
        const confirmed = Platform.OS === 'web'
          ? window.confirm(`leave ${community.name}?`)
          : await new Promise<boolean>(resolve =>
              Alert.alert(`leave ${community.name}?`, '', [
                { text: 'cancel', style: 'cancel', onPress: () => resolve(false) },
                { text: 'leave', style: 'destructive', onPress: () => resolve(true) },
              ])
            );
        if (!confirmed) { setJoining(false); return; }
        await leaveCommunity(community.id);
        setCommunity(c => c ? { ...c, is_member: false, member_count: (c.member_count ?? 1) - 1 } : c);
      } else {
        await joinCommunity(community.id);
        setCommunity(c => c ? { ...c, is_member: true, member_count: (c.member_count ?? 0) + 1 } : c);
      }
    } catch (e: any) {
      Platform.OS === 'web'
        ? window.alert(e?.message ?? 'something went wrong')
        : Alert.alert('error', e?.message ?? 'something went wrong');
    } finally {
      setJoining(false);
    }
  };

  const handleDelete = async () => {
    if (!community) return;
    if (Platform.OS === 'web') {
      if (!window.confirm(`delete "${community.name}"? this removes the community and all its members.`)) return;
      try {
        await deleteCommunity(community.id);
        router.back();
      } catch (e: any) {
        window.alert(e?.message ?? 'could not delete community');
      }
      return;
    }
    Alert.alert(`delete "${community.name}"?`, 'this removes the community and all its members. you can\'t undo this.', [
      { text: 'cancel', style: 'cancel' },
      {
        text: 'delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteCommunity(community.id);
            router.back();
          } catch (e: any) {
            Alert.alert('error', e?.message ?? 'could not delete community');
          }
        },
      },
    ]);
  };

  const handleShare = async () => {
    if (!community) return;
    const url = Linking.createURL(`community/${id}`);
    try {
      await Share.share({ message: `join the ${community.name} community on Muse — ${url}`, url });
    } catch {}
  };

  const handlePostPress = (post: Post) => {
    router.push({
      pathname: '/entry/[date]' as any,
      params: { date: post.date, userId: post.user_id },
    });
  };

  const handleComment = async (postId: string, text: string, parentCommentId?: string) => {
    await addComment(postId, text, parentCommentId);
    setPosts(prev => prev.map(p =>
      p.id === postId ? { ...p, comments_count: (p.comments_count ?? 0) + 1 } : p
    ));
  };

  const handleLike = (post: Post) => {
    const liked = post.liked_by_me ?? false;
    setPosts(prev => prev.map(p =>
      p.id === post.id
        ? { ...p, liked_by_me: !liked, likes_count: Math.max((p.likes_count ?? 0) + (liked ? -1 : 1), 0) }
        : p
    ));
    (liked ? unlikePost(post.id) : likePost(post.id)).catch(() => {
      setPosts(prev => prev.map(p =>
        p.id === post.id
          ? { ...p, liked_by_me: liked, likes_count: post.likes_count }
          : p
      ));
    });
  };

  if (!community) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loading}>
          <ActivityIndicator color={Theme.colors.brandWarm} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backText}>‹ back</Text>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
          {community.created_by === session?.user.id && (
            <TouchableOpacity onPress={handleDelete} hitSlop={12}>
              <Text style={styles.deleteText}>delete</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={handleShare} hitSlop={12}>
            <Feather name="share" size={18} color={Theme.colors.secondary} />
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={posts}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <PostCard post={item} onPress={() => handlePostPress(item)} onLike={handleLike} onComment={handleComment} />
        )}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.communityHeader}>
            <View style={styles.communityIcon}>
              <Feather name="users" size={24} color={Theme.colors.accent} />
            </View>
            <Text style={styles.communityName}>{community.name}</Text>
            {community.description ? (
              <Text style={styles.communityDesc}>{community.description}</Text>
            ) : null}
            <Text style={styles.memberCount}>
              {community.member_count ?? 0} member{community.member_count !== 1 ? 's' : ''}
            </Text>

            {session && (
              <TouchableOpacity
                style={[
                  styles.joinBtn,
                  community.is_member && styles.joinBtnLeave,
                  joining && { opacity: 0.5 },
                ]}
                onPress={handleJoinLeave}
                disabled={joining}
                activeOpacity={0.8}
              >
                <Text style={[styles.joinBtnText, community.is_member && styles.joinBtnTextLeave]}>
                  {community.is_member ? 'leave community' : 'join community'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>no posts in this community yet.</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Theme.colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: { paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  backText: { fontSize: Theme.font.base, color: Theme.colors.primary, fontWeight: '600' },

  list: { paddingBottom: 40 },

  communityHeader: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
    gap: 8,
    marginBottom: 16,
  },
  communityIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: Theme.colors.surface,
    borderWidth: 1.5, borderColor: Theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  communityName: {
    fontSize: Theme.font.xl, fontWeight: '800',
    color: Theme.colors.primary, letterSpacing: -0.5, textAlign: 'center',
  },
  communityDesc: {
    fontSize: Theme.font.sm, color: Theme.colors.secondary, textAlign: 'center', lineHeight: 20,
  },
  memberCount: { fontSize: Theme.font.xs, color: Theme.colors.secondary, textTransform: 'uppercase', letterSpacing: 0.5 },

  joinBtn: {
    backgroundColor: Theme.colors.accent, borderRadius: Theme.radius.md,
    paddingHorizontal: 28, paddingVertical: 12, marginTop: 8,
  },
  joinBtnLeave: {
    backgroundColor: 'transparent',
    borderWidth: 1.5, borderColor: Theme.colors.border,
  },
  joinBtnText: { fontSize: Theme.font.base, fontWeight: '700', color: Theme.colors.background },
  joinBtnTextLeave: { color: Theme.colors.secondary },

  deleteText: { fontSize: Theme.font.sm, color: '#D9534F', fontWeight: '500' },

  empty: { alignItems: 'center', paddingTop: 40 },
  emptyText: { fontSize: Theme.font.sm, color: Theme.colors.secondary },
});
