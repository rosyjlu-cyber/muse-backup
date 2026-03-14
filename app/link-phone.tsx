/**
 * Shown to email-auth users who haven't linked a phone yet.
 * Uses Supabase's updateUser({ phone }) → verifyOtp({ type: 'phone_change' }) flow.
 */

import { useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';

import { Theme } from '@/constants/Theme';
import { sendPhoneLinkOTP, verifyPhoneLink } from '@/utils/api';
import { useAuth } from '@/utils/auth';

const COUNTRY_CODES = [
  { code: '+1',  label: 'United States (+1)' },
  { code: '+44', label: 'United Kingdom (+44)' },
  { code: '+61', label: 'Australia (+61)' },
  { code: '+33', label: 'France (+33)' },
  { code: '+49', label: 'Germany (+49)' },
  { code: '+81', label: 'Japan (+81)' },
  { code: '+82', label: 'South Korea (+82)' },
  { code: '+91', label: 'India (+91)' },
  { code: '+55', label: 'Brazil (+55)' },
  { code: '+52', label: 'Mexico (+52)' },
];

const ACCENT_GRAD = ['#F9C74F', '#F77FAD'] as const;

export default function LinkPhoneScreen() {
  const router = useRouter();
  const { reloadSession } = useAuth();

  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [countryCode, setCountryCode] = useState('+1');
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [sending, setSending] = useState(false);

  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const otpRefs = useRef<Array<TextInput | null>>([]);
  const [verifying, setVerifying] = useState(false);

  const fullPhone = `${countryCode}${phoneNumber.replace(/\D/g, '')}`;

  const showError = (msg: string) =>
    Platform.OS === 'web' ? window.alert(msg) : Alert.alert('oops', msg);

  const handleSend = async () => {
    const digits = phoneNumber.replace(/\D/g, '');
    if (digits.length < 7) { showError('please enter a valid phone number'); return; }
    setSending(true);
    try {
      const { error } = await sendPhoneLinkOTP(fullPhone);
      if (error) { showError(error.message); return; }
      setOtp(['', '', '', '', '', '']);
      setStep('otp');
      setTimeout(() => otpRefs.current[0]?.focus(), 300);
    } finally { setSending(false); }
  };

  const handleOTPChange = (val: string, idx: number) => {
    const digit = val.replace(/\D/g, '').slice(-1);
    const next = [...otp]; next[idx] = digit; setOtp(next);
    if (digit && idx < 5) otpRefs.current[idx + 1]?.focus();
    if (next.every(d => d !== '')) handleVerify(next.join(''));
  };

  const handleOTPKeyPress = (key: string, idx: number) => {
    if (key === 'Backspace' && !otp[idx] && idx > 0) otpRefs.current[idx - 1]?.focus();
  };

  const handleVerify = async (code: string) => {
    setVerifying(true);
    try {
      const { error } = await verifyPhoneLink(fullPhone, code);
      if (error) {
        showError(error.message);
        setOtp(['', '', '', '', '', '']);
        otpRefs.current[0]?.focus();
        return;
      }
      // Refresh session so session.user.phone is now populated
      await reloadSession();
      router.replace('/(tabs)' as any);
    } finally { setVerifying(false); }
  };

  return (
    <LinearGradient colors={['#FEFCE7', '#FAECF7', '#F7E4F9']} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>

          {step === 'phone' ? (
            <>
              <ScrollView
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.wordmark}>muse</Text>
                <Text style={styles.title}>one quick{'\n'}thing.</Text>
                <Text style={styles.sub}>
                  we're moving to phone-based sign-in. add your number to keep access to your account.
                </Text>

                <TouchableOpacity
                  style={styles.countryRow}
                  onPress={() => setShowCountryPicker(v => !v)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.countryCode}>{countryCode}</Text>
                  <Text style={styles.countryChevron}>{showCountryPicker ? '▲' : '▼'}</Text>
                </TouchableOpacity>

                {showCountryPicker && (
                  <View style={styles.countryList}>
                    <ScrollView style={{ maxHeight: 180 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                      {COUNTRY_CODES.map((c, i) => (
                        <TouchableOpacity
                          key={i}
                          style={styles.countryItem}
                          onPress={() => { setCountryCode(c.code); setShowCountryPicker(false); }}
                        >
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
                  onSubmitEditing={handleSend}
                />
                <Text style={styles.disclaimer}>standard rates may apply</Text>
              </ScrollView>

              <View style={styles.footer}>
                <TouchableOpacity
                  onPress={handleSend}
                  disabled={!phoneNumber.trim() || sending}
                  activeOpacity={0.85}
                  style={{ opacity: !phoneNumber.trim() || sending ? 0.45 : 1 }}
                >
                  <LinearGradient colors={ACCENT_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.btn}>
                    {sending
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={styles.btnText}>send code</Text>
                    }
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <ScrollView
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.wordmark}>muse</Text>
              <Text style={styles.title}>check your{'\n'}texts.</Text>
              <Text style={styles.sub}>enter the 6-digit code sent to {fullPhone}</Text>

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
                    maxLength={1}
                    textAlign="center"
                    selectTextOnFocus
                  />
                ))}
              </View>

              {verifying && <ActivityIndicator color={Theme.colors.brandWarm} style={{ marginTop: 24 }} />}

              <TouchableOpacity onPress={() => setStep('phone')} hitSlop={8} style={{ marginTop: 28 }}>
                <Text style={styles.resendText}>use a different number</Text>
              </TouchableOpacity>
            </ScrollView>
          )}

        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: 28, paddingTop: 32, paddingBottom: 16 },
  footer: { paddingHorizontal: 28, paddingBottom: 16, paddingTop: 12 },

  wordmark: {
    fontFamily: Theme.font.brand,
    fontSize: 32, color: Theme.colors.brandWarm,
    marginBottom: 20,
  },
  title: {
    fontSize: 32, fontWeight: '800',
    color: Theme.colors.primary, letterSpacing: -0.8,
    lineHeight: 38, marginBottom: 12,
  },
  sub: {
    fontSize: Theme.font.base, color: Theme.colors.secondary,
    lineHeight: 22, marginBottom: 32,
  },

  countryRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderRadius: Theme.radius.md, borderWidth: 1, borderColor: Theme.colors.border,
    paddingHorizontal: 14, paddingVertical: 11, marginBottom: 8,
  },
  countryCode: { fontSize: Theme.font.base, fontWeight: '600', color: Theme.colors.primary },
  countryChevron: { fontSize: 10, color: Theme.colors.secondary },
  countryList: {
    backgroundColor: '#fff', borderRadius: Theme.radius.md,
    borderWidth: 1, borderColor: Theme.colors.border, marginBottom: 8,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
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

  btn: { borderRadius: Theme.radius.md, paddingVertical: 16, alignItems: 'center' },
  btnText: { fontSize: Theme.font.base, fontWeight: '800', color: '#fff', letterSpacing: -0.2 },

  otpRow: { flexDirection: 'row', gap: 10, justifyContent: 'center', marginTop: 8 },
  otpBox: {
    width: 46, height: 58,
    backgroundColor: '#fff',
    borderRadius: Theme.radius.md,
    borderWidth: 1.5, borderColor: Theme.colors.border,
    fontSize: 24, fontWeight: '700', color: Theme.colors.primary, textAlign: 'center',
  },
  otpBoxFilled: { borderColor: '#F77FAD' },
  resendText: { fontSize: Theme.font.sm, fontWeight: '600', color: '#F77FAD', textAlign: 'center' },
});
