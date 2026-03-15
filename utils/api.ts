import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { supabase } from "./supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  is_public: boolean;
  bio?: string | null;
  location?: string | null;
  style_tags?: string[];
  birth_date?: string | null;
  followers_count?: number;
  following_count?: number;
  created_at: string;
}

export interface Post {
  id: string;
  user_id: string;
  date: string; // YYYY-MM-DD
  photo_url: string; // Supabase Storage public URL
  caption: string | null;
  tags: string[];
  is_private?: boolean; // hidden from other users' feed; default false
  likes_count?: number;
  comments_count?: number;
  liked_by_me?: boolean;
  created_at: string;
  profile?: Pick<
    Profile,
    "username" | "display_name" | "avatar_url" | "is_public"
  >;
}

export interface Comment {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  created_at: string;
  parent_comment_id?: string | null;
  likes_count?: number;
  liked_by_me?: boolean;
  profile?: Pick<Profile, "username" | "display_name" | "avatar_url">;
}

export interface Community {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  created_by: string;
  is_private: boolean;
  created_at: string;
  member_count?: number;
  is_member?: boolean;
}

export interface WardrobeItem {
  id: string;
  user_id: string;
  label: string;
  description: string | null;
  ai_description: string | null;
  category: string | null;
  brand: string | null;
  link_url: string | null;
  generated_image_url: string | null;
  tags: string[];
  created_at: string;
  photos?: WardrobeItemPhoto[];
}

export interface WardrobeItemPhoto {
  id: string;
  item_id: string;
  photo_url: string;
  created_at: string;
}

export interface WardrobeSuggestion {
  id: string;
  user_id: string;
  new_item: WardrobeItem;
  existing_item: WardrobeItem;
  dismissed: boolean;
  created_at: string;
}

export interface FeedFilters {
  date?: string; // YYYY-MM-DD — filter to a specific day
  dateRange?: "week" | "month"; // relative range (mutually exclusive with date)
  communityId?: string;
  tag?: string;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function signUp(email: string, password: string) {
  return supabase.auth.signUp({ email, password });
}

export async function signIn(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  await AsyncStorage.removeItem("muse_onboarding_done");
  return supabase.auth.signOut();
}

export async function deleteAccount(): Promise<void> {
  // Delete communities created by this user first to avoid FK constraint violations
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    await supabase.from("communities").delete().eq("created_by", user.id);
  }
  const { error } = await supabase.rpc("delete_user");
  if (error) throw error;
  await AsyncStorage.removeItem("muse_onboarding_done");
  await supabase.auth.signOut();
}

// Phone OTP auth (requires Supabase SMS provider configured in dashboard)
export async function sendPhoneOTP(phone: string) {
  return supabase.auth.signInWithOtp({ phone });
}

export async function verifyPhoneOTP(phone: string, token: string) {
  return supabase.auth.verifyOtp({ phone, token, type: "sms" });
}

// Link a phone number to an existing email account
export async function sendPhoneLinkOTP(phone: string) {
  return supabase.auth.updateUser({ phone });
}

export async function verifyPhoneLink(phone: string, token: string) {
  return supabase.auth.verifyOtp({ phone, token, type: "phone_change" });
}

export async function checkUsernameAvailable(
  username: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", username.toLowerCase())
    .maybeSingle();
  return data === null;
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// ─── Profile ──────────────────────────────────────────────────────────────────

export async function getMyProfile(): Promise<Profile | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  if (data) return data;
  // Profile row missing — create a bare-minimum row; onboarding will fill display_name/username
  const { data: created } = await supabase
    .from("profiles")
    .insert({ id: user.id, username: user.id, display_name: null })
    .select()
    .single();
  return created;
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  return data;
}

