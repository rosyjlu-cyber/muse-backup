import { useState } from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '@/constants/Theme';
import { Post, Comment, getComments } from '@/utils/api';
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
  onComment?: (postId: string, content: string) => Promise<void>;
  onAuthorPress?: () => void;
}

export function PostCard({ post, onPress, onLike, onComment, onAuthorPress }: PostCardProps) {
  const { session } = useAuth();
  const username = post.profile?.username ?? 'unknown';
  const avatarLetter = (post.profile?.display_name ?? username)[0].toUpperCase();
  const isOwnPost = session?.user.id === post.user_id;

  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  const handleCommentsTap = async () => {
    const opening = !showComments;
    setShowComments(opening);
    if (opening && !commentsLoaded) {
      setLoadingComments(true);
      try {
        const loaded = await getComments(post.id);
        setComments(loaded);
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
    setNewComment('');
    try {
      await onComment(post.id, trimmed);
      const loaded = await getComments(post.id);
      setComments(loaded);
      setCommentsLoaded(true);
    } finally {
      setSubmittingComment(false);
    }
  };

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

      {/* Photo with depop-style like overlay */}
      <TouchableOpacity onPress={onPress} activeOpacity={0.95}>
        <View style={{ position: 'relative' }}>
          <Image source={{ uri: post.photo_url }} style={styles.photo} resizeMode="cover" />
          <TouchableOpacity
            style={styles.likeOverlay}
            onPress={() => !isOwnPost && onLike?.(post)}
            hitSlop={8}
            activeOpacity={isOwnPost ? 1 : 0.75}
            disabled={isOwnPost}
          >
            <Ionicons
              name={post.liked_by_me ? 'heart' : 'heart-outline'}
              size={22}
              color="#fff"
            />
            {(post.likes_count ?? 0) > 0 && (
              <Text style={styles.likeOverlayCount}>{post.likes_count}</Text>
            )}
          </TouchableOpacity>
        </View>
      </TouchableOpacity>

      {/* Caption */}
      {post.caption ? (
        <Text style={styles.caption}>{post.caption}</Text>
      ) : null}

      {/* Tags — light blue pills */}
      {post.tags.length > 0 && (
        <View style={styles.tagsRow}>
          {post.tags.map(t => (
            <View key={t} style={styles.tagPill}>
              <Text style={styles.tagPillText}>#{t}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Footer: comment bubble only */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.footerBtn}
          onPress={handleCommentsTap}
          hitSlop={8}
          activeOpacity={0.7}
        >
          <Ionicons
            name={showComments ? 'chatbubble' : 'chatbubble-outline'}
            size={17}
            color={showComments ? Theme.colors.accent : 'rgba(0,0,0,0.38)'}
          />
          {(post.comments_count ?? 0) > 0 && (
            <Text style={styles.footerCount}>{post.comments_count}</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Expandable comments + input */}
      {showComments && (
        <View style={styles.commentsSection}>
          {loadingComments ? (
            <ActivityIndicator size="small" color={Theme.colors.accent} style={{ marginBottom: 8 }} />
          ) : (
            comments.slice(0, 2).map((c, i) => (
              <View key={c.id} style={[styles.commentRow, i > 0 && styles.commentRowBorder]}>
                <Text style={styles.commentLine} numberOfLines={2}>
                  <Text style={styles.commentAuthor}>@{c.profile?.username ?? 'unknown'} </Text>
                  {c.content}
                </Text>
              </View>
            ))
          )}
          {!loadingComments && (post.comments_count ?? 0) > 2 && (
            <TouchableOpacity onPress={onPress} hitSlop={8} style={{ marginTop: 6 }}>
              <Text style={styles.viewAll}>view all {post.comments_count} comments</Text>
            </TouchableOpacity>
          )}

          {/* Comment input */}
          {session && onComment && (
            <View style={styles.commentInputRow}>
              <TextInput
                style={styles.commentInput}
                placeholder="add a comment..."
                placeholderTextColor="rgba(0,0,0,0.30)"
                value={newComment}
                onChangeText={setNewComment}
                onSubmitEditing={handleSubmitComment}
                returnKeyType="send"
                blurOnSubmit={true}
                editable={!submittingComment}
              />
              {newComment.trim().length > 0 && (
                <TouchableOpacity onPress={handleSubmitComment} hitSlop={8}>
                  <Ionicons
                    name="arrow-up-circle"
                    size={24}
                    color={Theme.colors.accent}
                  />
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      )}
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

  likeOverlay: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.38)',
    borderRadius: 100,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  likeOverlayCount: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
    lineHeight: 14,
  },

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
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(90,143,168,0.18)',
  },
  tagPillText: {
    fontSize: Theme.font.xs,
    color: '#4A7A96',
    fontWeight: '600',
  },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.08)',
    marginTop: 6,
  },
  footerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  footerCount: {
    fontSize: Theme.font.xs,
    color: 'rgba(0,0,0,0.45)',
    fontWeight: '600',
  },

  commentsSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.07)',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 0,
  },
  commentRow: { paddingVertical: 4 },
  commentRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.06)',
  },
  commentAuthor: { fontWeight: '700', color: Theme.colors.primary },
  commentLine: { fontSize: Theme.font.xs, color: 'rgba(0,0,0,0.6)', lineHeight: 18 },
  viewAll: {
    fontSize: Theme.font.xs,
    color: 'rgba(0,0,0,0.38)',
    fontWeight: '600',
  },

  commentInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.07)',
    paddingTop: 10,
  },
  commentInput: {
    flex: 1,
    fontSize: Theme.font.xs,
    color: Theme.colors.primary,
    backgroundColor: Theme.colors.surface,
    borderRadius: 100,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
});
