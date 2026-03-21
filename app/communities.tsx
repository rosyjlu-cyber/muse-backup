import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Theme } from "@/constants/Theme";
import {
  cancelCommunityRequest,
  Community,
  Profile,
  createCommunity,
  getAllCommunities,
  joinCommunity,
  leaveCommunity,
  sendCommunityRequest,
  getMutualFollows,
  inviteUserToCommunity,
} from "@/utils/api";
import { useAuth } from "@/utils/auth";

export default function CommunitiesScreen() {
  const router = useRouter();
  const { session } = useAuth();

  const [all, setAll] = useState<Community[]>([]);
  const [search, setSearch] = useState("");
  const [loadingId, setLoadingId] = useState<string | null>(null);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createStep, setCreateStep] = useState<'form' | 'invite'>('form');
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPrivate, setNewPrivate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdCommunity, setCreatedCommunity] = useState<Community | null>(null);

  // Invite step
  const [mutuals, setMutuals] = useState<Profile[]>([]);
  const [invitingIds, setInvitingIds] = useState<Set<string>>(new Set());
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());

  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      getAllCommunities().then(setAll);
    }, [session]),
  );

  const updateStatus = (id: string, status: Community["join_status"]) =>
    setAll((prev) => {
      const updated = prev.map((c) =>
        c.id === id
          ? { ...c, join_status: status, is_member: status === "member" }
          : c,
      );
      // Re-sort: your communities first, then by member count
      updated.sort((a, b) => {
        const aMe = a.is_member ? 1 : 0;
        const bMe = b.is_member ? 1 : 0;
        if (aMe !== bMe) return bMe - aMe;
        return (b.member_count ?? 0) - (a.member_count ?? 0);
      });
      return updated;
    });

  const handleAction = async (community: Community) => {
    const status =
      community.join_status ?? (community.is_member ? "member" : "none");
    setLoadingId(community.id);
    try {
      if (status === "member") {
        await leaveCommunity(community.id);
        updateStatus(community.id, "none");
      } else if (status === "pending") {
        await cancelCommunityRequest(community.id);
        updateStatus(community.id, "none");
      } else if (community.is_private) {
        await sendCommunityRequest(community.id);
        updateStatus(community.id, "pending");
      } else {
        await joinCommunity(community.id);
        updateStatus(community.id, "member");
      }
    } catch (e: any) {
      Alert.alert("error", e?.message ?? "something went wrong");
    } finally {
      setLoadingId(null);
    }
  };

  const openCreateModal = () => {
    setNewName(""); setNewDesc(""); setNewPrivate(false);
    setCreateStep('form'); setCreatedCommunity(null);
    setInvitedIds(new Set()); setMutuals([]);
    setShowCreate(true);
  };

  const closeCreateModal = () => {
    setShowCreate(false);
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const c = await createCommunity({
        name: newName.trim(),
        slug: newName
          .trim()
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9-]/g, "")
          + "-" + Math.random().toString(36).slice(2, 6),
        description: newDesc.trim(),
        is_private: newPrivate,
      });
      setAll((prev) => [{ ...c, join_status: "member" }, ...prev]);
      setCreatedCommunity(c);
      setCreateStep('invite');
      getMutualFollows().then(setMutuals).catch(() => {});
    } catch (e: any) {
      Alert.alert("error", e?.message ?? "could not create community");
    } finally {
      setCreating(false);
    }
  };

  const handleInviteMutual = async (userId: string) => {
    if (!createdCommunity) return;
    setInvitingIds(prev => new Set([...prev, userId]));
    try {
      await inviteUserToCommunity(createdCommunity.id, userId);
      setInvitedIds(prev => new Set([...prev, userId]));
    } catch {}
    finally { setInvitingIds(prev => { const n = new Set(prev); n.delete(userId); return n; }); }
  };

  const filtered = all.filter(
    (c) => !search || c.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backText}>‹ back</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.title}>communities</Text>

      {/* Search */}
      <View style={styles.searchRow}>
        <Feather
          name="search"
          size={15}
          color={Theme.colors.secondary}
          style={{ marginRight: 8 }}
        />
        <TextInput
          style={styles.searchInput}
          placeholder="search communities"
          placeholderTextColor={Theme.colors.disabled}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />
      </View>

      {/* List */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => {
          const status =
            item.join_status ?? (item.is_member ? "member" : "none");
          const busy = loadingId === item.id;
          const btnLabel =
            status === "member"
              ? "leave"
              : status === "pending"
                ? "requested"
                : "join";
          const isMember = status === "member";
          const isPending = status === "pending";
          return (
            <View style={styles.row}>
              <TouchableOpacity
                style={styles.rowContent}
                onPress={() =>
                  router.push({
                    pathname: "/community/[id]" as any,
                    params: { id: item.id },
                  })
                }
              >
                {item.avatar_url ? (
                  <Image source={{ uri: item.avatar_url }} style={styles.rowAvatar} contentFit="cover" cachePolicy="disk" />
                ) : (
                  <View style={styles.rowAvatarPlaceholder}>
                    <Feather name="users" size={16} color={Theme.colors.accent} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                <Text style={styles.communityName}>
                  {item.name}
                  {item.is_private && (
                    <Text style={{ fontSize: 12 }}>
                      {' '}<Feather name="lock" size={11} color={Theme.colors.secondary} />
                    </Text>
                  )}
                </Text>
                {item.description ? (
                  <Text style={styles.communityDesc} numberOfLines={1}>
                    {item.description}
                  </Text>
                ) : null}
                {item.member_count != null && (
                  <Text style={styles.memberCount}>
                    {item.member_count} member
                    {item.member_count !== 1 ? "s" : ""}
                  </Text>
                )}
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => handleAction(item)}
                disabled={busy}
                activeOpacity={0.8}
                style={busy ? { opacity: 0.5 } : undefined}
              >
                {isMember || isPending ? (
                  <View
                    style={[
                      styles.actionBtn,
                      isMember
                        ? styles.actionBtnLeave
                        : styles.actionBtnPending,
                    ]}
                  >
                    {busy ? (
                      <ActivityIndicator
                        size="small"
                        color={Theme.colors.secondary}
                      />
                    ) : (
                      <Text style={styles.actionBtnTextMuted}>{btnLabel}</Text>
                    )}
                  </View>
                ) : (
                  <LinearGradient
                    colors={["#F9C74F", "#F77FAD"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.actionBtn}
                  >
                    {busy ? (
                      <ActivityIndicator
                        size="small"
                        color={Theme.colors.primary}
                      />
                    ) : (
                      <Text style={styles.actionBtnText}>{btnLabel}</Text>
                    )}
                  </LinearGradient>
                )}
              </TouchableOpacity>
            </View>
          );
        }}
        ListEmptyComponent={
          search ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                no communities match your search.
              </Text>
            </View>
          ) : null
        }
      />

      {/* Start a community button */}
      <TouchableOpacity
        onPress={openCreateModal}
        activeOpacity={0.85}
        style={styles.bottomBtnWrap}
      >
        <LinearGradient
          colors={['#F9C74F', '#F77FAD']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.bottomBtn}
        >
          <Text style={styles.bottomBtnText}>start a community</Text>
        </LinearGradient>
      </TouchableOpacity>

      {/* Create community modal */}
      <Modal visible={showCreate} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.safe}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
            <View style={styles.modalHeader}>
              <View style={{ width: 40 }} />
              <Text style={styles.modalTitle}>
                {createStep === 'form' ? 'new community' : 'invite friends'}
              </Text>
              <TouchableOpacity onPress={closeCreateModal} hitSlop={12}>
                <Text style={styles.modalClose}>{createStep === 'invite' ? 'done' : 'cancel'}</Text>
              </TouchableOpacity>
            </View>

            {createStep === 'form' ? (
              <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
                <TextInput
                  style={styles.formInput}
                  placeholder="name your vibe"
                  placeholderTextColor={Theme.colors.disabled}
                  value={newName}
                  onChangeText={setNewName}
                  autoFocus
                />
                <TextInput
                  style={[styles.formInput, { minHeight: 56 }]}
                  placeholder="what's it about? (optional)"
                  placeholderTextColor={Theme.colors.disabled}
                  value={newDesc}
                  onChangeText={setNewDesc}
                  multiline
                />
                <TouchableOpacity
                  style={styles.privacyToggle}
                  onPress={() => setNewPrivate(p => !p)}
                  activeOpacity={0.7}
                >
                  <Feather name={newPrivate ? 'lock' : 'globe'} size={13} color={Theme.colors.secondary} />
                  <Text style={styles.privacyToggleText}>{newPrivate ? 'private — invite only' : 'public — anyone can join'}</Text>
                  <Feather name="chevron-right" size={13} color={Theme.colors.disabled} />
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={handleCreate}
                  disabled={creating || !newName.trim()}
                  activeOpacity={0.85}
                  style={{ marginTop: 12, opacity: !newName.trim() ? 0.4 : 1 }}
                >
                  <LinearGradient
                    colors={['#F9C74F', '#F77FAD']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.createBtn}
                  >
                    {creating
                      ? <ActivityIndicator color="#0B0B0B" />
                      : <Text style={styles.createBtnText}>create</Text>
                    }
                  </LinearGradient>
                </TouchableOpacity>
              </ScrollView>
            ) : (
              <ScrollView contentContainerStyle={styles.modalContent}>
                <TouchableOpacity
                  onPress={() => {
                    if (!createdCommunity) return;
                    const url = `https://bemymuse.app/c/${createdCommunity.slug}`;
                    Share.share({ message: `join my community "${createdCommunity.name}" on muse — ${url}`, url });
                  }}
                  activeOpacity={0.85}
                >
                  <LinearGradient
                    colors={['#F9C74F', '#F77FAD']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.shareLinkBtn}
                  >
                    <Feather name="link" size={14} color={Theme.colors.primary} />
                    <Text style={styles.shareLinkText}>share invite link</Text>
                  </LinearGradient>
                </TouchableOpacity>

                {mutuals.length === 0 ? (
                  <Text style={styles.inviteEmpty}>no mutual friends to invite yet — share the link instead!</Text>
                ) : (
                  mutuals.map(p => {
                    const invited = invitedIds.has(p.id);
                    const inviting = invitingIds.has(p.id);
                    return (
                      <View key={p.id} style={styles.inviteRow}>
                        {p.avatar_url ? (
                          <Image source={{ uri: p.avatar_url }} style={styles.inviteAvatar} cachePolicy="disk" />
                        ) : (
                          <View style={styles.inviteAvatarPlaceholder}>
                            <Text style={styles.inviteAvatarInitial}>{(p.display_name ?? p.username ?? '?')[0].toUpperCase()}</Text>
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={styles.inviteName}>{p.display_name ?? p.username}</Text>
                          <Text style={styles.inviteUsername}>@{p.username}</Text>
                        </View>
                        {invited ? (
                          <Text style={styles.invitedText}>invited ✓</Text>
                        ) : inviting ? (
                          <ActivityIndicator size="small" color={Theme.colors.accent} />
                        ) : (
                          <TouchableOpacity style={styles.inviteSmallBtn} onPress={() => handleInviteMutual(p.id)} activeOpacity={0.8}>
                            <Text style={styles.inviteSmallBtnText}>invite</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })
                )}
              </ScrollView>
            )}
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Theme.colors.background },

  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
  backText: {
    fontSize: Theme.font.base,
    color: Theme.colors.primary,
    fontWeight: "600",
  },
  title: {
    fontFamily: Theme.font.brand,
    fontSize: 22,
    color: Theme.colors.primary,
    letterSpacing: -0.5,
    paddingHorizontal: 20,
    marginTop: 8,
    marginBottom: 16,
    textAlign: "center",
  },

  // Modal
  modalHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Theme.colors.border,
  },
  modalTitle: {
    fontFamily: Theme.font.brand, fontSize: 20,
    color: Theme.colors.primary, textAlign: "center", flex: 1,
  },
  modalClose: { fontSize: Theme.font.sm, fontWeight: "600", color: Theme.colors.accent, width: 40, textAlign: "right" },
  modalContent: { padding: 20, gap: 10 },

  formInput: {
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.radius.md,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: Theme.font.base,
    color: Theme.colors.primary,
  },
  createBtn: {
    borderRadius: 100,
    paddingVertical: 10, paddingHorizontal: 20,
    alignItems: "center",
  },
  createBtnText: {
    fontSize: Theme.font.sm,
    fontWeight: "700",
    color: Theme.colors.primary,
  },

  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 20,
    marginBottom: 8,
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: Theme.font.base,
    color: Theme.colors.primary,
  },

  list: { paddingHorizontal: 20, paddingBottom: 40 },

  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
  },
  rowContent: { flex: 1, flexDirection: "row", alignItems: "flex-start", gap: 12 },
  rowAvatar: { width: 40, height: 40, borderRadius: 20 },
  rowAvatarPlaceholder: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Theme.colors.surface, borderWidth: 1, borderColor: Theme.colors.border,
    alignItems: "center", justifyContent: "center",
  },
  communityName: {
    fontSize: Theme.font.base,
    fontWeight: "700",
    color: Theme.colors.primary,
  },
  communityDesc: {
    fontSize: Theme.font.xs,
    color: Theme.colors.secondary,
    marginTop: 2,
  },
  memberCount: {
    fontSize: Theme.font.xs,
    color: Theme.colors.disabled,
    marginTop: 2,
  },

  actionBtn: {
    borderRadius: 100,
    paddingHorizontal: 16,
    paddingVertical: 6,
    minWidth: 72,
    alignItems: "center",
  },
  actionBtnLeave: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: Theme.colors.border,
  },
  actionBtnPending: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: Theme.colors.secondary,
  },
  actionBtnText: {
    fontSize: Theme.font.sm,
    fontWeight: "700",
    color: Theme.colors.primary,
  },
  actionBtnTextMuted: {
    fontSize: Theme.font.sm,
    fontWeight: "700",
    color: Theme.colors.secondary,
  },

  empty: { paddingTop: 40, alignItems: "center" },
  emptyText: { fontSize: Theme.font.sm, color: Theme.colors.secondary },

  privacyToggle: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 8,
  },
  privacyToggleText: { fontSize: Theme.font.xs, color: Theme.colors.secondary, flex: 1 },
  bottomBtnWrap: { paddingHorizontal: 20, paddingVertical: 12 },
  bottomBtn: {
    borderRadius: 100, paddingVertical: 14, alignItems: "center",
  },
  bottomBtnText: { fontSize: Theme.font.base, fontWeight: "700", color: Theme.colors.primary },

  // Invite step
  shareLinkBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderRadius: 100, paddingVertical: 12, marginBottom: 16,
  },
  shareLinkText: { fontSize: Theme.font.sm, fontWeight: "700", color: Theme.colors.primary },
  inviteEmpty: { fontSize: Theme.font.sm, color: Theme.colors.secondary, textAlign: "center", marginTop: 20 },
  inviteRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Theme.colors.border,
  },
  inviteAvatar: { width: 40, height: 40, borderRadius: 20 },
  inviteAvatarPlaceholder: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Theme.colors.surface, borderWidth: 1, borderColor: Theme.colors.border,
    alignItems: "center", justifyContent: "center",
  },
  inviteAvatarInitial: { fontSize: Theme.font.sm, fontWeight: "700", color: Theme.colors.primary },
  inviteName: { fontSize: Theme.font.sm, fontWeight: "600", color: Theme.colors.primary },
  inviteUsername: { fontSize: Theme.font.xs, color: Theme.colors.secondary, marginTop: 1 },
  invitedText: { fontSize: Theme.font.xs, fontWeight: "600", color: Theme.colors.accent },
  inviteSmallBtn: {
    backgroundColor: Theme.colors.accent, borderRadius: 100,
    paddingHorizontal: 14, paddingVertical: 6,
  },
  inviteSmallBtnText: { fontSize: Theme.font.xs, fontWeight: "700", color: "#fff" },
});
