import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { supabase } from "./supabase";
import { calculateStreak } from "./dates";

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
  share_closet?: boolean;
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
  saved_by_me?: boolean;
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
  avatar_url: string | null;
  created_at: string;
  member_count?: number;
  is_member?: boolean;
  join_status?: 'member' | 'pending' | 'none';
}

export interface AppNotification {
  id: string;
  type: 'like' | 'comment' | 'new_follower' | 'streak' | 'follow_accepted' | 'community_invite' | 'community_accepted';
  actor_id: string | null;
  post_id: string | null;
  data: Record<string, any>;
  is_read: boolean;
  created_at: string;
  actor?: Pick<Profile, 'id' | 'username' | 'display_name' | 'avatar_url'>;
}

export interface CommunityRequest {
  id: string;
  community_id: string;
  user_id: string;
  created_at: string;
  profile: Pick<Profile, 'id' | 'username' | 'display_name' | 'avatar_url'>;
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
  search?: string; // free text — matches caption, tags, username
  explore?: boolean; // when true, show all public posts (not just followed)
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
      | "share_closet"
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
  await supabase.storage.from("outfit-photos").remove([path]);
  const { error } = await supabase.storage
    .from("outfit-photos")
    .upload(path, fileData, { contentType: `image/${ext}` });
  if (error) throw error;
  const { data } = supabase.storage.from("outfit-photos").getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
}

export async function uploadCommunityAvatar(
  communityId: string,
  localUri: string,
): Promise<string> {
  const path = `communities/${communityId}.jpg`;
  const fileData = await uriToBlob(localUri);
  await supabase.storage.from('outfit-photos').remove([path]);
  const { error } = await supabase.storage
    .from('outfit-photos')
    .upload(path, fileData, { contentType: 'image/jpeg' });
  if (error) throw error;
  const { data } = supabase.storage.from('outfit-photos').getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
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

export async function getFollowers(userId: string): Promise<Profile[]> {
  const { data } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('following_id', userId);
  if (!data?.length) return [];
  const ids = data.map(r => r.follower_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('*')
    .in('id', ids);
  return (profiles ?? []) as Profile[];
}

export async function getFollowing(userId: string): Promise<Profile[]> {
  const { data } = await supabase
    .from('follows')
    .select('following_id')
    .eq('follower_id', userId);
  if (!data?.length) return [];
  const ids = data.map(r => r.following_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('*')
    .in('id', ids);
  return (profiles ?? []) as Profile[];
}

export async function getMutualFollows(): Promise<Profile[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const [{ data: followers }, { data: following }] = await Promise.all([
    supabase.from('follows').select('follower_id').eq('following_id', user.id),
    supabase.from('follows').select('following_id').eq('follower_id', user.id),
  ]);
  const followerIds = new Set((followers ?? []).map(r => r.follower_id));
  const mutualIds = (following ?? []).map(r => r.following_id).filter(id => followerIds.has(id));
  if (!mutualIds.length) return [];
  const { data: profiles } = await supabase.from('profiles').select('*').in('id', mutualIds);
  return (profiles ?? []) as Profile[];
}

// ─── Follow Requests ──────────────────────────────────────────────────────────

export async function getFollowStatus(userId: string): Promise<'following' | 'pending' | 'none'> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 'none';
  const [{ data: follow }, { data: request }] = await Promise.all([
    supabase.from('follows').select('follower_id').eq('follower_id', user.id).eq('following_id', userId).maybeSingle(),
    supabase.from('follow_requests').select('id').eq('requester_id', user.id).eq('requested_id', userId).maybeSingle(),
  ]);
  if (follow) return 'following';
  if (request) return 'pending';
  return 'none';
}

export async function sendFollowRequest(userId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not logged in');
  const { error } = await supabase.from('follow_requests').insert({ requester_id: user.id, requested_id: userId });
  if (error) throw error;
}

export async function cancelFollowRequest(userId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not logged in');
  const { error } = await supabase.from('follow_requests').delete().eq('requester_id', user.id).eq('requested_id', userId);
  if (error) throw error;
}

export interface FollowRequest {
  id: string;
  requester_id: string;
  created_at: string;
  profile: Pick<Profile, 'id' | 'username' | 'display_name' | 'avatar_url'>;
}

export async function getPendingFollowRequests(): Promise<FollowRequest[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data: rows, error } = await supabase
    .from('follow_requests')
    .select('id, requester_id, created_at')
    .eq('requested_id', user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  if (!rows || rows.length === 0) return [];

  const requesterIds = rows.map(r => r.requester_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .in('id', requesterIds);
  const profileMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p]));

  return rows.map(r => ({ ...r, profile: profileMap[r.requester_id] ?? { id: r.requester_id, username: 'unknown', display_name: null, avatar_url: null } }));
}