export async function updateProfile(
  userId: string,
  updates: Partial<
    Pick<
      Profile,
      | "username"
      | "display_name"
      | "avatar_url"
      | "is_public"
      | "bio"
      | "location"
      | "style_tags"
      | "birth_date"
    >
  >,
) {
  const { data, error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", userId)
    .select()
    .single();
  if (error) throw error;
  return data as Profile;
}

export async function uploadAvatar(
  userId: string,
  localUri: string,
): Promise<string> {
  const ext = localUri.split(".").pop()?.split("?")[0] ?? "jpg";
  const path = `avatars/${userId}.${ext}`;
  const fileData = await uriToBlob(localUri);
  const { error } = await supabase.storage
    .from("outfit-photos")
    .upload(path, fileData, { upsert: true, contentType: `image/${ext}` });
  if (error) throw error;
  const { data } = supabase.storage.from("outfit-photos").getPublicUrl(path);
  return data.publicUrl;
}

// ─── Follows ──────────────────────────────────────────────────────────────────

export async function followUser(userId: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("not logged in");
  const { error } = await supabase
    .from("follows")
    .insert({ follower_id: user.id, following_id: userId });
  if (error) throw error;
}

export async function unfollowUser(userId: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("not logged in");
  const { error } = await supabase
    .from("follows")
    .delete()
    .eq("follower_id", user.id)
    .eq("following_id", userId);
  if (error) throw error;
}

export async function isFollowing(userId: string): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from("follows")
    .select("follower_id")
    .eq("follower_id", user.id)
    .eq("following_id", userId)
    .maybeSingle();
  return !!data;
}

// ─── Posts ────────────────────────────────────────────────────────────────────

export async function getMyPosts(): Promise<Post[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("posts")
    .select("*")
    .eq("user_id", user.id)
    .order("date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Post[];
}

export async function getPostsByUser(userId: string): Promise<Post[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("posts")
    .select(
      "*, profile:profiles!posts_user_id_fkey(username, display_name, avatar_url, is_public)",
    )
    .eq("user_id", userId)
    .eq("is_private", false)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const posts = (data ?? []) as Post[];
  if (user && posts.length > 0) {
    const postIds = posts.map((p) => p.id);
    const { data: likedRows } = await supabase
      .from("likes")
      .select("post_id")
      .eq("user_id", user.id)
      .in("post_id", postIds);
    const likedSet = new Set((likedRows ?? []).map((r: any) => r.post_id));
    return posts.map((p) => ({ ...p, liked_by_me: likedSet.has(p.id) }));
  }
  return posts;
}

export async function getPost(
  userId: string,
  date: string,
): Promise<Post | null> {
  const { data } = await supabase
    .from("posts")
    .select(
      "*, profile:profiles(username, display_name, avatar_url, is_public)",
    )
    .eq("user_id", userId)
    .eq("date", date)
    .single();
  if (!data) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data: likeRow } = await supabase
      .from("likes")
      .select("post_id")
      .eq("post_id", data.id)
      .eq("user_id", user.id)
      .maybeSingle();
    return { ...data, liked_by_me: !!likeRow } as Post;
  }
  return data as Post;
}

export async function upsertPost(
  date: string,
  photoUri: string,
  caption: string,
  tags: string[],
  isPrivate: boolean = false,
): Promise<Post> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("not logged in");

  // Upload photo
  const photoUrl = await uploadPhoto(user.id, date, photoUri);

  const { data, error } = await supabase
    .from("posts")
    .upsert(
      {
        user_id: user.id,
        date,
        photo_url: photoUrl,
        caption: caption.trim() || null,
        tags,
        is_private: isPrivate,
      },
      { onConflict: "user_id,date" },
    )
    .select()
    .single();
  if (error) throw error;
  return data as Post;
}

export async function updatePostMeta(
  postId: string,
  updates: { caption?: string | null; tags?: string[]; is_private?: boolean },
): Promise<Post> {
  const { data, error } = await supabase
    .from("posts")
    .update(updates)
    .eq("id", postId)
    .select()
    .single();
  if (error) throw error;
  return data as Post;
}

export async function deletePost(postId: string): Promise<void> {
  const { error } = await supabase.from("posts").delete().eq("id", postId);
  if (error) throw error;
}

// ─── Feed ─────────────────────────────────────────────────────────────────────

