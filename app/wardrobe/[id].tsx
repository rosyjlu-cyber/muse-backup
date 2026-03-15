import { useCallback, useState } from 'react';
import {
  View, Text, Image, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, Platform,
  ActivityIndicator, Linking, Dimensions,
  KeyboardAvoidingView, StatusBar, Modal, FlatList,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';

import { Theme } from '@/constants/Theme';
import {
  getWardrobeItem, updateWardrobeItem, deleteWardrobeItem,
  addWardrobeItemPhoto, getItemPosts, getWardrobeItems, mergeWardrobeItems,
  addPostWardrobeItem, getMyPosts,
  WardrobeItem, Post,
} from '@/utils/api';
import { useAuth } from '@/utils/auth';
import { loadUserCats, saveUserCat, removeUserCat } from '@/components/WardrobeGrid';

const SW = Math.min(Dimensions.get('window').width, 390);
const THUMB = 120;
const WORN_SIZE = Math.floor((SW - 32 - 16) / 3);
const MERGE_CELL = Math.floor((SW - 32 - 16) / 3);
const COMPARE_IMG = Math.floor((SW - 32 - 12) / 2) - 20;

const CATEGORIES = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'bag', 'accessory'];

function catEmoji(cat: string | null) {
  const map: Record<string, string> = {
    top: '👕', bottom: '👖', outerwear: '🧥', shoes: '👟',
    bag: '👜', dress: '👗', accessory: '💍',
  };
  return cat ? (map[cat] ?? '🏷️') : '🏷️';
}