export async function resolveFollowRequest(requesterId: string, accept: boolean): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not logged in');
  if (accept) {
    const { error } = await supabase.from('follows').insert({ follower_id: requesterId, following_id: user.id });
    if (error) throw error;
    // notify the requester that their follow was accepted
    await supabase.from('notifications').insert({
      user_id: requesterId,
      type: 'follow_accepted',
      actor_id: user.id,
    });
  }
  await supabase.from('follow_requests').delete().eq('requester_id', requesterId).eq('requested_id', user.id);
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
    const [{ data: likedRows }, { data: savedRows }] = await Promise.all([
      supabase.from("likes").select("post_id").eq("user_id", user.id).in("post_id", postIds),
      supabase.from("saves").select("post_id").eq("user_id", user.id).in("post_id", postIds),
    ]);
    const likedSet = new Set((likedRows ?? []).map((r: any) => r.post_id));
    const savedSet = new Set((savedRows ?? []).map((r: any) => r.post_id));
    return posts.map((p) => ({ ...p, liked_by_me: likedSet.has(p.id), saved_by_me: savedSet.has(p.id) }));
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
  checkStreakMilestone(user.id).catch(() => {});
  return data as Post;
}

async function checkStreakMilestone(userId: string): Promise<void> {
  const { data: posts } = await supabase.from('posts').select('date').eq('user_id', userId);
  const streak = calculateStreak(posts ?? []);
  const isMilestone =
    (streak >= 2 && streak <= 10) ||
    (streak > 10 && streak <= 100 && streak % 5 === 0) ||
    (streak > 100 && streak % 10 === 0);
  if (isMilestone) {
    await supabase.from('notifications').insert({
      user_id: userId, type: 'streak', data: { count: streak },
    });
  }
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

const FEED_PAGE_SIZE = 20;

export async function getFeed(filters: FeedFilters = {}, cursor?: string): Promise<{ posts: Post[]; nextCursor?: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Build the set of user IDs whose posts should appear in the feed:
  // people you follow + members of your communities + yourself
  const feedUserIds = new Set<string>();
  if (user) {
    feedUserIds.add(user.id);
    const [{ data: following }, { data: myMemberships }] = await Promise.all([
      supabase.from('follows').select('following_id').eq('follower_id', user.id),
      supabase.from('community_members').select('community_id').eq('user_id', user.id),
    ]);
    (following ?? []).forEach((r: any) => feedUserIds.add(r.following_id));

    if (myMemberships?.length) {
      const communityIds = myMemberships.map((m: any) => m.community_id);
      const { data: communityMembers } = await supabase
        .from('community_members')
        .select('user_id')
        .in('community_id', communityIds);
      (communityMembers ?? []).forEach((m: any) => feedUserIds.add(m.user_id));
    }
  }

  let query = supabase
    .from("posts")
    .select(
      "*, profile:profiles!posts_user_id_fkey(username, display_name, avatar_url, is_public)",
    )
    .order("created_at", { ascending: false })
    .limit(FEED_PAGE_SIZE + 1); // fetch one extra to detect if there's a next page

  // Exclude all private posts from the feed (for everyone, including the owner)
  query = query.eq("is_private", false);

  // Cursor-based pagination
  if (cursor) {
    query = query.lt("created_at", cursor);
  }

  // Only show posts from followed users + community members (unless exploring)
  if (!filters.explore && feedUserIds.size > 0) {
    query = query.in("user_id", [...feedUserIds]);
  }

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
    // Further narrow to just this community's members
    const { data: members } = await supabase
      .from("community_members")
      .select("user_id")
      .eq("community_id", filters.communityId);
    const memberIds = (members ?? []).map(
      (m: { user_id: string }) => m.user_id,
    );
    if (memberIds.length === 0) return { posts: [], nextCursor: undefined };
    query = query.in("user_id", memberIds);
  }

  const { data, error } = await query;
  if (error) throw error;
  const allPosts = (data ?? []) as Post[];

  // Check if there's a next page
  const hasMore = allPosts.length > FEED_PAGE_SIZE;
  const pagePosts = hasMore ? allPosts.slice(0, FEED_PAGE_SIZE) : allPosts;

  // Exclude posts from private-profile users (unless it's your own post)
  let posts = pagePosts.filter(
    (p) => p.profile?.is_public === true || p.user_id === user?.id,
  );

  // Client-side search filtering
  if (filters.search) {
    const q = filters.search.toLowerCase();
    posts = posts.filter(p =>
      (p.caption?.toLowerCase().includes(q)) ||
      (p.tags ?? []).some(t => t.toLowerCase().includes(q)) ||
      (p.profile?.username?.toLowerCase().includes(q)) ||
      (p.profile?.display_name?.toLowerCase().includes(q))
    );
  }

  const nextCursor = hasMore ? pagePosts[pagePosts.length - 1].created_at : undefined;

  if (user && posts.length > 0) {
    const postIds = posts.map((p) => p.id);
    const [{ data: likedRows, error: likesErr }, { data: savedRows }] = await Promise.all([
      supabase.from("likes").select("post_id").eq("user_id", user.id).in("post_id", postIds),
      supabase.from("saves").select("post_id").eq("user_id", user.id).in("post_id", postIds),
    ]);
    if (likesErr) {
      console.warn("liked_by_me fetch error:", likesErr.message);
      return { posts, nextCursor };
    }
    const likedSet = new Set((likedRows ?? []).map((r: any) => r.post_id));
    const savedSet = new Set((savedRows ?? []).map((r: any) => r.post_id));
    return { posts: posts.map((p) => ({ ...p, liked_by_me: likedSet.has(p.id), saved_by_me: savedSet.has(p.id) })), nextCursor };
  }
  return { posts, nextCursor };
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
  const communities = (data ?? []).map((row: any) => row.community) as Community[];
  if (communities.length === 0) return communities;

  // Order by most recent post from community members
  const communityIds = communities.map(c => c.id);
  const { data: memberRows } = await supabase
    .from("community_members")
    .select("community_id, user_id")
    .in("community_id", communityIds);
  const membersByCommunity = new Map<string, string[]>();
  for (const r of (memberRows ?? []) as any[]) {
    const arr = membersByCommunity.get(r.community_id) ?? [];
    arr.push(r.user_id);
    membersByCommunity.set(r.community_id, arr);
  }
  const allMemberIds = [...new Set((memberRows ?? []).map((r: any) => r.user_id))];
  const { data: recentPosts } = await supabase
    .from("posts")
    .select("user_id, created_at")
    .in("user_id", allMemberIds)
    .order("created_at", { ascending: false })
    .limit(200);

  // Find most recent post date per community
  const latestByCommunity = new Map<string, string>();
  for (const [cid, members] of membersByCommunity) {
    const memberSet = new Set(members);
    for (const post of (recentPosts ?? []) as any[]) {
      if (memberSet.has(post.user_id)) {
        latestByCommunity.set(cid, post.created_at);
        break;
      }
    }
  }

  return communities.sort((a, b) => {
    const aDate = latestByCommunity.get(a.id) ?? '';
    const bDate = latestByCommunity.get(b.id) ?? '';
    return bDate.localeCompare(aDate);
  });
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

  // Fetch member counts
  const { data: countRows } = await supabase
    .from('community_members')
    .select('community_id');
  const countMap: Record<string, number> = {};
  (countRows ?? []).forEach((r: any) => { countMap[r.community_id] = (countMap[r.community_id] ?? 0) + 1; });

  const [{ data: memberships }, { data: requests }] = await Promise.all([
    supabase.from("community_members").select("community_id").eq("user_id", user.id),
    supabase.from("community_requests").select("community_id").eq("user_id", user.id),
  ]);
  const memberSet = new Set((memberships ?? []).map((m: any) => m.community_id));
  const pendingSet = new Set((requests ?? []).map((r: any) => r.community_id));
  const mapped = data.map((c) => ({
    ...c,
    member_count: countMap[c.id] ?? 0,
    is_member: memberSet.has(c.id),
    join_status: memberSet.has(c.id) ? 'member' : pendingSet.has(c.id) ? 'pending' : 'none',
  })) as Community[];
  // Show user's communities first, then sort by member count
  mapped.sort((a, b) => {
    const aMe = a.is_member ? 1 : 0;
    const bMe = b.is_member ? 1 : 0;
    if (aMe !== bMe) return bMe - aMe;
    return (b.member_count ?? 0) - (a.member_count ?? 0);
  });
  return mapped;
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
  is_private?: boolean;
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

export async function updateCommunity(id: string, updates: { is_private?: boolean; name?: string; description?: string | null; avatar_url?: string | null }): Promise<Community> {
  const { data, error } = await supabase
    .from('communities')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
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
    const [{ data: likedRows, error: likesErr }, { data: savedRows }] = await Promise.all([
      supabase.from("likes").select("post_id").eq("user_id", user.id).in("post_id", postIds),
      supabase.from("saves").select("post_id").eq("user_id", user.id).in("post_id", postIds),
    ]);
    if (likesErr) {
      console.warn("liked_by_me fetch error:", likesErr.message);
      return posts;
    }
    const likedSet = new Set((likedRows ?? []).map((r: any) => r.post_id));
    const savedSet = new Set((savedRows ?? []).map((r: any) => r.post_id));
    return posts.map((p) => ({ ...p, liked_by_me: likedSet.has(p.id), saved_by_me: savedSet.has(p.id) }));
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
  // remove the like notification
  await supabase
    .from("notifications")
    .delete()
    .eq("type", "like")
    .eq("actor_id", user.id)
    .eq("post_id", postId);
}

// ─── Saves ────────────────────────────────────────────────────────────────────

export async function savePost(postId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not logged in");
  const { error } = await supabase.from("saves").insert({ post_id: postId, user_id: user.id });
  if (error) throw error;
}

export async function unsavePost(postId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not logged in");
  const { error } = await supabase.from("saves").delete().eq("post_id", postId).eq("user_id", user.id);
  if (error) throw error;
}

export async function getSavedPosts(): Promise<Post[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data: saveRows, error } = await supabase
    .from("saves")
    .select("post_id, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error || !saveRows || saveRows.length === 0) return [];
  const postIds = saveRows.map((r: any) => r.post_id);
  const { data, error: postsErr } = await supabase
    .from("posts")
    .select("*, profile:profiles!posts_user_id_fkey(username, display_name, avatar_url, is_public)")
    .in("id", postIds)
    .eq("is_private", false);
  if (postsErr) throw postsErr;
  const posts = (data ?? []) as Post[];
  // Attach liked_by_me and saved_by_me
  const { data: likedRows } = await supabase.from("likes").select("post_id").eq("user_id", user.id).in("post_id", postIds);
  const likedSet = new Set((likedRows ?? []).map((r: any) => r.post_id));
  const savedSet = new Set(postIds);
  // Preserve save order
  const orderMap = new Map(saveRows.map((r: any, i: number) => [r.post_id, i]));
  return posts
    .map((p) => ({ ...p, liked_by_me: likedSet.has(p.id), saved_by_me: savedSet.has(p.id) }))
    .sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
}

export async function saveWardrobeItem(itemId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not logged in");
  const { error } = await supabase.from("saved_wardrobe_items").insert({ item_id: itemId, user_id: user.id });
  if (error) throw error;
}

export async function unsaveWardrobeItem(itemId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not logged in");
  const { error } = await supabase.from("saved_wardrobe_items").delete().eq("item_id", itemId).eq("user_id", user.id);
  if (error) throw error;
}

export async function getSavedWardrobeItems(): Promise<WardrobeItem[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data: saveRows, error } = await supabase
    .from("saved_wardrobe_items")
    .select("item_id, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error || !saveRows || saveRows.length === 0) return [];
  const itemIds = saveRows.map((r: any) => r.item_id);
  const { data, error: itemsErr } = await supabase
    .from("wardrobe_items")
    .select("*")
    .in("id", itemIds);
  if (itemsErr) throw itemsErr;
  const items = (data ?? []) as WardrobeItem[];
  const orderMap = new Map(saveRows.map((r: any, i: number) => [r.item_id, i]));
  return items.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
}

export async function getWardrobeItemSaveStatus(itemId: string): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from("saved_wardrobe_items")
    .select("id")
    .eq("item_id", itemId)
    .eq("user_id", user.id)
    .maybeSingle();
  return !!data;
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

// ─── Notifications ────────────────────────────────────────────────────────────

const NOTIF_PAGE_SIZE = 20;

export async function getNotifications(cursor?: string): Promise<{ notifications: AppNotification[]; nextCursor?: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { notifications: [] };
  let q = supabase
    .from('notifications')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(NOTIF_PAGE_SIZE + 1);
  if (cursor) q = q.lt('created_at', cursor);
  const { data: rows, error } = await q;
  if (error || !rows || rows.length === 0) return { notifications: [] };

  const hasMore = rows.length > NOTIF_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, NOTIF_PAGE_SIZE) : rows;

  const actorIds = [...new Set(page.map((r: any) => r.actor_id).filter(Boolean))];
  const { data: profiles } = actorIds.length
    ? await supabase.from('profiles').select('id, username, display_name, avatar_url').in('id', actorIds)
    : { data: [] };
  const profileMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]));

  return {
    notifications: page.map((r: any) => ({ ...r, actor: r.actor_id ? profileMap[r.actor_id] : undefined })),
    nextCursor: hasMore ? page[page.length - 1].created_at : undefined,
  };
}

