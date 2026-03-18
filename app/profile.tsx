import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
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
  Community,
  Post,
  Profile,
} from '@/utils/api';
import { useAuth } from '@/utils/auth';

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
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled) return;
    try {
      const url = await uploadAvatar(profile.id, result.assets[0].uri);
      const updated = await updateProfile(profile.id, { avatar_url: url });
      setProfile(updated);
      refreshProfile();
    } catch (e: any) {
      Alert.alert('error', e?.message ?? 'could not upload photo');
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

  const displayName = profile.display_name ?? profile.username;
  const initials = displayName[0].toUpperCase();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backText}>‹ back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>profile</Text>
        <TouchableOpacity onPress={handleSignOut} hitSlop={12}>
          <Text style={styles.signOutText}>sign out</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Avatar */}
        <TouchableOpacity style={styles.avatarArea} onPress={handleAvatarPress} activeOpacity={0.8}>
          {profile.avatar_url ? (
            <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitials}>{initials}</Text>
            </View>
          )}
          <View style={styles.avatarEditBadge}>
            <Feather name="camera" size={12} color={Theme.colors.background} />
          </View>
        </TouchableOpacity>

        {/* Name / username / bio — unified edit */}
        {editingProfile ? (
          <View style={styles.nameBlock}>
            <View style={styles.nameBlockSpacer} />
            <View style={{ flex: 1, alignItems: 'center', gap: 8 }}>
              <TextInput
                style={styles.nameInput}
                value={draftName}
                onChangeText={setDraftName}
                autoFocus
                returnKeyType="next"
                placeholderTextColor={Theme.colors.disabled}
              />
              <View style={styles.nameEditRow}>
                <Text style={styles.usernameAt}>@</Text>
                <TextInput
                  style={styles.usernameInput}
                  value={draftUsername}
                  onChangeText={setDraftUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  placeholderTextColor={Theme.colors.disabled}
                />
              </View>
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
              <Text style={[styles.bioCharCount, { alignSelf: 'flex-end' }]}>{draftBio.length}/150</Text>
            </View>
            <TouchableOpacity onPress={saveProfile} disabled={savingProfile} hitSlop={10} style={styles.nameEditIcon}>
              {savingProfile
                ? <ActivityIndicator size="small" color={Theme.colors.secondary} />
                : <Feather name="check" size={16} color={Theme.colors.secondary} />
              }
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.nameBlock}>
            <View style={styles.nameBlockSpacer} />
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={styles.displayName}>{displayName}</Text>
              <Text style={styles.username}>@{profile.username}</Text>
              {profile.bio
                ? <Text style={styles.bioText}>{profile.bio}</Text>
                : <Text style={styles.bioPlaceholder}>+ add a bio</Text>
              }
            </View>
            <TouchableOpacity
              onPress={() => { setDraftName(displayName); setDraftUsername(profile.username); setDraftBio(profile.bio ?? ''); setEditingProfile(true); }}
              hitSlop={10}
              style={styles.nameEditIcon}
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
            <View style={styles.stat}>
              <Text style={styles.statNum}>{posts.length}</Text>
              <Text style={styles.statLabel}>outfits</Text>
            </View>
            <TouchableOpacity style={styles.stat} onPress={() => router.push('/communities' as any)} hitSlop={8}>
              <Text style={styles.statNum}>{communities.length}</Text>
              <Text style={styles.statLabel}>communities</Text>
            </TouchableOpacity>
            <View style={styles.stat}>
              <Text style={styles.statNum}>{profile.followers_count ?? 0}</Text>
              <Text style={styles.statLabel}>followers</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statNum}>{profile.following_count ?? 0}</Text>
              <Text style={styles.statLabel}>following</Text>
            </View>
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
                <Switch
                  value={profile.is_public}
                  onValueChange={handleTogglePublic}
                  trackColor={{ false: Theme.colors.surface, true: Theme.colors.accent }}
                  thumbColor={Theme.colors.primary}
                />
              </View>
              <View style={styles.rowDivider} />
              <View style={styles.row}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={styles.rowLabel}>share my closet</Text>
                  <Text style={styles.rowSub}>let followers browse your wardrobe</Text>
                </View>
                <Switch
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
                  trackColor={{ false: Theme.colors.surface, true: Theme.colors.accent }}
                  thumbColor={Theme.colors.primary}
                />
              </View>
            </View>

            <View style={styles.section}>
              <View style={styles.row}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={styles.rowLabel}>daily reminder</Text>
                  <Text style={styles.rowSub}>nudge to log your outfit each day</Text>
                </View>
                <Switch
                  value={notifReminder}
                  onValueChange={toggleNotifReminder}
                  trackColor={{ false: Theme.colors.surface, true: Theme.colors.accent }}
                  thumbColor={Theme.colors.primary}
                />
              </View>
              <View style={styles.rowDivider} />
              <View style={styles.row}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={styles.rowLabel}>likes & comments</Text>
                  <Text style={styles.rowSub}>get notified when people interact with your looks</Text>
                </View>
                <Switch
                  value={notifSocial}
                  onValueChange={toggleNotifSocial}
                  trackColor={{ false: Theme.colors.surface, true: Theme.colors.accent }}
                  thumbColor={Theme.colors.primary}
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

            <TouchableOpacity onPress={handleDeleteAccount} style={styles.deleteBtn} hitSlop={8}>
              <Text style={styles.deleteBtnText}>delete account</Text>
            </TouchableOpacity>

            <Text style={styles.version}>muse v{Constants.expoConfig?.version ?? '1.0.0'}</Text>
          </>
        )}
      </ScrollView>
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
  headerTitle: {
    fontFamily: 'Caprasimo_400Regular', fontSize: 22,
    color: Theme.colors.primary, letterSpacing: -0.3,
  },
  signOutText: { fontSize: Theme.font.sm, color: '#D9534F', fontWeight: '500' },

  content: { paddingHorizontal: 20, paddingBottom: 60, alignItems: 'center' },

  avatarArea: { marginTop: 12, marginBottom: 14, position: 'relative' },
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

  displayName: {
    fontSize: Theme.font.xl, fontWeight: '800',
    color: Theme.colors.primary, letterSpacing: -0.5, textAlign: 'center',
  },
  username: { fontSize: Theme.font.sm, color: Theme.colors.secondary, marginTop: 2 },

  nameEditRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameInput: {
    fontSize: Theme.font.xl, fontWeight: '800', color: Theme.colors.primary,
    borderBottomWidth: 1.5, borderBottomColor: Theme.colors.accent,
    minWidth: 160, paddingBottom: 2,
  },
  nameSaveBtn: {
    backgroundColor: Theme.colors.accent, borderRadius: Theme.radius.sm,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  nameSaveBtnText: { fontSize: Theme.font.sm, fontWeight: '700', color: Theme.colors.background },

  usernameAt: { fontSize: Theme.font.sm, fontWeight: '600', color: Theme.colors.secondary },
  usernameInput: {
    fontSize: Theme.font.sm, fontWeight: '600', color: Theme.colors.secondary,
    borderBottomWidth: 1.5, borderBottomColor: Theme.colors.accent,
    minWidth: 100, paddingBottom: 2,
  },

  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nameBlock: { flexDirection: 'row', alignItems: 'flex-start', width: '100%' },
  nameBlockSpacer: { width: 28 },
  nameEditIcon: { width: 28, paddingTop: 6, alignItems: 'center' },

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

  deleteBtn: { marginTop: 32 },
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
  bioText: { fontSize: Theme.font.sm, color: Theme.colors.primary, textAlign: 'center', lineHeight: 20 },
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

  settingsHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start', marginTop: 28, paddingVertical: 4,
  },
  settingsHeaderText: { fontSize: Theme.font.sm, fontWeight: '700', color: Theme.colors.secondary, textTransform: 'uppercase', letterSpacing: 1 },

});
