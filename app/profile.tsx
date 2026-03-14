import { useCallback, useState } from 'react';
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
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
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
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [savingName, setSavingName] = useState(false);

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

  const handleAvatarPress = async () => {
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
      Alert.alert('error', e?.message ?? 'could not upload avatar');
    }
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

  const saveName = async () => {
    if (!draftName.trim()) return;
    setSavingName(true);
    try {
      const updated = await updateProfile(profile.id, { display_name: draftName.trim() });
      setProfile(updated);
      refreshProfile();
      setEditingName(false);
    } catch (e: any) {
      Alert.alert('error', e?.message ?? 'could not save name');
    } finally {
      setSavingName(false);
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
          onPress: async () => {
            try {
              await deleteAccount();
            } catch (e: any) {
              Alert.alert('error', e?.message ?? 'could not delete account');
            }
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

        {/* Display name */}
        {editingName ? (
          <View style={styles.nameEditRow}>
            <TextInput
              style={styles.nameInput}
              value={draftName}
              onChangeText={setDraftName}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={saveName}
              placeholderTextColor={Theme.colors.disabled}
            />
            <TouchableOpacity onPress={saveName} disabled={savingName} style={styles.nameSaveBtn}>
              {savingName
                ? <ActivityIndicator size="small" color={Theme.colors.background} />
                : <Text style={styles.nameSaveBtnText}>save</Text>
              }
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity onPress={() => { setDraftName(displayName); setEditingName(true); }}>
            <Text style={styles.displayName}>{displayName}</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.username}>@{profile.username}</Text>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statNum}>{posts.length}</Text>
            <Text style={styles.statLabel}>outfits</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statNum}>{profile.followers_count ?? 0}</Text>
            <Text style={styles.statLabel}>followers</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statNum}>{profile.following_count ?? 0}</Text>
            <Text style={styles.statLabel}>following</Text>
          </View>
          <View style={styles.statDivider} />
          <TouchableOpacity
            style={styles.stat}
            onPress={() => router.push('/communities' as any)}
            hitSlop={8}
          >
            <Text style={styles.statNum}>{communities.length}</Text>
            <Text style={styles.statLabel}>communities</Text>
          </TouchableOpacity>
        </View>

        {/* Public toggle */}
        <View style={styles.section}>
          <View style={styles.row}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={styles.rowLabel}>{profile.is_public ? 'public profile' : 'private profile'}</Text>
              <Text style={styles.rowSub}>
                {profile.is_public
                  ? 'your outfits are visible to everyone.'
                  : 'only you can see your outfits.'}
              </Text>
            </View>
            <Switch
              value={profile.is_public}
              onValueChange={handleTogglePublic}
              trackColor={{ false: Theme.colors.surface, true: Theme.colors.accent }}
              thumbColor={Theme.colors.primary}
            />
          </View>
        </View>

        {/* Danger zone */}
        <TouchableOpacity onPress={handleDeleteAccount} style={styles.deleteBtn} hitSlop={8}>
          <Text style={styles.deleteBtnText}>delete account</Text>
        </TouchableOpacity>
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

  statsRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 28, marginTop: 20, marginBottom: 8,
  },
  stat: { alignItems: 'center', gap: 2 },
  statNum: { fontSize: Theme.font.lg, fontWeight: '800', color: Theme.colors.primary },
  statLabel: { fontSize: Theme.font.xs, color: Theme.colors.secondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  statDivider: { width: 1, height: 28, backgroundColor: Theme.colors.border },

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

  deleteBtn: { marginTop: 32 },
  deleteBtnText: { fontSize: Theme.font.sm, color: '#C0392B', fontWeight: '500', textAlign: 'center' },

});