export async function getNotificationsBadgeCount(): Promise<{ followRequests: number; unread: number }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { followRequests: 0, unread: 0 };
  const [
    { count: followRequests },
    { count: unread },
  ] = await Promise.all([
    supabase.from('follow_requests').select('*', { count: 'exact', head: true }).eq('requested_id', user.id),
    supabase.from('notifications').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('is_read', false),
  ]);
  return { followRequests: followRequests ?? 0, unread: unread ?? 0 };
}

export async function markNotificationsRead(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from('notifications').update({ is_read: true }).eq('user_id', user.id).eq('is_read', false);
}

// ─── Community Requests ───────────────────────────────────────────────────────

export async function getCommunityJoinStatus(communityId: string): Promise<'member' | 'pending' | 'none'> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 'none';
  const [{ data: member }, { data: request }] = await Promise.all([
    supabase.from('community_members').select('user_id').eq('community_id', communityId).eq('user_id', user.id).maybeSingle(),
    supabase.from('community_requests').select('id').eq('community_id', communityId).eq('user_id', user.id).maybeSingle(),
  ]);
  if (member) return 'member';
  if (request) return 'pending';
  return 'none';
}

export async function sendCommunityRequest(communityId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not logged in');
  const { error } = await supabase.from('community_requests').insert({ community_id: communityId, user_id: user.id });
  if (error) throw error;
}

