import { useCallback, useState } from 'react';
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
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, Feather } from '@expo/vector-icons';

import { Theme } from '@/constants/Theme';
import {
  getPost, deletePost, updatePostMeta,
  followUser, unfollowUser, isFollowing,
  likePost, unlikePost,
  getComments, addComment,
  Post, Comment,
} from '@/utils/api';
import { formatDate } from '@/utils/dates';
import { useAuth } from '@/utils/auth';
import { TagInput } from '@/components/TagInput';

const SCREEN_WIDTH = Math.min(Dimensions.get('window').width, 390);

export default function EntryScreen() {
  const { date, userId } = useLocalSearchParams<{ date: string; userId?: string }>();
  const router = useRouter();
  const { session, profile: authProfile } = useAuth();
  const [post, setPost] = useState<Post | null>(null);

  const [editing, setEditing] = useState(false);
  const [editCaption, setEditCaption] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const [followingThem, setFollowingThem] = useState<boolean | null>(null);
  const [followLoading, setFollowLoading] = useState(false);

  const [likedByMe, setLikedByMe] = useState(false);
  const [likesCount, setLikesCount] = useState(0);

  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

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
            getComments(p.id).then(setComments);
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
    Alert.alert('delete this look?', "you can't undo this.", [
      { text: 'keep it', style: 'cancel' },
      {
        text: 'delete', style: 'destructive',
        onPress: async () => {
          if (!post) return;
          try { await deletePost(post.id); router.back(); }
          catch { Alert.alert('oops', 'could not delete this look. try again?'); }
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

  const handleLikeToggle = async () => {
    if (!post || !session || isOwn) return;
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

  const handleAddComment = async () => {
    if (!post || !commentText.trim() || submittingComment) return;
    setSubmittingComment(true);
    const text = commentText.trim();
    setCommentText('');
    try {
      const newComment = await addComment(post.id, text);
      setComments(prev => [...prev, {
        ...newComment,
        profile: authProfile ? {
          username: authProfile.username,
          display_name: authProfile.display_name,
          avatar_url: authProfile.avatar_url,
        } : undefined,
      }]);
      setPost(p => p ? { ...p, comments_count: (p.comments_count ?? 0) + 1 } : p);
    } catch { setCommentText(text); }
    finally { setSubmittingComment(false); }
  };

  if (!post) return null;

  const photoWidth = SCREEN_WIDTH - 32;
  const photoHeight = Math.round(photoWidth * (4 / 3));

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={Theme.colors.background} />

      {/* Header */}
      <View style={styles.header}>
        {editing ? (
          <TouchableOpacity onPress={cancelEdit} hitSlop={12}>
            <Text style={styles.cancelText}>cancel</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.backText}>‹ back</Text>
          </TouchableOpacity>
        )}

        {editing ? (
          <TouchableOpacity onPress={saveEdit} hitSlop={12} disabled={saving}>
            {saving
              ? <ActivityIndicator size="small" color={Theme.colors.accent} />
              : <Text style={styles.saveText}>save</Text>
            }
          </TouchableOpacity>
        ) : isOwn ? (
          <View style={styles.headerRight}>
            <TouchableOpacity onPress={startEditing} hitSlop={12}>
              <Text style={styles.editText}>edit</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDelete} hitSlop={12}>
              <Text style={styles.deleteText}>delete</Text>
            </TouchableOpacity>
          </View>
        ) : followingThem !== null ? (
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
            <Text style={styles.authorText}>@{post.profile.username}</Text>
          )}

          {/* Photo */}
          <View style={styles.photoContainer}>
            <Image
              source={{ uri: post.photo_url }}
              style={[styles.photo, { width: photoWidth, height: photoHeight }]}
              resizeMode="cover"
            />
          </View>

          {/* Date + like row */}
          <View style={styles.dateRow}>
            <Text style={styles.dateText}>{formatDate(post.date)}</Text>
            {(!isOwn && session) ? (
              <TouchableOpacity
                style={styles.likeRowBtn}
                onPress={handleLikeToggle}
                hitSlop={8}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={likedByMe ? 'heart' : 'heart-outline'}
                  size={20}
                  color={likedByMe ? Theme.colors.accent : 'rgba(0,0,0,0.38)'}
                />
                {likesCount > 0 && (
                  <Text style={[styles.likeRowCount, likedByMe && styles.likeRowCountActive]}>
                    {likesCount}
                  </Text>
                )}
              </TouchableOpacity>
            ) : likesCount > 0 ? (
              <View style={styles.likeRowBtn}>
                <Ionicons name="heart" size={20} color={Theme.colors.secondary} />
                <Text style={styles.likeRowCount}>{likesCount}</Text>
              </View>
            ) : null}
          </View>

          {/* Caption */}
          {editing ? (
            <View style={styles.inputCard}>
              <TextInput
                style={styles.captionInput}
                value={editCaption}
                onChangeText={setEditCaption}
                placeholder="add a caption... (optional)"
                placeholderTextColor={Theme.colors.disabled}
                multiline
                submitBehavior="blurAndSubmit"
                returnKeyType="done"
                maxLength={280}
                autoFocus
              />
            </View>
          ) : post.caption ? (
            <Text style={styles.captionText}>{post.caption}</Text>
          ) : isOwn ? (
            <TouchableOpacity onPress={startEditing} activeOpacity={0.7}>
              <Text style={styles.addHint}>+ add a caption</Text>
            </TouchableOpacity>
          ) : null}

          {/* Tags */}
          {editing ? (
            <View style={styles.tagInputWrap}>
              <TagInput value={editTags} onChange={setEditTags} placeholder="add tags..." />
            </View>
          ) : post.tags.length > 0 ? (
            <View style={styles.tagsRow}>
              {post.tags.map(t => (
                <View key={t} style={styles.tagPill}>
                  <Text style={styles.tagPillText}>#{t}</Text>
                </View>
              ))}
            </View>
          ) : isOwn && !editing ? (
            <TouchableOpacity onPress={startEditing} activeOpacity={0.7} style={{ marginBottom: 12 }}>
              <Text style={styles.addHint}>+ add tags</Text>
            </TouchableOpacity>
          ) : null}

          {/* Replace button (own posts) */}
          {isOwn && !editing && (
            <TouchableOpacity style={styles.replaceBtn} onPress={handleReplace} activeOpacity={0.8}>
              <Text style={styles.replaceBtnText}>replace this look</Text>
            </TouchableOpacity>
          )}

          {/* Comments */}
          {!editing && comments.length > 0 && (
            <View style={styles.commentsSection}>
              <Text style={styles.commentsSectionTitle}>comments</Text>
              {comments.map(comment => (
                <View key={comment.id} style={styles.commentRow}>
                  <View style={styles.commentAvatar}>
                    {comment.profile?.avatar_url ? (
                      <Image source={{ uri: comment.profile.avatar_url }} style={styles.commentAvatarImg} />
                    ) : (
                      <View style={styles.commentAvatarPlaceholder}>
                        <Text style={styles.commentAvatarInitial}>
                          {(comment.profile?.display_name ?? comment.profile?.username ?? '?')[0].toUpperCase()}
                        </Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.commentContent}>
                    <Text style={styles.commentUsername}>@{comment.profile?.username ?? 'unknown'}</Text>
                    <Text style={styles.commentText}>{comment.content}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>

        {/* Comment input bar */}
        {session && !editing && !isOwn && (
          <View style={styles.commentInputBar}>
            <TextInput
              style={styles.commentInput}
              value={commentText}
              onChangeText={setCommentText}
              placeholder="add a comment..."
              placeholderTextColor={Theme.colors.disabled}
              returnKeyType="send"
              onSubmitEditing={handleAddComment}
              blurOnSubmit={true}
            />
            <TouchableOpacity
              onPress={handleAddComment}
              disabled={!commentText.trim() || submittingComment}
              hitSlop={8}
            >
              {submittingComment
                ? <ActivityIndicator size="small" color={Theme.colors.accent} />
                : <Feather name="send" size={20} color={commentText.trim() ? Theme.colors.accent : Theme.colors.disabled} />
              }
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Theme.colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  backText: { fontSize: Theme.font.base, color: Theme.colors.primary, fontWeight: '600' },
  cancelText: { fontSize: Theme.font.base, color: Theme.colors.secondary, fontWeight: '500' },
  saveText: { fontSize: Theme.font.base, color: Theme.colors.accent, fontWeight: '700' },
  editText: { fontSize: Theme.font.base, color: Theme.colors.secondary, fontWeight: '500' },
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
  authorText: {
    fontSize: Theme.font.sm, color: Theme.colors.secondary,
    fontWeight: '600', marginBottom: 10,
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
  likeRowBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  likeRowCount: { fontSize: Theme.font.sm, fontWeight: '700', color: 'rgba(0,0,0,0.38)' },
  likeRowCountActive: { color: Theme.colors.accent },

  inputCard: {
    backgroundColor: Theme.colors.surface, borderRadius: Theme.radius.md,
    borderWidth: 1, borderColor: Theme.colors.border,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10, minHeight: 64,
  },
  captionInput: { fontSize: Theme.font.base, color: Theme.colors.primary, lineHeight: 22 },

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
  tagPillText: {
    fontSize: Theme.font.xs, color: '#4A7A96', fontWeight: '600',
  },
  addHint: { fontSize: Theme.font.sm, color: Theme.colors.disabled, marginBottom: 12 },
  tagInputWrap: { marginBottom: 12 },

  replaceBtn: {
    borderWidth: 1, borderColor: Theme.colors.border,
    borderRadius: Theme.radius.md, paddingVertical: 13, alignItems: 'center',
    marginBottom: 20,
  },
  replaceBtnText: {
    fontSize: Theme.font.sm, fontWeight: '600',
    color: Theme.colors.secondary, letterSpacing: 0.2,
  },

  commentsSection: { gap: 12, marginBottom: 16 },
  commentsSectionTitle: {
    fontSize: Theme.font.sm, fontWeight: '700',
    color: Theme.colors.secondary, textTransform: 'uppercase', letterSpacing: 0.5,
    marginBottom: 4,
  },
  commentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  commentAvatar: {},
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

  commentInputBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Theme.colors.border,
    backgroundColor: Theme.colors.background,
  },
  commentInput: {
    flex: 1, fontSize: Theme.font.base, color: Theme.colors.primary,
    paddingVertical: 8, paddingHorizontal: 14,
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.radius.full,
  },
});
