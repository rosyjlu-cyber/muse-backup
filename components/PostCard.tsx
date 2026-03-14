import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  Modal,
  ScrollView,
  Share,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '@/constants/Theme';
import { Post, Comment, Profile, getComments, deleteComment, likeComment, unlikeComment, getPostLikers } from '@/utils/api';
import { useAuth } from '@/utils/auth';
import { formatShortDate } from '@/utils/dates';

const SCREEN_WIDTH = Math.min(Dimensions.get('window').width, 390);
const CARD_W = SCREEN_WIDTH - 32;
const CARD_H = Math.round(CARD_W * (4 / 3));
const CARD_R = 18;

interface PostCardProps {
  post: Post;
  onPress: () => void;
  onLike?: (post: Post) => void;
  onComment?: (postId: string, content: string, parentCommentId?: string) => Promise<void>;
  onAuthorPress?: () => void;
}

export function PostCard({ post, onPress, onLike, onComment, onAuthorPress }: PostCardProps) {
  const { session } = useAuth();
  const username = post.profile?.username ?? 'unknown';
  const avatarLetter = (post.profile?.display_name ?? username)[0].toUpperCase();

  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [localCommentsCount, setLocalCommentsCount] = useState(post.comments_count ?? 0);
  const [replyingTo, setReplyingTo] = useState<{ commentId: string; username: string } | null>(null);
  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set());
  const inputRef = useRef<TextInput>(null);

  const [showLikersPanel, setShowLikersPanel] = useState(false);
  const [likers, setLikers] = useState<Profile[]>([]);
  const [loadingLikers, setLoadingLikers] = useState(false);

  // Sync count from prop when panel hasn't been opened yet
  useEffect(() => {
    if (!commentsLoaded) {
      setLocalCommentsCount(post.comments_count ?? 0);
    }
  }, [post.comments_count, commentsLoaded]);

  const closeComments = () => {
    Keyboard.dismiss();
    setShowComments(false);
  };

  const openComments = async () => {
    setShowComments(true);
    if (!commentsLoaded) {
      setLoadingComments(true);
      try {
        const loaded = await getComments(post.id);
        setComments(loaded);
        setLocalCommentsCount(loaded.length);
        setCommentsLoaded(true);
      } finally {
        setLoadingComments(false);
      }
    }
  };

  const handleSubmitComment = async () => {
    const trimmed = newComment.trim();
    if (!trimmed || !onComment || submittingComment) return;
    setSubmittingComment(true);
    const parentId = replyingTo?.commentId;
    setNewComment('');
    setReplyingTo(null);
    try {
      await onComment(post.id, trimmed, parentId);
      const loaded = await getComments(post.id);
      setComments(loaded);
      setLocalCommentsCount(loaded.length);
      setCommentsLoaded(true);
      if (parentId) {
        setExpandedReplies(prev => new Set([...prev, parentId]));
      }
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleShare = () => {
    Share.share({ message: `Check out this outfit on muse! 🧥` }).catch(() => {});
  };

  const handleCommentLike = (commentId: string) => {
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

  const handleReply = (topLevelCommentId: string, replyUsername: string) => {
    setReplyingTo({ commentId: topLevelCommentId, username: replyUsername });
    setNewComment(`@${replyUsername} `);
    setExpandedReplies(prev => new Set([...prev, topLevelCommentId]));
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleDeleteComment = (commentId: string) => {
    Alert.alert('delete comment?', undefined, [
      { text: 'cancel', style: 'cancel' },
      {
        text: 'delete', style: 'destructive',
        onPress: async () => {
          try {
            await deleteComment(commentId);
            setComments(prev => prev.filter(c => c.id !== commentId));
            setLocalCommentsCount(prev => Math.max(prev - 1, 0));
          } catch { /* silent */ }
        },
      },
    ]);
  };

  const toggleReplies = (commentId: string) => {
    setExpandedReplies(prev => {
      const next = new Set(prev);
      if (next.has(commentId)) next.delete(commentId);
      else next.add(commentId);
      return next;
    });
  };

  const openLikersPanel = async () => {
    if ((post.likes_count ?? 0) === 0) return;
    setShowLikersPanel(true);
    setLoadingLikers(true);
    try {
      const profiles = await getPostLikers(post.id);
      setLikers(profiles);
    } catch { /* silent */ }
    finally { setLoadingLikers(false); }
  };

  // Group into top-level and replies
  const topLevel = comments.filter(c => !c.parent_comment_id);
  const repliesByParent: Record<string, Comment[]> = {};
  comments.forEach(c => {
    if (c.parent_comment_id) {
      (repliesByParent[c.parent_comment_id] ??= []).push(c);
    }
  });

  const renderCommentItem = (c: Comment, isReply: boolean, topLevelId: string, topLevelUsername: string) => (
    <View style={isReply ? styles.replyRow : styles.commentRow}>
      {c.profile?.avatar_url ? (
        <Image
          source={{ uri: c.profile.avatar_url }}
          style={isReply ? styles.replyAvatar : styles.commentAvatar}
        />
      ) : (
        <View style={isReply ? styles.replyAvatarPlaceholder : styles.commentAvatarPlaceholder}>
          <Text style={styles.commentAvatarInitial}>
            {(c.profile?.display_name ?? c.profile?.username ?? '?')[0].toUpperCase()}
          </Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.commentAuthor}>@{c.profile?.username ?? 'unknown'}</Text>
        <Text style={styles.commentText}>{c.content}</Text>
        <View style={styles.commentActions}>
          {session && (
            <TouchableOpacity onPress={() => handleReply(topLevelId, topLevelUsername)} hitSlop={8}>
              <Text style={styles.commentAction}>reply</Text>
            </TouchableOpacity>
          )}
          {c.user_id === session?.user.id && (
            <TouchableOpacity onPress={() => handleDeleteComment(c.id)} hitSlop={8}>
              <Text style={styles.commentAction}>delete</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      <TouchableOpacity
        style={styles.commentLikeBtn}
        onPress={() => handleCommentLike(c.id)}
        hitSlop={8}
        disabled={!session}
      >
        <Ionicons
          name={c.liked_by_me ? 'heart' : 'heart-outline'}
          size={13}
          color={c.liked_by_me ? Theme.colors.brandWarm : 'rgba(0,0,0,0.30)'}
        />
        {(c.likes_count ?? 0) > 0 && (
          <Text style={styles.commentLikeCount}>{c.likes_count}</Text>
        )}
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.card}>
      {/* Author row */}
      <TouchableOpacity
        style={styles.authorRow}
        onPress={onAuthorPress}
        activeOpacity={onAuthorPress ? 0.7 : 1}
        disabled={!onAuthorPress}
      >
        {post.profile?.avatar_url ? (
          <Image source={{ uri: post.profile.avatar_url }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarLetter}>{avatarLetter}</Text>
          </View>
        )}
        <Text style={styles.username}>@{username}</Text>
        <Text style={styles.dateText}>{formatShortDate(post.date)}</Text>
      </TouchableOpacity>

      {/* Photo */}
      <TouchableOpacity onPress={onPress} activeOpacity={0.95}>
        <Image source={{ uri: post.photo_url }} style={styles.photo} resizeMode="cover" />
      </TouchableOpacity>

      {/* Caption */}
      {post.caption ? (
        <Text style={styles.caption}>{post.caption}</Text>
      ) : null}

      {/* Tags */}
      {post.tags.length > 0 && (
        <View style={styles.tagsRow}>
          {post.tags.map(t => (
            <View key={t} style={styles.tagPill}>
              <Text style={styles.tagPillText}>{t}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Footer: like | comment | share */}
      <View style={styles.footer}>
        <View style={styles.footerBtn}>
          <TouchableOpacity onPress={() => onLike?.(post)} hitSlop={8} activeOpacity={0.7}>
            <Ionicons
              name={post.liked_by_me ? 'heart' : 'heart-outline'}
              size={20}
              color={post.liked_by_me ? Theme.colors.brandWarm : 'rgba(0,0,0,0.38)'}
            />
          </TouchableOpacity>
          {(post.likes_count ?? 0) > 0 && (
            <TouchableOpacity onPress={openLikersPanel} hitSlop={8} activeOpacity={0.7}>
              <Text style={[styles.footerCount, post.liked_by_me && styles.footerCountActive]}>
                {post.likes_count}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={styles.footerBtn}
          onPress={openComments}
          hitSlop={8}
          activeOpacity={0.7}
        >
          <Ionicons name="chatbubble-outline" size={19} color='rgba(0,0,0,0.38)' />
          {localCommentsCount > 0 && (
            <Text style={styles.footerCount}>{localCommentsCount}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.footerBtn}
          onPress={handleShare}
          hitSlop={8}
          activeOpacity={0.7}
        >
          <Ionicons name="paper-plane-outline" size={18} color='rgba(0,0,0,0.38)' />
        </TouchableOpacity>
      </View>

      {/* Comments panel */}
      <Modal
        visible={showComments}
        transparent
        animationType="slide"
        onRequestClose={closeComments}
      >
        <KeyboardAvoidingView
          style={{ flex: 1, justifyContent: 'flex-end' }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={closeComments}
          />
          <View style={styles.commentsPanel}>
            <View style={styles.panelHandle} />
            <Text style={styles.panelTitle}>comments</Text>

            {loadingComments ? (
              <ActivityIndicator color={Theme.colors.brandWarm} style={{ marginTop: 24, marginBottom: 16 }} />
            ) : (
              <ScrollView
                style={styles.commentsList}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {topLevel.length === 0 ? (
                  <Text style={styles.commentsEmpty}>no comments yet — be the first!</Text>
                ) : (
                  topLevel.map(c => {
                    const replies = repliesByParent[c.id] ?? [];
                    const repliesExpanded = expandedReplies.has(c.id);
                    const cUsername = c.profile?.username ?? 'unknown';
                    return (
                      <View key={c.id}>
                        {renderCommentItem(c, false, c.id, cUsername)}

                        {replies.length > 0 && (
                          <TouchableOpacity
                            style={styles.viewRepliesBtn}
                            onPress={() => toggleReplies(c.id)}
                            activeOpacity={0.7}
                          >
                            <View style={styles.replyThreadLine} />
                            <Text style={styles.viewRepliesText}>
                              {repliesExpanded
                                ? 'hide replies'
                                : `view ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`
                              }
                            </Text>
                          </TouchableOpacity>
                        )}

                        {repliesExpanded && replies.map(r => (
                          <View key={r.id}>
                            {renderCommentItem(r, true, c.id, cUsername)}
                          </View>
                        ))}
                      </View>
                    );
                  })
                )}
              </ScrollView>
            )}

            {session && onComment && (
              <>
                {replyingTo && (
                  <View style={styles.replyingToRow}>
                    <Text style={styles.replyingToText}>replying to @{replyingTo.username}</Text>
                    <TouchableOpacity
                      onPress={() => { setReplyingTo(null); setNewComment(''); }}
                      hitSlop={8}
                    >
                      <Ionicons name="close" size={14} color={Theme.colors.secondary} />
                    </TouchableOpacity>
                  </View>
                )}
                <View style={[styles.commentInputRow, !!replyingTo && styles.commentInputRowNoTopBorder]}>
                  <TextInput
                    ref={inputRef}
                    style={styles.commentInput}
                    placeholder="add a comment..."
                    placeholderTextColor="rgba(0,0,0,0.30)"
                    value={newComment}
                    onChangeText={setNewComment}
                    returnKeyType="send"
                    onSubmitEditing={handleSubmitComment}
                    editable={!submittingComment}
                  />
                  {submittingComment ? (
                    <ActivityIndicator size="small" color={Theme.colors.brandWarm} />
                  ) : (
                    <TouchableOpacity onPress={handleSubmitComment} hitSlop={8} disabled={!newComment.trim()} style={{ justifyContent: 'center' }}>
                      <Ionicons
                        name="arrow-up-circle"
                        size={26}
                        color={newComment.trim() ? Theme.colors.brandWarm : Theme.colors.disabled}
                      />
                    </TouchableOpacity>
                  )}
                </View>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Likers panel */}
      <Modal
        visible={showLikersPanel}
        transparent
        animationType="slide"
        onRequestClose={() => setShowLikersPanel(false)}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowLikersPanel(false)} />
          <View style={styles.likersPanel}>
            <View style={styles.likersPanelHandle} />
            <Text style={styles.likersPanelTitle}>liked by</Text>
            {loadingLikers ? (
              <ActivityIndicator color={Theme.colors.brandWarm} style={{ marginTop: 24 }} />
            ) : likers.length === 0 ? (
              <Text style={styles.likersPanelEmpty}>no likes yet</Text>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 300 }}>
                {likers.map(p => (
                  <View key={p.id} style={styles.likerRow}>
                    {p.avatar_url ? (
                      <Image source={{ uri: p.avatar_url }} style={styles.likerAvatar} />
                    ) : (
                      <View style={styles.likerAvatarPlaceholder}>
                        <Text style={styles.likerAvatarInitial}>
                          {(p.display_name ?? p.username)[0].toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <View>
                      <Text style={styles.likerName}>{p.display_name ?? p.username}</Text>
                      <Text style={styles.likerUsername}>@{p.username}</Text>
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_W,
    alignSelf: 'center',
    marginBottom: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: CARD_R,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.10)',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
  },

  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
  },
  avatar: { width: 28, height: 28, borderRadius: 14 },
  avatarPlaceholder: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Theme.colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarLetter: { fontSize: Theme.font.xs, fontWeight: '800', color: '#fff' },
  username: {
    fontSize: Theme.font.sm, fontWeight: '700',
    color: Theme.colors.primary, flex: 1,
  },
  dateText: { fontSize: Theme.font.xs, color: 'rgba(0,0,0,0.38)' },

  photo: { width: CARD_W, height: CARD_H },

  caption: {
    fontSize: Theme.font.sm,
    color: Theme.colors.primary,
    lineHeight: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 2,
  },

  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 4,
  },
  tagPill: {
    backgroundColor: 'rgba(166,194,215,0.22)',
    borderRadius: 100,
    paddingHorizontal: 10, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(90,143,168,0.18)',
  },
  tagPillText: { fontSize: Theme.font.xs, color: '#4A7A96', fontWeight: '600' },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.08)',
    marginTop: 6,
  },
  footerBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  footerCount: { fontSize: Theme.font.xs, color: 'rgba(0,0,0,0.45)', fontWeight: '600' },
  footerCountActive: { color: Theme.colors.brandWarm },

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
  panelHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: Theme.colors.border,
    alignSelf: 'center', marginBottom: 16,
  },
  panelTitle: {
    fontFamily: 'Caprasimo_400Regular',
    fontSize: 20, color: Theme.colors.primary, marginBottom: 12,
  },
  commentsList: { maxHeight: 320, minHeight: 60 },
  commentsEmpty: {
    fontSize: Theme.font.sm, color: Theme.colors.disabled,
    textAlign: 'center', marginVertical: 24,
  },

  commentRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    gap: 10, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  replyRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    gap: 8, paddingVertical: 6, paddingLeft: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.04)',
  },
  commentAvatar: { width: 32, height: 32, borderRadius: 16 },
  commentAvatarPlaceholder: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Theme.colors.surface,
    borderWidth: 1, borderColor: Theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  replyAvatar: { width: 24, height: 24, borderRadius: 12 },
  replyAvatarPlaceholder: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: Theme.colors.surface,
    borderWidth: 1, borderColor: Theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  commentAvatarInitial: { fontSize: Theme.font.xs, fontWeight: '700', color: Theme.colors.primary },
  commentAuthor: { fontSize: Theme.font.sm, fontWeight: '700', color: Theme.colors.primary, marginBottom: 2 },
  commentText: { fontSize: Theme.font.base, color: 'rgba(0,0,0,0.65)', lineHeight: 22 },

  viewRepliesBtn: {
    flexDirection: 'row', alignItems: 'center',
    gap: 8, paddingVertical: 6, paddingLeft: 44, marginBottom: 2,
  },
  replyThreadLine: {
    width: 20, height: 1.5,
    backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: 1,
  },
  viewRepliesText: {
    fontSize: Theme.font.xs, fontWeight: '600', color: 'rgba(0,0,0,0.45)',
  },

  replyingToRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 6, paddingTop: 10, paddingBottom: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.08)',
  },
  replyingToText: {
    fontSize: Theme.font.xs, color: 'rgba(0,0,0,0.45)', flex: 1, fontStyle: 'italic',
  },

  commentInputRow: {
    flexDirection: 'row', alignItems: 'stretch',
    gap: 10, paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.08)',
  },
  commentInputRowNoTopBorder: { borderTopWidth: 0 },
  commentInput: {
    flex: 1, fontSize: Theme.font.base, color: Theme.colors.primary,
    backgroundColor: Theme.colors.surface,
    borderRadius: 100, paddingHorizontal: 14, paddingVertical: 8,
  },

  commentActions: { flexDirection: 'row', gap: 12, marginTop: 5 },
  commentAction: { fontSize: Theme.font.xs, color: 'rgba(0,0,0,0.38)', fontWeight: '600' },
  commentLikeBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingLeft: 8, paddingTop: 2 },
  commentLikeCount: { fontSize: Theme.font.xs, color: 'rgba(0,0,0,0.38)', fontWeight: '600' },

  likersPanel: {
    backgroundColor: Theme.colors.background,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32,
    maxHeight: '55%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.10,
    shadowRadius: 12,
    elevation: 12,
  },
  likersPanelHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: Theme.colors.border,
    alignSelf: 'center', marginBottom: 16,
  },
  likersPanelTitle: {
    fontFamily: 'Caprasimo_400Regular',
    fontSize: 20, color: Theme.colors.primary, marginBottom: 16,
  },
  likersPanelEmpty: { fontSize: Theme.font.sm, color: Theme.colors.disabled, textAlign: 'center', marginTop: 24 },
  likerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  likerAvatar: { width: 36, height: 36, borderRadius: 18 },
  likerAvatarPlaceholder: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Theme.colors.surface,
    borderWidth: 1, borderColor: Theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  likerAvatarInitial: { fontSize: Theme.font.sm, fontWeight: '700', color: Theme.colors.primary },
  likerName: { fontSize: Theme.font.base, fontWeight: '600', color: Theme.colors.primary },
  likerUsername: { fontSize: Theme.font.sm, color: Theme.colors.secondary },
});