export async function cancelCommunityRequest(communityId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not logged in');
  const { error } = await supabase.from('community_requests').delete().eq('community_id', communityId).eq('user_id', user.id);
  if (error) throw error;
}

export async function getCommunityRequests(communityId: string): Promise<CommunityRequest[]> {
  const { data: rows, error } = await supabase
    .from('community_requests')
    .select('id, community_id, user_id, created_at')
    .eq('community_id', communityId)
    .order('created_at', { ascending: false });
  if (error || !rows || rows.length === 0) return [];
  const userIds = rows.map((r: any) => r.user_id);
  const { data: profiles } = await supabase.from('profiles').select('id, username, display_name, avatar_url').in('id', userIds);
  const profileMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]));
  return rows.map((r: any) => ({ ...r, profile: profileMap[r.user_id] ?? { id: r.user_id, username: 'unknown', display_name: null, avatar_url: null } }));
}

export async function resolveCommunityRequest(communityId: string, userId: string, accept: boolean): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (accept) {
    const { error } = await supabase.from('community_members').insert({ community_id: communityId, user_id: userId });
    if (error) throw error;
    // Notify the requester that they were accepted
    if (user) {
      await supabase.from('notifications').insert({
        user_id: userId,
        type: 'community_accepted',
        actor_id: user.id,
        data: { community_id: communityId },
      });
    }
  }
  await supabase.from('community_requests').delete().eq('community_id', communityId).eq('user_id', userId);
}