export async function getFeed(filters: FeedFilters = {}): Promise<Post[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let query = supabase
    .from("posts")
    .select(
      "*, profile:profiles!posts_user_id_fkey(username, display_name, avatar_url, is_public)",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  // Exclude all private posts from the feed (for everyone, including the owner)
  query = query.eq("is_private", false);

  if (filters.date) {
    query = query.eq("date", filters.date);
  } else if (filters.dateRange === "week") {
    const since = new Date();
    since.setDate(since.getDate() - 7);
    query = query.gte("date", since.toISOString().slice(0, 10));
  } else if (filters.dateRange === "month") {
    const since = new Date();
    since.setMonth(since.getMonth() - 1);
    query = query.gte("date", since.toISOString().slice(0, 10));
  }

  if (filters.tag) {
    query = query.contains("tags", [filters.tag]);
  }

  if (filters.communityId) {
    // Get member IDs of this community, then filter posts
    const { data: members } = await supabase
      .from("community_members")
      .select("user_id")
      .eq("community_id", filters.communityId);
    const memberIds = (members ?? []).map(
      (m: { user_id: string }) => m.user_id,
    );
    if (memberIds.length === 0) return [];
    query = query.in("user_id", memberIds);
  }

  const { data, error } = await query;
  if (error) throw error;
  const allPosts = (data ?? []) as Post[];
  // Exclude posts from private-profile users (unless it's your own post)
  const posts = allPosts.filter(
    (p) => p.profile?.is_public === true || p.user_id === user?.id,
  );
  if (user && posts.length > 0) {
    const postIds = posts.map((p) => p.id);
    const { data: likedRows, error: likesErr } = await supabase
      .from("likes")
      .select("post_id")
      .eq("user_id", user.id)
      .in("post_id", postIds);
    if (likesErr) {
      console.warn("liked_by_me fetch error:", likesErr.message);
      return posts;
    }
    const likedSet = new Set((likedRows ?? []).map((r: any) => r.post_id));
    return posts.map((p) => ({ ...p, liked_by_me: likedSet.has(p.id) }));
  }
  return posts;
}

// ─── Communities ──────────────────────────────────────────────────────────────

export async function getMyCommunities(): Promise<Community[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("community_members")
    .select("community:communities(*)")
    .eq("user_id", user.id);
  if (error) throw error;
  return (data ?? []).map((row: any) => row.community) as Community[];
}

export async function getAllCommunities(): Promise<Community[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("communities")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;

  if (!user || !data) return (data ?? []) as Community[];

  // Mark which ones the user is already a member of
  const { data: memberships } = await supabase
    .from("community_members")
    .select("community_id")
    .eq("user_id", user.id);
  const memberSet = new Set(
    (memberships ?? []).map((m: any) => m.community_id),
  );
  return data.map((c) => ({
    ...c,
    is_member: memberSet.has(c.id),
  })) as Community[];
}

export async function getCommunity(id: string): Promise<Community | null> {
  const { data, error } = await supabase
    .from("communities")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { count } = await supabase
    .from("community_members")
    .select("*", { count: "exact", head: true })
    .eq("community_id", id);

  let is_member = false;
  if (user) {
    const { data: mem } = await supabase
      .from("community_members")
      .select("user_id")
      .eq("community_id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    is_member = !!mem;
  }

  return { ...data, member_count: count ?? 0, is_member } as Community;
}

export async function joinCommunity(communityId: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("not logged in");
  const { error } = await supabase
    .from("community_members")
    .insert({ community_id: communityId, user_id: user.id });
  if (error) throw error;
}

export async function leaveCommunity(communityId: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("not logged in");
  const { error } = await supabase
    .from("community_members")
    .delete()
    .eq("community_id", communityId)
    .eq("user_id", user.id);
  if (error) throw error;
}

export async function deleteCommunity(communityId: string): Promise<void> {
  const { error } = await supabase
    .from("communities")
    .delete()
    .eq("id", communityId);
  if (error) throw error;
}

export async function createCommunity(input: {
  name: string;
  slug: string;
  description: string;
}): Promise<Community> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("not logged in");
  const { data, error } = await supabase
    .from("communities")
    .insert({ ...input, created_by: user.id })
    .select()
    .single();
  if (error) throw error;
  // Auto-join as admin
  await supabase
    .from("community_members")
    .insert({ community_id: data.id, user_id: user.id, role: "admin" });
  return data as Community;
}

export async function getCommunityPosts(communityId: string): Promise<Post[]> {
  const [
    { data: members },
    {
      data: { user },
    },
  ] = await Promise.all([
    supabase
      .from("community_members")
      .select("user_id")
      .eq("community_id", communityId),
    supabase.auth.getUser(),
  ]);
  const memberIds = (members ?? []).map((m: any) => m.user_id);
  if (memberIds.length === 0) return [];

  let query = supabase
    .from("posts")
    .select(
      "*, profile:profiles!posts_user_id_fkey(username, display_name, avatar_url, is_public)",
    )
    .in("user_id", memberIds)
    .order("created_at", { ascending: false });

  query = query.eq("is_private", false);

  const { data, error } = await query;
  if (error) throw error;
  const allPosts = (data ?? []) as Post[];
  // Exclude posts from private-profile users (unless it's your own post)
  const posts = allPosts.filter(
    (p) => p.profile?.is_public === true || p.user_id === user?.id,
  );
  if (user && posts.length > 0) {
    const postIds = posts.map((p) => p.id);
    const { data: likedRows, error: likesErr } = await supabase
      .from("likes")
      .select("post_id")
      .eq("user_id", user.id)
      .in("post_id", postIds);
    if (likesErr) {
      console.warn("liked_by_me fetch error:", likesErr.message);
      return posts;
    }
    const likedSet = new Set((likedRows ?? []).map((r: any) => r.post_id));
    return posts.map((p) => ({ ...p, liked_by_me: likedSet.has(p.id) }));
  }
  return posts;
}

// ─── Likes ────────────────────────────────────────────────────────────────────

export async function likePost(postId: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("not logged in");
  const { error } = await supabase
    .from("likes")
    .insert({ post_id: postId, user_id: user.id });
  if (error) throw error;
}

export async function unlikePost(postId: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("not logged in");
  const { error } = await supabase
    .from("likes")
    .delete()
    .eq("post_id", postId)
    .eq("user_id", user.id);
  if (error) throw error;
}

export async function getPostLikers(postId: string): Promise<Profile[]> {
  const { data: likeRows, error: likesErr } = await supabase
    .from("likes")
    .select("user_id, created_at")
    .eq("post_id", postId)
    .order("created_at", { ascending: false });
  if (likesErr) throw likesErr;
  if (!likeRows || likeRows.length === 0) return [];
  const userIds = likeRows.map((r: any) => r.user_id);
  const { data: profiles, error: profilesErr } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, is_public, created_at")
    .in("id", userIds);
  if (profilesErr) throw profilesErr;
  const profileMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]));
  return userIds.map((id: string) => profileMap[id]).filter(Boolean) as Profile[];
}

