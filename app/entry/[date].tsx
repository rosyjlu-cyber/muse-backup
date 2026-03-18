import { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Platform,
  Dimensions,
  StatusBar,
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Keyboard,
  FlatList,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, Feather } from '@expo/vector-icons';

import { Theme } from '@/constants/Theme';
import {
  getPost, deletePost, updatePostMeta,
  followUser, unfollowUser, isFollowing,
  likePost, unlikePost, getPostLikers,
  savePost, unsavePost,
  getComments, addComment, deleteComment, likeComment, unlikeComment,
  getPostWardrobeItems, getWardrobeItems,
  removePostWardrobeItem, addPostWardrobeItem, mergeWardrobeItems,
  Post, Comment, WardrobeItem, Profile,
} from '@/utils/api';
import { formatDate } from '@/utils/dates';
import { useAuth } from '@/utils/auth';

const SCREEN_WIDTH = Math.min(Dimensions.get('window').width, 390);
const MERGE_CELL = Math.floor((SCREEN_WIDTH - 32 - 16) / 3);
const COMPARE_IMG = Math.floor((SCREEN_WIDTH - 32 - 12) / 2) - 20;

export default function EntryScreen() {
  const { date, userId } = useLocalSearchParams<{ date: string; userId?: string }>();
  const router = useRouter();
  const { session, profile: authProfile } = useAuth();
  const [post, setPost] = useState<Post | null>(null);

  const [editing, setEditing] = useState(false);
  const [editCaption, setEditCaption] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const tagInputRef = useRef<TextInput>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [followingThem, setFollowingThem] = useState<boolean | null>(null);
  const [followLoading, setFollowLoading] = useState(false);

  const [likedByMe, setLikedByMe] = useState(false);
  const [likesCount, setLikesCount] = useState(0);
  const [savedByMe, setSavedByMe] = useState(false);

  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [showCommentsPanel, setShowCommentsPanel] = useState(false);
  const [replyingTo, setReplyingTo] = useState<{ commentId: string; username: string } | null>(null);
  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set());
  const inputRef = useRef<TextInput>(null);

  const [wardrobeItems, setWardrobeItems] = useState<WardrobeItem[]>([]);
  const [managingItems, setManagingItems] = useState(false);
  const [addItemModal, setAddItemModal] = useState(false);
  const [allWardrobeItems, setAllWardrobeItems] = useState<WardrobeItem[]>([]);

  // Merge state (long-press on wardrobe item)
  const [mergeSource, setMergeSource] = useState<WardrobeItem | null>(null);
  const [mergeTarget, setMergeTarget] = useState<WardrobeItem | null>(null);
  const [keepCurrentImage, setKeepCurrentImage] = useState(true);
  const [merging, setMerging] = useState(false);

  const [showLikesPanel, setShowLikesPanel] = useState(false);
  const [likers, setLikers] = useState<Profile[]>([]);
  const [loadingLikers, setLoadingLikers] = useState(false);

  const targetUserId = userId ?? session?.user.id ?? '';
  const isOwn = !userId || userId === session?.user.id;

  useFocusEffect(
    useCallback(() => {
      if (date && targetUserId) {
        getPost(targetUserId, date).then(p => {
          setPost(p);
          if (p) {
            setLikedByMe(p.liked_by_me ?? false);
            setLikesCount(p.likes_count ?? 0);
            setSavedByMe(p.saved_by_me ?? false);
            getComments(p.id).then(setComments);
            getPostWardrobeItems(p.id).then(setWardrobeItems).catch(() => {});
          }
        });
      }
      if (!isOwn && targetUserId) {
        isFollowing(targetUserId).then(setFollowingThem);
      }
    }, [date, targetUserId, isOwn])
  );

  const startEditing = () => {
    if (!post) return;
    setEditCaption(post.caption ?? '');
    setEditTags(post.tags);
    setEditing(true);
  };

  const cancelEdit = () => setEditing(false);

  const saveEdit = async () => {
    if (!post) return;
    setSaving(true);
    try {
      const updated = await updatePostMeta(post.id, {
        caption: editCaption.trim() || null,
        tags: editTags,
      });
      setPost(updated);
      setEditing(false);
    } catch (e: any) {
      Alert.alert('oops', e?.message ?? 'could not save changes');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (Platform.OS === 'web') {
      if (!window.confirm("delete this look? you can't undo this.")) return;
      if (!post) return;
      try { await deletePost(post.id); router.back(); }
      catch { window.alert('could not delete this look. try again?'); }
      return;
    }
    Alert.alert('delete this look?', "this fit disappears for good 🫣", [
      { text: 'keep it', style: 'cancel' },
      {
        text: 'delete', style: 'destructive',
        onPress: async () => {
          if (!post) return;
          setDeleting(true);
          try { await deletePost(post.id); router.back(); }
          catch {
            setDeleting(false);
            Alert.alert('oops', 'could not delete this look. try again?');
          }
        },
      },
    ]);
  };

  const handleFollowToggle = async () => {
    if (followLoading || followingThem === null) return;
    setFollowLoading(true);
    const prev = followingThem;
    setFollowingThem(!prev);
    try {
      if (prev) await unfollowUser(targetUserId);
      else await followUser(targetUserId);
    } catch { setFollowingThem(prev); }
    finally { setFollowLoading(false); }
  };

  const handleReplace = () => {
    if (date) router.push({ pathname: '/add' as any, params: { date } });
  };

  const openAddItemModal = async () => {
    if (!post) return;
    const all = await getWardrobeItems(session?.user.id ?? '');
    setAllWardrobeItems(all);
    setAddItemModal(true);
  };

  const handleLongPressItem = async (item: WardrobeItem) => {
    const all = allWardrobeItems.length > 0
      ? allWardrobeItems
      : await getWardrobeItems(session?.user.id ?? '');
    setAllWardrobeItems(all);
    setMergeSource(item);
    setMergeTarget(null);
    setKeepCurrentImage(true);
  };

  const handleMergeConfirm = async () => {
    if (!mergeSource || !mergeTarget || !post) return;
    setMerging(true);
    try {
      await mergeWardrobeItems(mergeSource.id, mergeTarget.id, !keepCurrentImage);
      const updated = await getPostWardrobeItems(post.id);
      setWardrobeItems(updated);
      setMergeSource(null);
      setMergeTarget(null);
    } catch (e: any) {
      Alert.alert('error', e?.message ?? 'could not merge items');
    } finally {
      setMerging(false);
    }
  };

  const openLikesPanel = async () => {
    if (!post || likesCount === 0) return;
    setShowLikesPanel(true);
    setLoadingLikers(true);
    try {
      const profiles = await getPostLikers(post.id);
      setLikers(profiles);
    } catch { /* silent */ }
    finally { setLoadingLikers(false); }
  };

  const handleLikeToggle = async () => {
    if (!post || !session) return;
    const prev = likedByMe;
    setLikedByMe(!prev);
    setLikesCount(c => Math.max(c + (prev ? -1 : 1), 0));
    try {
      if (prev) await unlikePost(post.id);
      else await likePost(post.id);
    } catch {
      setLikedByMe(prev);
      setLikesCount(c => c + (prev ? 1 : -1));
    }
  };

  const handleSaveToggle = () => {
    if (!post || !session) return;
    const prev = savedByMe;
    setSavedByMe(!prev);
    (prev ? unsavePost(post.id) : savePost(post.id)).catch(() => setSavedByMe(prev));
  };

  const handleAddComment = async (parentCommentId?: string) => {
    if (!post || !commentText.trim() || submittingComment) return;
    setSubmittingComment(true);
    const text = commentText.trim();
    setCommentText('');
    setReplyingTo(null);
    try {
      const newComment = await addComment(post.id, text, parentCommentId);
      setComments(prev => [...prev, {
        ...newComment,
        parent_comment_id: parentCommentId ?? null,
        profile: authProfile ? {
          username: authProfile.username,
          display_name: authProfile.display_name,
          avatar_url: authProfile.avatar_url,
        } : undefined,
      }]);
      setPost(p => p ? { ...p, comments_count: (p.comments_count ?? 0) + 1 } : p);
      if (parentCommentId) {
        setExpandedReplies(prev => new Set([...prev, parentCommentId]));
      }
    } catch { setCommentText(text); }
    finally { setSubmittingComment(false); }
  };

  const closeCommentsPanel = () => {
    Keyboard.dismiss();
    setShowCommentsPanel(false);
  };

  const handleDeleteCommentInPanel = (commentId: string) => {
    Alert.alert('delete comment?', undefined, [
      { text: 'cancel', style: 'cancel' },
      {
        text: 'delete', style: 'destructive',
        onPress: async () => {
          try {
            await deleteComment(commentId);
            setComments(prev => prev.filter(c => c.id !== commentId));
            setPost(p => p ? { ...p, comments_count: Math.max((p.comments_count ?? 1) - 1, 0) } : p);
          } catch { /* silent */ }
        },
      },
    ]);
  };

  const handleCommentLikeInPanel = (commentId: string) => {
    if (!session) return;
    const comment = comments.find(c => c.id === commentId);
    if (!comment) return;
    const wasLiked = comment.liked_by_me ?? false;
    setComments(prev => prev.map(c =>
      c.id !== commentId ? c : {
        ...c,
        liked_by_me: !wasLiked,
        likes_count: Math.max((c.likes_count ?? 0) + (wasLiked ? -1 : 1), 0),
      }
    ));
    (wasLiked ? unlikeComment(commentId) : likeComment(commentId)).catch(() => {
      setComments(prev => prev.map(c =>
        c.id !== commentId ? c : { ...c, liked_by_me: wasLiked, likes_count: comment.likes_count }
      ));
    });
  };

  const handleReplyInPanel = (topLevelId: string, replyUsername: string) => {
    setReplyingTo({ commentId: topLevelId, username: replyUsername });
    setCommentText(`@${replyUsername} `);
    setExpandedReplies(prev => new Set([...prev, topLevelId]));
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const toggleReplies = (commentId: string) => {
    setExpandedReplies(prev => {
      const next = new Set(prev);
      if (next.has(commentId)) next.delete(commentId);
      else next.add(commentId);
      return next;
    });
  };

  // Group comments for panel and card preview
  const topLevelComments = comments.filter(c => !c.parent_comment_id);
  const repliesByParentId: Record<string, Comment[]> = {};
  comments.forEach(c => {
    if (c.parent_comment_id) {
      (repliesByParentId[c.parent_comment_id] ??= []).push(c);
    }
  });

  if (!post) return null;

  const photoWidth = SCREEN_WIDTH - 32;
  const photoHeight = Math.round(photoWidth * (4 / 3));

  const renderPanelCommentItem = (c: Comment, isReply: boolean, topLevelId: string, topLevelUsername: string) => (
    <View style={isReply ? styles.cPanelReplyRow : styles.cPanelCommentRow}>
      {c.profile?.avatar_url ? (
        <Image source={{ uri: c.profile.avatar_url }} style={isReply ? styles.cPanelReplyAvatar : styles.cPanelCommentAvatar} />
      ) : (
        <View style={isReply ? styles.cPanelReplyAvatarPlaceholder : styles.cPanelCommentAvatarPlaceholder}>
          <Text style={styles.cPanelAvatarInitial}>
            {(c.profile?.display_name ?? c.profile?.username ?? '?')[0].toUpperCase()}
          </Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.cPanelCommentAuthor}>@{c.profile?.username ?? 'unknown'}</Text>
        <Text style={styles.cPanelCommentText}>{c.content}</Text>
        <View style={styles.cPanelCommentActions}>
          {session && (
            <TouchableOpacity onPress={() => handleReplyInPanel(topLevelId, topLevelUsername)} hitSlop={8}>
              <Text style={styles.cPanelCommentAction}>reply</Text>
            </TouchableOpacity>
          )}
          {c.user_id === session?.user.id && (
            <TouchableOpacity onPress={() => handleDeleteCommentInPanel(c.id)} hitSlop={8}>
              <Text style={styles.cPanelCommentAction}>delete</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      <TouchableOpacity
        style={styles.cPanelLikeBtn}
        onPress={() => handleCommentLikeInPanel(c.id)}
        hitSlop={8}
        disabled={!session}
      >
        <Ionicons
          name={c.liked_by_me ? 'heart' : 'heart-outline'}
          size={13}
          color={c.liked_by_me ? Theme.colors.brandWarm : 'rgba(0,0,0,0.30)'}
        />
        {(c.likes_count ?? 0) > 0 && (
          <Text style={styles.cPanelLikeCount}>{c.likes_count}</Text>
        )}
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={['#F9C74F', '#F77FAD']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#F9C74F" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={editing ? cancelEdit : () => router.back()} hitSlop={12}>
          <Text style={styles.backText}>{editing ? 'cancel' : '‹ back'}</Text>
        </TouchableOpacity>

        {!editing && !isOwn && followingThem !== null ? (
          <TouchableOpacity
            style={[styles.followBtn, followingThem && styles.followBtnActive]}
            onPress={handleFollowToggle}
            disabled={followLoading}
            hitSlop={8}
          >
            <Text style={[styles.followBtnText, followingThem && styles.followBtnTextActive]}>
              {followingThem ? 'following' : 'follow'}
            </Text>
          </TouchableOpacity>
        ) : null}
        {isOwn && post.is_private && !editing && (
          <Text style={styles.hiddenBadgeText}>hidden from feed</Text>
        )}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* Author (others' posts) */}
          {!isOwn && post.profile && (
            <TouchableOpacity
              onPress={() => router.push({ pathname: '/profile/[userId]' as any, params: { userId: post.user_id } })}
              hitSlop={8}
              activeOpacity={0.7}
              style={styles.authorPill}
            >
              <Text style={styles.authorText}>@{post.profile.username}</Text>
            </TouchableOpacity>
          )}

          {/* Photo */}
          <View style={styles.photoContainer}>
            <Image
              source={{ uri: post.photo_url }}
              style={[styles.photo, { width: photoWidth, height: photoHeight }]}
              resizeMode="cover"
            />
          </View>

          <View style={styles.contentCard}>
          {/* Date row */}
          <View style={styles.dateRow}>
            <Text style={styles.dateText}>{formatDate(post.date)}</Text>
            {!isOwn && session && (
              <TouchableOpacity onPress={handleSaveToggle} hitSlop={10} activeOpacity={0.7}>
                <Ionicons
                  name={savedByMe ? 'bookmark' : 'bookmark-outline'}
                  size={22}
                  color={savedByMe ? Theme.colors.brandWarm : 'rgba(0,0,0,0.3)'}
                />
              </TouchableOpacity>
            )}
          </View>

          {/* Caption + Tags + edit */}
          <View style={styles.metaRow}>
            <View style={{ flex: 1 }}>
              {editing ? (
                <>
                  <Text style={styles.editFieldLabel}>caption</Text>
                  <View style={styles.inputCard}>
                    <TextInput
                      style={styles.captionInput}
                      value={editCaption}
                      onChangeText={setEditCaption}
                      placeholder="what's the vibe today?"
                      placeholderTextColor={Theme.colors.disabled}
                      multiline
                      scrollEnabled={false}
                      returnKeyType="done"
                      submitBehavior="blurAndSubmit"
                      maxLength={280}
                      autoFocus
                    />
                  </View>
                </>
              ) : post.caption ? (
                <Text style={styles.captionText}>{post.caption}</Text>
              ) : isOwn ? (
                <TouchableOpacity onPress={startEditing} activeOpacity={0.7}>
                  <Text style={styles.addHint}>+ add a caption</Text>
                </TouchableOpacity>
              ) : null}

              {editing ? (
                <>
                  <Text style={styles.editFieldLabel}>tags</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.tagScroll}
                    contentContainerStyle={styles.tagScrollContent}
                    keyboardShouldPersistTaps="handled"
                  >
                    <View style={styles.tagAddPill}>
                      <TextInput
                        ref={tagInputRef}
                        style={styles.tagAddInput}
                        value={tagInput}
                        placeholder="+ add"
                        placeholderTextColor={Theme.colors.accent}
                        onChangeText={text => {
                          if (text.endsWith(',') || text.endsWith(' ')) {
                            const t = text.slice(0, -1).trim().toLowerCase();
                            if (t && !editTags.includes(t)) setEditTags([...editTags, t]);
                            setTagInput('');
                          } else { setTagInput(text); }
                        }}
                        onSubmitEditing={() => {
                          const t = tagInput.trim().toLowerCase();
                          if (t && !editTags.includes(t)) setEditTags([...editTags, t]);
                          setTagInput('');
                        }}
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="done"
                        submitBehavior="blurAndSubmit"
                      />
                    </View>
                    {editTags.map(tag => (
                      <TouchableOpacity key={tag} style={styles.tagChipSelected} onPress={() => setEditTags(editTags.filter(t => t !== tag))} activeOpacity={0.7}>
                        <Text style={styles.tagChipSelectedText}>{tag} ×</Text>
                      </TouchableOpacity>
                    ))}
                    {(authProfile?.style_tags ?? []).filter(t => !editTags.includes(t.toLowerCase())).map(tag => (
                      <TouchableOpacity key={tag} style={styles.tagChipSuggestion} onPress={() => { const t = tag.toLowerCase(); if (!editTags.includes(t)) setEditTags([...editTags, t]); }} activeOpacity={0.7}>
                        <Text style={styles.tagChipSuggestionText}>{tag}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </>
              ) : post.tags.length > 0 ? (
                <View style={styles.tagsRow}>
                  {post.tags.map(t => (
                    <View key={t} style={styles.tagPill}>
                      <Text style={styles.tagPillText}>{t}</Text>
                    </View>
                  ))}
                </View>
              ) : isOwn && !editing ? (
                <TouchableOpacity onPress={startEditing} activeOpacity={0.7}>
                  <Text style={styles.addHint}>+ add tags</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Edit / save */}
            <View style={styles.metaRight}>
              {isOwn && (editing || post.caption || post.tags.length > 0) && (
                <TouchableOpacity
                  onPress={editing ? saveEdit : startEditing}
                  hitSlop={8}
                  disabled={saving}
                >
                  {saving
                    ? <ActivityIndicator size="small" color={Theme.colors.brandWarm} />
                    : <Text style={[styles.editText, editing && { color: Theme.colors.accent, fontWeight: '700' }]}>
                        {editing ? 'save' : 'edit'}
                      </Text>
                  }
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Wardrobe items */}
          {!editing && (wardrobeItems.length > 0 || isOwn) && (
            <View style={styles.itemsSection}>
              <View style={styles.itemsHeader}>
                <Text style={styles.itemsTitle}>items in this look</Text>
                {isOwn && (
                  <TouchableOpacity onPress={() => setManagingItems(m => !m)} hitSlop={8}>
                    <Text style={styles.itemsManageText}>
                      {managingItems ? 'done' : 'edit'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              {wardrobeItems.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.itemsScroll}
                  contentContainerStyle={styles.itemsContent}
                >
                  {wardrobeItems.map(item => (
                    <TouchableOpacity
                      key={item.id}
                      style={styles.itemCell}
                      onPress={() => {
                        if (managingItems) return;
                        router.push({ pathname: '/wardrobe/[id]' as any, params: { id: item.id } });
                      }}
                      onLongPress={() => { if (!managingItems) handleLongPressItem(item); }}
                      activeOpacity={0.8}
                    >
                      {item.generated_image_url ? (
                        <Image source={{ uri: item.generated_image_url }} style={styles.itemImage} resizeMode="cover" />
                      ) : (
                        <View style={[styles.itemImage, styles.itemPlaceholder]}>
                          <Text style={styles.itemEmoji}>🏷️</Text>
                        </View>
                      )}
                      {managingItems && (
                        <TouchableOpacity
                          style={styles.itemRemoveBadge}
                          onPress={async () => {
                            if (!post) return;
                            await removePostWardrobeItem(post.id, item.id);
                            setWardrobeItems(prev => prev.filter(i => i.id !== item.id));
                          }}
                          hitSlop={4}
                        >
                          <Feather name="x" size={10} color="#fff" />
                        </TouchableOpacity>
                      )}
                      <Text style={styles.itemLabel} numberOfLines={1}>{item.label}</Text>
                    </TouchableOpacity>
                  ))}
                  {managingItems && (
                    <TouchableOpacity style={styles.itemAddCell} activeOpacity={0.75} onPress={openAddItemModal}>
                      <Feather name="plus" size={22} color={Theme.colors.accent} />
                    </TouchableOpacity>
                  )}
                </ScrollView>
              ) : (
                <View style={styles.itemsEmptyRow}>
                  {managingItems ? (
                    <TouchableOpacity style={styles.itemAddCell} activeOpacity={0.75} onPress={openAddItemModal}>
                      <Feather name="plus" size={22} color={Theme.colors.accent} />
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.itemsEmpty}>tap "edit" to add an item</Text>
                  )}
                </View>
              )}
            </View>
          )}


          </View>{/* end contentCard */}

          {/* Engagement card: likes + comments */}
          {!editing && (
            <View style={styles.engagementCard}>
              {/* Like row */}
              <View style={styles.engageLikeRow}>
                <TouchableOpacity
                  onPress={handleLikeToggle}
                  hitSlop={8}
                  activeOpacity={0.75}
                  disabled={!session}
                >
                  <Ionicons
                    name={likedByMe ? 'heart' : 'heart-outline'}
                    size={17}
                    color={likedByMe ? Theme.colors.brandWarm : 'rgba(0,0,0,0.32)'}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                  onPress={isOwn && likesCount > 0 ? openLikesPanel : (!isOwn ? handleLikeToggle : undefined)}
                  hitSlop={8}
                  activeOpacity={0.75}
                  disabled={isOwn && likesCount === 0}
                >
                  <Text style={[styles.engageLikeText, likedByMe && styles.engageLikeTextActive]} numberOfLines={1}>
                    {isOwn
                      ? (likesCount === 0 ? 'no likes yet' : 'your look got some love')
                      : (likedByMe ? 'you liked this' : 'like this look')}
                  </Text>
                  {isOwn && likesCount > 0 && (
                    <Ionicons name="chevron-forward" size={13} color="rgba(0,0,0,0.22)" />
                  )}
                </TouchableOpacity>
              </View>

              {/* Comments preview */}
              {comments.length > 0 && (
                <>
                  <View style={styles.engageDivider} />
                  <View style={styles.engageComments}>
                    {topLevelComments.slice(0, 2).map(comment => (
                      <View key={comment.id} style={styles.commentRow}>
                        {comment.profile?.avatar_url ? (
                          <Image source={{ uri: comment.profile.avatar_url }} style={styles.commentAvatarImg} />
                        ) : (
                          <View style={styles.commentAvatarPlaceholder}>
                            <Text style={styles.commentAvatarInitial}>
                              {(comment.profile?.display_name ?? comment.profile?.username ?? '?')[0].toUpperCase()}
                            </Text>
                          </View>
                        )}
                        <View style={styles.commentContent}>
                          <Text style={styles.commentUsername}>@{comment.profile?.username ?? 'unknown'}</Text>
                          <Text style={styles.commentText} numberOfLines={2}>{comment.content}</Text>
                        </View>
                      </View>
                    ))}
                    <TouchableOpacity onPress={() => setShowCommentsPanel(true)} hitSlop={8} style={styles.viewAllBtn}>
                      <Text style={styles.viewAllText}>
                        view all {comments.length} {comments.length === 1 ? 'comment' : 'comments'}
                      </Text>
                      <Ionicons name="chevron-forward" size={12} color="rgba(0,0,0,0.35)" />
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {/* No comments yet — prompt for non-own */}
              {comments.length === 0 && session && (
                <>
                  <View style={styles.engageDivider} />
                  <TouchableOpacity
                    style={styles.addCommentPrompt}
                    onPress={() => setShowCommentsPanel(true)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.addCommentPromptText}>add a comment...</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          {/* Replace + delete row */}
          {isOwn && !editing && (
            <View style={styles.replaceBtnRow}>
              <TouchableOpacity style={styles.replaceBtn} onPress={handleReplace} activeOpacity={0.8}>
                <Text style={styles.replaceBtnText}>replace this look</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleDelete} hitSlop={12} style={styles.deleteIconBtn} disabled={deleting}>
                {deleting
                  ? <ActivityIndicator size="small" color={Theme.colors.accent} />
                  : <Feather name="trash-2" size={20} color={Theme.colors.accent} />}
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>

      </KeyboardAvoidingView>
    </SafeAreaView>

    {/* Likes panel */}
    <Modal
      visible={showLikesPanel}
      transparent
      animationType="slide"
      onRequestClose={() => setShowLikesPanel(false)}
    >
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowLikesPanel(false)} />
        <View style={styles.likesPanel}>
        <View style={styles.likesPanelHandle} />
        <Text style={styles.likesPanelTitle}>liked by</Text>
        {loadingLikers ? (
          <ActivityIndicator color={Theme.colors.brandWarm} style={{ marginTop: 24 }} />
        ) : likers.length === 0 ? (
          <Text style={styles.likersEmpty}>no likes yet</Text>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false}>
            {likers.map(p => (
              <TouchableOpacity
                key={p.id}
                style={styles.likerRow}
                onPress={() => { setShowLikesPanel(false); router.push({ pathname: '/entry/[date]' as any, params: { date, userId: p.id } }); }}
                activeOpacity={0.7}
              >
                {p.avatar_url ? (
                  <Image source={{ uri: p.avatar_url }} style={styles.likerAvatar} />
                ) : (
                  <View style={styles.likerAvatarPlaceholder}>
                    <Text style={styles.likerAvatarInitial}>{(p.display_name ?? p.username)[0].toUpperCase()}</Text>
                  </View>
                )}
                <View>
                  <Text style={styles.likerName}>{p.display_name ?? p.username}</Text>
                  <Text style={styles.likerUsername}>@{p.username}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
        </View>
      </View>
    </Modal>

    {/* Comments panel */}
    <Modal
      visible={showCommentsPanel}
      transparent
      animationType="slide"
      onRequestClose={closeCommentsPanel}
    >
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: 'flex-end' }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={closeCommentsPanel} />
        <View style={styles.commentsPanel}>
          <View style={styles.cPanelHandle} />
          <Text style={styles.cPanelTitle}>comments</Text>

          <ScrollView
            style={styles.cPanelList}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {topLevelComments.length === 0 ? (
              <Text style={styles.cPanelEmpty}>no comments yet — be the first!</Text>
            ) : (
              topLevelComments.map(c => {
                const replies = repliesByParentId[c.id] ?? [];
                const repliesExpanded = expandedReplies.has(c.id);
                const cUsername = c.profile?.username ?? 'unknown';
                return (
                  <View key={c.id}>
                    {renderPanelCommentItem(c, false, c.id, cUsername)}

                    {replies.length > 0 && (
                      <TouchableOpacity
                        style={styles.cPanelViewRepliesBtn}
                        onPress={() => toggleReplies(c.id)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.cPanelReplyLine} />
                        <Text style={styles.cPanelViewRepliesText}>
                          {repliesExpanded
                            ? 'hide replies'
                            : `view ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
                        </Text>
                      </TouchableOpacity>
                    )}

                    {repliesExpanded && replies.map(r => (
                      <View key={r.id}>
                        {renderPanelCommentItem(r, true, c.id, cUsername)}
                      </View>
                    ))}
                  </View>
                );
              })
            )}
          </ScrollView>

          {session && (
            <>
              {replyingTo && (
                <View style={styles.cPanelReplyingToRow}>
                  <Text style={styles.cPanelReplyingToText}>replying to @{replyingTo.username}</Text>
                  <TouchableOpacity onPress={() => { setReplyingTo(null); setCommentText(''); }} hitSlop={8}>
                    <Ionicons name="close" size={14} color={Theme.colors.secondary} />
                  </TouchableOpacity>
                </View>
              )}
              <View style={[styles.cPanelInputRow, !!replyingTo && styles.cPanelInputRowNoTopBorder]}>
                <TextInput
                  ref={inputRef}
                  style={styles.cPanelInput}
                  placeholder="add a comment..."
                  placeholderTextColor="rgba(0,0,0,0.30)"
                  value={commentText}
                  onChangeText={setCommentText}
                  returnKeyType="send"
                  onSubmitEditing={() => handleAddComment(replyingTo?.commentId)}
                  editable={!submittingComment}
                />
                {submittingComment ? (
                  <ActivityIndicator size="small" color={Theme.colors.brandWarm} />
                ) : (
                  <TouchableOpacity
                    onPress={() => handleAddComment(replyingTo?.commentId)}
                    hitSlop={8}
                    disabled={!commentText.trim()}
                    style={{ justifyContent: 'center' }}
                  >
                    <Ionicons
                      name="arrow-up-circle"
                      size={26}
                      color={commentText.trim() ? Theme.colors.brandWarm : Theme.colors.disabled}
                    />
                  </TouchableOpacity>
                )}
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>

    {/* Add to this look modal */}
    <Modal
      visible={addItemModal}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setAddItemModal(false)}
    >
      <SafeAreaView style={styles.sheetSafe}>
        <View style={styles.sheetHeader}>
          <TouchableOpacity onPress={() => setAddItemModal(false)} hitSlop={12}>
            <Feather name="x" size={20} color={Theme.colors.primary} />
          </TouchableOpacity>
          <Text style={styles.sheetTitle}>add to this look</Text>
          <View style={{ width: 20 }} />
        </View>
        {(() => {
          const available = allWardrobeItems.filter(i =>
            !wardrobeItems.some(w => w.id === i.id) &&
            (i.generated_image_url || i.photos?.[0]?.photo_url)
          );
          if (available.length === 0) {
            return (
              <View style={styles.sheetEmpty}>
                <Text style={styles.sheetEmptyText}>all your wardrobe items are already in this look</Text>
              </View>
            );
          }
          return (
            <FlatList
              data={available}
              keyExtractor={i => i.id}
              numColumns={3}
              contentContainerStyle={styles.sheetGrid}
              columnWrapperStyle={styles.sheetGridRow}
              renderItem={({ item }) => {
                const imgUrl = item.generated_image_url ?? item.photos?.[0]?.photo_url;
                return (
                  <TouchableOpacity
                    style={styles.sheetCell}
                    activeOpacity={0.8}
                    onPress={async () => {
                      if (!post) return;
                      await addPostWardrobeItem(post.id, item.id);
                      setWardrobeItems(prev => [...prev, item]);
                      setAddItemModal(false);
                    }}
                  >
                    {imgUrl ? (
                      <Image source={{ uri: imgUrl }} style={styles.sheetCellImage} resizeMode="contain" />
                    ) : (
                      <View style={[styles.sheetCellImage, styles.sheetCellPlaceholder]}>
                        <Text style={{ fontSize: 28 }}>🏷️</Text>
                      </View>
                    )}
                    <Text style={styles.sheetCellLabel} numberOfLines={2}>{item.label}</Text>
                  </TouchableOpacity>
                );
              }}
            />
          );
        })()}
      </SafeAreaView>
    </Modal>

    {/* Merge modal (long-press on wardrobe item) */}
    <Modal
      visible={mergeSource !== null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => { if (mergeTarget) setMergeTarget(null); else setMergeSource(null); }}
    >
      <SafeAreaView style={styles.sheetSafe}>
        <View style={styles.sheetHeader}>
          <TouchableOpacity
            onPress={() => { if (mergeTarget) setMergeTarget(null); else setMergeSource(null); }}
            hitSlop={12}
          >
            <Feather name={mergeTarget ? 'arrow-left' : 'x'} size={20} color={Theme.colors.primary} />
          </TouchableOpacity>
          <Text style={styles.sheetTitle}>
            {mergeTarget ? 'pick your fave photo' : 'merge with...'}
          </Text>
          <View style={{ width: 20 }} />
        </View>

        {!mergeTarget ? (
          <FlatList
            data={allWardrobeItems.filter(i =>
              i.id !== mergeSource?.id && (i.generated_image_url || i.photos?.[0]?.photo_url)
            ).sort((a, b) => {
              if (!mergeSource) return 0;
              const sourceWords = new Set(mergeSource.label.toLowerCase().split(/\s+/).filter(Boolean));
              const score = (mi: WardrobeItem) => {
                let s = 0;
                if (mi.label.toLowerCase().split(/\s+/).some(w => sourceWords.has(w))) s += 2;
                if (mi.category && mergeSource.category && mi.category === mergeSource.category) s += 1;
                return s;
              };
              const diff = score(b) - score(a);
              return diff !== 0 ? diff : new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
            })}
            keyExtractor={i => i.id}
            numColumns={3}
            contentContainerStyle={styles.sheetGrid}
            columnWrapperStyle={styles.sheetGridRow}
            renderItem={({ item: mi }) => {
              const imgUrl = mi.generated_image_url ?? mi.photos?.[0]?.photo_url;
              return (
                <TouchableOpacity
                  style={styles.sheetCell}
                  onPress={() => { setMergeTarget(mi); setKeepCurrentImage(true); }}
                  activeOpacity={0.8}
                >
                  {imgUrl ? (
                    <Image source={{ uri: imgUrl }} style={styles.sheetCellImage} resizeMode="contain" />
                  ) : (
                    <View style={[styles.sheetCellImage, styles.sheetCellPlaceholder]}>
                      <Text style={{ fontSize: 28 }}>🏷️</Text>
                    </View>
                  )}
                  <Text style={styles.sheetCellLabel} numberOfLines={2}>{mi.label}</Text>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <View style={styles.sheetEmpty}>
                <Text style={styles.sheetEmptyText}>no other items to merge with</Text>
              </View>
            }
          />
        ) : (
          <ScrollView contentContainerStyle={styles.mergeConfirmContent}>
            <Text style={styles.mergeHint}>
              these two are the same thing — pick the photo you love most and we'll combine all your outfits ✨
            </Text>
            <View style={styles.mergeCompare}>
              {([
                { wi: mergeSource!, isCurrent: true },
                { wi: mergeTarget, isCurrent: false },
              ] as const).map(({ wi, isCurrent }) => {
                const imgUrl = wi.generated_image_url ?? wi.photos?.[0]?.photo_url;
                const selected = isCurrent ? keepCurrentImage : !keepCurrentImage;
                return (
                  <TouchableOpacity
                    key={wi.id}
                    style={[styles.mergeCompareCol, selected && styles.mergeCompareColActive]}
                    onPress={() => setKeepCurrentImage(isCurrent)}
                    activeOpacity={0.85}
                  >
                    {imgUrl ? (
                      <Image source={{ uri: imgUrl }} style={styles.mergeCompareImg} resizeMode="contain" />
                    ) : (
                      <View style={[styles.mergeCompareImg, styles.sheetCellPlaceholder]}>
                        <Text style={{ fontSize: 36 }}>🏷️</Text>
                      </View>
                    )}
                    <Text style={styles.mergeCompareLabel} numberOfLines={2}>{wi.label}</Text>
                    {selected && (
                      <View style={styles.mergeCheck}>
                        <Feather name="check" size={12} color="#fff" />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.mergeWarning}>the other item quietly disappears after merging</Text>
            <TouchableOpacity
              onPress={handleMergeConfirm}
              disabled={merging}
              activeOpacity={0.82}
              style={merging ? { opacity: 0.5 } : undefined}
            >
              <LinearGradient
                colors={['#fdf5b9', '#f0c8e8', '#e9b3ee']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={styles.mergeConfirmBtn}
              >
                {merging
                  ? <ActivityIndicator color="#9B4D7E" />
                  : <Text style={styles.mergeConfirmBtnText}>merge ✨</Text>
                }
              </LinearGradient>
            </TouchableOpacity>
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F77FAD' },
  safe: { flex: 1, backgroundColor: 'transparent' },
  contentCard: {
    backgroundColor: 'rgba(255,255,255,0.45)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 20,
    marginBottom: 14,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  backText: { fontSize: Theme.font.base, color: Theme.colors.primary, fontWeight: '600' },
  cancelText: { fontSize: Theme.font.base, color: Theme.colors.secondary, fontWeight: '500' },
  saveText: { fontSize: Theme.font.base, color: Theme.colors.accent, fontWeight: '700' },
  editText: { fontSize: Theme.font.sm, color: Theme.colors.secondary, fontWeight: '500' },
  deleteText: { fontSize: Theme.font.base, color: Theme.colors.accent, fontWeight: '500' },
  headerRight: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  followBtn: {
    borderWidth: 1.5, borderColor: Theme.colors.border,
    borderRadius: 100, paddingHorizontal: 14, paddingVertical: 5,
  },
  followBtnActive: { backgroundColor: Theme.colors.accent, borderColor: Theme.colors.accent },
  followBtnText: { fontSize: Theme.font.sm, fontWeight: '700', color: Theme.colors.primary },
  followBtnTextActive: { color: '#fff' },

  content: { paddingHorizontal: 16, paddingBottom: 16 },
  authorPill: {
    alignSelf: 'flex-start',
    borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.35)',
    borderRadius: 100,
    paddingHorizontal: 12, paddingVertical: 4,
    marginBottom: 10, marginLeft: 4,
  },
  authorText: {
    fontSize: Theme.font.sm, color: 'rgba(0,0,0,0.55)',
    fontWeight: '600',
  },

  photoContainer: {
    borderRadius: Theme.radius.lg, overflow: 'hidden',
    marginBottom: 14,
  },
  photo: { borderRadius: Theme.radius.lg },

  dateRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 8,
  },
  dateText: {
    fontSize: Theme.font.lg, fontWeight: '800', color: Theme.colors.primary,
    letterSpacing: -0.5,
  },
  likeArea: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  likeRowBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  likeRowCount: { fontSize: Theme.font.sm, fontWeight: '700', color: 'rgba(0,0,0,0.38)' },
  likeRowCountActive: { color: Theme.colors.accent },

  editFieldLabel: {
    fontSize: 10, fontWeight: '600', color: Theme.colors.secondary,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6, marginTop: 12,
  },
  inputCard: {
    backgroundColor: Theme.colors.surface, borderRadius: Theme.radius.md,
    borderWidth: 1, borderColor: Theme.colors.border,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 4, minHeight: 64,
  },
  captionInput: {
    fontSize: Theme.font.base, color: Theme.colors.primary, lineHeight: 22,
    textAlignVertical: 'top', paddingTop: 0, paddingBottom: 0, minHeight: 40,
  },
  tagScroll: { height: 44, marginBottom: 8 },
  tagScrollContent: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  tagAddPill: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 100,
    borderWidth: 1.5, borderStyle: 'dashed' as any, borderColor: Theme.colors.accent,
    justifyContent: 'center',
  },
  tagAddInput: {
    fontSize: Theme.font.xs, fontWeight: '700', color: Theme.colors.accent,
    minWidth: 36, padding: 0, margin: 0, height: 16,
  },
  tagChipSelected: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 100,
    backgroundColor: Theme.colors.accentLight,
    borderWidth: 1, borderColor: 'rgba(58,135,181,0.25)',
  },
  tagChipSelectedText: { fontSize: Theme.font.sm, fontWeight: '600', color: Theme.colors.accent },
  tagChipSuggestion: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 100,
    borderWidth: 1, borderColor: Theme.colors.border, backgroundColor: Theme.colors.surface,
  },
  tagChipSuggestionText: { fontSize: Theme.font.sm, color: Theme.colors.secondary },

  captionText: {
    fontSize: Theme.font.base, color: Theme.colors.primary,
    lineHeight: 22, marginBottom: 6,
  },
  tagsRow: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: 6, marginBottom: 16,
  },
  tagPill: {
    backgroundColor: 'rgba(166,194,215,0.22)',
    borderRadius: 100,
    paddingHorizontal: 10, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(90,143,168,0.18)',
  },
  tagPillText: { fontSize: Theme.font.xs, color: '#4A7A96', fontWeight: '600' },
  metaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 4 },
  metaRight: { alignItems: 'flex-end', gap: 8, paddingTop: 2 },
  addHint: { fontSize: Theme.font.sm, color: Theme.colors.disabled, marginBottom: 12 },
  editSaveRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 12, marginTop: 4, marginBottom: 4 },
  editCancelInline: { fontSize: Theme.font.sm, color: Theme.colors.secondary },
  editSaveBtn: { backgroundColor: 'rgba(30, 100, 220, 0.7)', borderRadius: Theme.radius.full, paddingVertical: 6, paddingHorizontal: 16 },
  editSaveBtnText: { fontSize: Theme.font.sm, fontWeight: '700', color: '#fff' },

  itemsSection: { marginTop: 16, marginBottom: 12 },
  itemsHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10,
  },
  itemsTitle: { fontSize: Theme.font.sm, fontWeight: '700', color: Theme.colors.secondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  itemsHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  itemsManageText: { fontSize: Theme.font.sm, color: Theme.colors.secondary, fontWeight: '500' },
  itemsEmptyRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  itemsEmpty: { fontSize: Theme.font.sm, color: Theme.colors.disabled },
  itemsScroll: { marginHorizontal: -16 },
  itemsContent: { paddingHorizontal: 16, gap: 10, flexDirection: 'row' },
  itemCell: { width: 72, alignItems: 'center', position: 'relative' },
  itemImage: { width: 72, height: 72, borderRadius: Theme.radius.md },
  itemPlaceholder: { backgroundColor: Theme.colors.surface, alignItems: 'center', justifyContent: 'center' },
  itemEmoji: { fontSize: 28 },
  itemLabel: { fontSize: 10, color: Theme.colors.secondary, marginTop: 4, textAlign: 'center', width: 72 },
  itemAddCell: {
    width: 72, height: 72, borderRadius: Theme.radius.md,
    borderWidth: 1.5, borderColor: Theme.colors.accent,
    borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
  },
  itemRemoveBadge: {
    position: 'absolute', top: -4, right: -4,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: Theme.colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },

  replaceBtnRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 12, marginTop: 32, marginBottom: 40,
  },
  replaceBtn: {
    backgroundColor: 'rgba(0,0,0,0.1)',
    borderRadius: Theme.radius.full,
    paddingVertical: 7, paddingHorizontal: 18,
  },
  replaceBtnText: { fontSize: Theme.font.sm, fontWeight: '500', color: Theme.colors.secondary },
  deleteIconBtn: { padding: 6 },

  // Engagement card
  engagementCard: {
    backgroundColor: 'rgba(255,255,255,0.30)',
    borderRadius: 20,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16,
    marginBottom: 8,
  },
  engageLikeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  engageLikeText: { fontSize: Theme.font.sm, color: 'rgba(0,0,0,0.40)', fontWeight: '500' },
  engageLikeTextActive: { color: 'rgba(0,0,0,0.55)' },
  engageDivider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(0,0,0,0.12)', marginVertical: 12 },
  engageComments: { gap: 10 },

  // Comment rows in card preview
  commentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  commentAvatarImg: { width: 28, height: 28, borderRadius: 14 },
  commentAvatarPlaceholder: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Theme.colors.surface,
    borderWidth: 1, borderColor: Theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  commentAvatarInitial: { fontSize: Theme.font.xs, fontWeight: '700', color: Theme.colors.primary },
  commentContent: { flex: 1 },
  commentUsername: { fontSize: Theme.font.xs, fontWeight: '700', color: Theme.colors.primary, marginBottom: 2 },
  commentText: { fontSize: Theme.font.sm, color: 'rgba(0,0,0,0.65)', lineHeight: 18 },

  viewAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  viewAllText: { fontSize: Theme.font.xs, fontWeight: '600', color: 'rgba(0,0,0,0.40)' },
  addCommentPrompt: { paddingVertical: 4 },
  addCommentPromptText: { fontSize: Theme.font.sm, color: Theme.colors.disabled },

  // Likes panel
  panelBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  likesPanel: {
    backgroundColor: Theme.colors.background,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40,
    maxHeight: '60%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.10,
    shadowRadius: 12,
    elevation: 12,
  },
  likesPanelHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: Theme.colors.border,
    alignSelf: 'center', marginBottom: 16,
  },
  likesPanelTitle: {
    fontFamily: 'Caprasimo_400Regular',
    fontSize: 20, color: Theme.colors.primary, marginBottom: 16,
  },
  likersEmpty: { fontSize: Theme.font.sm, color: Theme.colors.disabled, textAlign: 'center', marginTop: 24 },
  likerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  likerAvatar: { width: 40, height: 40, borderRadius: 20 },
  likerAvatarPlaceholder: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Theme.colors.surface,
    borderWidth: 1, borderColor: Theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  likerAvatarInitial: { fontSize: Theme.font.base, fontWeight: '700', color: Theme.colors.primary },
  likerName: { fontSize: Theme.font.base, fontWeight: '600', color: Theme.colors.primary },
  likerUsername: { fontSize: Theme.font.sm, color: Theme.colors.secondary },

  // Comments panel
  commentsPanel: {
    backgroundColor: Theme.colors.background,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8,
    maxHeight: '70%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.10,
    shadowRadius: 12,
    elevation: 12,
  },
  cPanelHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: Theme.colors.border,
    alignSelf: 'center', marginBottom: 16,
  },
  cPanelTitle: {
    fontFamily: 'Caprasimo_400Regular',
    fontSize: 20, color: Theme.colors.primary, marginBottom: 12,
  },
  cPanelList: { maxHeight: 360, minHeight: 60 },
  cPanelEmpty: {
    fontSize: Theme.font.sm, color: Theme.colors.disabled,
    textAlign: 'center', marginVertical: 24,
  },
  cPanelCommentRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    gap: 10, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  cPanelReplyRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    gap: 8, paddingVertical: 6, paddingLeft: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.04)',
  },
  cPanelCommentAvatar: { width: 32, height: 32, borderRadius: 16 },
  cPanelCommentAvatarPlaceholder: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Theme.colors.surface,
    borderWidth: 1, borderColor: Theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  cPanelReplyAvatar: { width: 24, height: 24, borderRadius: 12 },
  cPanelReplyAvatarPlaceholder: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: Theme.colors.surface,
    borderWidth: 1, borderColor: Theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  cPanelAvatarInitial: { fontSize: Theme.font.xs, fontWeight: '700', color: Theme.colors.primary },
  cPanelCommentAuthor: { fontSize: Theme.font.sm, fontWeight: '700', color: Theme.colors.primary, marginBottom: 2 },
  cPanelCommentText: { fontSize: Theme.font.base, color: 'rgba(0,0,0,0.65)', lineHeight: 22 },
  cPanelCommentActions: { flexDirection: 'row', gap: 12, marginTop: 5 },
  cPanelCommentAction: { fontSize: Theme.font.xs, color: 'rgba(0,0,0,0.38)', fontWeight: '600' },
  cPanelLikeBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingLeft: 8, paddingTop: 2 },
  cPanelLikeCount: { fontSize: Theme.font.xs, color: 'rgba(0,0,0,0.38)', fontWeight: '600' },
  cPanelViewRepliesBtn: {
    flexDirection: 'row', alignItems: 'center',
    gap: 8, paddingVertical: 6, paddingLeft: 44, marginBottom: 2,
  },
  cPanelReplyLine: { width: 20, height: 1.5, backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: 1 },
  cPanelViewRepliesText: { fontSize: Theme.font.xs, fontWeight: '600', color: 'rgba(0,0,0,0.45)' },
  cPanelReplyingToRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 6, paddingTop: 10, paddingBottom: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.08)',
  },
  cPanelReplyingToText: { fontSize: Theme.font.xs, color: 'rgba(0,0,0,0.45)', flex: 1, fontStyle: 'italic' },
  cPanelInputRow: {
    flexDirection: 'row', alignItems: 'stretch',
    gap: 10, paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.08)',
  },
  cPanelInputRowNoTopBorder: { borderTopWidth: 0 },
  cPanelInput: {
    flex: 1, fontSize: Theme.font.base, color: Theme.colors.primary,
    backgroundColor: Theme.colors.surface,
    borderRadius: 100, paddingHorizontal: 14, paddingVertical: 8,
  },

  // Shared sheet (pageSheet modal) styles
  sheetSafe: { flex: 1, backgroundColor: Theme.colors.background },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Theme.colors.border,
  },
  sheetTitle: {
    fontFamily: 'Caprasimo_400Regular', fontSize: Theme.font.md, color: Theme.colors.primary,
  },
  sheetEmpty: { flex: 1, alignItems: 'center', paddingTop: 48 },
  sheetEmptyText: { fontSize: Theme.font.sm, color: Theme.colors.disabled },
  sheetGrid: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32 },
  sheetGridRow: { gap: 8, marginBottom: 8 },
  sheetCell: { width: MERGE_CELL },
  sheetCellImage: {
    width: MERGE_CELL, height: MERGE_CELL, borderRadius: 12,
    backgroundColor: '#fff', overflow: 'hidden',
  },
  sheetCellPlaceholder: { backgroundColor: Theme.colors.surface, alignItems: 'center', justifyContent: 'center' },
  sheetCellLabel: {
    fontSize: 10, color: Theme.colors.primary, fontWeight: '500',
    marginTop: 4, textAlign: 'center',
  },

  // Merge confirm (step 2)
  mergeConfirmContent: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 40 },
  mergeHint: {
    fontSize: Theme.font.sm, color: Theme.colors.secondary,
    textAlign: 'center', lineHeight: 20, marginBottom: 24,
  },
  mergeCompare: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  mergeCompareCol: {
    flex: 1, alignItems: 'center', borderRadius: 16, padding: 8,
    borderWidth: 2, borderColor: 'transparent', position: 'relative',
  },
  mergeCompareColActive: { borderColor: '#E879A8', backgroundColor: 'rgba(240,168,212,0.10)' },
  mergeCompareImg: {
    width: COMPARE_IMG, height: COMPARE_IMG, borderRadius: 12, backgroundColor: '#fff',
  },
  mergeCompareLabel: {
    fontSize: Theme.font.xs, color: Theme.colors.primary,
    fontWeight: '500', textAlign: 'center', marginTop: 8,
  },
  mergeCheck: {
    position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#E879A8', alignItems: 'center', justifyContent: 'center',
  },
  mergeWarning: {
    fontSize: Theme.font.xs, color: Theme.colors.disabled,
    textAlign: 'center', lineHeight: 18, marginBottom: 20,
  },
  mergeConfirmBtn: { borderRadius: Theme.radius.md, paddingVertical: 16, alignItems: 'center' },
  mergeConfirmBtnText: { fontSize: Theme.font.base, fontWeight: '700', color: '#7C3060' },

  hiddenBadgeText: { fontSize: Theme.font.xs, color: 'rgba(0,0,0,0.4)', fontWeight: '500' },
});