// ─── Search / Discover ────────────────────────────────────────────────────────

export async function searchPosts(query: string): Promise<Post[]> {
  const { data: { user } } = await supabase.auth.getUser();
  const q = query.toLowerCase();

  // 1. Direct post matches (caption, tags)
  const { data: directData } = await supabase
    .from('posts')
    .select('*, profile:profiles!posts_user_id_fkey(username, display_name, avatar_url, is_public)')
    .eq('is_private', false)
    .or(`caption.ilike.%${query}%,tags.cs.{${q}}`)
    .order('created_at', { ascending: false })
    .limit(50);

  // 2. Posts via wardrobe items (label, brand, category, description)
  const { data: itemLinks } = await supabase
    .from('post_wardrobe_items')
    .select('post_id, item:wardrobe_items!inner(label, brand, category, description)')
    .or(`label.ilike.%${query}%,brand.ilike.%${query}%,category.ilike.%${query}%,description.ilike.%${query}%`, { referencedTable: 'wardrobe_items' })
    .limit(100);

  const itemPostIds = [...new Set((itemLinks ?? []).map((r: any) => r.post_id))];

  // Fetch posts matched via items (exclude ones already in direct results)
  const directIds = new Set((directData ?? []).map((p: any) => p.id));
  const missingIds = itemPostIds.filter(id => !directIds.has(id));
  let itemPosts: Post[] = [];
  if (missingIds.length > 0) {
    const { data: extraData } = await supabase
      .from('posts')
      .select('*, profile:profiles!posts_user_id_fkey(username, display_name, avatar_url, is_public)')
      .eq('is_private', false)
      .in('id', missingIds)
      .order('created_at', { ascending: false });
    itemPosts = (extraData ?? []) as Post[];
  }

  // Merge and deduplicate
  const allPosts = [...((directData ?? []) as Post[]), ...itemPosts];
  const posts = allPosts.filter(p => p.profile?.is_public === true || p.user_id === user?.id);

  if (user && posts.length > 0) {
    const postIds = posts.map(p => p.id);
    const [{ data: likedRows }, { data: savedRows }] = await Promise.all([
      supabase.from('likes').select('post_id').eq('user_id', user.id).in('post_id', postIds),
      supabase.from('saves').select('post_id').eq('user_id', user.id).in('post_id', postIds),
    ]);
    const likedSet = new Set((likedRows ?? []).map((r: any) => r.post_id));
    const savedSet = new Set((savedRows ?? []).map((r: any) => r.post_id));
    return posts.map(p => ({ ...p, liked_by_me: likedSet.has(p.id), saved_by_me: savedSet.has(p.id) }));
  }
  return posts;
}