// ─── Comments ─────────────────────────────────────────────────────────────────

export async function getComments(postId: string): Promise<Comment[]> {
  const { data, error } = await supabase
    .from("comments")
    .select("*")
    .eq("post_id", postId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const comments = (data ?? []) as Comment[];
  if (comments.length === 0) return comments;

  const userIds = [...new Set(comments.map((c) => c.user_id))];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url")
    .in("id", userIds);
  const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
  const withProfiles = comments.map((c) => ({ ...c, profile: profileMap.get(c.user_id) }));

  // Attach liked_by_me for current user (requires comment_likes table migration)
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      const commentIds = comments.map((c) => c.id);
      const { data: myLikes } = await supabase
        .from("comment_likes")
        .select("comment_id")
        .in("comment_id", commentIds)
        .eq("user_id", session.user.id);
      const likedSet = new Set((myLikes ?? []).map((l: any) => l.comment_id));
      return withProfiles.map((c) => ({ ...c, liked_by_me: likedSet.has(c.id) }));
    }
  } catch { /* comment_likes table may not exist yet */ }

  return withProfiles;
}

export async function likeComment(commentId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not logged in");
  const { error } = await supabase
    .from("comment_likes")
    .insert({ comment_id: commentId, user_id: user.id });
  if (error) throw error;
}

export async function unlikeComment(commentId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not logged in");
  const { error } = await supabase
    .from("comment_likes")
    .delete()
    .eq("comment_id", commentId)
    .eq("user_id", user.id);
  if (error) throw error;
}

export async function addComment(
  postId: string,
  content: string,
  parentCommentId?: string,
): Promise<Comment> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("not logged in");
  const insertData: Record<string, unknown> = {
    post_id: postId,
    user_id: user.id,
    content: content.trim(),
  };
  if (parentCommentId) insertData.parent_comment_id = parentCommentId;
  const { data, error } = await supabase
    .from("comments")
    .insert(insertData)
    .select()
    .single();
  if (error) throw error;
  return data as Comment;
}

