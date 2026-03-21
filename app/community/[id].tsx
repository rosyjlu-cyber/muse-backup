import { useCallback, useRef, useState } from 'react';
import { Image } from 'expo-image';
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
  TextInput,
  Modal,
  ScrollView,
  Keyboard,
  Animated,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';

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
  getCommunityMembers,
  getMyRoleInCommunity,
  promoteToAdmin,
  demoteFromAdmin,
  removeMember,
  searchProfiles,
  inviteUserToCommunity,
  savePost,
  unsavePost,
  updateCommunity,
  uploadCommunityAvatar,
  Community,
  Post,
  CommunityRequest,
  CommunityMember,
  Profile,
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
  const [myRole, setMyRole] = useState<string | null>(null);

  // Admin panel
  const [pendingRequests, setPendingRequests] = useState<CommunityRequest[]>([]);
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());

  // Members
  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [showMembers, setShowMembers] = useState(false);

  // Invite modal
  const [showSettings, setShowSettings] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [invitingIds, setInvitingIds] = useState<Set<string>>(new Set());
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  const hasLoaded = useRef(false);
  const isAdmin = myRole === 'admin';

  // Scroll-collapse animation
  const scrollY = useRef(new Animated.Value(0)).current;
  const SCROLL_THRESHOLD = 60;
  const titleFontSize = scrollY.interpolate({
    inputRange: [0, SCROLL_THRESHOLD],
    outputRange: [22, 16],
    extrapolate: 'clamp',
  });
  const headerCenterMarginTop = scrollY.interpolate({
    inputRange: [0, SCROLL_THRESHOLD],
    outputRange: [24, 0],
    extrapolate: 'clamp',
  });
  const headerPaddingBottom = scrollY.interpolate({
    inputRange: [0, SCROLL_THRESHOLD],
    outputRange: [10, 4],
    extrapolate: 'clamp',
  });

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      if (hasLoaded.current) return;
      hasLoaded.current = true;
      Promise.all([getCommunity(id), getCommunityPosts(id)]).then(([c, ps]) => {
        setCommunity(c);
        setPosts(ps);
        if (session) {
          getCommunityJoinStatus(id).then(setJoinStatus);
          getMyRoleInCommunity(id).then(setMyRole);
          getCommunityMembers(id).then(setMembers);
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
        // Prevent last admin from leaving
        if (isAdmin) {
          const adminCount = members.filter(m => m.role === 'admin').length;
          if (adminCount <= 1) {
            Alert.alert(
              "you're the only admin",
              'promote someone else to admin before leaving, or delete the community.',
            );
            setJoining(false);
            return;
          }
        }
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
        setMyRole(null);
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
        setMyRole('member');
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

  const handleChangeAvatar = async () => {
    if (!community || !isAdmin) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled) return;
    try {
      const url = await uploadCommunityAvatar(community.id, result.assets[0].uri);
      await updateCommunity(community.id, { avatar_url: url });
      setCommunity(c => c ? { ...c, avatar_url: url } : c);
    } catch (e: any) {
      Alert.alert('error', e?.message ?? 'could not upload photo');
    }
  };

  const handleTogglePrivacy = async () => {
    if (!community) return;
    try {
      const updated = await updateCommunity(community.id, { is_private: !community.is_private });
      setCommunity(c => c ? { ...c, is_private: updated.is_private } : c);
    } catch (e: any) {
      Alert.alert('error', e?.message ?? 'could not update privacy');
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

  const handleSaveSettings = async () => {
    if (!community) { setShowSettings(false); return; }
    if (isAdmin && (editName.trim() !== community.name || editDescription.trim() !== (community.description ?? ''))) {
      setSavingSettings(true);
      try {
        const updated = await updateCommunity(community.id, {
          name: editName.trim(),
          description: editDescription.trim() || null,
        });
        setCommunity(c => c ? { ...c, name: updated.name, description: updated.description } : c);
      } catch (e) {
        console.error('Failed to update community:', e);
        Alert.alert('error', 'could not save changes. you may not have permission.');
      }
      setSavingSettings(false);
    }
    setShowSettings(false);
  };

  const handleShare = async () => {
    if (!community) return;
    const url = `https://bemymuse.app/c/${community.slug}`;
    try {
      await Share.share({ message: `join the ${community.name} community on muse — ${url}`, url });
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
        // Refresh members list
        getCommunityMembers(community!.id).then(setMembers);
      }
    } catch (e: any) {
      Alert.alert('error', e?.message ?? 'could not resolve request');
    } finally {
      setResolvingIds(prev => { const n = new Set(prev); n.delete(req.user_id); return n; });
    }
  };

  // Admin actions on members
  const handleMemberAction = (member: CommunityMember) => {
    if (!isAdmin || member.user_id === session?.user.id) return;
    const options: { text: string; onPress?: () => void; style?: 'destructive' | 'cancel' }[] = [];

    if (member.role === 'admin') {
      options.push({ text: 'remove admin', onPress: async () => {
        await demoteFromAdmin(community!.id, member.user_id);
        setMembers(prev => prev.map(m => m.user_id === member.user_id ? { ...m, role: 'member' } : m));
      }});
    } else {
      options.push({ text: 'make admin', onPress: async () => {
        await promoteToAdmin(community!.id, member.user_id);
        setMembers(prev => prev.map(m => m.user_id === member.user_id ? { ...m, role: 'admin' } : m));
      }});
    }

    options.push({ text: 'remove from community', style: 'destructive', onPress: async () => {
      await removeMember(community!.id, member.user_id);
      setMembers(prev => prev.filter(m => m.user_id !== member.user_id));
      setCommunity(c => c ? { ...c, member_count: Math.max((c.member_count ?? 1) - 1, 0) } : c);
    }});

    options.push({ text: 'cancel', style: 'cancel' });
    Alert.alert(member.profile.display_name ?? member.profile.username, undefined, options);
  };

  // Invite search
  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!text.trim()) { setSearchResults([]); return; }
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await searchProfiles(text.trim());
        // Filter out existing members
        const memberIds = new Set(members.map(m => m.user_id));
        setSearchResults(results.filter(r => !memberIds.has(r.id) && r.id !== session?.user.id));
      } catch {}
      finally { setSearching(false); }
    }, 300);
  };

  const handleInvite = async (userId: string) => {
    if (!community) return;
    setInvitingIds(prev => new Set([...prev, userId]));
    try {
      await inviteUserToCommunity(community.id, userId);
      setInvitedIds(prev => new Set([...prev, userId]));
      setCommunity(c => c ? { ...c, member_count: (c.member_count ?? 0) + 1 } : c);
      getCommunityMembers(community.id).then(setMembers);
    } catch (e: any) {
      Alert.alert('error', e?.message ?? 'could not invite user');
    } finally {
      setInvitingIds(prev => { const n = new Set(prev); n.delete(userId); return n; });
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
  const adminMembers = members.filter(m => m.role === 'admin');
  const regularMembers = members.filter(m => m.role !== 'admin');

  return (
    <SafeAreaView style={styles.safe}>
      <Animated.View style={[styles.header, { paddingBottom: headerPaddingBottom }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.headerLeft}>
          <Text style={styles.backText}>‹ back</Text>
        </TouchableOpacity>
        <Animated.View style={[styles.headerCenter, { marginTop: headerCenterMarginTop }]}>
          <Animated.Text style={[styles.headerName, { fontSize: titleFontSize }]} numberOfLines={1}>{community.name}</Animated.Text>
        </Animated.View>
        <View style={styles.headerRight}>
          <TouchableOpacity onPress={handleShare} hitSlop={12} activeOpacity={0.75}>
            <Feather name="send" size={18} color={Theme.colors.secondary} />
          </TouchableOpacity>
          {joinStatus === 'member' && (
            <TouchableOpacity onPress={() => { setEditName(community?.name ?? ''); setEditDescription(community?.description ?? ''); setShowSettings(true); }} hitSlop={12}>
              <Feather name="settings" size={18} color={Theme.colors.secondary} />
            </TouchableOpacity>
          )}
        </View>
      </Animated.View>

      <Animated.FlatList
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
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: false }
        )}
        scrollEventThrottle={16}
        ListHeaderComponent={
          <View>
            {/* Community info */}
            <View style={styles.communityHeader}>
              <TouchableOpacity
                style={styles.communityIconWrap}
                onPress={isAdmin ? handleChangeAvatar : undefined}
                activeOpacity={isAdmin ? 0.8 : 1}
                disabled={!isAdmin}
              >
                {community.avatar_url ? (
                  <Image source={{ uri: community.avatar_url }} style={styles.communityAvatar} contentFit="cover" cachePolicy="disk" />
                ) : (
                  <View style={styles.communityIcon}>
                    <Feather name="users" size={24} color={Theme.colors.accent} />
                  </View>
                )}
                {isAdmin && (
                  <View style={styles.communityAvatarBadge}>
                    <Feather name="camera" size={10} color={Theme.colors.background} />
                  </View>
                )}
              </TouchableOpacity>
              {community.description ? (
                <Text style={styles.communityDesc}>{community.description}</Text>
              ) : null}

              {/* Member count — tappable to show list */}
              <TouchableOpacity onPress={() => setShowMembers(true)} activeOpacity={0.7}>
                <Text style={styles.memberCount}>
                  {community.member_count ?? 0} member{community.member_count !== 1 ? 's' : ''} ›
                </Text>
              </TouchableOpacity>

              {session && joinStatus !== 'member' && (
                <TouchableOpacity
                  style={[
                    styles.joinBtn,
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
                        joinStatus === 'pending' && styles.joinBtnTextMuted,
                      ]}>
                        {joinStatus === 'pending' ? 'requested' : 'join community'}
                      </Text>
                  }
                </TouchableOpacity>
              )}

              {/* Invite friends button — for members */}
              {joinStatus === 'member' && (
                <TouchableOpacity onPress={() => { setShowInvite(true); setSearchQuery(''); setSearchResults([]); setInvitedIds(new Set()); }} activeOpacity={0.8}>
                  <LinearGradient
                    colors={['#F9C74F', '#F77FAD']}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={styles.inviteBtn}
                  >
                    <Feather name="user-plus" size={14} color={Theme.colors.primary} />
                    <Text style={styles.inviteBtnText}>invite friends</Text>
                  </LinearGradient>
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
                          <Image source={{ uri: p.avatar_url }} style={styles.avatar} cachePolicy="disk" />
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

      {/* Members Modal */}
      <Modal visible={showMembers} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.safe}>
          <View style={styles.modalHeader}>
            <View style={styles.modalSpacer} />
            <Text style={styles.modalTitle}>members</Text>
            <TouchableOpacity onPress={() => setShowMembers(false)} hitSlop={12}>
              <Text style={styles.modalClose}>done</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.membersList}>
            {adminMembers.length > 0 && (
              <>
                <Text style={styles.memberSectionLabel}>admins</Text>
                {adminMembers.map(m => (
                  <TouchableOpacity
                    key={m.user_id}
                    style={styles.memberRow}
                    onPress={() => { setShowMembers(false); router.push({ pathname: '/profile/[userId]' as any, params: { userId: m.user_id } }); }}
                    onLongPress={() => handleMemberAction(m)}
                    activeOpacity={0.7}
                  >
                    {m.profile.avatar_url ? (
                      <Image source={{ uri: m.profile.avatar_url }} style={styles.memberAvatar} cachePolicy="disk" />
                    ) : (
                      <View style={styles.memberAvatarPlaceholder}>
                        <Text style={styles.memberAvatarInitial}>
                          {(m.profile.display_name ?? m.profile.username ?? '?')[0].toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName}>{m.profile.display_name ?? m.profile.username}</Text>
                      <Text style={styles.memberUsername}>@{m.profile.username}</Text>
                    </View>
                    <View style={styles.adminBadge}>
                      <Text style={styles.adminBadgeText}>admin</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </>
            )}
            {regularMembers.length > 0 && (
              <>
                <Text style={styles.memberSectionLabel}>members</Text>
                {regularMembers.map(m => (
                  <TouchableOpacity
                    key={m.user_id}
                    style={styles.memberRow}
                    onPress={() => { setShowMembers(false); router.push({ pathname: '/profile/[userId]' as any, params: { userId: m.user_id } }); }}
                    onLongPress={() => handleMemberAction(m)}
                    activeOpacity={0.7}
                  >
                    {m.profile.avatar_url ? (
                      <Image source={{ uri: m.profile.avatar_url }} style={styles.memberAvatar} cachePolicy="disk" />
                    ) : (
                      <View style={styles.memberAvatarPlaceholder}>
                        <Text style={styles.memberAvatarInitial}>
                          {(m.profile.display_name ?? m.profile.username ?? '?')[0].toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName}>{m.profile.display_name ?? m.profile.username}</Text>
                      <Text style={styles.memberUsername}>@{m.profile.username}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </>
            )}
            {isAdmin && (
              <Text style={styles.memberHint}>long press a member to manage</Text>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Settings Modal */}
      <Modal visible={showSettings} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.safe}>
          <View style={styles.modalHeader}>
            <View style={styles.modalSpacer} />
            <Text style={styles.modalTitle}>settings</Text>
            <TouchableOpacity onPress={handleSaveSettings} hitSlop={12}>
              <Text style={styles.modalClose}>{savingSettings ? 'saving...' : 'done'}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.settingsContent}>
            {isAdmin ? (
              <>
                <Text style={styles.settingsInfoLabel}>name</Text>
                <TextInput
                  style={styles.settingsInput}
                  value={editName}
                  onChangeText={setEditName}
                  placeholder="community name"
                  placeholderTextColor={Theme.colors.disabled}
                />

                <View style={styles.settingsDivider} />

                <Text style={styles.settingsInfoLabel}>description</Text>
                <TextInput
                  style={[styles.settingsInput, { minHeight: 60 }]}
                  value={editDescription}
                  onChangeText={setEditDescription}
                  placeholder="what's this community about?"
                  placeholderTextColor={Theme.colors.disabled}
                  multiline
                />

                <View style={styles.settingsDivider} />
              </>
            ) : null}

            <View style={styles.settingsRow}>
              <Feather name={community.is_private ? 'lock' : 'globe'} size={15} color={Theme.colors.secondary} />
              <Text style={styles.settingsSub}>
                {community.is_private ? 'private — invite only' : 'public — anyone can join'}
              </Text>
            </View>

            <View style={styles.settingsDivider} />

            <Text style={styles.settingsInfoLabel}>created</Text>
            <Text style={styles.settingsInfoValue}>{new Date(community.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</Text>

            <View style={styles.settingsDivider} />

            <Text style={styles.settingsInfoLabel}>members</Text>
            <Text style={styles.settingsInfoValue}>{community.member_count ?? 0}</Text>

            <View style={{ marginTop: 32, alignItems: 'center', gap: 16 }}>
              <TouchableOpacity
                style={styles.settingsLeaveBtn}
                onPress={() => { setShowSettings(false); handleJoinAction(); }}
                activeOpacity={0.8}
              >
                <Text style={styles.settingsLeaveBtnText}>leave community</Text>
              </TouchableOpacity>

              {isAdmin && (
                <TouchableOpacity onPress={() => { setShowSettings(false); handleDelete(); }} hitSlop={8}>
                  <Text style={styles.settingsDeleteText}>delete community</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Invite Modal */}
      <Modal visible={showInvite} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.safe}>
          <View style={styles.modalHeader}>
            <View style={styles.modalSpacer} />
            <Text style={styles.modalTitle}>invite friends</Text>
            <TouchableOpacity onPress={() => setShowInvite(false)} hitSlop={12}>
              <Text style={styles.modalClose}>done</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.searchWrap}>
            <Feather name="search" size={16} color={Theme.colors.secondary} />
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={handleSearchChange}
              placeholder="search by username or name"
              placeholderTextColor={Theme.colors.disabled}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
          </View>

          {/* Share link option */}
          <TouchableOpacity style={styles.shareLinkRow} onPress={handleShare} activeOpacity={0.7}>
            <Feather name="link" size={16} color={Theme.colors.accent} />
            <Text style={styles.shareLinkText}>share invite link</Text>
          </TouchableOpacity>

          <ScrollView contentContainerStyle={styles.searchResults} keyboardShouldPersistTaps="handled">
            {searching && <ActivityIndicator color={Theme.colors.brandWarm} style={{ marginTop: 20 }} />}
            {!searching && searchQuery.trim() && searchResults.length === 0 && (
              <Text style={styles.noResults}>no users found</Text>
            )}
            {searchResults.map(user => {
              const invited = invitedIds.has(user.id);
              const inviting = invitingIds.has(user.id);
              return (
                <View key={user.id} style={styles.searchRow}>
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}
                    onPress={() => { setShowInvite(false); router.push({ pathname: '/profile/[userId]' as any, params: { userId: user.id } }); }}
                    activeOpacity={0.7}
                  >
                    {user.avatar_url ? (
                      <Image source={{ uri: user.avatar_url }} style={styles.memberAvatar} cachePolicy="disk" />
                    ) : (
                      <View style={styles.memberAvatarPlaceholder}>
                        <Text style={styles.memberAvatarInitial}>
                          {(user.display_name ?? user.username ?? '?')[0].toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName}>{user.display_name ?? user.username}</Text>
                      <Text style={styles.memberUsername}>@{user.username}</Text>
                    </View>
                  </TouchableOpacity>
                  {invited ? (
                    <Text style={styles.invitedText}>invited ✓</Text>
                  ) : inviting ? (
                    <ActivityIndicator size="small" color={Theme.colors.accent} />
                  ) : (
                    <TouchableOpacity style={styles.inviteSmallBtn} onPress={() => handleInvite(user.id)} activeOpacity={0.8}>
                      <Text style={styles.inviteSmallBtnText}>invite</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Theme.colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: { paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center' },
  backText: { fontSize: Theme.font.base, color: Theme.colors.primary, fontWeight: '600' },
  headerLeft: { position: 'absolute', left: 16, top: 12, zIndex: 1 },
  headerCenter: { alignItems: 'center' },
  headerRight: { position: 'absolute', right: 16, top: 12, zIndex: 1, flexDirection: 'row', gap: 10, alignItems: 'center' },
  headerName: { fontFamily: 'Caprasimo_400Regular', color: Theme.colors.primary, letterSpacing: -0.3 },

  list: { paddingBottom: 40 },

  communityHeader: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
    gap: 8,
    marginBottom: 8,
  },
  communityIconWrap: { marginBottom: 4, position: 'relative' },
  communityAvatar: { width: 64, height: 64, borderRadius: 32 },
  communityIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: Theme.colors.surface,
    borderWidth: 1.5, borderColor: Theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  communityAvatarBadge: {
    position: 'absolute', bottom: 0, right: -2,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: Theme.colors.accent,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Theme.colors.background,
  },
  communityNameRow: { flexDirection: 'row', alignItems: 'center' },
  communityName: {
    fontFamily: 'Caprasimo_400Regular',
    fontSize: Theme.font.xl, color: Theme.colors.primary, textAlign: 'center',
  },
  communityDesc: {
    fontSize: Theme.font.sm, color: Theme.colors.secondary, textAlign: 'center', lineHeight: 20,
  },
  memberCount: {
    fontSize: Theme.font.xs, color: Theme.colors.accent, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },

  joinBtn: {
    backgroundColor: Theme.colors.accent, borderRadius: 100,
    paddingHorizontal: 28, paddingVertical: 12, marginTop: 4, minWidth: 160, alignItems: 'center',
  },
  joinBtnPending: {
    backgroundColor: 'transparent',
    borderWidth: 1.5, borderColor: Theme.colors.secondary,
  },
  joinBtnText: { fontSize: Theme.font.sm, fontWeight: '700', color: Theme.colors.background },
  joinBtnTextMuted: { color: Theme.colors.secondary },

  inviteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 100, paddingHorizontal: 20, paddingVertical: 10, marginTop: 4,
  },
  inviteBtnText: { fontSize: Theme.font.sm, fontWeight: '700', color: Theme.colors.primary },

  // Settings modal
  settingsContent: { padding: 20 },
  settingsRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  settingsLabel: { fontSize: Theme.font.base, fontWeight: '600', color: Theme.colors.primary },
  settingsSub: { fontSize: Theme.font.xs, color: Theme.colors.secondary, marginTop: 2 },
  settingsToggle: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Theme.colors.surface, borderWidth: 1, borderColor: Theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  settingsToggleActive: {
    backgroundColor: Theme.colors.brandWarm, borderColor: Theme.colors.brandWarm,
  },
  settingsDivider: { height: 1, backgroundColor: Theme.colors.border, marginVertical: 20 },
  settingsInfoLabel: {
    fontSize: Theme.font.xs, fontWeight: '700', color: Theme.colors.secondary,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2,
  },
  settingsInfoValue: { fontSize: Theme.font.base, color: Theme.colors.primary },
  settingsInput: {
    fontSize: Theme.font.base, color: Theme.colors.primary,
    borderBottomWidth: 1, borderBottomColor: Theme.colors.border,
    paddingVertical: 8, paddingHorizontal: 0,
  },
  settingsLeaveBtn: {
    borderWidth: 1.5, borderColor: Theme.colors.border, borderRadius: 100,
    paddingHorizontal: 28, paddingVertical: 10,
  },
  settingsLeaveBtnText: { fontSize: Theme.font.sm, fontWeight: '600', color: Theme.colors.secondary },
  settingsDeleteText: { fontSize: Theme.font.sm, fontWeight: '500', color: '#D9534F' },

  // Admin requests panel
  requestsPanel: {
    marginHorizontal: 16, marginBottom: 16,
    backgroundColor: Theme.colors.surface, borderRadius: Theme.radius.md,
    borderWidth: 1.5, borderColor: Theme.colors.border,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  requestsLabel: {
    fontSize: Theme.font.xs, color: Theme.colors.secondary,
    textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: '700', marginBottom: 8,
  },
  requestRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Theme.colors.border,
  },
  avatar: { width: 38, height: 38, borderRadius: 19 },
  avatarPlaceholder: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: Theme.colors.background, borderWidth: 1, borderColor: Theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { fontSize: Theme.font.sm, fontWeight: '700', color: Theme.colors.primary },
  requestName: { fontSize: Theme.font.sm, fontWeight: '600', color: Theme.colors.primary },
  requestSub: { fontSize: Theme.font.xs, color: Theme.colors.secondary, marginTop: 1 },
  requestActions: { flexDirection: 'row', gap: 8 },
  acceptBtn: { backgroundColor: Theme.colors.accent, borderRadius: 100, paddingHorizontal: 12, paddingVertical: 6 },
  acceptText: { fontSize: Theme.font.xs, fontWeight: '700', color: '#fff' },
  declineBtn: { borderRadius: 100, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1.5, borderColor: Theme.colors.border },
  declineText: { fontSize: Theme.font.xs, fontWeight: '600', color: Theme.colors.secondary },

  empty: { alignItems: 'center', paddingTop: 40 },
  emptyText: { fontSize: Theme.font.sm, color: Theme.colors.secondary },

  // Modal shared
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Theme.colors.border,
  },
  modalSpacer: { width: 40 },
  modalTitle: { fontFamily: 'Caprasimo_400Regular', fontSize: 20, color: Theme.colors.primary, textAlign: 'center', flex: 1 },
  modalClose: { fontSize: Theme.font.sm, fontWeight: '600', color: Theme.colors.accent, width: 40, textAlign: 'right' },

  // Members modal
  membersList: { padding: 16 },
  memberSectionLabel: {
    fontSize: Theme.font.xs, fontWeight: '700', color: Theme.colors.secondary,
    textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 12, marginBottom: 8,
  },
  memberRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Theme.colors.border,
  },
  memberAvatar: { width: 40, height: 40, borderRadius: 20 },
  memberAvatarPlaceholder: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Theme.colors.surface, borderWidth: 1, borderColor: Theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  memberAvatarInitial: { fontSize: Theme.font.sm, fontWeight: '700', color: Theme.colors.primary },
  memberName: { fontSize: Theme.font.sm, fontWeight: '600', color: Theme.colors.primary },
  memberUsername: { fontSize: Theme.font.xs, color: Theme.colors.secondary, marginTop: 1 },
  adminBadge: {
    backgroundColor: '#F9C74F', borderRadius: 100, paddingHorizontal: 8, paddingVertical: 3,
  },
  adminBadgeText: { fontSize: 9, fontWeight: '800', color: Theme.colors.primary, textTransform: 'uppercase', letterSpacing: 0.5 },
  memberHint: { fontSize: Theme.font.xs, color: Theme.colors.disabled, textAlign: 'center', marginTop: 20 },

  // Invite modal
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 12, marginBottom: 4,
    backgroundColor: Theme.colors.surface, borderRadius: Theme.radius.md,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: Theme.font.sm, color: Theme.colors.primary, padding: 0 },
  shareLinkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Theme.colors.border,
  },
  shareLinkText: { fontSize: Theme.font.sm, fontWeight: '600', color: Theme.colors.accent },
  searchResults: { padding: 16 },
  noResults: { fontSize: Theme.font.sm, color: Theme.colors.secondary, textAlign: 'center', marginTop: 20 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Theme.colors.border,
  },
  inviteSmallBtn: {
    backgroundColor: Theme.colors.accent, borderRadius: 100, paddingHorizontal: 14, paddingVertical: 6,
  },
  inviteSmallBtnText: { fontSize: Theme.font.xs, fontWeight: '700', color: '#fff' },
  invitedText: { fontSize: Theme.font.xs, fontWeight: '600', color: Theme.colors.accent },
});