export default function WardrobeItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuth();

  const [item, setItem] = useState<WardrobeItem | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [editLabel, setEditLabel] = useState('');
  const [editBrand, setEditBrand] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editLink, setEditLink] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [addingPhoto, setAddingPhoto] = useState(false);
  const [showCustomCat, setShowCustomCat] = useState(false);
  const [showTagInput, setShowTagInput] = useState(false);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [userCats, setUserCats] = useState<string[]>([]);

  // Worn-in edit state
  const [wornInEdit, setWornInEdit] = useState(false);
  const [postPickerVisible, setPostPickerVisible] = useState(false);
  const [allUserPosts, setAllUserPosts] = useState<Post[]>([]);
  const [addingPostLink, setAddingPostLink] = useState(false);

  // Merge state
  const [mergeVisible, setMergeVisible] = useState(false);
  const [mergeItems, setMergeItems] = useState<WardrobeItem[]>([]);
  const [mergeTarget, setMergeTarget] = useState<WardrobeItem | null>(null);
  const [keepCurrentImage, setKeepCurrentImage] = useState(true);
  const [merging, setMerging] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadUserCats().then(setUserCats);
      getWardrobeItem(id).then(w => {
        if (w) {
          setItem(w);
          setEditLabel(w.label);
          setEditBrand((w as any).brand ?? '');
          setEditDesc('');
          setEditLink(w.link_url ?? '');
          setEditTags(w.tags ?? []);
        }
      });
      getItemPosts(id).then(setPosts).catch(() => {});
      getWardrobeItems(session?.user.id ?? '').then(all => {
        const tags = [...new Set(all.flatMap(i => (i as any).tags ?? []))] as string[];
        setAllTags(tags);
      }).catch(() => {});
    }, [id, session?.user.id]),
  );

  const save = async (updates: Parameters<typeof updateWardrobeItem>[1]) => {
    if (!item) return;
    setItem(i => i ? { ...i, ...updates } : i);
    await updateWardrobeItem(item.id, updates).catch(() => {});
  };

  const handleSetCategory = async (cat: string | null) => {
    const newCat = item?.category === cat ? null : cat;
    save({ category: newCat });
    if (newCat && !CATEGORIES.includes(newCat)) {
      const updated = await saveUserCat(newCat, userCats);
      setUserCats(updated);
    }
  };

  const handleDeleteUserCat = (cat: string) => {
    Alert.alert(`remove "${cat}"?`, 'it will be removed from the category list.', [
      { text: 'cancel', style: 'cancel' },
      {
        text: 'remove', style: 'destructive', onPress: async () => {
          const updated = await removeUserCat(cat, userCats);
          setUserCats(updated);
          if (item?.category === cat) save({ category: null });
        },
      },
    ]);
  };

  const handleAddTag = (tag: string) => {
    const t = tag.trim().toLowerCase();
    if (!t || editTags.includes(t)) return;
    const updated = [...editTags, t];
    setEditTags(updated);
    save({ tags: updated });
  };

  const handleRemoveTag = (tag: string) => {
    const updated = editTags.filter(t => t !== tag);
    setEditTags(updated);
    save({ tags: updated });
  };

  const handleOpenLink = () => {
    if (!item?.link_url) return;
    const url = item.link_url.startsWith('http') ? item.link_url : `https://${item.link_url}`;
    Linking.openURL(url).catch(() => {});
  };

  const handleAddPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('photo access needed'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled || !item) return;
    setAddingPhoto(true);
    try {
      const newPhoto = await addWardrobeItemPhoto(item.id, result.assets[0].uri);
      setItem(i => i ? { ...i, photos: [...(i.photos ?? []), newPhoto] } : i);
    } catch (e: any) {
      Alert.alert('oops', e?.message ?? 'could not add photo');
    } finally {
      setAddingPhoto(false);
    }
  };

  const handleDelete = () => {
    if (Platform.OS === 'web') {
      if (!window.confirm("delete this item?")) return;
      deleteWardrobeItem(id).then(() => router.back()).catch(() => {});
      return;
    }
    Alert.alert('delete item?', "it'll be removed from all your outfits.", [
      { text: 'cancel', style: 'cancel' },
      {
        text: 'delete', style: 'destructive', onPress: () => {
          deleteWardrobeItem(id).then(() => router.back()).catch(e => {
            Alert.alert('error', e?.message ?? 'could not delete item');
          });
        },
      },
    ]);
  };

  const handleOpenPostPicker = async () => {
    const all = await getMyPosts().catch(() => []);
    const linkedIds = new Set(posts.map(p => p.id));
    setAllUserPosts(all.filter(p => !linkedIds.has(p.id)));
    setPostPickerVisible(true);
  };

  const handleAddPostLink = async (post: Post) => {
    setAddingPostLink(true);
    try {
      await addPostWardrobeItem(post.id, id);
      setPosts(prev => [...prev, post]);
      setAllUserPosts(prev => prev.filter(p => p.id !== post.id));
    } catch (e: any) {
      Alert.alert('error', e?.message ?? 'could not link outfit');
    } finally {
      setAddingPostLink(false);
    }
  };

  const handleOpenMerge = async () => {
    if (!session?.user.id) return;
    const all = await getWardrobeItems(session.user.id);
    setMergeItems(all.filter(i => i.id !== id));
    setMergeTarget(null);
    setKeepCurrentImage(true);
    setMergeVisible(true);
  };

  const handleMerge = async () => {
    if (!item || !mergeTarget) return;
    setMerging(true);
    try {
      await mergeWardrobeItems(item.id, mergeTarget.id, !keepCurrentImage);
      const updated = await getWardrobeItem(id);
      if (updated) {
        setItem(updated);
        setEditLabel(updated.label);
        setEditBrand((updated as any).brand ?? '');
        setEditDesc(prev => prev); // keep user-edited notes as-is
        setEditLink(updated.link_url ?? '');
        setEditTags(updated.tags ?? []);
      }
      getItemPosts(id).then(setPosts).catch(() => {});
      setMergeVisible(false);
      setMergeTarget(null);
    } catch (e: any) {
      Alert.alert('error', e?.message ?? 'could not merge items');
    } finally {
      setMerging(false);
    }
  };

  if (!item) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator style={{ flex: 1 }} color={Theme.colors.brandWarm} />
      </SafeAreaView>
    );
  }

  const allImages = [
    ...(item.generated_image_url ? [{ id: 'ai', url: item.generated_image_url }] : []),
    ...(item.photos ?? []).map(p => ({ id: p.id, url: p.photo_url })),
  ];

  const allCats = [...CATEGORIES, ...userCats.filter(c => !CATEGORIES.includes(c))];
  // If item has a category not yet in allCats (e.g. set before userCats loaded), show it too
  if (item.category && !allCats.includes(item.category)) allCats.push(item.category);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={Theme.colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Feather name="chevron-left" size={22} color={Theme.colors.primary} />
          <Text style={styles.backText}>back</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

          {/* Item label — editable, no image regeneration */}
          <TextInput
            style={styles.itemLabel}
            value={editLabel}
            onChangeText={setEditLabel}
            onBlur={() => save({ label: editLabel.trim() || item.label })}
            placeholder="item name"
            placeholderTextColor={Theme.colors.disabled}
            multiline
            textAlignVertical="center"
          />

          {/* Photos row: thumbnails + "+" */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photosRow} style={styles.photosScroll}>
            {allImages.map(img => (
              <Image key={img.id} source={{ uri: img.url }} style={styles.photoThumb} resizeMode="cover" />
            ))}
            <TouchableOpacity
              style={styles.addPhotoThumb}
              onPress={handleAddPhoto}
              disabled={addingPhoto}
              activeOpacity={0.75}
            >
              {addingPhoto
                ? <ActivityIndicator size="small" color={Theme.colors.brandWarm} />
                : <Feather name="plus" size={26} color={Theme.colors.accent} />
              }
            </TouchableOpacity>
          </ScrollView>

          {/* Category chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catsScroll} contentContainerStyle={styles.catsContent}>
            {allCats.map(cat => {
              const isCustom = !CATEGORIES.includes(cat);
              return (
                <TouchableOpacity
                  key={cat}
                  style={[styles.catChip, item.category === cat && styles.catChipActive]}
                  onPress={() => handleSetCategory(cat)}
                  onLongPress={isCustom ? () => handleDeleteUserCat(cat) : undefined}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.catChipText, item.category === cat && styles.catChipTextActive]}>
                    {catEmoji(cat)} {cat}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {showCustomCat ? (
              <TextInput
                autoFocus
                style={[styles.catChip, styles.customCatInput]}
                placeholder="type..."
                placeholderTextColor={Theme.colors.disabled}
                returnKeyType="done"
                onSubmitEditing={e => {
                  const val = e.nativeEvent.text.trim().toLowerCase();
                  if (val) handleSetCategory(val);
                  setShowCustomCat(false);
                }}
                onBlur={() => setShowCustomCat(false)}
              />
            ) : (
              <TouchableOpacity style={styles.catChip} onPress={() => setShowCustomCat(true)} activeOpacity={0.75}>
                <Text style={styles.catChipText}>+ other</Text>
              </TouchableOpacity>
            )}
          </ScrollView>

          {/* Tags */}
          <View style={styles.tagsSection}>
            <Text style={styles.fieldLabel}>tags</Text>
            <View style={styles.tagsRow}>
              {showTagInput ? (
                <TextInput
                  autoFocus
                  style={styles.tagInput}
                  placeholder="add tag..."
                  placeholderTextColor={Theme.colors.disabled}
                  returnKeyType="done"
                  onSubmitEditing={e => {
                    handleAddTag(e.nativeEvent.text);
                    setShowTagInput(false);
                  }}
                  onBlur={() => setShowTagInput(false)}
                />
              ) : (
                <TouchableOpacity style={styles.tagChipAdd} onPress={() => setShowTagInput(true)} activeOpacity={0.7}>
                  <Feather name="plus" size={11} color={Theme.colors.disabled} />
                  <Text style={styles.tagChipAddText}>add</Text>
                </TouchableOpacity>
              )}
              {editTags.map(tag => (
                <TouchableOpacity key={tag} style={styles.tagChip} onPress={() => handleRemoveTag(tag)} activeOpacity={0.7}>
                  <Text style={styles.tagChipText}>{tag}</Text>
                  <Feather name="x" size={10} color={Theme.colors.disabled} style={{ marginLeft: 4 }} />
                </TouchableOpacity>
              ))}
              {allTags.filter(t => !editTags.includes(t)).map(tag => (
                <TouchableOpacity key={tag} style={styles.tagChipUnselected} onPress={() => handleAddTag(tag)} activeOpacity={0.7}>
                  <Text style={styles.tagChipUnselectedText}>{tag}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.divider} />

          {/* Brand */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>brand</Text>
            <TextInput
              style={styles.fieldInput}
              value={editBrand}
              onChangeText={setEditBrand}
              onBlur={() => save({ brand: editBrand.trim() || null })}
              placeholder=""
              placeholderTextColor={Theme.colors.disabled}
              returnKeyType="done"
              submitBehavior="blurAndSubmit"
            />
          </View>

          <View style={styles.divider} />

          {/* Description */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>notes</Text>
            <TextInput
              style={styles.descInput}
              value={editDesc}
              onChangeText={setEditDesc}
              onBlur={() => save({ description: editDesc.trim() || null })}
              placeholder=""
              placeholderTextColor={Theme.colors.disabled}
              multiline
              returnKeyType="done"
              submitBehavior="blurAndSubmit"
            />
          </View>

          <View style={styles.divider} />

          {/* Link */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>link</Text>
            <View style={styles.linkRow}>
              <TextInput
                style={[styles.fieldInput, { flex: 1 }]}
                value={editLink}
                onChangeText={setEditLink}
                onBlur={() => save({ link_url: editLink.trim() || null })}
                placeholder=""
                placeholderTextColor={Theme.colors.disabled}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="done"
                submitBehavior="blurAndSubmit"
              />
              {!!item.link_url && (
                <TouchableOpacity onPress={handleOpenLink} hitSlop={8}>
                  <Feather name="external-link" size={16} color={Theme.colors.accent} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Worn in */}
          <View style={styles.wornInSection}>
            <View style={styles.wornInHeader}>
              <Text style={styles.wornInTitle}>worn in</Text>
              <TouchableOpacity onPress={() => setWornInEdit(e => !e)} hitSlop={10} activeOpacity={0.7}>
                <Text style={styles.wornInEditBtn}>{wornInEdit ? 'done' : 'edit'}</Text>
              </TouchableOpacity>
            </View>
            {(posts.length > 0 || wornInEdit) && (
              <View style={styles.wornInGrid}>
                {posts.map(post => (
                  <TouchableOpacity
                    key={post.id}
                    style={styles.wornInThumb}
                    onPress={() => router.push({ pathname: '/entry/[date]' as any, params: { date: post.date } })}
                    activeOpacity={0.82}
                  >
                    <Image source={{ uri: post.photo_url }} style={styles.wornInImg} resizeMode="cover" />
                  </TouchableOpacity>
                ))}
                {wornInEdit && (
                  <TouchableOpacity
                    style={styles.wornInAddThumb}
                    onPress={handleOpenPostPicker}
                    activeOpacity={0.75}
                  >
                    <Feather name="plus" size={22} color={Theme.colors.accent} />
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>

          {/* Merge */}
          <TouchableOpacity onPress={handleOpenMerge} activeOpacity={0.75} style={styles.mergeActionBtn}>
            <Text style={styles.mergeActionText}>merge with another item</Text>
          </TouchableOpacity>

          {/* Remove */}
          <TouchableOpacity style={styles.removeBtn} onPress={handleDelete} activeOpacity={0.7} hitSlop={12}>
            <Feather name="trash-2" size={18} color={Theme.colors.accent} />
          </TouchableOpacity>

        </ScrollView>
      </KeyboardAvoidingView>

      {/* Post picker modal */}
      <Modal
        visible={postPickerVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPostPickerVisible(false)}
      >
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setPostPickerVisible(false)} hitSlop={12}>
              <Feather name="x" size={20} color={Theme.colors.primary} />
            </TouchableOpacity>
            <Text style={[styles.modalTitle, styles.modalTitleCaprasimo]}>also worn in</Text>
            <View style={{ width: 20 }} />
          </View>
          {addingPostLink && (
            <ActivityIndicator style={{ marginTop: 16 }} color={Theme.colors.brandWarm} />
          )}
          <FlatList
            data={allUserPosts}
            keyExtractor={p => p.id}
            numColumns={3}
            contentContainerStyle={styles.postPickerGrid}
            columnWrapperStyle={styles.mergeGridRow}
            renderItem={({ item: post }) => (
              <TouchableOpacity
                style={styles.postPickerCell}
                onPress={() => handleAddPostLink(post)}
                activeOpacity={0.8}
                disabled={addingPostLink}
              >
                <Image source={{ uri: post.photo_url }} style={styles.postPickerImg} resizeMode="cover" />
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View style={styles.mergeEmpty}>
                <Text style={styles.mergeEmptyText}>no other outfits to add</Text>
              </View>
            }
          />
        </SafeAreaView>
      </Modal>

      {/* Merge modal */}
      <Modal
        visible={mergeVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => { if (mergeTarget) setMergeTarget(null); else setMergeVisible(false); }}
      >
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <TouchableOpacity
              onPress={() => { if (mergeTarget) setMergeTarget(null); else setMergeVisible(false); }}
              hitSlop={12}
            >
              <Feather name={mergeTarget ? 'arrow-left' : 'x'} size={20} color={Theme.colors.primary} />
            </TouchableOpacity>
            <Text style={[styles.modalTitle, styles.modalTitleCaprasimo]}>
              {mergeTarget ? 'pick your fave photo' : 'merge with...'}
            </Text>
            <View style={{ width: 20 }} />
          </View>

          {!mergeTarget ? (
            /* Step 1: pick item to merge with */
            <FlatList
              data={mergeItems}
              keyExtractor={i => i.id}
              numColumns={3}
              contentContainerStyle={styles.mergeGrid}
              columnWrapperStyle={styles.mergeGridRow}
              renderItem={({ item: mi }) => {
                const imgUrl = mi.generated_image_url ?? mi.photos?.[0]?.photo_url;
                return (
                  <TouchableOpacity
                    style={styles.mergeCell}
                    onPress={() => { setMergeTarget(mi); setKeepCurrentImage(true); }}
                    activeOpacity={0.8}
                  >
                    {imgUrl ? (
                      <Image source={{ uri: imgUrl }} style={styles.mergeCellImage} resizeMode="contain" />
                    ) : (
                      <View style={[styles.mergeCellImage, styles.mergePlaceholder]}>
                        <Text style={{ fontSize: 28 }}>{catEmoji(mi.category)}</Text>
                      </View>
                    )}
                    <Text style={styles.mergeCellLabel} numberOfLines={2}>{mi.label}</Text>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={styles.mergeEmpty}>
                  <Text style={styles.mergeEmptyText}>no other items to merge with</Text>
                </View>
              }
            />
          ) : (
            /* Step 2: choose image + confirm */
            <ScrollView contentContainerStyle={styles.mergeConfirmContent}>
              <Text style={styles.mergeHint}>
                these two are the same thing — pick the photo you love most and we'll combine all your outfits ✨
              </Text>
              <View style={styles.mergeCompare}>
                {[
                  { wi: item, isCurrent: true },
                  { wi: mergeTarget, isCurrent: false },
                ].map(({ wi, isCurrent }) => {
                  const imgUrl = wi.generated_image_url ?? wi.photos?.[0]?.photo_url;
                  const selected = isCurrent ? keepCurrentImage : !keepCurrentImage;
                  return (
                    <TouchableOpacity
                      key={wi.id}
                      style={[styles.mergeCompareCol, selected && styles.mergeCompareColActive]}
                      onPress={() => setKeepCurrentImage(isCurrent)}
                      activeOpacity={0.85}
                    >
                      {imgUrl ? (
                        <Image source={{ uri: imgUrl }} style={styles.mergeCompareImg} resizeMode="contain" />
                      ) : (
                        <View style={[styles.mergeCompareImg, styles.mergePlaceholder]}>
                          <Text style={{ fontSize: 36 }}>{catEmoji(wi.category)}</Text>
                        </View>
                      )}
                      <Text style={styles.mergeCompareLabel} numberOfLines={2}>{wi.label}</Text>
                      {selected && (
                        <View style={styles.mergeCheck}>
                          <Feather name="check" size={12} color="#fff" />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.mergeWarning}>
                the other item quietly disappears after merging
              </Text>
              <TouchableOpacity
                onPress={handleMerge}
                disabled={merging}
                activeOpacity={0.82}
                style={merging ? { opacity: 0.5 } : undefined}
              >
                <LinearGradient
                  colors={['#fdf5b9', '#f0c8e8', '#e9b3ee']}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={styles.mergeConfirmBtn}
                >
                  {merging
                    ? <ActivityIndicator color="#9B4D7E" />
                    : <Text style={styles.mergeConfirmBtnText}>merge ✨</Text>
                  }
                </LinearGradient>
              </TouchableOpacity>
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
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backText: { fontSize: Theme.font.sm, fontWeight: '600', color: Theme.colors.primary },

  content: { paddingBottom: 52 },

  // Photos row
  photosScroll: { marginBottom: 20 },
  photosRow: { paddingHorizontal: 16, gap: 10 },
  photoThumb: {
    width: THUMB, height: THUMB,
    borderRadius: 14, backgroundColor: Theme.colors.surface,
  },
  addPhotoThumb: {
    width: THUMB, height: THUMB, borderRadius: 14,
    borderWidth: 1.5, borderColor: Theme.colors.accent,
    borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,59,48,0.04)',
  },

  // Category chips
  catsScroll: { marginBottom: 28 },
  catsContent: { paddingHorizontal: 16, gap: 8, flexDirection: 'row' },
  catChip: {
    paddingHorizontal: 13, paddingVertical: 7,
    borderRadius: 100, borderWidth: 1,
    borderColor: 'rgba(90,143,168,0.25)',
    backgroundColor: 'rgba(166,194,215,0.18)',
  },
  catChipActive: {
    backgroundColor: '#4A7A96', borderColor: '#4A7A96',
  },
  catChipText: { fontSize: Theme.font.xs, fontWeight: '600', color: '#4A7A96' },
  catChipTextActive: { color: '#fff' },
  customCatInput: { minWidth: 80, fontSize: Theme.font.xs, color: Theme.colors.primary },

  // Tags
  tagsSection: { paddingHorizontal: 16, marginBottom: 20 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 4 },
  tagChip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 100, borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  tagChipText: { fontSize: Theme.font.xs, color: Theme.colors.primary, fontWeight: '500' },
  tagChipAdd: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 100, borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.10)',
    borderStyle: 'dashed',
  },
  tagChipAddText: { fontSize: Theme.font.xs, color: Theme.colors.disabled },
  tagChipUnselected: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 100, borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.07)',
    backgroundColor: 'transparent',
  },
  tagChipUnselectedText: { fontSize: Theme.font.xs, color: Theme.colors.disabled },
  tagInput: {
    fontSize: Theme.font.xs, color: Theme.colors.primary,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 100, borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.15)',
    minWidth: 80,
  },

  // Fields
  field: { paddingHorizontal: 16, marginBottom: 20 },
  fieldLabel: {
    fontSize: 10, fontWeight: '700', letterSpacing: 0.9,
    color: Theme.colors.disabled, textTransform: 'uppercase', marginBottom: 8,
  },
  fieldInput: {
    fontSize: Theme.font.base, color: Theme.colors.primary,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Theme.colors.border,
    paddingBottom: 8,
  },
  descInput: {
    fontSize: Theme.font.base, color: Theme.colors.primary,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Theme.colors.border,
    paddingBottom: 8,
  },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Theme.colors.border, marginHorizontal: 16, marginBottom: 20 },

  // Worn in
  wornInSection: { paddingHorizontal: 16, marginTop: 8 },
  wornInHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  wornInTitle: {
    fontSize: 10, fontWeight: '700', letterSpacing: 0.9,
    color: Theme.colors.disabled, textTransform: 'uppercase',
  },
  wornInEditBtn: { fontSize: Theme.font.xs, fontWeight: '600', color: Theme.colors.secondary },
  wornInGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  wornInThumb: { width: WORN_SIZE, height: WORN_SIZE, borderRadius: 10, overflow: 'hidden' },
  wornInImg: { width: WORN_SIZE, height: WORN_SIZE },
  wornInAddThumb: {
    width: WORN_SIZE, height: WORN_SIZE, borderRadius: 10,
    borderWidth: 1.5, borderColor: Theme.colors.accent, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(58,135,181,0.04)',
  },

  // Post picker
  postPickerGrid: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32 },
  postPickerCell: { width: MERGE_CELL, marginBottom: 0 },
  postPickerImg: { width: MERGE_CELL, height: MERGE_CELL, borderRadius: 10 },

  // Item label (editable)
  itemLabel: {
    fontFamily: 'Caprasimo_400Regular',
    fontSize: Theme.font.lg, color: Theme.colors.primary,
    paddingHorizontal: 16, marginBottom: 32, marginTop: 2,
    textAlign: 'center', lineHeight: 30,
  },

  // Merge + remove at bottom
  mergeActionBtn: {
    alignSelf: 'center', marginTop: 52,
    paddingHorizontal: 24, paddingVertical: 11,
    borderRadius: 100, backgroundColor: 'rgba(232,39,45,0.10)',
  },
  mergeActionText: { fontSize: Theme.font.sm, fontWeight: '600', color: Theme.colors.brandWarm },
  removeBtn: { alignSelf: 'center', marginTop: 16, marginBottom: 8, paddingVertical: 8, paddingHorizontal: 16 },

  // Merge modal
  modalSafe: { flex: 1, backgroundColor: Theme.colors.background },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Theme.colors.border,
  },
  modalTitle: { fontSize: Theme.font.base, fontWeight: '700', color: Theme.colors.primary },
  modalTitleCaprasimo: { fontFamily: 'Caprasimo_400Regular', fontWeight: undefined, fontSize: Theme.font.md },

  // Merge picker grid
  mergeGrid: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32 },
  mergeGridRow: { gap: 8, marginBottom: 8 },
  mergeCell: { width: MERGE_CELL },
  mergeCellImage: {
    width: MERGE_CELL, height: MERGE_CELL, borderRadius: 12,
    backgroundColor: '#fff', overflow: 'hidden',
  },
  mergePlaceholder: { backgroundColor: Theme.colors.surface, alignItems: 'center', justifyContent: 'center' },
  mergeCellLabel: {
    fontSize: 10, color: Theme.colors.primary, fontWeight: '500',
    marginTop: 4, textAlign: 'center',
  },
  mergeEmpty: { flex: 1, alignItems: 'center', paddingTop: 48 },
  mergeEmptyText: { fontSize: Theme.font.sm, color: Theme.colors.disabled },

  // Merge confirm
  mergeConfirmContent: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 40 },
  mergeHint: {
    fontSize: Theme.font.sm, color: Theme.colors.secondary,
    textAlign: 'center', lineHeight: 20, marginBottom: 24,
  },
  mergeCompare: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  mergeCompareCol: {
    flex: 1, alignItems: 'center', borderRadius: 16, padding: 8,
    borderWidth: 2, borderColor: 'transparent', position: 'relative',
  },
  mergeCompareColActive: {
    borderColor: '#E879A8', backgroundColor: 'rgba(240,168,212,0.10)',
  },
  mergeCompareImg: {
    width: COMPARE_IMG, height: COMPARE_IMG, borderRadius: 12, backgroundColor: '#fff',
  },
  mergeCompareLabel: {
    fontSize: Theme.font.xs, color: Theme.colors.primary,
    fontWeight: '500', textAlign: 'center', marginTop: 8,
  },
  mergeCheck: {
    position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#E879A8', alignItems: 'center', justifyContent: 'center',
  },
  mergeWarning: {
    fontSize: Theme.font.xs, color: Theme.colors.disabled,
    textAlign: 'center', lineHeight: 18, marginBottom: 20,
  },
  mergeConfirmBtn: {
    borderRadius: Theme.radius.md, paddingVertical: 16, alignItems: 'center',
  },
  mergeConfirmBtnText: { fontSize: Theme.font.base, fontWeight: '700', color: '#7C3060' },
});