export async function searchCommunities(query: string): Promise<Community[]> {
  const { data } = await supabase
    .from('communities')
    .select('*')
    .ilike('name', `%${query}%`)
    .limit(20);
  return (data ?? []) as Community[];
}

// ─── Community Members & Admin ────────────────────────────────────────────────

export interface CommunityMember {
  user_id: string;
  role: string;
  profile: Pick<Profile, 'id' | 'username' | 'display_name' | 'avatar_url'>;
}

export async function getCommunityMembers(communityId: string): Promise<CommunityMember[]> {
  const { data, error } = await supabase
    .from('community_members')
    .select('user_id, role, profiles:user_id(id, username, display_name, avatar_url)')
    .eq('community_id', communityId);
  if (error) throw error;
  return (data ?? []).map((m: any) => ({
    user_id: m.user_id,
    role: m.role ?? 'member',
    profile: m.profiles,
  }));
}

export async function getMyRoleInCommunity(communityId: string): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('community_members')
    .select('role')
    .eq('community_id', communityId)
    .eq('user_id', user.id)
    .maybeSingle();
  return data?.role ?? null;
}

export async function promoteToAdmin(communityId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('community_members')
    .update({ role: 'admin' })
    .eq('community_id', communityId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function demoteFromAdmin(communityId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('community_members')
    .update({ role: 'member' })
    .eq('community_id', communityId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function removeMember(communityId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('community_members')
    .delete()
    .eq('community_id', communityId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function searchProfiles(query: string): Promise<Profile[]> {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .or(`username.ilike.%${query}%,display_name.ilike.%${query}%`)
    .limit(20);
  return (data ?? []) as Profile[];
}

export async function inviteUserToCommunity(communityId: string, userId: string): Promise<void> {
  // Direct add for now — admin invites skip the request flow
  const { error } = await supabase
    .from('community_members')
    .insert({ community_id: communityId, user_id: userId });
  if (error) throw error;
  // Notify the invited user
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    await supabase.from('notifications').insert({
      user_id: userId,
      type: 'community_invite',
      actor_id: user.id,
      data: { community_id: communityId },
    });
  }
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

// ── Referrals ──────────────────────────────────────────────

export async function createReferral(phone: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("not logged in");
  // Normalize phone: strip non-digits
  const normalized = phone.replace(/\D/g, "");
  const { error } = await supabase
    .from("referrals")
    .upsert(
      { inviter_id: user.id, invited_phone: normalized },
      { onConflict: "inviter_id,invited_phone" }
    );
  if (error) throw error;
}

export async function getMyReferralCount(): Promise<number> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 0;
  const { count } = await supabase
    .from("referrals")
    .select("*", { count: "exact", head: true })
    .eq("inviter_id", user.id)
    .eq("status", "accepted");
  return count ?? 0;
}
