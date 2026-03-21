import { useCallback, useRef, useState } from 'react';
import { Image } from 'expo-image';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { Theme } from '@/constants/Theme';
import {
  getPendingFollowRequests,
  resolveFollowRequest,
  getNotifications,
  markNotificationsRead,
  FollowRequest,
  AppNotification,
} from '@/utils/api';
import { formatShortDate } from '@/utils/dates';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return formatShortDate(iso.slice(0, 10));
}

export default function NotificationsScreen() {
  const router = useRouter();
  const [requests, setRequests] = useState<FollowRequest[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [resolving, setResolving] = useState<Set<string>>(new Set());
  const hasLoaded = useRef(false);
  const nextCursor = useRef<string | undefined>();

  useFocusEffect(
    useCallback(() => {
      if (hasLoaded.current) return;
      hasLoaded.current = true;
      Promise.all([getPendingFollowRequests(), getNotifications()])
        .then(([reqs, result]) => {
          setRequests(reqs);
          setNotifications(result.notifications);
          nextCursor.current = result.nextCursor;
          markNotificationsRead().catch(() => {});
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    }, [])
  );

  const loadMore = async () => {
    if (loadingMore || !nextCursor.current) return;
    setLoadingMore(true);
    try {
      const result = await getNotifications(nextCursor.current);
      setNotifications(prev => [...prev, ...result.notifications]);
      nextCursor.current = result.nextCursor;
    } catch {}
    finally { setLoadingMore(false); }
  };

  const handleResolve = async (req: FollowRequest, accept: boolean) => {
    setResolving(prev => new Set([...prev, req.requester_id]));
    try {
      await resolveFollowRequest(req.requester_id, accept);
      setRequests(prev => prev.filter(r => r.requester_id !== req.requester_id));
      if (accept) {
        setNotifications(prev => [{
          id: req.id,
          type: 'new_follower',
          actor_id: req.requester_id,
          post_id: null,
          data: {},
          is_read: true,
          created_at: new Date().toISOString(),
          actor: req.profile,
        }, ...prev]);
      }
    } catch { /* leave in list */ }
    finally {
      setResolving(prev => { const n = new Set(prev); n.delete(req.requester_id); return n; });
    }
  };

  const notifText = (n: AppNotification): string => {
    const name = n.actor ? `@${n.actor.username}` : 'someone';
    switch (n.type) {
      case 'like': return `${name} liked your post`;
      case 'comment': return n.data?.preview ? `${name} commented: "${n.data.preview}"` : `${name} commented on your post`;
      case 'new_follower': return `${name} started following you`;
      case 'follow_accepted': return `you're now following ${name}`;
      case 'streak': return `${n.data?.count}-day streak!`;
      case 'community_invite': return `${name} added you to a community`;
      case 'community_accepted': return `your request to join was accepted`;
    }
  };

  const handleNotifPress = (n: AppNotification) => {
    if (n.type === 'streak') return;
    if ((n.type === 'community_invite' || n.type === 'community_accepted') && n.data?.community_id) {
      router.push({ pathname: '/community/[id]' as any, params: { id: n.data.community_id } });
      return;
    }
    if ((n.type === 'like' || n.type === 'comment') && n.post_id) {
      // Navigate to entry — we need the date; it's on the post but we only have post_id.
      // For now navigate to the actor's profile as a fallback if no date
      if (n.actor?.id) router.push({ pathname: '/profile/[userId]' as any, params: { userId: n.actor.id } });
    } else if ((n.type === 'new_follower' || n.type === 'follow_accepted') && n.actor?.id) {
      router.push({ pathname: '/profile/[userId]' as any, params: { userId: n.actor.id } });
    }
  };

  const isEmpty = requests.length === 0 && notifications.length === 0;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={Theme.colors.background} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backText}>‹ back</Text>
        </TouchableOpacity>
        <View style={styles.headerSpacer} />
      </View>

      <Text style={styles.title}>notifications</Text>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Theme.colors.brandWarm} />
        </View>
      ) : isEmpty ? (
        <View style={styles.empty}>
          <Feather name="bell" size={36} color={Theme.colors.disabled} />
          <Text style={styles.emptyText}>nothing yet</Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={n => n.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          ListHeaderComponent={requests.length > 0 ? (
            <View>
              <Text style={styles.sectionLabel}>follow requests</Text>
              {requests.map(req => {
                const p = req.profile;
                const displayName = p.display_name ?? p.username;
                const busy = resolving.has(req.requester_id);
                return (
                  <View key={req.id} style={styles.row}>
                    <TouchableOpacity
                      onPress={() => router.push({ pathname: '/profile/[userId]' as any, params: { userId: p.id } })}
                      activeOpacity={0.8}
                    >
                      {p.avatar_url ? (
                        <Image source={{ uri: p.avatar_url }} style={styles.avatar} cachePolicy="disk" />
                      ) : (
                        <View style={styles.avatarPlaceholder}>
                          <Text style={styles.avatarInitial}>{(displayName)[0].toUpperCase()}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ flex: 1 }}
                      onPress={() => router.push({ pathname: '/profile/[userId]' as any, params: { userId: p.id } })}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.rowName}>{displayName}</Text>
                      <Text style={styles.rowSub}>wants to follow you</Text>
                    </TouchableOpacity>
                    {busy ? (
                      <ActivityIndicator size="small" color={Theme.colors.accent} />
                    ) : (
                      <View style={styles.actions}>
                        <TouchableOpacity onPress={() => handleResolve(req, true)} activeOpacity={0.8}>
                          <LinearGradient
                            colors={['#F9C74F', '#F77FAD']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 0 }}
                            style={styles.acceptBtn}
                          >
                            <Text style={styles.acceptText}>accept</Text>
                          </LinearGradient>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.declineBtn} onPress={() => handleResolve(req, false)} activeOpacity={0.8}>
                          <Text style={styles.declineText}>decline</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })}
              {notifications.length > 0 && <Text style={styles.sectionLabel}>activity</Text>}
            </View>
          ) : notifications.length > 0 ? (
            <Text style={styles.sectionLabel}>activity</Text>
          ) : null}
          renderItem={({ item: n }) => {
            const isStreak = n.type === 'streak';
            const actor = n.actor;
            return (
              <TouchableOpacity
                style={[styles.row, !n.is_read && styles.rowUnread]}
                onPress={() => handleNotifPress(n)}
                activeOpacity={0.8}
              >
                {isStreak ? (
                  <View style={styles.streakIcon}>
                    <Text style={styles.streakEmoji}>🔥</Text>
                  </View>
                ) : actor?.avatar_url ? (
                  <TouchableOpacity onPress={() => router.push({ pathname: '/profile/[userId]' as any, params: { userId: actor.id } })} activeOpacity={0.8}>
                    <Image source={{ uri: actor.avatar_url }} style={styles.avatar} cachePolicy="disk" />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity onPress={() => actor && router.push({ pathname: '/profile/[userId]' as any, params: { userId: actor.id } })} activeOpacity={0.8}>
                    <View style={styles.avatarPlaceholder}>
                      <Text style={styles.avatarInitial}>
                        {actor ? (actor.display_name ?? actor.username)[0].toUpperCase() : '?'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.notifText}>{notifText(n)}</Text>
                </View>
                <Text style={styles.timeText}>{timeAgo(n.created_at)}</Text>
              </TouchableOpacity>
            );
          }}
          ListFooterComponent={loadingMore ? (
            <View style={{ paddingVertical: 20 }}>
              <ActivityIndicator color={Theme.colors.brandWarm} />
            </View>
          ) : <View style={{ height: 32 }} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Theme.colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  backText: { fontSize: Theme.font.base, color: Theme.colors.primary, fontWeight: '600' },
  headerSpacer: { width: 60 },

  title: {
    fontFamily: 'Caprasimo_400Regular', fontSize: 26,
    color: Theme.colors.primary, paddingHorizontal: 20, marginBottom: 8,
  },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: Theme.font.sm, color: Theme.colors.secondary },

  list: { paddingHorizontal: 16 },

  sectionLabel: {
    fontSize: Theme.font.xs, color: Theme.colors.secondary,
    textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: '700',
    marginTop: 16, marginBottom: 6,
  },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.border,
  },
  rowUnread: {
    borderLeftWidth: 3, borderLeftColor: '#F77FAD', paddingLeft: 10,
  },

  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarPlaceholder: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Theme.colors.surface,
    borderWidth: 1, borderColor: Theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { fontSize: Theme.font.base, fontWeight: '700', color: Theme.colors.primary },

  streakIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,140,0,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  streakEmoji: { fontSize: 22 },

  rowName: { fontSize: Theme.font.base, fontWeight: '600', color: Theme.colors.primary },
  rowSub: { fontSize: Theme.font.sm, color: Theme.colors.secondary, marginTop: 1 },
  notifText: { fontSize: Theme.font.sm, color: Theme.colors.primary, lineHeight: 20 },
  timeText: { fontSize: Theme.font.xs, color: Theme.colors.secondary },

  actions: { flexDirection: 'row', gap: 8 },
  acceptBtn: {
    borderRadius: 100,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  acceptText: { fontSize: Theme.font.sm, fontWeight: '700', color: '#0B0B0B' },
  declineBtn: {
    borderRadius: 100, paddingHorizontal: 14, paddingVertical: 7,
    borderWidth: 1.5, borderColor: Theme.colors.border,
  },
  declineText: { fontSize: Theme.font.sm, fontWeight: '600', color: Theme.colors.secondary },
});
