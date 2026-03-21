import { useCallback, useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Animated,
  Modal,
  TextInput,
  Alert,
  Linking,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as ImagePicker from 'expo-image-picker';
import { Feather } from '@expo/vector-icons';

import { Theme } from '@/constants/Theme';
import {
  getMyProfile,
  getMyPosts,
  getMyCommunities,
  updateProfile,
  uploadAvatar,
  signOut,
  deleteAccount,
  getFollowers,
  getFollowing,
  Community,
  Post,
  Profile,
} from '@/utils/api';
import { useAuth } from '@/utils/auth';
import { supabase } from '@/utils/supabase';

function GradientToggle({ value, onValueChange }: { value: boolean; onValueChange: (v: boolean) => void }) {
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={() => onValueChange(!value)}
      style={{ width: 51, height: 31, borderRadius: 16, justifyContent: 'center', padding: 2 }}
    >
      {value ? (
        <LinearGradient
          colors={['#F9C74F', '#F77FAD']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 16 }}
        />
      ) : (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 16, backgroundColor: Theme.colors.surface }} />
      )}
      <View style={{
        width: 27, height: 27, borderRadius: 14, backgroundColor: '#fff',
        alignSelf: value ? 'flex-end' : 'flex-start',
        shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2,
      }} />
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const { session, profile: authProfile, refreshProfile } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(authProfile);
  const [posts, setPosts] = useState<Post[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);

  // Edit state
  const [editingProfile, setEditingProfile] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftUsername, setDraftUsername] = useState('');
  const [draftBio, setDraftBio] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  const [notifReminder, setNotifReminder] = useState(false);
  const [notifSocial, setNotifSocial] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [sendingFeedback, setSendingFeedback] = useState(false);

  // Popup modals
  const [popupType, setPopupType] = useState<'followers' | 'following' | 'communities' | null>(null);
  const [popupProfiles, setPopupProfiles] = useState<Profile[]>([]);
  const [popupLoading, setPopupLoading] = useState(false);

  const openPopup = async (type: 'followers' | 'following' | 'communities') => {
    setPopupType(type);
    setPopupLoading(true);
    try {
      if (type === 'followers') {
        setPopupProfiles(await getFollowers(profile!.id));
      } else if (type === 'following') {
        setPopupProfiles(await getFollowing(profile!.id));
      }
    } catch {}
    finally { setPopupLoading(false); }
  };

  const scrollY = useRef(new Animated.Value(0)).current;
  const SCROLL_THRESHOLD = 60;
  const titleFontSize = scrollY.interpolate({
    inputRange: [0, SCROLL_THRESHOLD],
    outputRange: [28, 20],
    extrapolate: 'clamp',
  });
  const usernameFontSize = scrollY.interpolate({
    inputRange: [0, SCROLL_THRESHOLD],
    outputRange: [14, 10],
    extrapolate: 'clamp',
  });
  const headerCenterMarginTop = scrollY.interpolate({
    inputRange: [0, SCROLL_THRESHOLD],
    outputRange: [28, 0],
    extrapolate: 'clamp',
  });
  const headerPaddingBottom = scrollY.interpolate({
    inputRange: [0, SCROLL_THRESHOLD],
    outputRange: [10, 4],
    extrapolate: 'clamp',
  });

  useEffect(() => {
    AsyncStorage.multiGet(['notif_reminder', 'notif_social']).then(([reminder, social]) => {
      if (reminder[1] !== null) setNotifReminder(reminder[1] === 'true');
      if (social[1] !== null) setNotifSocial(social[1] === 'true');
    });
  }, []);

  const toggleNotifReminder = (val: boolean) => {
    setNotifReminder(val);
    AsyncStorage.setItem('notif_reminder', String(val));
  };

  const toggleNotifSocial = (val: boolean) => {
    setNotifSocial(val);
    AsyncStorage.setItem('notif_social', String(val));
  };

  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      Promise.all([getMyProfile(), getMyPosts(), getMyCommunities()]).then(
        ([p, ps, cs]) => {
          setProfile(p);
          setPosts(ps);
          setCommunities(cs);
        }
      );
    }, [session])
  );

  if (!session) return null;

  if (!profile) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Theme.colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={Theme.colors.brandWarm} />
      </SafeAreaView>
    );
  }

  const pickAndUploadAvatar = async () => {
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
      const url = await uploadAvatar(profile.id, result.assets[0].uri);
      const updated = await updateProfile(profile.id, { avatar_url: url });
      setProfile({ ...updated, avatar_url: url });
      refreshProfile();
    } catch (e: any) {
      Alert.alert('oops', e?.message ?? 'could not upload photo');
    }
  };

  const handleRemoveAvatar = async () => {
    try {
      const updated = await updateProfile(profile.id, { avatar_url: null });
      setProfile(updated);
      refreshProfile();
    } catch (e: any) {
      Alert.alert('error', e?.message ?? 'could not remove photo');
    }
  };

  const handleAvatarPress = () => {
    if (profile.avatar_url) {
      Alert.alert('profile photo', '', [
        { text: 'change photo', onPress: pickAndUploadAvatar },
        { text: 'remove photo', style: 'destructive', onPress: handleRemoveAvatar },
        { text: 'cancel', style: 'cancel' },
      ]);
    } else {
      pickAndUploadAvatar();
    }
  };

  const saveProfile = async () => {
    const cleanedUsername = draftUsername.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!cleanedUsername || !draftName.trim()) return;
    setSavingProfile(true);
    try {
      const updated = await updateProfile(profile.id, {
        display_name: draftName.trim(),
        username: cleanedUsername,
        bio: draftBio.trim() || null,
      });
      setProfile(updated);
      refreshProfile();
      setEditingProfile(false);
    } catch (e: any) {
      Alert.alert('error', e?.message ?? 'could not save profile');
    } finally {
      setSavingProfile(false);
    }
  };

  const saveTags = async (tags: string[]) => {
    setDraftTags(tags);
    try {
      const updated = await updateProfile(profile.id, { style_tags: tags });
      setProfile(updated);
      refreshProfile();
    } catch {}
  };

  const handleTogglePublic = async (val: boolean) => {
    try {
      const updated = await updateProfile(profile.id, { is_public: val });
      setProfile(updated);
      refreshProfile();
    } catch {
      Alert.alert('error', 'could not update privacy setting');
    }
  };

  const handleSignOut = async () => {
    await signOut();
    // AuthGate will redirect to /auth once session becomes null
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'delete account',
      'this will permanently delete your account, all outfits, and profile data. this cannot be undone.',
      [
        { text: 'cancel', style: 'cancel' },
        {
          text: 'delete',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'are you sure?',
              "once it's gone, it's really gone 👀",
              [
                { text: 'nevermind', style: 'cancel' },
                {
                  text: 'yes, delete it',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await deleteAccount();
                    } catch (e: any) {
                      Alert.alert('something went wrong', e?.message ?? 'could not delete your account — try again');
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  const handleSendFeedback = async () => {
    if (!feedbackText.trim() || sendingFeedback) return;
    setSendingFeedback(true);
    try {
      await supabase.from('feedback').insert({
        user_id: profile.id,
        content: feedbackText.trim(),
      });
      setFeedbackText('');
      setFeedbackSent(true);
    } catch { /* silent */ }
    finally { setSendingFeedback(false); }
  };

  const displayName = profile.display_name ?? profile.username;
  const initials = displayName[0].toUpperCase();

  return (
    <SafeAreaView style={styles.safe}>
      <Animated.View style={[styles.header, { paddingBottom: headerPaddingBottom }]}>
        <Animated.View style={[styles.headerCenter, { marginTop: headerCenterMarginTop }]}>
          {editingProfile ? (
            <TextInput
              style={styles.headerTitleInput}
              value={draftName}
              onChangeText={setDraftName}
              autoFocus
              returnKeyType="done"
              placeholderTextColor={Theme.colors.disabled}
              textAlign="center"
            />
          ) : (
            <Animated.Text style={[styles.headerTitle, { fontSize: titleFontSize }]}>{displayName}</Animated.Text>
          )}
          {editingProfile ? (
            <View style={styles.headerUsernameRow}>
              <Text style={styles.headerUsernameAt}>@</Text>
              <TextInput
                style={styles.headerUsernameInput}
                value={draftUsername}
                onChangeText={setDraftUsername}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                placeholderTextColor={Theme.colors.disabled}
              />
            </View>
          ) : (
            <Animated.Text style={[styles.headerUsername, { fontSize: usernameFontSize }]}>@{profile.username}</Animated.Text>
          )}
        </Animated.View>
        <TouchableOpacity onPress={editingProfile ? () => setEditingProfile(false) : () => router.back()} hitSlop={12} style={styles.headerLeft}>
          <Text style={styles.backText}>{editingProfile ? 'cancel' : '‹ back'}</Text>
        </TouchableOpacity>
        {editingProfile && (
          <TouchableOpacity onPress={saveProfile} disabled={savingProfile} hitSlop={12} style={styles.headerRight}>
            {savingProfile
              ? <ActivityIndicator size="small" color={Theme.colors.accent} />
              : <Text style={styles.headerSaveText}>save</Text>
            }
          </TouchableOpacity>
        )}
      </Animated.View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: false }
        )}
        scrollEventThrottle={16}
      >
        {/* Avatar */}
        <TouchableOpacity style={styles.avatarArea} onPress={handleAvatarPress} activeOpacity={0.8}>
          {profile.avatar_url ? (
            <Image source={{ uri: profile.avatar_url }} style={styles.avatar} cachePolicy="disk" />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitials}>{initials}</Text>
            </View>
          )}
          <View style={styles.avatarEditBadge}>
            <Feather name="camera" size={12} color={Theme.colors.background} />
          </View>
        </TouchableOpacity>

        {/* Bio */}
        {editingProfile ? (
          <View style={styles.bioEditWrap}>
            <TextInput
              style={styles.bioInputEdit}
              value={draftBio}
              onChangeText={setDraftBio}
              multiline
              maxLength={150}
              placeholder="describe your vibe..."
              placeholderTextColor={Theme.colors.disabled}
              textAlignVertical="top"
            />
            <Text style={styles.bioCharCount}>{draftBio.length}/150</Text>
          </View>
        ) : (
          <View style={styles.bioRow}>
            {profile.bio
              ? <Text style={styles.bioText}>{profile.bio}</Text>
              : <Text style={styles.bioPlaceholder}>+ add a bio</Text>
            }
            <TouchableOpacity
              onPress={() => { setDraftName(displayName); setDraftUsername(profile.username); setDraftBio(profile.bio ?? ''); setEditingProfile(true); }}
              hitSlop={10}
            >
              <Feather name="edit-2" size={14} color={Theme.colors.secondary} />
            </TouchableOpacity>
          </View>
        )}

        {/* Stats card + style tags */}
        <LinearGradient
          colors={['#F9C74F', '#F77FAD']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={styles.statsCard}
        >
          <View style={styles.statsGrid}>
            <TouchableOpacity style={styles.stat} onPress={() => router.push('/' as any)} activeOpacity={0.7}>
              <Text style={styles.statNum}>{posts.length}</Text>
              <Text style={styles.statLabel}>outfits</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.stat} onPress={() => openPopup('communities')} activeOpacity={0.7}>
              <Text style={styles.statNum}>{communities.length}</Text>
              <Text style={styles.statLabel}>communities</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.stat} onPress={() => openPopup('followers')} activeOpacity={0.7}>
              <Text style={styles.statNum}>{profile.followers_count ?? 0}</Text>
              <Text style={styles.statLabel}>followers</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.stat} onPress={() => openPopup('following')} activeOpacity={0.7}>
              <Text style={styles.statNum}>{profile.following_count ?? 0}</Text>
              <Text style={styles.statLabel}>following</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.statsTagDivider} />
          <Text style={styles.statsTagHeader}>my style</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tagsScroll} contentContainerStyle={styles.tagsScrollContent}>
            <View style={styles.tagAddPill}>
              <TextInput
                style={styles.tagAddInput}
                value={tagInput}
                placeholder="+ add tag"
                placeholderTextColor={Theme.colors.accent}
                onChangeText={text => {
                  if (text.endsWith(',') || text.endsWith(' ')) {
                    const t = text.slice(0, -1).trim().toLowerCase();
                    if (t && !draftTags.includes(t)) {
                      const next = [...draftTags, t];
                      setDraftTags(next);
                      saveTags(next);
                    }
                    setTagInput('');
                  } else setTagInput(text);
                }}
                onSubmitEditing={() => {
                  const t = tagInput.trim().toLowerCase();
                  if (t && !draftTags.includes(t)) {
                    const next = [...draftTags, t];
                    setDraftTags(next);
                    saveTags(next);
                  }
                  setTagInput('');
                }}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
              />
            </View>
            {draftTags.map(tag => (
              <TouchableOpacity
                key={tag}
                style={styles.tagChipSelected}
                onPress={() => { const next = draftTags.filter(t => t !== tag); setDraftTags(next); saveTags(next); }}
                activeOpacity={0.7}
              >
                <Text style={styles.tagChipSelectedText}>{tag} ×</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </LinearGradient>

        {/* Feedback card */}
        <LinearGradient
          colors={['#CCE0EE', '#A6C2D7', '#82A9BF']}
          start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }}
          style={styles.feedbackCard}
        >
          {feedbackSent ? (
            <View style={{ alignItems: 'center', paddingVertical: 12 }}>
              <Text style={styles.feedbackTitle}>thank you 💛</Text>
              <Text style={styles.feedbackSub}>Your input means the world to us.</Text>
            </View>
          ) : (
            <>
              <Text style={styles.feedbackTitle}>we're committed to building your dream fashion app.</Text>
              <Text style={styles.feedbackSub}>Muse is still early and your feedback shapes what comes next. Tell us what you love, features you want us to add, or what's broken.</Text>
              <TextInput
                style={styles.feedbackInput}
                value={feedbackText}
                onChangeText={setFeedbackText}
                placeholder="i wish muse could..."
                placeholderTextColor={Theme.colors.disabled}
                multiline
                maxLength={500}
                textAlignVertical="top"
              />
              <TouchableOpacity
                style={[styles.feedbackBtn, !feedbackText.trim() && { opacity: 0.4 }]}
                onPress={handleSendFeedback}
                disabled={!feedbackText.trim() || sendingFeedback}
                activeOpacity={0.8}
              >
                {sendingFeedback
                  ? <ActivityIndicator size="small" color={Theme.colors.primary} />
                  : <Text style={styles.feedbackBtnText}>send feedback ✨</Text>
                }
              </TouchableOpacity>
            </>
          )}
        </LinearGradient>

        {/* Settings (collapsible) */}
        <TouchableOpacity style={styles.settingsHeader} onPress={() => setSettingsOpen(o => !o)} activeOpacity={0.7}>
          <Text style={styles.settingsHeaderText}>settings</Text>
          <Feather name={settingsOpen ? 'chevron-up' : 'chevron-down'} size={16} color={Theme.colors.secondary} />
        </TouchableOpacity>

        {settingsOpen && (
          <>
            <View style={styles.section}>
              <View style={styles.row}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={styles.rowLabel}>{profile.is_public ? 'public profile' : 'private profile'}</Text>
                  <Text style={styles.rowSub}>
                    {profile.is_public
                      ? 'your outfits are visible to everyone.'
                      : 'only approved followers and community members can see your outfits.'}
                  </Text>
                </View>
                <GradientToggle
                  value={profile.is_public}
                  onValueChange={handleTogglePublic}
                  />
              </View>
              <View style={styles.rowDivider} />
              <View style={styles.row}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={styles.rowLabel}>share my closet</Text>
                  <Text style={styles.rowSub}>let followers browse your wardrobe</Text>
                </View>
                <GradientToggle
                  value={profile.share_closet ?? true}
                  onValueChange={async (val) => {
                    try {
                      const updated = await updateProfile(profile.id, { share_closet: val });
                      setProfile(updated);
                      refreshProfile();
                    } catch {
                      Alert.alert('error', 'could not update closet setting');
                    }
                  }}
                  />
              </View>
            </View>

            <View style={styles.section}>
              <View style={styles.row}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={styles.rowLabel}>daily reminder</Text>
                  <Text style={styles.rowSub}>nudge to log your outfit each day</Text>
                </View>
                <GradientToggle
                  value={notifReminder}
                  onValueChange={toggleNotifReminder}
                  />
              </View>
              <View style={styles.rowDivider} />
              <View style={styles.row}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={styles.rowLabel}>likes & comments</Text>
                  <Text style={styles.rowSub}>get notified when people interact with your looks</Text>
                </View>
                <GradientToggle
                  value={notifSocial}
                  onValueChange={toggleNotifSocial}
                  />
              </View>
            </View>

            <View style={styles.section}>
              <TouchableOpacity style={styles.row} onPress={() => Linking.openURL('https://bemymuse.app/terms')} hitSlop={8}>
                <Text style={styles.rowLabel}>terms of service</Text>
                <Feather name="external-link" size={14} color={Theme.colors.secondary} />
              </TouchableOpacity>
              <View style={styles.rowDivider} />
              <TouchableOpacity style={styles.row} onPress={() => Linking.openURL('https://bemymuse.app/privacy')} hitSlop={8}>
                <Text style={styles.rowLabel}>privacy policy</Text>
                <Feather name="external-link" size={14} color={Theme.colors.secondary} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={handleSignOut} style={styles.signOutBtn} activeOpacity={0.8}>
              <Text style={styles.signOutBtnText}>sign out</Text>
            </TouchableOpacity>

            <Text style={styles.version}>muse v{Constants.expoConfig?.version ?? '1.0.0'}</Text>

            <TouchableOpacity onPress={handleDeleteAccount} style={styles.deleteBtn} hitSlop={8}>
              <Text style={styles.deleteBtnText}>delete account</Text>
            </TouchableOpacity>
          </>
        )}
      </Animated.ScrollView>
      </KeyboardAvoidingView>

      {/* Stats popup modal */}
      <Modal visible={popupType !== null} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.safe}>
          <View style={styles.popupHeader}>
            <View style={{ width: 40 }} />
            <Text style={styles.popupTitle}>{popupType ?? ''}</Text>
            <TouchableOpacity onPress={() => setPopupType(null)} hitSlop={12}>
              <Text style={styles.popupClose}>done</Text>
            </TouchableOpacity>
          </View>
          {popupLoading ? (
            <View style={styles.popupCenter}>
              <ActivityIndicator color={Theme.colors.brandWarm} />
            </View>
          ) : popupType === 'communities' ? (
            <ScrollView contentContainerStyle={styles.popupList}>
              {communities.length === 0 ? (
                <Text style={styles.popupEmpty}>no communities yet</Text>
              ) : communities.map(c => (
                <TouchableOpacity
                  key={c.id}
                  style={styles.popupRow}
                  onPress={() => { setPopupType(null); router.push({ pathname: '/community/[id]' as any, params: { id: c.id } }); }}
                  activeOpacity={0.7}
                >
                  <View style={styles.popupIconCircle}>
                    <Feather name="users" size={14} color={Theme.colors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.popupName}>{c.name}</Text>
                    {c.description ? <Text style={styles.popupSub} numberOfLines={1}>{c.description}</Text> : null}
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : (
            <ScrollView contentContainerStyle={styles.popupList}>
              {popupProfiles.length === 0 ? (
                <Text style={styles.popupEmpty}>no {popupType} yet</Text>
              ) : popupProfiles.map(p => (
                <TouchableOpacity
                  key={p.id}
                  style={styles.popupRow}
                  onPress={() => { setPopupType(null); router.push({ pathname: '/profile/[userId]' as any, params: { userId: p.id } }); }}
                  activeOpacity={0.7}
                >
                  {p.avatar_url ? (
                    <Image source={{ uri: p.avatar_url }} style={styles.popupAvatar} cachePolicy="disk" />
                  ) : (
                    <View style={styles.popupAvatarPlaceholder}>
                      <Text style={styles.popupAvatarInitial}>{(p.display_name ?? p.username ?? '?')[0].toUpperCase()}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.popupName}>{p.display_name ?? p.username}</Text>
                    <Text style={styles.popupSub}>@{p.username}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Theme.colors.background },
  header: {
    paddingHorizontal: 16, paddingTop: 8,
  },
  headerCenter: { alignItems: 'center' },
  headerLeft: { position: 'absolute', left: 16, top: 8 },
  headerRight: { position: 'absolute', right: 16, top: 10 },
  backText: { fontSize: Theme.font.base, color: Theme.colors.primary, fontWeight: '600' },
  headerTitle: {
    fontFamily: 'Caprasimo_400Regular',
    color: Theme.colors.primary, letterSpacing: -0.3,
  },
  headerUsername: { color: Theme.colors.secondary, marginTop: 1 },

  content: { paddingHorizontal: 20, paddingBottom: 60, alignItems: 'center' },

  avatarArea: { marginTop: 4, marginBottom: 10, position: 'relative' },
  avatar: { width: 88, height: 88, borderRadius: 44 },
  avatarPlaceholder: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: Theme.colors.surface,
    borderWidth: 2, borderColor: Theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitials: { fontSize: 32, fontWeight: '700', color: Theme.colors.primary },
  avatarEditBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: Theme.colors.accent,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Theme.colors.background,
  },

  headerTitleInput: {
    fontFamily: 'Caprasimo_400Regular', fontSize: 28,
    color: Theme.colors.primary, letterSpacing: -0.3,
    borderBottomWidth: 1.5, borderBottomColor: Theme.colors.accent,
    paddingBottom: 2, minWidth: 120,
  },
  headerUsernameRow: { flexDirection: 'row', alignItems: 'center', marginTop: 1 },
  headerUsernameAt: { fontSize: 14, color: Theme.colors.secondary },
  headerUsernameInput: {
    fontSize: 14, color: Theme.colors.secondary,
    borderBottomWidth: 1.5, borderBottomColor: Theme.colors.accent,
    paddingBottom: 1, minWidth: 80,
  },
  headerSaveText: { fontSize: Theme.font.sm, fontWeight: '700', color: Theme.colors.accent },

  bioRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, width: '100%',
  },
  bioEditWrap: { width: '100%', alignItems: 'flex-end' },

  statsCard: {
    width: '100%', borderRadius: Theme.radius.lg,
    marginTop: 20, marginBottom: 8, padding: 4,
  },
  statsGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
  },
  stat: { width: '50%', alignItems: 'center', paddingVertical: 16, gap: 3 },
  statNum: { fontSize: 22, fontWeight: '800', color: Theme.colors.primary },
  statLabel: { fontSize: Theme.font.xs, color: Theme.colors.primary, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6 },

  section: {
    width: '100%', marginTop: 24,
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.radius.lg,
    borderWidth: 1, borderColor: Theme.colors.border,
    padding: 16,
    gap: 12,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { fontSize: Theme.font.base, fontWeight: '600', color: Theme.colors.primary },
  rowSub: { fontSize: Theme.font.xs, color: Theme.colors.secondary, marginTop: 2 },

  rowDivider: { height: 1, backgroundColor: Theme.colors.border },

  signOutBtn: {
    marginTop: 32, alignSelf: 'center',
    backgroundColor: Theme.colors.brandWarm, borderRadius: 100,
    paddingHorizontal: 24, paddingVertical: 10,
  },
  signOutBtnText: { fontSize: Theme.font.sm, fontWeight: '700', color: '#fff' },
  deleteBtn: { marginTop: 20 },
  deleteBtnText: { fontSize: Theme.font.sm, color: '#C0392B', fontWeight: '500', textAlign: 'center' },

  version: { marginTop: 16, fontSize: Theme.font.xs, color: Theme.colors.disabled, textAlign: 'center' },

  bioInput: {
    width: '100%', minHeight: 72, fontSize: Theme.font.base, color: Theme.colors.primary,
    backgroundColor: Theme.colors.surface, borderRadius: Theme.radius.md,
    borderWidth: 1, borderColor: Theme.colors.border,
    padding: 12, textAlignVertical: 'top',
  },
  bioInputEdit: {
    width: '100%', minHeight: 60, fontSize: Theme.font.sm, color: Theme.colors.primary,
    backgroundColor: Theme.colors.surface, borderRadius: Theme.radius.md,
    borderWidth: 1, borderColor: Theme.colors.border,
    padding: 10, textAlignVertical: 'top',
  },
  bioText: { fontSize: Theme.font.base, fontWeight: '500', color: Theme.colors.primary, textAlign: 'center', lineHeight: 21, marginTop: 10 },
  bioPlaceholder: { fontSize: Theme.font.sm, color: Theme.colors.disabled, textAlign: 'center' },
  bioCharCount: { fontSize: Theme.font.xs, color: Theme.colors.disabled },

  statsTagDivider: { height: 1, backgroundColor: 'rgba(0,0,0,0.08)', marginHorizontal: 4, marginTop: 8, marginBottom: 14 },
  statsTagHeader: {
    fontSize: Theme.font.sm, fontWeight: '600', color: Theme.colors.primary,
    textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.7,
    paddingHorizontal: 12, marginBottom: 2, textAlign: 'center',
  },
  tagsScroll: { paddingHorizontal: 8 },
  tagsScrollContent: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 8, paddingRight: 12 },
  tagAddPill: {
    borderRadius: 100, borderWidth: 1.5, borderStyle: 'dashed',
    borderColor: Theme.colors.accent, paddingHorizontal: 12, paddingVertical: 6,
  },
  tagAddInput: {
    fontSize: Theme.font.sm, fontWeight: '700', color: Theme.colors.accent,
    width: 72, padding: 0, margin: 0,
  },
  tagChipSelected: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 100, backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)',
  },
  tagChipSelectedText: { fontSize: Theme.font.sm, fontWeight: '600', color: Theme.colors.primary },

  feedbackCard: {
    width: '100%', marginTop: 20,
    borderRadius: Theme.radius.lg,
    padding: 20, alignItems: 'center', gap: 10,
  },
  feedbackTitle: {
    fontFamily: 'Caprasimo_400Regular',
    fontSize: Theme.font.base, color: Theme.colors.primary,
    textAlign: 'center',
  },
  feedbackSub: {
    fontSize: Theme.font.xs, color: 'rgba(0,0,0,0.55)',
    textAlign: 'center', lineHeight: 17,
  },
  feedbackInput: {
    width: '100%', minHeight: 72, fontSize: Theme.font.sm, color: Theme.colors.primary,
    backgroundColor: 'rgba(255,255,255,0.6)', borderRadius: Theme.radius.md,
    padding: 12, textAlignVertical: 'top', marginTop: 4,
  },
  feedbackBtn: {
    backgroundColor: 'rgba(255,255,255,0.75)', borderRadius: 100,
    paddingHorizontal: 20, paddingVertical: 10,
  },
  feedbackBtnText: {
    fontSize: Theme.font.sm, fontWeight: '700', color: Theme.colors.primary,
  },

  settingsHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start', marginTop: 28, paddingVertical: 4,
  },
  settingsHeaderText: { fontSize: Theme.font.sm, fontWeight: '700', color: Theme.colors.secondary, textTransform: 'uppercase', letterSpacing: 1 },

  // Popup modal
  popupHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Theme.colors.border,
  },
  popupTitle: {
    fontFamily: 'Caprasimo_400Regular', fontSize: 20,
    color: Theme.colors.primary, textAlign: 'center', flex: 1,
  },
  popupClose: { fontSize: Theme.font.sm, fontWeight: '600', color: Theme.colors.accent, width: 40, textAlign: 'right' },
  popupCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  popupList: { padding: 16 },
  popupEmpty: { fontSize: Theme.font.sm, color: Theme.colors.secondary, textAlign: 'center', marginTop: 32 },
  popupRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Theme.colors.border,
  },
  popupAvatar: { width: 40, height: 40, borderRadius: 20 },
  popupAvatarPlaceholder: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Theme.colors.surface, borderWidth: 1, borderColor: Theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  popupAvatarInitial: { fontSize: Theme.font.sm, fontWeight: '700', color: Theme.colors.primary },
  popupIconCircle: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Theme.colors.surface, borderWidth: 1, borderColor: Theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  popupName: { fontSize: Theme.font.sm, fontWeight: '600', color: Theme.colors.primary },
  popupSub: { fontSize: Theme.font.xs, color: Theme.colors.secondary, marginTop: 1 },
});
