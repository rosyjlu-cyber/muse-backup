/**
 * Multi-step onboarding flow.
 * Steps: welcome → phone → otp → name → avatar → contacts → community → done
 *
 * Phone auth requires a Supabase SMS provider configured in your dashboard
 * under Authentication → Providers → Phone.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ScrollView,
  FlatList,
  KeyboardAvoidingView,
  StyleSheet,
  Dimensions,
  Platform,
  ActivityIndicator,
  Alert,
  Keyboard,
  Linking,
  Share,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';

import { Theme } from '@/constants/Theme';
import {
  sendPhoneOTP, verifyPhoneOTP,
  checkUsernameAvailable, updateProfile, uploadAvatar,
  getAllCommunities, joinCommunity, createCommunity, deleteCommunity,
  Community,
} from '@/utils/api';
import { useAuth } from '@/utils/auth';

const { width: SW, height: SH } = Dimensions.get('window');

// The same blob SVG path used in the journal hero
const BLOB_PATH = 'M30.5054 40.5625C-5.49458 72.5625 17.5054 101.562 17.5054 101.562C17.5054 101.562 29.5174 111.958 30.5054 125.562C33.2106 162.812 6.50542 152.562 0.505417 196.562C8.50541 246.562 34.9904 247.443 44.5054 274.563C56.5302 308.835 25.5054 334.563 17.5054 372.563C17.5054 412.563 29.5676 442.268 65.5054 453.563C127.505 473.048 125.505 414.461 158.505 416.562C189.505 436.562 175.505 475.563 228.505 475.563C263.505 467.562 276.505 411.563 276.505 372.563C276.505 329.269 237.723 317.322 244.505 274.563C249.416 243.605 274.457 189.931 263.505 160.563C256.324 141.304 256.445 142.293 244.505 125.562C215.069 84.3156 311.505 73.5625 238.505 8.56246C160.505 -21.4375 168.505 40.5625 107.505 59.5625C82.9587 67.2082 71.5054 20.5625 30.5054 40.5625Z';

// Blob sized by height so it never overflows on any phone (used in done screen)
const BLOB_H = Math.round(SH * 0.42);
const BLOB_W = Math.round(BLOB_H * (277 / 477));

// Larger blob for welcome screen background layer
const BLOB_BIG_H = Math.round(SH * 0.74);
const BLOB_BIG_W = Math.round(BLOB_BIG_H * (277 / 477));

type Step = 'welcome' | 'phone' | 'otp' | 'setup' | 'contacts' | 'community' | 'notifications' | 'done';

const COUNTRY_CODES = [
  { code: '+1',  label: 'United States (+1)' },
  { code: '+44', label: 'United Kingdom (+44)' },
  { code: '+61', label: 'Australia (+61)' },
  { code: '+1',  label: 'Canada (+1)' },
  { code: '+33', label: 'France (+33)' },
  { code: '+49', label: 'Germany (+49)' },
  { code: '+81', label: 'Japan (+81)' },
  { code: '+82', label: 'South Korea (+82)' },
  { code: '+91', label: 'India (+91)' },
  { code: '+55', label: 'Brazil (+55)' },
  { code: '+52', label: 'Mexico (+52)' },
];

// Warm editorial gradient for bg: cream → peach → pink → lavender
const BG_COLORS = ['#fdf5b9', '#f0c8e8', '#e9b3ee'] as const;
// Accent gradient for buttons/highlights: yellow → pink
const ACCENT_GRAD = ['#F9C74F', '#F77FAD'] as const;

const STYLE_TAGS = [
  'minimalist', 'streetwear', 'vintage', 'preppy', 'athleisure',
  'business casual', 'boho', 'Y2K', 'cottagecore', 'dark academia',
  'old money', 'grunge', 'coastal', 'feminine', 'edgy',
  'classic', 'sporty', 'artsy', 'maximalist', 'thrift',
  'quiet luxury', 'clean girl', 'coquette', 'ballet core',
  'goth', 'kawaii', 'western', 'crunchy',
];

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, profile, reloadSession, refreshProfile } = useAuth();

  const [step, setStep] = useState<Step>('welcome');

  // Phone
  const [countryCode, setCountryCode] = useState('+1');
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [sendingOTP, setSendingOTP] = useState(false);

  // OTP
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const otpRefs = useRef<Array<TextInput | null>>([]);
  const [verifyingOTP, setVerifyingOTP] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);

  // Name
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const usernameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  // Avatar
  const [avatarUri, setAvatarUri] = useState<string | null>(null);

  // Date of birth
  const [birthDate, setBirthDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);

  // About (bio, location, style tags)
  const [bio, setBio] = useState('');
  const [location, setLocation] = useState('');
  const [styleTags, setStyleTags] = useState<string[]>([]);
  const [customTagInput, setCustomTagInput] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [contactSearch, setContactSearch] = useState('');

  // T&C
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [agreedToPrivacy, setAgreedToPrivacy] = useState(false);

  // Contacts
  const [contactsPermission, setContactsPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [contactsLoading, setContactsLoading] = useState(false);
  const [museContacts, setMuseContacts] = useState<Array<{ name: string; phone: string }>>([]);

  // Keyboard height (used by phone step to float button above keypad)
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', e => setKbHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKbHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // Community
  const [communities, setCommunities] = useState<Community[]>([]);
  const [joinedIds, setJoinedIds] = useState<Set<string>>(new Set());
  const [loadingCommunities, setLoadingCommunities] = useState(false);
  const [showCreateCommunity, setShowCreateCommunity] = useState(false);
  const [newCommunityName, setNewCommunityName] = useState('');
  const [creatingCommunity, setCreatingCommunity] = useState(false);
  const [createdCommunity, setCreatedCommunity] = useState<Community | null>(null);

  useEffect(() => {
    if (session && profile?.display_name) completeOnboarding();
  }, []);

  useEffect(() => {
    if (resendTimer <= 0) return;
    const t = setTimeout(() => setResendTimer(r => r - 1), 1000);
    return () => clearTimeout(t);
  }, [resendTimer]);

  useEffect(() => {
    const cleaned = username.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (cleaned !== username) setUsername(cleaned);
    if (usernameTimer.current) clearTimeout(usernameTimer.current);
    if (cleaned.length < 3) { setUsernameStatus('idle'); return; }
    setUsernameStatus('checking');
    usernameTimer.current = setTimeout(async () => {
      const available = await checkUsernameAvailable(cleaned);
      setUsernameStatus(available ? 'available' : 'taken');
    }, 500);
  }, [username]);

  useEffect(() => {
    if (step === 'community') loadCommunities();
  }, [step]);

  const fullPhone = `${countryCode}${phoneNumber.replace(/\D/g, '')}`;

  const completeOnboarding = async () => {
    await refreshProfile();
    await AsyncStorage.setItem('muse_onboarding_done', 'true');
    router.replace('/(tabs)' as any);
  };

  const goBack = () => {
    const order: Step[] = ['welcome', 'phone', 'otp', 'setup', 'contacts', 'community', 'notifications', 'done'];
    const idx = order.indexOf(step);
    if (idx > 0) setStep(order[idx - 1]);
  };

  const showError = (msg: string) =>
    Platform.OS === 'web' ? window.alert(msg) : Alert.alert('oops', msg);

  const getAge = (dob: Date) => {
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
    return age;
  };

  // ─── Phone ────────────────────────────────────────────────────────────────
  const handleSendOTP = async () => {
    const digits = phoneNumber.replace(/\D/g, '');
    if (digits.length < 7) { showError('please enter a valid phone number'); return; }
    setSendingOTP(true);
    try {
      const { error } = await sendPhoneOTP(fullPhone);
      if (error) { showError(error.message); return; }
      setOtp(['', '', '', '', '', '']);
      setResendTimer(60);
      setStep('otp');
      setTimeout(() => otpRefs.current[0]?.focus(), 300);
    } finally { setSendingOTP(false); }
  };

  const handleOTPChange = (val: string, idx: number) => {
    const cleaned = val.replace(/\D/g, '');
    // iOS autofill pastes the full code into the first box
    if (cleaned.length > 1) {
      const digits = cleaned.slice(0, 6).split('');
      const next = [...otp];
      digits.forEach((d, i) => { if (i < 6) next[i] = d; });
      setOtp(next);
      const lastFilled = Math.min(digits.length - 1, 5);
      otpRefs.current[lastFilled]?.focus();
      if (next.every(d => d !== '')) handleVerifyOTP(next.join(''));
      return;
    }
    const digit = cleaned.slice(-1);
    const next = [...otp]; next[idx] = digit; setOtp(next);
    if (digit && idx < 5) otpRefs.current[idx + 1]?.focus();
    if (next.every(d => d !== '')) handleVerifyOTP(next.join(''));
  };

  const handleOTPKeyPress = (key: string, idx: number) => {
    if (key === 'Backspace' && !otp[idx] && idx > 0) otpRefs.current[idx - 1]?.focus();
  };

  const handleVerifyOTP = async (code: string) => {
    setVerifyingOTP(true);
    try {
      const { data, error } = await verifyPhoneOTP(fullPhone, code);
      if (error) { showError(error.message); setOtp(['', '', '', '', '', '']); otpRefs.current[0]?.focus(); return; }
      if (data.session) await reloadSession(data.session);
      const p = await import('@/utils/api').then(m => m.getMyProfile());
      if (p?.display_name) { await completeOnboarding(); }
      else {
        setUsername(p?.username === p?.id ? '' : (p?.username ?? ''));
        setStep('setup');
      }
    } finally { setVerifyingOTP(false); }
  };

  // ─── Setup (name + avatar + bio + location + style tags combined) ────────
  const handlePickAvatar = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    if (!r.canceled && r.assets[0]) setAvatarUri(r.assets[0].uri);
  };

  const handleToggleStyleTag = (tag: string) => {
    setStyleTags(prev => {
      if (prev.includes(tag)) return prev.filter(t => t !== tag);
      if (prev.length >= 5) return prev;
      return [...prev, tag];
    });
  };

  const handleAddCustomTag = () => {
    const tag = customTagInput.trim().toLowerCase();
    if (!tag || styleTags.length >= 5 || styleTags.includes(tag)) return;
    setStyleTags(prev => [...prev, tag]);
    setCustomTagInput('');
  };

  const handleSaveSetup = async () => {
    if (!displayName.trim()) { showError('please enter your name'); return; }
    if (username.length < 3) { showError('username must be at least 3 characters'); return; }
    if (usernameStatus === 'taken') { showError('that username is taken'); return; }
    if (usernameStatus === 'checking') return;
    if (!birthDate) { showError('please enter your date of birth'); return; }
    if (getAge(birthDate) < 13) { showError('you must be 13 or older to use muse'); return; }
    setSavingProfile(true);
    try {
      const uid = session?.user.id; if (!uid) return;
      const updates: any = { display_name: displayName.trim(), username: username.toLowerCase(), birth_date: birthDate.toISOString().split('T')[0], is_public: isPublic };
      if (bio.trim()) updates.bio = bio.trim();
      if (location.trim()) updates.location = location.trim();
      if (styleTags.length > 0) updates.style_tags = styleTags;
      await updateProfile(uid, updates);
      if (avatarUri) {
        try {
          const url = await uploadAvatar(uid, avatarUri);
          await updateProfile(uid, { avatar_url: url });
        } catch {}
      }
      setStep('contacts');
    } catch (e: any) { showError(e?.message ?? 'could not save'); }
    finally { setSavingProfile(false); }
  };

  // ─── Notifications ────────────────────────────────────────────────────────
  const handleRequestNotifications = async () => {
    try {
      const Notifications = await import('expo-notifications').catch(() => null);
      if (Notifications) await Notifications.requestPermissionsAsync();
    } catch {}
    setStep('done');
  };

  // ─── Contacts ─────────────────────────────────────────────────────────────
  const handleRequestContacts = async () => {
    setContactsLoading(true);
    try {
      const Contacts = await import('expo-contacts').catch(() => null);
      if (!Contacts) { setContactsPermission('denied'); return; }
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') { setContactsPermission('denied'); return; }
      setContactsPermission('granted');
      const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers] });
      const contacts = data
        .filter(c => c.phoneNumbers?.length)
        .map(c => ({ name: c.name ?? 'Unknown', phone: c.phoneNumbers![0].number ?? '' }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setMuseContacts(contacts);
    } finally { setContactsLoading(false); }
  };

  // ─── Community ────────────────────────────────────────────────────────────
  const loadCommunities = useCallback(async () => {
    setLoadingCommunities(true);
    try { setCommunities((await getAllCommunities()).filter(c => !c.is_private).slice(0, 8)); }
    finally { setLoadingCommunities(false); }
  }, []);

  const handleToggleCommunity = async (id: string) => {
    const next = new Set(joinedIds);
    if (next.has(id)) { next.delete(id); } else { next.add(id); await joinCommunity(id).catch(() => {}); }
    setJoinedIds(next);
  };

  const handleCreateCommunityInline = async () => {
    if (!newCommunityName.trim()) return;
    setCreatingCommunity(true);
    try {
      const slug = newCommunityName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const community = await createCommunity({ name: newCommunityName.trim(), slug, description: '' });
      setCreatedCommunity(community);
      setJoinedIds(prev => new Set([...prev, community.id]));
      setCommunities(prev => [community, ...prev]);
      setShowCreateCommunity(false);
      setNewCommunityName('');
    } catch (e: any) { showError(e?.message ?? 'could not create community'); }
    finally { setCreatingCommunity(false); }
  };

  const handleShareCommunity = async (community: Community) => {
    try {
      await Share.share({ message: `join my community "${community.name}" on muse! https://museapp.com/c/${community.slug}` });
    } catch {}
  };

  const handleDeleteCreatedCommunity = async () => {
    if (!createdCommunity) return;
    try {
      await deleteCommunity(createdCommunity.id);
      setJoinedIds(prev => { const s = new Set(prev); s.delete(createdCommunity.id); return s; });
      setCommunities(prev => prev.filter(c => c.id !== createdCommunity.id));
      setCreatedCommunity(null);
    } catch (e: any) { showError(e?.message ?? 'could not delete community'); }
  };

  // ─── Shared layout pieces ─────────────────────────────────────────────────

  // ─── WELCOME ──────────────────────────────────────────────────────────────
  if (step === 'welcome') {
    return (
      <View style={{ flex: 1 }}>
        <LinearGradient colors={BG_COLORS} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />

        <SafeAreaView style={{ flex: 1 }}>
          <View style={styles.welcomeRoot}>

            {/* Blob contains all content */}
            <View style={styles.welcomeBlob}>
              <Svg width={BLOB_BIG_W} height={BLOB_BIG_H} viewBox="0 0 277 477" preserveAspectRatio="xMidYMid meet" style={StyleSheet.absoluteFill}>
                <Defs>
                  <SvgGradient id="wbg" x1="20%" y1="0%" x2="80%" y2="100%">
                    <Stop offset="0%" stopColor="#CCE0EE" />
                    <Stop offset="50%" stopColor="#A6C2D7" />
                    <Stop offset="100%" stopColor="#82A9BF" />
                  </SvgGradient>
                </Defs>
                <Path d={BLOB_PATH} fill="url(#wbg)" />
              </Svg>

              {/* All content inside blob in a flex column */}
              <View style={styles.welcomeBlobContent}>
                {/* Brand group at top */}
                <View style={{ alignItems: 'center' }}>
                  <Text style={styles.welcomeWordmark}>muse</Text>
                  <Text style={styles.welcomeTagline}>your daily outfit diary.</Text>
                </View>

                {/* CTA group at bottom */}
                <View style={{ width: '100%', gap: 14 }}>
                  <TouchableOpacity onPress={() => setStep('phone')} activeOpacity={0.88}>
                    <LinearGradient colors={ACCENT_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.welcomeCTA}>
                      <Text style={styles.welcomeCTAText}>get started</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setStep('phone')} hitSlop={8} style={{ alignItems: 'center' }}>
                    <Text style={styles.welcomeLink}>sign in with phone number</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ─── PHONE ────────────────────────────────────────────────────────────────
  if (step === 'phone') {
    const keyboardOpen = kbHeight > 0;
    return (
      <StepShell current="phone" onBack={goBack}>
        {/* Scrollable content — lets user nudge content up so phone input clears the floating button */}
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
          contentContainerStyle={{
            paddingHorizontal: 28,
            paddingTop: 20,
            paddingBottom: keyboardOpen ? kbHeight - insets.bottom + 80 : 32,
          }}
        >
          <Text style={styles.stepTitle}>what's your{'\n'}number?</Text>
          <Text style={styles.stepSub}>we'll send a code to verify it's you</Text>

          <TouchableOpacity style={styles.countryRow} onPress={() => setShowCountryPicker(v => !v)} activeOpacity={0.8}>
            <Text style={styles.countryCode}>{countryCode}</Text>
            <Ionicons name={showCountryPicker ? 'chevron-up' : 'chevron-down'} size={14} color={Theme.colors.secondary} />
          </TouchableOpacity>

          {showCountryPicker && (
            <View style={styles.countryList}>
              <ScrollView style={{ maxHeight: 180 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                {COUNTRY_CODES.map((c, i) => (
                  <TouchableOpacity key={i} style={styles.countryItem} onPress={() => { setCountryCode(c.code); setShowCountryPicker(false); }}>
                    <Text style={styles.countryItemText}>{c.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          <TextInput
            style={styles.phoneInput}
            placeholder="(555) 000-0000"
            placeholderTextColor={Theme.colors.disabled}
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            keyboardType="phone-pad"
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleSendOTP}
          />
          <Text style={styles.disclaimer}>standard rates may apply</Text>

          {/* Inline button — only shown when keyboard is closed */}
          {!keyboardOpen && (
            <View style={{ marginTop: 28 }}>
              <GradBtn onPress={handleSendOTP} disabled={!phoneNumber.trim() || sendingOTP} loading={sendingOTP} label="send code" />
            </View>
          )}
        </ScrollView>

        {/* Floating button — anchored above keyboard when keypad is open */}
        {keyboardOpen && (
          <View style={{ position: 'absolute', left: 28, right: 28, bottom: kbHeight - insets.bottom + 16 }}>
            <GradBtn onPress={handleSendOTP} disabled={!phoneNumber.trim() || sendingOTP} loading={sendingOTP} label="send code" />
          </View>
        )}
      </StepShell>
    );
  }

  // ─── OTP ──────────────────────────────────────────────────────────────────
  if (step === 'otp') {
    return (
      <StepShell current="otp" onBack={goBack}>
        <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>check your{'\n'}texts.</Text>
            <Text style={styles.stepSub}>enter the 6-digit code sent to {fullPhone}</Text>

            <View style={styles.otpRow}>
              {otp.map((digit, i) => (
                <TextInput
                  key={i}
                  ref={r => { otpRefs.current[i] = r; }}
                  style={[styles.otpBox, digit && styles.otpBoxFilled]}
                  value={digit}
                  onChangeText={v => handleOTPChange(v, i)}
                  onKeyPress={({ nativeEvent }) => handleOTPKeyPress(nativeEvent.key, i)}
                  keyboardType="number-pad"
                  maxLength={i === 0 ? 6 : 1}
                  textContentType="oneTimeCode"
                  textAlign="center"
                  selectTextOnFocus
                />
              ))}
            </View>

            {verifyingOTP && <ActivityIndicator color={Theme.colors.accent} style={{ marginTop: 24 }} />}

            <TouchableOpacity onPress={handleSendOTP} disabled={resendTimer > 0 || sendingOTP} hitSlop={8} style={{ marginTop: 28 }}>
              <Text style={[styles.resendText, resendTimer > 0 && styles.resendTextDisabled]}>
                {resendTimer > 0 ? `resend in ${resendTimer}s` : 'resend code'}
              </Text>
            </TouchableOpacity>
          </View>
      </StepShell>
    );
  }

  // ─── SETUP ────────────────────────────────────────────────────────────────
  if (step === 'setup') {
    const canContinue = displayName.trim().length > 0 && username.length >= 3 && usernameStatus === 'available' && !savingProfile && birthDate !== null && getAge(birthDate) >= 13;
    return (
      <StepShell current="setup" canGoBack={false} onBack={goBack}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 28, paddingTop: 20, paddingBottom: 120 }}
          >
          <Text style={styles.stepTitle}>set up your{'\n'}profile.</Text>
          <Text style={styles.stepSub}>tell us a little about yourself</Text>

          {/* Name */}
          <View style={[styles.fieldGroup, { marginTop: 24 }]}>
            <Text style={styles.fieldLabel}>your name</Text>
            <TextInput style={styles.fieldInput} placeholder="" placeholderTextColor={Theme.colors.disabled} value={displayName} onChangeText={setDisplayName} autoFocus returnKeyType="next" maxLength={40} />
          </View>

          {/* Username */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>username</Text>
            <View style={styles.usernameRow}>
              <Text style={styles.atSign}>@</Text>
              <TextInput style={[styles.fieldInput, { flex: 1 }]} placeholder="" placeholderTextColor={Theme.colors.disabled} value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} maxLength={20} returnKeyType="next" />
              {usernameStatus === 'checking' && <ActivityIndicator size="small" color={Theme.colors.disabled} style={{ marginLeft: 8 }} />}
              {usernameStatus === 'available' && <Ionicons name="checkmark-circle" size={18} color="#4CAF50" style={{ marginLeft: 8 }} />}
              {usernameStatus === 'taken' && <Ionicons name="close-circle" size={18} color={Theme.colors.accent} style={{ marginLeft: 8 }} />}
            </View>
            {usernameStatus === 'taken' && <Text style={styles.usernameError}>that username is taken</Text>}
            <Text style={styles.usernameHint}>3–20 chars · letters, numbers, underscores</Text>
          </View>

          {/* Date of birth */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>date of birth</Text>
            <TouchableOpacity
              style={[styles.fieldInput, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
              onPress={() => setShowDatePicker(true)}
              activeOpacity={0.7}
            >
              <Text style={{ fontSize: Theme.font.base, color: birthDate ? Theme.colors.primary : Theme.colors.disabled }}>
                {birthDate ? birthDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'tap to select'}
              </Text>
              <Ionicons name="calendar-outline" size={18} color={Theme.colors.disabled} />
            </TouchableOpacity>
            {birthDate && getAge(birthDate) < 13 && (
              <Text style={styles.usernameError}>you must be 13 or older to use muse</Text>
            )}
            {showDatePicker && (
              <DateTimePicker
                value={birthDate ?? new Date(2000, 0, 1)}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(_, date) => {
                  if (Platform.OS === 'android') setShowDatePicker(false);
                  if (date) setBirthDate(date);
                }}
                maximumDate={new Date()}
                minimumDate={new Date(1900, 0, 1)}
              />
            )}
          </View>

          {/* Avatar */}
          <View style={{ marginBottom: 20 }}>
            <TouchableOpacity style={[styles.avatarPicker, { marginTop: 8 }]} onPress={handlePickAvatar} activeOpacity={0.8}>
              {avatarUri
                ? <Image source={{ uri: avatarUri }} style={styles.avatarImg} />
                : (
                  <View style={styles.avatarPlaceholder}>
                    <LinearGradient colors={ACCENT_GRAD} style={StyleSheet.absoluteFill} />
                    <Feather name="camera" size={28} color="#fff" />
                    <Text style={[styles.avatarHint, { color: '#fff' }]}>add photo</Text>
                  </View>
                )
              }
            </TouchableOpacity>
            {avatarUri && (
              <TouchableOpacity onPress={() => setAvatarUri(null)} hitSlop={8} style={{ marginTop: 10, alignSelf: 'center' }}>
                <Text style={styles.changePhoto}>change photo</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Bio */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>bio <Text style={styles.optionalLabel}>optional</Text></Text>
            <TextInput
              style={[styles.fieldInput, styles.bioInput]}
              placeholder="describe your vibe..."
              placeholderTextColor={Theme.colors.disabled}
              value={bio}
              onChangeText={setBio}
              multiline
              maxLength={150}
              textAlignVertical="top"
            />
            <Text style={styles.charCount}>{bio.length}/150</Text>
          </View>

          {/* Style tags */}
          <Text style={styles.styleTagsLabel}>your style · pick up to 5 <Text style={styles.optionalLabel}>optional</Text></Text>
          <View style={[styles.styleTagsWrap, { marginBottom: 12 }]}>
            {STYLE_TAGS.map(tag => {
              const selected = styleTags.includes(tag);
              return (
                <TouchableOpacity
                  key={tag}
                  onPress={() => handleToggleStyleTag(tag)}
                  style={[styles.styleTag, selected && styles.styleTagSelected]}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.styleTagText, selected && styles.styleTagTextSelected]}>{tag}</Text>
                </TouchableOpacity>
              );
            })}
            {/* Custom selected tags (not in preset list) */}
            {styleTags.filter(t => !STYLE_TAGS.includes(t)).map(tag => (
              <TouchableOpacity
                key={tag}
                onPress={() => handleToggleStyleTag(tag)}
                style={[styles.styleTag, styles.styleTagSelected]}
                activeOpacity={0.75}
              >
                <Text style={[styles.styleTagText, styles.styleTagTextSelected]}>{tag}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {styleTags.length < 5 && (
            <View style={styles.customTagRow}>
              <TextInput
                style={styles.customTagInput}
                placeholder="add your own..."
                placeholderTextColor={Theme.colors.disabled}
                value={customTagInput}
                onChangeText={setCustomTagInput}
                onSubmitEditing={handleAddCustomTag}
                returnKeyType="done"
                maxLength={20}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                onPress={handleAddCustomTag}
                disabled={!customTagInput.trim()}
                style={[styles.customTagAdd, { opacity: customTagInput.trim() ? 1 : 0.35 }]}
                hitSlop={8}
              >
                <Ionicons name="add" size={18} color={Theme.colors.accent} />
              </TouchableOpacity>
            </View>
          )}
          <View style={{ height: 20 }} />

          {/* Location */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>location <Text style={styles.optionalLabel}>optional · find fashion lovers near you</Text></Text>
            <TextInput
              style={styles.fieldInput}
              placeholder="city, country"
              placeholderTextColor={Theme.colors.disabled}
              value={location}
              onChangeText={setLocation}
              maxLength={50}
              returnKeyType="done"
            />
          </View>

          {/* Account visibility */}
          <View style={[styles.fieldGroup, { marginBottom: 28 }]}>
            <Text style={styles.fieldLabel}>account visibility</Text>
            <View style={styles.visibilityRow}>
              <TouchableOpacity
                style={[styles.visibilityOption, isPublic && styles.visibilityOptionSelected]}
                onPress={() => setIsPublic(true)}
                activeOpacity={0.8}
              >
                <Ionicons name="earth-outline" size={18} color={isPublic ? Theme.colors.accent : Theme.colors.secondary} />
                <Text style={[styles.visibilityLabel, isPublic && styles.visibilityLabelSelected]}>public</Text>
                <Text style={styles.visibilityDesc}>anyone can see your profile</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.visibilityOption, !isPublic && styles.visibilityOptionSelected]}
                onPress={() => setIsPublic(false)}
                activeOpacity={0.8}
              >
                <Ionicons name="lock-closed-outline" size={18} color={!isPublic ? Theme.colors.accent : Theme.colors.secondary} />
                <Text style={[styles.visibilityLabel, !isPublic && styles.visibilityLabelSelected]}>private</Text>
                <Text style={styles.visibilityDesc}>only followers + communities</Text>
              </TouchableOpacity>
            </View>
          </View>
          </ScrollView>
        </KeyboardAvoidingView>
        <View style={styles.stepFooter}>
          <GradBtn onPress={handleSaveSetup} disabled={!canContinue} loading={savingProfile} label="continue" />
        </View>
      </StepShell>
    );
  }

  // ─── CONTACTS ─────────────────────────────────────────────────────────────
  if (step === 'contacts') {
    return (
      <StepShell current="contacts" onBack={goBack}>
        <View style={styles.stepContent}>
          <Text style={styles.stepTitle}>find your{'\n'}friends.</Text>

          {contactsPermission === 'unknown' && (
            <View style={[styles.contactsPrompt, { flex: 1, justifyContent: 'center' }]}>
              <View style={styles.contactsIconWrap}>
                <LinearGradient colors={BG_COLORS} style={StyleSheet.absoluteFill} borderRadius={40} />
                <Feather name="users" size={34} color={Theme.colors.secondary} />
              </View>
              <Text style={styles.contactsPromptText}>
                connect with your people.
              </Text>
            </View>
          )}

          {contactsPermission === 'denied' && (
            <View style={styles.contactsPrompt}>
              <Feather name="lock" size={36} color={Theme.colors.disabled} />
              <Text style={[styles.contactsPromptText, { marginTop: 12 }]}>contacts access was denied. you can enable it in settings later.</Text>
            </View>
          )}

          {contactsPermission === 'granted' && (
            <>
              <TextInput
                style={[styles.fieldInput, { marginTop: 12, marginBottom: 4 }]}
                placeholder="search contacts..."
                placeholderTextColor={Theme.colors.disabled}
                value={contactSearch}
                onChangeText={setContactSearch}
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
              />
              <FlatList
                data={museContacts.filter(c =>
                  !contactSearch ||
                  c.name.toLowerCase().includes(contactSearch.toLowerCase()) ||
                  c.phone.includes(contactSearch)
                )}
                keyExtractor={(_, i) => String(i)}
                style={{ marginTop: 8 }}
                renderItem={({ item: c }) => (
                  <View style={styles.contactRow}>
                    <View style={styles.contactAvatar}>
                      <Text style={styles.contactInitial}>{c.name[0]?.toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.contactName}>{c.name}</Text>
                      <Text style={styles.contactPhone}>{c.phone}</Text>
                    </View>
                    <TouchableOpacity style={styles.inviteBtn}><Text style={styles.inviteBtnText}>invite</Text></TouchableOpacity>
                  </View>
                )}
                ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                ListEmptyComponent={<Text style={styles.emptyNote}>{museContacts.length === 0 ? 'none of your contacts are on muse yet — invite them!' : 'no contacts match your search'}</Text>}
              />
            </>
          )}
        </View>
        <View style={styles.stepFooter}>
          {contactsPermission === 'unknown' ? (
            <>
              <GradBtn onPress={handleRequestContacts} disabled={contactsLoading} loading={contactsLoading} label="sync my contacts" />
              <TouchableOpacity onPress={() => setStep('community')} hitSlop={12} style={{ marginTop: 16, alignSelf: 'center' }}>
                <Text style={styles.skipText}>skip for now</Text>
              </TouchableOpacity>
            </>
          ) : (
            <GradBtn onPress={() => setStep('community')} disabled={false} loading={false} label="continue" />
          )}
        </View>
      </StepShell>
    );
  }

  // ─── COMMUNITY ────────────────────────────────────────────────────────────
  if (step === 'community') {
    const communityHeader = (
      <View style={{ marginBottom: 10 }}>
        {createdCommunity ? (
          <View style={styles.createSuccessCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={styles.createSuccessTitle}>"{createdCommunity.name}" created!</Text>
              <TouchableOpacity onPress={handleDeleteCreatedCommunity} hitSlop={10}>
                <Ionicons name="trash-outline" size={16} color={Theme.colors.disabled} />
              </TouchableOpacity>
            </View>
            <View style={styles.inviteActionsRow}>
              <TouchableOpacity style={styles.inviteActionBtn} onPress={() => handleShareCommunity(createdCommunity)}>
                <Ionicons name="share-outline" size={15} color={Theme.colors.accent} />
                <Text style={styles.inviteActionText}>share link</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.inviteActionBtn} onPress={() => Linking.openURL(`sms:&body=join my community "${createdCommunity.name}" on muse! https://museapp.com/c/${createdCommunity.slug}`)}>
                <Ionicons name="chatbubble-outline" size={15} color={Theme.colors.accent} />
                <Text style={styles.inviteActionText}>invite via SMS</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : showCreateCommunity ? (
          <View style={styles.createCommunityForm}>
            <TextInput
              style={styles.fieldInput}
              placeholder="community name"
              placeholderTextColor={Theme.colors.disabled}
              value={newCommunityName}
              onChangeText={setNewCommunityName}
              autoFocus
              maxLength={40}
              returnKeyType="done"
              onSubmitEditing={handleCreateCommunityInline}
            />
          </View>
        ) : null}
      </View>
    );

    return (
      <StepShell current="community" onBack={goBack}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={[styles.stepContent, { paddingBottom: 0 }]}>
          <Text style={styles.stepTitle}>join a{'\n'}community.</Text>
        </View>
        <FlatList
          data={communities}
          keyExtractor={item => item.id}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 28, paddingTop: 4, paddingBottom: 12, gap: 10 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={communityHeader}
          ListEmptyComponent={
            loadingCommunities
              ? <ActivityIndicator color={Theme.colors.accent} style={{ marginTop: 24 }} />
              : null
          }
          renderItem={({ item }) => {
            const joined = joinedIds.has(item.id);
            return (
              <TouchableOpacity
                style={[styles.communityCard, joined && styles.communityCardJoined]}
                onPress={() => handleToggleCommunity(item.id)}
                activeOpacity={0.8}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.communityName, joined && { color: Theme.colors.accent }]}>{item.name}</Text>
                  {item.description ? <Text style={styles.communityDesc} numberOfLines={1}>{item.description}</Text> : null}
                </View>
                {joined
                  ? <LinearGradient colors={ACCENT_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.joinPill}><Text style={styles.joinPillTextActive}>joined</Text></LinearGradient>
                  : <View style={styles.joinPillOutline}><Text style={styles.joinPillText}>join</Text></View>
                }
              </TouchableOpacity>
            );
          }}
        />
        <View style={styles.stepFooter}>
          {showCreateCommunity ? (
            <>
              <GradBtn onPress={handleCreateCommunityInline} disabled={!newCommunityName.trim() || creatingCommunity} loading={creatingCommunity} label="create" />
              <TouchableOpacity onPress={() => { setShowCreateCommunity(false); setNewCommunityName(''); }} hitSlop={12} style={{ marginTop: 16, alignSelf: 'center' }}>
                <Text style={styles.skipText}>cancel</Text>
              </TouchableOpacity>
            </>
          ) : createdCommunity || joinedIds.size > 0 ? (
            <GradBtn onPress={() => setStep('notifications')} disabled={false} loading={false} label="continue" />
          ) : (
            <>
              <TouchableOpacity onPress={() => setShowCreateCommunity(true)} activeOpacity={0.85}>
                <LinearGradient colors={ACCENT_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.gradBtn}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                    <Text style={styles.gradBtnText}>create a community</Text>
                    <Text style={[styles.gradBtnText, { fontSize: 20, lineHeight: 22 }]}>+</Text>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setStep('notifications')} hitSlop={12} style={{ marginTop: 16, alignSelf: 'center' }}>
                <Text style={styles.skipText}>skip for now</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
        </KeyboardAvoidingView>
      </StepShell>
    );
  }

  // ─── NOTIFICATIONS ────────────────────────────────────────────────────────
  if (step === 'notifications') {
    const termsOk = agreedToTerms && agreedToPrivacy;
    return (
      <StepShell current="notifications" onBack={goBack}>
        <View style={styles.stepContent}>
          <Text style={styles.stepTitle}>never miss{'\n'}a day.</Text>
          <Text style={styles.stepSub}>get a gentle reminder to log your look each day</Text>

          <View style={styles.notifPreview}>
            <View style={styles.notifCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <View style={styles.notifAppIcon} />
                <Text style={styles.notifAppName}>muse</Text>
              </View>
              <Text style={styles.notifBody}>time to capture today's look ✨</Text>
            </View>
          </View>

          {/* T&C */}
          <View style={styles.termsSection}>
            <TouchableOpacity style={styles.checkRow} onPress={() => setAgreedToTerms(v => !v)} activeOpacity={0.7}>
              <View style={[styles.checkbox, agreedToTerms && styles.checkboxChecked]}>
                {agreedToTerms && <Ionicons name="checkmark" size={12} color="#fff" />}
              </View>
              <Text style={styles.checkLabel}>I agree to the{' '}
                <Text style={styles.checkLink} onPress={() => Linking.openURL('https://example.com/terms')}>Terms of Service</Text>
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.checkRow} onPress={() => setAgreedToPrivacy(v => !v)} activeOpacity={0.7}>
              <View style={[styles.checkbox, agreedToPrivacy && styles.checkboxChecked]}>
                {agreedToPrivacy && <Ionicons name="checkmark" size={12} color="#fff" />}
              </View>
              <Text style={styles.checkLabel}>I agree to the{' '}
                <Text style={styles.checkLink} onPress={() => Linking.openURL('https://example.com/privacy')}>Privacy Policy</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.stepFooter}>
          <GradBtn onPress={handleRequestNotifications} disabled={!termsOk} loading={false} label="turn on reminders" />
          <TouchableOpacity onPress={() => { if (termsOk) setStep('done'); }} hitSlop={8} style={{ alignItems: 'center', marginTop: 14 }}>
            <Text style={[styles.skipText, !termsOk && { opacity: 0.35 }]}>skip for now</Text>
          </TouchableOpacity>
        </View>
      </StepShell>
    );
  }

  // ─── DONE ─────────────────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <View style={{ flex: 1 }}>
        <LinearGradient colors={BG_COLORS} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />
        <SafeAreaView style={{ flex: 1 }}>
          <View style={styles.doneRoot}>
            {/* Mini blob */}
            <View style={{ width: BLOB_W * 0.7, height: BLOB_H * 0.7, marginBottom: 32 }}>
              <Svg width={BLOB_W * 0.7} height={BLOB_H * 0.7} viewBox="0 0 277 477" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
                <Defs>
                  <SvgGradient id="donebg" x1="20%" y1="0%" x2="80%" y2="100%">
                    <Stop offset="0%" stopColor="#CCE0EE" />
                    <Stop offset="100%" stopColor="#7AAAC2" />
                  </SvgGradient>
                </Defs>
                <Path d={BLOB_PATH} fill="url(#donebg)" />
              </Svg>
              <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={styles.doneInnerText}>you're{'\n'}all set.</Text>
              </View>
            </View>

            <Text style={styles.doneWordmark}>muse</Text>
            {username && <Text style={styles.doneUsername}>@{username}</Text>}
            <Text style={styles.doneSub}>start capturing your daily looks{'\n'}and share them with your community.</Text>
            <TouchableOpacity onPress={completeOnboarding} activeOpacity={0.88} style={{ width: '80%' }}>
              <LinearGradient colors={ACCENT_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.doneCTA}>
                <Text style={styles.doneCTAText}>start journaling</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return null;
}

// ─── Step shell helpers (must live outside OnboardingScreen to keep stable refs) ──
const FLOW_STEPS: Step[] = ['phone', 'otp', 'setup', 'contacts', 'community', 'notifications'];

function renderProgress(current: Step) {
  const idx = FLOW_STEPS.indexOf(current);
  if (idx < 0) return null;
  return (
    <View style={styles.progressRow}>
      {FLOW_STEPS.map((_, i) => (
        <View key={i} style={[styles.progressDot, i <= idx && styles.progressDotActive]} />
      ))}
    </View>
  );
}

function StepShell({ current, canGoBack = true, onBack, children }: { current: Step; canGoBack?: boolean; onBack: () => void; children: React.ReactNode }) {
  return (
    <LinearGradient colors={['#FEFCE7', '#FAECF7', '#F7E4F9']} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.stepHeader}>
          {canGoBack
            ? <TouchableOpacity onPress={onBack} hitSlop={12}><Ionicons name="chevron-back" size={22} color={Theme.colors.primary} /></TouchableOpacity>
            : <View style={{ width: 22 }} />
          }
          {renderProgress(current)}
          <View style={{ width: 22 }} />
        </View>
        {children}
      </SafeAreaView>
    </LinearGradient>
  );
}

// ─── Gradient button component ────────────────────────────────────────────────
function GradBtn({ onPress, disabled, loading, label, style }: { onPress: () => void; disabled: boolean; loading: boolean; label: string; style?: object }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled || loading} activeOpacity={0.85} style={[{ opacity: disabled ? 0.45 : 1 }, style]}>
      <LinearGradient colors={ACCENT_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.gradBtn}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.gradBtnText}>{label}</Text>}
      </LinearGradient>
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({

  // ── Welcome ──────────────────────────────────────────────────────────────
  welcomeRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  welcomeBlob: {
    width: BLOB_BIG_W,
    height: BLOB_BIG_H,
  },
  welcomeBlobContent: {
    ...StyleSheet.absoluteFillObject,
    paddingHorizontal: Math.round(BLOB_BIG_W * 0.10),
    paddingTop: Math.round(BLOB_BIG_H * 0.28),
    paddingBottom: Math.round(BLOB_BIG_H * 0.22),
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  welcomeWordmark: {
    fontFamily: 'Caprasimo_400Regular',
    fontSize: 86, color: '#ef4444',
    textAlign: 'center',
  },
  welcomeTagline: {
    fontSize: 14,
    fontWeight: '600',
    color: '#5E8EAD',
    letterSpacing: 0, lineHeight: 18,
    textAlign: 'center',
    marginTop: 0,
  },
  welcomeCTA: {
    borderRadius: Theme.radius.md,
    paddingVertical: 18,
    alignItems: 'center',
  },
  welcomeCTAText: {
    fontSize: Theme.font.base, fontWeight: '800',
    color: '#fff', letterSpacing: -0.2,
  },
  welcomeLink: {
    fontSize: Theme.font.sm,
    color: 'rgba(0,0,0,0.45)',
    textAlign: 'center',
    fontWeight: '500',
  },

  // ── Step shell ────────────────────────────────────────────────────────────
  progressRow: {
    flexDirection: 'row', gap: 5, alignItems: 'center',
  },
  progressDot: {
    width: 5, height: 5, borderRadius: 3,
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  progressDotActive: { backgroundColor: Theme.colors.brandWarm, width: 14 },
  stepHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 6, paddingBottom: 4,
  },
  stepContent: { flex: 1, paddingHorizontal: 28, paddingTop: 20 },
  stepFooter: { paddingHorizontal: 28, paddingBottom: 16, paddingTop: 12 },

  stepTitle: {
    fontSize: 32, fontWeight: '800',
    color: Theme.colors.primary, letterSpacing: -0.8,
    lineHeight: 38, marginBottom: 10,
  },
  stepSub: {
    fontSize: Theme.font.base, color: Theme.colors.secondary,
    lineHeight: 22, marginBottom: 28,
  },

  // Gradient button
  gradBtn: {
    borderRadius: Theme.radius.md, paddingVertical: 16,
    alignItems: 'center',
  },
  gradBtnText: {
    fontSize: Theme.font.base, fontWeight: '800', color: '#fff', letterSpacing: -0.2,
  },

  // Phone
  countryRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderRadius: Theme.radius.md, borderWidth: 1, borderColor: Theme.colors.border,
    paddingHorizontal: 14, paddingVertical: 11, marginBottom: 8,
  },
  countryCode: { fontSize: Theme.font.base, fontWeight: '600', color: Theme.colors.primary },
  countryList: {
    backgroundColor: '#fff', borderRadius: Theme.radius.md,
    borderWidth: 1, borderColor: Theme.colors.border, marginBottom: 8,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  countryItem: { paddingHorizontal: 14, paddingVertical: 11 },
  countryItemText: { fontSize: Theme.font.sm, color: Theme.colors.primary },
  phoneInput: {
    backgroundColor: '#fff', borderRadius: Theme.radius.md,
    borderWidth: 1, borderColor: Theme.colors.border,
    paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 22, fontWeight: '600', color: Theme.colors.primary, letterSpacing: 1,
  },
  disclaimer: { fontSize: 11, color: Theme.colors.disabled, marginTop: 12, textAlign: 'center' },

  // OTP
  otpRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  otpBox: {
    flex: 1, maxWidth: 54, height: 58,
    backgroundColor: '#fff',
    borderRadius: Theme.radius.md,
    borderWidth: 1.5, borderColor: Theme.colors.border,
    fontSize: 24, fontWeight: '700', color: Theme.colors.primary, textAlign: 'center',
  },
  otpBoxFilled: { borderColor: '#F77FAD' },
  resendText: { fontSize: Theme.font.sm, fontWeight: '600', color: '#F77FAD', textAlign: 'center' },
  resendTextDisabled: { color: Theme.colors.disabled },

  // Name
  fieldGroup: { marginBottom: 20 },
  fieldLabel: {
    fontSize: Theme.font.xs, fontWeight: '700', color: Theme.colors.secondary,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8,
  },
  fieldInput: {
    backgroundColor: '#fff', borderRadius: Theme.radius.md,
    borderWidth: 1, borderColor: Theme.colors.border,
    paddingHorizontal: 14, paddingVertical: 13, fontSize: Theme.font.base, color: Theme.colors.primary,
  },
  usernameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  atSign: { fontSize: Theme.font.base, fontWeight: '600', color: Theme.colors.secondary },
  usernameError: { fontSize: Theme.font.xs, color: Theme.colors.accent, marginTop: 4 },
  usernameHint: { fontSize: Theme.font.xs, color: Theme.colors.disabled, marginTop: 4 },
  optionalLabel: { fontSize: Theme.font.xs, fontWeight: '400', color: Theme.colors.disabled, textTransform: 'none', letterSpacing: 0 },
  fieldSubLabel: { fontSize: Theme.font.xs, color: Theme.colors.disabled, marginBottom: 8, marginTop: -4 },

  // Avatar
  avatarPicker: { width: 120, height: 120, borderRadius: 60, alignSelf: 'center', marginTop: 16, overflow: 'hidden' },
  avatarImg: { width: 120, height: 120 },
  avatarPlaceholder: {
    width: 120, height: 120, borderRadius: 60,
    alignItems: 'center', justifyContent: 'center', gap: 6,
    overflow: 'hidden',
  },
  avatarHint: { fontSize: Theme.font.xs, color: Theme.colors.secondary },
  changePhoto: { fontSize: Theme.font.sm, color: Theme.colors.secondary, fontWeight: '600', textAlign: 'center' },

  // Contacts
  contactsPrompt: { alignItems: 'center', gap: 12, marginTop: 16 },
  contactsIconWrap: {
    width: 80, height: 80, borderRadius: 40, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  contactsPromptText: { fontSize: Theme.font.sm, color: Theme.colors.secondary, textAlign: 'center', lineHeight: 20 },
  emptyNote: { fontSize: Theme.font.sm, color: Theme.colors.disabled, textAlign: 'center', marginTop: 24, lineHeight: 20 },
  contactRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: Theme.radius.md,
    borderWidth: 1, borderColor: Theme.colors.border, padding: 12,
  },
  contactAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(166,194,215,0.3)', alignItems: 'center', justifyContent: 'center',
  },
  contactInitial: { fontSize: Theme.font.base, fontWeight: '700', color: '#4A7A96' },
  contactName: { fontSize: Theme.font.sm, fontWeight: '700', color: Theme.colors.primary },
  contactPhone: { fontSize: Theme.font.xs, color: Theme.colors.secondary },
  inviteBtn: { borderWidth: 1.5, borderColor: '#F77FAD', borderRadius: 100, paddingHorizontal: 14, paddingVertical: 5 },
  inviteBtnText: { fontSize: Theme.font.xs, fontWeight: '700', color: '#F77FAD' },

  // Community
  communityCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: Theme.radius.md,
    borderWidth: 1, borderColor: Theme.colors.border, padding: 14,
  },
  communityCardJoined: { borderColor: 'rgba(249,199,79,0.4)', backgroundColor: 'rgba(249,199,79,0.04)' },
  communityName: { fontSize: Theme.font.sm, fontWeight: '700', color: Theme.colors.primary },
  communityDesc: { fontSize: Theme.font.xs, color: Theme.colors.secondary, marginTop: 2 },
  joinPill: { borderRadius: 100, paddingHorizontal: 14, paddingVertical: 5 },
  joinPillTextActive: { fontSize: Theme.font.xs, fontWeight: '700', color: '#fff' },
  joinPillOutline: { borderWidth: 1.5, borderColor: Theme.colors.border, borderRadius: 100, paddingHorizontal: 14, paddingVertical: 5 },
  joinPillText: { fontSize: Theme.font.xs, fontWeight: '700', color: Theme.colors.secondary },

  // Create community
  createCommunityBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: Theme.radius.md, paddingVertical: 14, overflow: 'hidden',
  },
  createCommunityBtnText: { fontSize: Theme.font.sm, fontWeight: '700', color: '#fff' },
  createCommunityForm: { gap: 4 },
  createSuccessCard: {
    backgroundColor: Theme.colors.accentLight, borderRadius: Theme.radius.md,
    borderWidth: 1, borderColor: Theme.colors.accent, padding: 14, gap: 10,
  },
  createSuccessTitle: { fontSize: Theme.font.sm, fontWeight: '700', color: Theme.colors.accent },
  inviteActionsRow: { flexDirection: 'row', gap: 10 },
  inviteActionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1.5, borderColor: Theme.colors.accent, borderRadius: Theme.radius.md,
    paddingVertical: 9,
  },
  inviteActionText: { fontSize: Theme.font.xs, fontWeight: '700', color: Theme.colors.accent },

  // About
  bioInput: { height: 88, paddingTop: 12, textAlignVertical: 'top' },
  charCount: { fontSize: Theme.font.xs, color: Theme.colors.disabled, textAlign: 'right', marginTop: 4 },
  styleTagsLabel: {
    fontSize: Theme.font.xs, fontWeight: '700', color: Theme.colors.secondary,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10, marginTop: 4,
  },
  styleTagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  styleTag: {
    borderWidth: 1.5, borderColor: Theme.colors.border, borderRadius: 100,
    paddingHorizontal: 14, paddingVertical: 8, backgroundColor: Theme.colors.background,
  },
  styleTagSelected: { borderColor: Theme.colors.accent, backgroundColor: 'rgba(58,135,181,0.07)' },
  styleTagText: { fontSize: Theme.font.sm, color: Theme.colors.secondary, fontWeight: '500' },
  styleTagTextSelected: { color: Theme.colors.accent, fontWeight: '700' },
  customTagRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  customTagInput: {
    flex: 1, borderWidth: 1.5, borderColor: Theme.colors.border, borderRadius: 100,
    paddingHorizontal: 14, paddingVertical: 8, fontSize: Theme.font.sm,
    color: Theme.colors.primary, backgroundColor: Theme.colors.background,
  },
  customTagAdd: {
    width: 34, height: 34, borderRadius: 17,
    borderWidth: 1.5, borderColor: Theme.colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },

  // Notifications
  notifPreview: { marginTop: 32, alignItems: 'center' },
  notifCard: {
    width: '100%', backgroundColor: Theme.colors.surface,
    borderRadius: Theme.radius.md, borderWidth: 1, borderColor: Theme.colors.border, padding: 16,
  },
  notifAppIcon: { width: 20, height: 20, borderRadius: 5, backgroundColor: Theme.colors.accent },
  notifAppName: { fontSize: Theme.font.sm, fontWeight: '700', color: Theme.colors.primary },
  notifBody: { fontSize: Theme.font.sm, color: Theme.colors.secondary },
  skipText: { fontSize: Theme.font.sm, color: Theme.colors.disabled, fontWeight: '500' },

  // Visibility toggle
  visibilityRow: { flexDirection: 'row', gap: 10 },
  visibilityOption: {
    flex: 1, borderWidth: 1.5, borderColor: Theme.colors.border,
    borderRadius: Theme.radius.md, padding: 12,
    alignItems: 'center', gap: 4,
  },
  visibilityOptionSelected: { borderColor: Theme.colors.accent, backgroundColor: 'rgba(58,135,181,0.07)' },
  visibilityLabel: { fontSize: Theme.font.sm, fontWeight: '700', color: Theme.colors.secondary },
  visibilityLabelSelected: { color: Theme.colors.accent },
  visibilityDesc: { fontSize: Theme.font.xs, color: Theme.colors.disabled, textAlign: 'center' },

  // T&C checkboxes
  termsSection: { gap: 14, marginTop: 28 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkbox: {
    width: 20, height: 20, borderRadius: 5,
    borderWidth: 1.5, borderColor: Theme.colors.border,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  checkboxChecked: { backgroundColor: Theme.colors.accent, borderColor: Theme.colors.accent },
  checkLabel: { flex: 1, fontSize: Theme.font.sm, color: Theme.colors.secondary },
  checkLink: { color: Theme.colors.accent, fontWeight: '600' },

  // Done
  doneRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40 },
  doneInnerText: {
    fontFamily: Theme.font.brand,
    fontSize: 22, color: '#fff', textAlign: 'center', lineHeight: 28,
  },
  doneWordmark: {
    fontFamily: Theme.font.brand,
    fontSize: 52, color: Theme.colors.brandWarm, letterSpacing: -1,
  },
  doneUsername: { fontSize: Theme.font.base, fontWeight: '700', color: Theme.colors.secondary },
  doneSub: {
    fontSize: Theme.font.sm, color: Theme.colors.secondary,
    textAlign: 'center', lineHeight: 22, marginBottom: 12,
  },
  doneCTA: { borderRadius: Theme.radius.md, paddingVertical: 18, alignItems: 'center' },
  doneCTAText: { fontSize: Theme.font.base, fontWeight: '800', color: '#fff', letterSpacing: -0.2 },
});