export async function deleteComment(commentId: string): Promise<void> {
  const { error } = await supabase
    .from("comments")
    .delete()
    .eq("id", commentId);
  if (error) throw error;
}

// ─── Wardrobe (AI-powered closet) ────────────────────────────────────────────

export async function createWardrobeItem(label: string): Promise<WardrobeItem> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not logged in');
  const { data, error } = await supabase
    .from('wardrobe_items')
    .insert({ user_id: user.id, label })
    .select().single();
  if (error) throw error;
  return data as WardrobeItem;
}

export async function getWardrobeItems(userId: string): Promise<WardrobeItem[]> {
  const { data, error } = await supabase
    .from('wardrobe_items')
    .select('*, photos:wardrobe_item_photos(*)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as WardrobeItem[];
}

export async function getWardrobeItem(id: string): Promise<WardrobeItem | null> {
  const { data } = await supabase
    .from('wardrobe_items')
    .select('*, photos:wardrobe_item_photos(*)')
    .eq('id', id)
    .single();
  return data as WardrobeItem | null;
}

export async function updateWardrobeItem(
  id: string,
  updates: { label?: string; description?: string | null; link_url?: string | null; category?: string | null; brand?: string | null; tags?: string[] },
): Promise<WardrobeItem> {
  const { data, error } = await supabase
    .from('wardrobe_items').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data as WardrobeItem;
}

export async function deleteWardrobeItem(id: string): Promise<void> {
  const { error } = await supabase.from('wardrobe_items').delete().eq('id', id);
  if (error) throw error;
}

export async function addWardrobeItemPhoto(
  itemId: string,
  localUri: string,
): Promise<WardrobeItemPhoto> {
  const ext = localUri.split('.').pop()?.split('?')[0] ?? 'jpg';
  const path = `wardrobe/${itemId}/${Date.now()}.${ext}`;
  const fileData = await uriToBlob(localUri);
  const { error: uploadErr } = await supabase.storage
    .from('outfit-photos')
    .upload(path, fileData, { contentType: `image/${ext}` });
  if (uploadErr) throw uploadErr;
  const { data: { publicUrl } } = supabase.storage.from('outfit-photos').getPublicUrl(path);
  const { data, error } = await supabase
    .from('wardrobe_item_photos')
    .insert({ item_id: itemId, photo_url: publicUrl })
    .select().single();
  if (error) throw error;
  const photo = data as WardrobeItemPhoto;
  // Fire-and-forget background removal (requires REMOVEBG_API_KEY secret in edge function)
  supabase.functions.invoke('analyze-outfit', {
    body: { action: 'processBackground', photoId: photo.id },
  }).catch(() => {});
  return photo;
}

export async function scanOutfit(
  postId: string,
  photoUrl: string,
  knownItems?: Array<{ id: string; label: string; ai_description: string | null }>,
): Promise<WardrobeItem[]> {
  const { data: { session } } = await supabase.auth.getSession();
  const { data, error } = await supabase.functions.invoke('analyze-outfit', {
    body: { action: 'scan', postId, photoUrl, knownItems },
    headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return (data?.items ?? []) as WardrobeItem[];
}

export async function generateItemImage(itemId: string): Promise<WardrobeItem> {
  const { data: { session } } = await supabase.auth.getSession();
  const { data, error } = await supabase.functions.invoke('analyze-outfit', {
    body: { action: 'generate', itemId },
    headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data.item as WardrobeItem;
}

export async function getPostWardrobeItems(postId: string): Promise<WardrobeItem[]> {
  const { data, error } = await supabase
    .from('post_wardrobe_items')
    .select('item:wardrobe_items(*)')
    .eq('post_id', postId);
  if (error) throw error;
  return (data ?? []).map((row: any) => row.item).filter(Boolean) as WardrobeItem[];
}

export async function removePostWardrobeItem(postId: string, itemId: string): Promise<void> {
  const { error } = await supabase
    .from('post_wardrobe_items')
    .delete()
    .eq('post_id', postId)
    .eq('wardrobe_item_id', itemId);
  if (error) throw error;
}

export async function addPostWardrobeItem(postId: string, itemId: string): Promise<void> {
  const { error } = await supabase
    .from('post_wardrobe_items')
    .upsert({ post_id: postId, wardrobe_item_id: itemId });
  if (error) throw error;
}

export async function mergeWardrobeItems(
  keepId: string,
  deleteId: string,
  useOtherImage: boolean,
): Promise<void> {
  // Fetch both items to merge metadata
  const [{ data: keepData }, { data: deleteData }] = await Promise.all([
    supabase.from('wardrobe_items').select('brand, description, link_url, generated_image_url').eq('id', keepId).single(),
    supabase.from('wardrobe_items').select('brand, description, link_url, generated_image_url').eq('id', deleteId).single(),
  ]);

  // Build update: swap image if requested; fill null brand/notes/link from the deleted item
  const updates: Record<string, any> = {};
  if (useOtherImage && deleteData?.generated_image_url) {
    updates.generated_image_url = deleteData.generated_image_url;
  }
  if (!keepData?.brand && deleteData?.brand) updates.brand = deleteData.brand;
  if (!keepData?.description && deleteData?.description) updates.description = deleteData.description;
  if (!keepData?.link_url && deleteData?.link_url) updates.link_url = deleteData.link_url;

  if (Object.keys(updates).length > 0) {
    await supabase.from('wardrobe_items').update(updates).eq('id', keepId);
  }

  // Re-link all posts from the deleted item to the kept item (skip conflicts)
  const { data: links } = await supabase
    .from('post_wardrobe_items').select('post_id').eq('wardrobe_item_id', deleteId);
  if (links && links.length > 0) {
    await supabase.from('post_wardrobe_items').upsert(
      links.map((l: any) => ({ post_id: l.post_id, wardrobe_item_id: keepId })),
      { onConflict: 'post_id,wardrobe_item_id', ignoreDuplicates: true },
    );
  }

  // Delete the other item (cascades its post_wardrobe_items and photos)
  const { error } = await supabase.from('wardrobe_items').delete().eq('id', deleteId);
  if (error) throw error;
}

export async function getWardrobeSuggestions(userId: string): Promise<WardrobeSuggestion[]> {
  const { data, error } = await supabase
    .from('wardrobe_suggestions')
    .select(`
      id, user_id, dismissed, created_at,
      new_item:wardrobe_items!wardrobe_suggestions_new_item_id_fkey(*),
      existing_item:wardrobe_items!wardrobe_suggestions_existing_item_id_fkey(*)
    `)
    .eq('user_id', userId)
    .eq('dismissed', false)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as WardrobeSuggestion[];
}

export async function dismissWardrobeSuggestion(id: string): Promise<void> {
  const { error } = await supabase
    .from('wardrobe_suggestions')
    .update({ dismissed: true })
    .eq('id', id);
  if (error) throw error;
}

export async function getItemPosts(itemId: string): Promise<Post[]> {
  const { data, error } = await supabase
    .from('post_wardrobe_items')
    .select('post:posts(id, date, photo_url, user_id, caption, tags, is_private, likes_count, comments_count, created_at)')
    .eq('wardrobe_item_id', itemId);
  if (error) throw error;
  const posts = (data ?? []).map((row: any) => row.post).filter(Boolean) as Post[];
  return posts.sort((a, b) => b.date.localeCompare(a.date));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function uploadPhoto(
  userId: string,
  date: string,
  localUri: string,
): Promise<string> {
  // Confirm session is active before attempting storage upload
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session)
    throw new Error("not logged in — please sign out and sign back in");

  const path = `posts/${userId}/${date}.jpg`;
  const fileData = await uriToBlob(localUri);
  // Remove existing file first (ignore error if it doesn't exist), then insert fresh
  await supabase.storage.from("outfit-photos").remove([path]);
  const { error } = await supabase.storage
    .from("outfit-photos")
    .upload(path, fileData, { contentType: "image/jpeg" });
  if (error)
    throw new Error(
      `storage [uid=${session.user.id.slice(0, 8)} path=${path}]: ${error.message}`,
    );
  const { data } = supabase.storage.from("outfit-photos").getPublicUrl(path);
  return data.publicUrl;
}

async function uriToBlob(uri: string): Promise<ArrayBuffer | Blob> {
  const response = await fetch(uri);
  // On native, arrayBuffer() sends raw bytes through Supabase's FormData upload
  // without going through React Native's Blob serialization (which loses the data).
  // On web, blob() is fine and more efficient.
  if (Platform.OS === "web") return response.blob();
  return response.arrayBuffer();
}
