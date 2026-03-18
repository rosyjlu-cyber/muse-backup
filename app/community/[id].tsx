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
  Image,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import * as Linking from 'expo-linking';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import { Theme } from '@/constants/Theme';
import {
  getCommunity,
  getCommunityPosts,
  joinCommunity,
  leaveCommunity,
  deleteCommunity,
  likePost,
  unlikePost,
  addComment,
  getCommunityJoinStatus,
  sendCommunityRequest,
  cancelCommunityRequest,
  getCommunityRequests,
  resolveCommunityRequest,
  savePost,
  unsavePost,
  Community,
  Post,
  CommunityRequest,
} from '@/utils/api';
import { useAuth } from '@/utils/auth';
import { PostCard } from '@/components/PostCard';

export default function CommunityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const [community, setCommunity] = useState<Community | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [joinStatus, setJoinStatus] = useState<'member' | 'pending' | 'none'>('none');
  const [joining, setJoining] = useState(false);

  // Admin panel
  const [pendingRequests, setPendingRequests] = useState<CommunityRequest[]>([]);
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());

  const isAdmin = !!session && community?.created_by === session.user.id;

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      Promise.all([getCommunity(id), getCommunityPosts(id)]).then(([c, ps]) => {
        setCommunity(c);
        setPosts(ps);
        if (session) {
          getCommunityJoinStatus(id).then(setJoinStatus);
          if (c && c.created_by === session.user.id) {
            getCommunityRequests(id).then(setPendingRequests);
          }
        }
      });
    }, [id, session?.user.id])
  );

  const handleJoinAction = async () => {
    if (!community || !session) return;
    setJoining(true);
    try {
      if (joinStatus === 'member') {
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
        setJoinStatus('none');
        setCommunity(c => c ? { ...c, is_member: false, member_count: (c.member_count ?? 1) - 1 } : c);
      } else if (joinStatus === 'pending') {
        await cancelCommunityRequest(community.id);
        setJoinStatus('none');
      } else if (community.is_private) {
        await sendCommunityRequest(community.id);
        setJoinStatus('pending');
      } else {
        await joinCommunity(community.id);
        setJoinStatus('member');
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
    Alert.alert(`delete "${community.name}"?`, "this removes the community and all its members. you can't undo this.", [
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

  const handleSave = (post: Post) => {
    const saved = post.saved_by_me ?? false;
    setPosts(prev => prev.map(p => p.id === post.id ? { ...p, saved_by_me: !saved } : p));
    (saved ? unsavePost(post.id) : savePost(post.id)).catch(() => {
      setPosts(prev => prev.map(p => p.id === post.id ? { ...p, saved_by_me: saved } : p));
    });
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

  const handleResolveRequest = async (req: CommunityRequest, accept: boolean) => {
    setResolvingIds(prev => new Set([...prev, req.user_id]));
    try {
      await resolveCommunityRequest(community!.id, req.user_id, accept);
      setPendingRequests(prev => prev.filter(r => r.user_id !== req.user_id));
      if (accept) {
        setCommunity(c => c ? { ...c, member_count: (c.member_count ?? 0) + 1 } : c);
      }
    } catch (e: any) {
      Alert.alert('error', e?.message ?? 'could not resolve request');
    } finally {
      setResolvingIds(prev => { const n = new Set(prev); n.delete(req.user_id); return n; });
    }
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

  const joinBtnLabel = joinStatus === 'member' ? 'leave community' : joinStatus === 'pending' ? 'requested' : 'join community';

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backText}>‹ back</Text>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
          {isAdmin && (
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
          <PostCard
            post={item}
            onPress={() => handlePostPress(item)}
            onLike={handleLike}
            onSave={handleSave}
            onComment={handleComment}
            onUserPress={(uid) => router.push({ pathname: '/profile/[userId]' as any, params: { userId: uid } })}
          />
        )}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            {/* Community info */}
            <View style={styles.communityHeader}>
              <View style={styles.communityIcon}>
                <Feather name="users" size={24} color={Theme.colors.accent} />
              </View>
              <View style={styles.communityNameRow}>
                <Text style={styles.communityName}>{community.name}</Text>
                {community.is_private && (
                  <Feather name="lock" size={14} color={Theme.colors.secondary} style={{ marginLeft: 6 }} />
                )}
              </View>
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
                    joinStatus === 'member' && styles.joinBtnLeave,
                    joinStatus === 'pending' && styles.joinBtnPending,
                    joining && { opacity: 0.5 },
                  ]}
                  onPress={handleJoinAction}
                  disabled={joining}
                  activeOpacity={0.8}
                >
                  {joining
                    ? <ActivityIndicator size="small" color={joinStatus === 'none' ? Theme.colors.background : Theme.colors.secondary} />
                    : <Text style={[
                        styles.joinBtnText,
                        (joinStatus === 'member' || joinStatus === 'pending') && styles.joinBtnTextMuted,
                      ]}>
                        {joinBtnLabel}
                      </Text>
                  }
                </TouchableOpacity>
              )}
            </View>

            {/* Admin: pending join requests */}
            {isAdmin && pendingRequests.length > 0 && (
              <View style={styles.requestsPanel}>
                <Text style={styles.requestsLabel}>join requests</Text>
                {pendingRequests.map(req => {
                  const p = req.profile;
                  const displayName = p?.display_name ?? p?.username ?? 'unknown';
                  const busy = resolvingIds.has(req.user_id);
                  return (
                    <View key={req.id} style={styles.requestRow}>
                      <TouchableOpacity
                        onPress={() => router.push({ pathname: '/profile/[userId]' as any, params: { userId: req.user_id } })}
                        activeOpacity={0.8}
                      >
                        {p?.avatar_url ? (
                          <Image source={{ uri: p.avatar_url }} style={styles.avatar} />
                        ) : (
                          <View style={styles.avatarPlaceholder}>
                            <Text style={styles.avatarInitial}>{displayName[0].toUpperCase()}</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={{ flex: 1 }}
                        onPress={() => router.push({ pathname: '/profile/[userId]' as any, params: { userId: req.user_id } })}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.requestName}>{displayName}</Text>
                        <Text style={styles.requestSub}>wants to join</Text>
                      </TouchableOpacity>
                      {busy ? (
                        <ActivityIndicator size="small" color={Theme.colors.accent} />
                      ) : (
                        <View style={styles.requestActions}>
                          <TouchableOpacity style={styles.acceptBtn} onPress={() => handleResolveRequest(req, true)} activeOpacity={0.8}>
                            <Text style={styles.acceptText}>accept</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.declineBtn} onPress={() => handleResolveRequest(req, false)} activeOpacity={0.8}>
                            <Text style={styles.declineText}>decline</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
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
    marginBottom: 8,
  },
  communityIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: Theme.colors.surface,
    borderWidth: 1.5, borderColor: Theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  communityNameRow: { flexDirection: 'row', alignItems: 'center' },
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
    paddingHorizontal: 28, paddingVertical: 12, marginTop: 8, minWidth: 160, alignItems: 'center',
  },
  joinBtnLeave: {
    backgroundColor: 'transparent',
    borderWidth: 1.5, borderColor: Theme.colors.border,
  },
  joinBtnPending: {
    backgroundColor: 'transparent',
    borderWidth: 1.5, borderColor: Theme.colors.secondary,
  },
  joinBtnText: { fontSize: Theme.font.base, fontWeight: '700', color: Theme.colors.background },
  joinBtnTextMuted: { color: Theme.colors.secondary },

  deleteText: { fontSize: Theme.font.sm, color: '#D9534F', fontWeight: '500' },

  // Admin requests panel
  requestsPanel: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.radius.md,
    borderWidth: 1.5,
    borderColor: Theme.colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  requestsLabel: {
    fontSize: Theme.font.xs, color: Theme.colors.secondary,
    textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: '700',
    marginBottom: 8,
  },
  requestRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.border,
  },
  avatar: { width: 38, height: 38, borderRadius: 19 },
  avatarPlaceholder: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: Theme.colors.background,
    borderWidth: 1, borderColor: Theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { fontSize: Theme.font.sm, fontWeight: '700', color: Theme.colors.primary },
  requestName: { fontSize: Theme.font.sm, fontWeight: '600', color: Theme.colors.primary },
  requestSub: { fontSize: Theme.font.xs, color: Theme.colors.secondary, marginTop: 1 },
  requestActions: { flexDirection: 'row', gap: 8 },
  acceptBtn: {
    backgroundColor: Theme.colors.accent, borderRadius: 100,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  acceptText: { fontSize: Theme.font.xs, fontWeight: '700', color: '#fff' },
  declineBtn: {
    borderRadius: 100, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1.5, borderColor: Theme.colors.border,
  },
  declineText: { fontSize: Theme.font.xs, fontWeight: '600', color: Theme.colors.secondary },

  empty: { alignItems: 'center', paddingTop: 40 },
  emptyText: { fontSize: Theme.font.sm, color: Theme.colors.secondary },
});
