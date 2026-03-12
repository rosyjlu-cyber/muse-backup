import { useCallback, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { Theme } from '@/constants/Theme';
import {
  getAllCommunities,
  getMyCommunities,
  joinCommunity,
  leaveCommunity,
  createCommunity,
  Community,
} from '@/utils/api';
import { useAuth } from '@/utils/auth';

export default function CommunitiesScreen() {
  const router = useRouter();
  const { session } = useAuth();

  const [all, setAll] = useState<Community[]>([]);
  const [myCommunityIds, setMyCommunityIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [loadingId, setLoadingId] = useState<string | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      Promise.all([getAllCommunities(), getMyCommunities()]).then(([all, mine]) => {
        setAll(all);
        setMyCommunityIds(new Set(mine.map(c => c.id)));
      });
    }, [session])
  );

  const handleJoin = async (community: Community) => {
    setLoadingId(community.id);
    try {
      await joinCommunity(community.id);
      setMyCommunityIds(s => new Set([...s, community.id]));
    } catch (e: any) {
      Alert.alert('error', e?.message ?? 'could not join');
    } finally {
      setLoadingId(null);
    }
  };

  const handleLeave = async (community: Community) => {
    setLoadingId(community.id);
    try {
      await leaveCommunity(community.id);
      setMyCommunityIds(s => { const n = new Set(s); n.delete(community.id); return n; });
    } catch (e: any) {
      Alert.alert('error', e?.message ?? 'could not leave');
    } finally {
      setLoadingId(null);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const c = await createCommunity({
        name: newName.trim(),
        slug: newName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
        description: newDesc.trim(),
      });
      setAll(prev => [c, ...prev]);
      setMyCommunityIds(s => new Set([...s, c.id]));
      setNewName('');
      setNewDesc('');
      setShowCreate(false);
    } catch (e: any) {
      Alert.alert('error', e?.message ?? 'could not create community');
    } finally {
      setCreating(false);
    }
  };

  const filtered = all.filter(
    c => !search || c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backText}>‹ back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>communities</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Create banner */}
      <TouchableOpacity
        onPress={() => setShowCreate(v => !v)}
        activeOpacity={0.88}
        style={styles.bannerWrap}
      >
        <LinearGradient
          colors={['#D4F53C', '#F9C74F', '#F77FAD']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.banner}
        >
          <Text style={styles.bannerTitle}>
            {showCreate ? 'never mind ✕' : 'start your own ✦'}
          </Text>
          <Text style={styles.bannerSub}>
            {showCreate ? 'cancel community creation' : 'gather your crew around your aesthetic'}
          </Text>
        </LinearGradient>
      </TouchableOpacity>

      {/* Create form */}
      {showCreate && (
        <View style={styles.createForm}>
          <TextInput
            style={styles.formInput}
            placeholder="name your vibe"
            placeholderTextColor={Theme.colors.disabled}
            value={newName}
            onChangeText={setNewName}
          />
          <TextInput
            style={[styles.formInput, { minHeight: 64 }]}
            placeholder="what's it about? (optional)"
            placeholderTextColor={Theme.colors.disabled}
            value={newDesc}
            onChangeText={setNewDesc}
            multiline
          />
          <TouchableOpacity
            onPress={handleCreate}
            disabled={creating}
            activeOpacity={0.85}
            style={creating ? { opacity: 0.5 } : undefined}
          >
            <LinearGradient
              colors={['#D4F53C', '#F9C74F']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.createBtn}
            >
              {creating
                ? <ActivityIndicator color="#0B0B0B" />
                : <Text style={styles.createBtnText}>make it happen →</Text>}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}

      {/* Search */}
      <View style={styles.searchRow}>
        <Feather name="search" size={15} color={Theme.colors.accent} style={{ marginRight: 8 }} />
        <TextInput
          style={styles.searchInput}
          placeholder="find your people..."
          placeholderTextColor={Theme.colors.disabled}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />
      </View>

      {/* List */}
      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => {
          const isMember = myCommunityIds.has(item.id);
          const loading = loadingId === item.id;
          return (
            <View style={styles.row}>
              <TouchableOpacity
                style={{ flex: 1 }}
                onPress={() => router.push({ pathname: '/community/[id]' as any, params: { id: item.id } })}
              >
                <Text style={styles.communityName}>{item.name}</Text>
                {item.description ? (
                  <Text style={styles.communityDesc} numberOfLines={1}>{item.description}</Text>
                ) : null}
                {item.member_count != null && (
                  <Text style={styles.memberCount}>{item.member_count} member{item.member_count !== 1 ? 's' : ''}</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, isMember && styles.actionBtnLeave, loading && { opacity: 0.5 }]}
                onPress={() => isMember ? handleLeave(item) : handleJoin(item)}
                disabled={loading}
              >
                {loading
                  ? <ActivityIndicator size="small" color={isMember ? Theme.colors.secondary : Theme.colors.background} />
                  : <Text style={[styles.actionBtnText, isMember && styles.actionBtnTextLeave]}>
                      {isMember ? 'leave' : 'join'}
                    </Text>
                }
              </TouchableOpacity>
            </View>
          );
        }}
        ListEmptyComponent={
          search ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>no communities match your search.</Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Theme.colors.background },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12,
  },
  backText: { fontSize: Theme.font.base, color: Theme.colors.primary, fontWeight: '600' },
  title: {
    fontFamily: Theme.font.brand, fontSize: 22,
    color: Theme.colors.primary, letterSpacing: -0.3,
  },
  bannerWrap: {
    marginHorizontal: 20, marginBottom: 12,
    borderRadius: Theme.radius.lg, overflow: 'hidden',
  },
  banner: {
    paddingHorizontal: 18, paddingVertical: 16,
    gap: 3,
  },
  bannerTitle: {
    fontSize: Theme.font.lg, fontWeight: '900',
    color: '#0B0B0B', letterSpacing: -0.5,
  },
  bannerSub: {
    fontSize: Theme.font.xs, color: '#0B0B0B', opacity: 0.6,
  },

  createForm: {
    marginHorizontal: 20, marginBottom: 14, gap: 8,
  },
  formInput: {
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.radius.md,
    borderWidth: 1.5, borderColor: Theme.colors.accent,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: Theme.font.base, color: Theme.colors.primary,
  },
  createBtn: {
    borderRadius: Theme.radius.md,
    paddingVertical: 14, alignItems: 'center',
  },
  createBtnText: { fontSize: Theme.font.base, fontWeight: '800', color: '#0B0B0B', letterSpacing: -0.2 },

  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 20, marginBottom: 8,
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.radius.md,
    borderWidth: 1.5, borderColor: Theme.colors.border,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  searchInput: { flex: 1, fontSize: Theme.font.base, color: Theme.colors.primary },

  list: { paddingHorizontal: 20, paddingBottom: 40 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Theme.colors.border,
  },
  communityName: { fontSize: Theme.font.base, fontWeight: '700', color: Theme.colors.primary },
  communityDesc: { fontSize: Theme.font.xs, color: Theme.colors.secondary, marginTop: 2 },
  memberCount: { fontSize: Theme.font.xs, color: Theme.colors.disabled, marginTop: 2 },

  actionBtn: {
    backgroundColor: Theme.colors.accent, borderRadius: 100,
    paddingHorizontal: 16, paddingVertical: 6, minWidth: 52, alignItems: 'center',
  },
  actionBtnLeave: {
    backgroundColor: 'transparent',
    borderWidth: 1.5, borderColor: Theme.colors.border,
  },
  actionBtnText: { fontSize: Theme.font.sm, fontWeight: '700', color: Theme.colors.background },
  actionBtnTextLeave: { color: Theme.colors.secondary },

  empty: { paddingTop: 40, alignItems: 'center' },
  emptyText: { fontSize: Theme.font.sm, color: Theme.colors.secondary },
});
