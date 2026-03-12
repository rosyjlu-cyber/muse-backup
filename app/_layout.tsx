import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { AuthProvider, useAuth } from "@/utils/auth";

export { ErrorBoundary } from "expo-router";

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

SplashScreen.preventAutoHideAsync();

function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, profile, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem("muse_onboarding_done").then(val => {
      setOnboardingDone(val === "true");
      setOnboardingChecked(true);
    });
  }, []);

  // If an existing user (has session + profile with display_name) lands here
  // without the AsyncStorage flag, mark them as done automatically so they
  // aren't sent through onboarding again.
  useEffect(() => {
    if (session && profile?.display_name && !onboardingDone && onboardingChecked) {
      AsyncStorage.setItem("muse_onboarding_done", "true");
      setOnboardingDone(true);
    }
  }, [session, profile, onboardingDone, onboardingChecked]);

  useEffect(() => {
    if (loading || !onboardingChecked) return;

    // Self-heal: if the onboarding flag is stale (user has a session but no
    // display_name), clear it so they're routed through onboarding properly.
    if (onboardingDone && session && profile && !profile.display_name) {
      AsyncStorage.removeItem("muse_onboarding_done");
      setOnboardingDone(false);
      return;
    }

    const seg = segments[0] as string;
    const inOnboarding = seg === "onboarding";
    const inAuth = seg === "auth";
    const inLinkPhone = seg === "link-phone";

    // Email users who haven't linked a phone yet must do so first
    const needsPhoneLink =
      session &&
      !session.user.phone &&
      session.user.app_metadata?.provider === "email";

    if (!session) {
      // No session → go to onboarding (which also handles returning-user sign-in)
      if (!inOnboarding && !inAuth) router.replace("/onboarding" as any);
    } else if (needsPhoneLink) {
      if (!inLinkPhone) router.replace("/link-phone" as any);
    } else if (session && !profile?.display_name) {
      // Has session but hasn't completed onboarding (display_name is the source of truth)
      if (!inOnboarding) router.replace("/onboarding" as any);
    } else if (session && profile?.display_name && (inOnboarding || inAuth || inLinkPhone)) {
      // Fully set up → go to tabs
      router.replace("/(tabs)" as any);
    }
  }, [session, profile, loading, onboardingChecked, onboardingDone, segments]);

  return <>{children}</>;
}

function RootLayoutNav() {
  const [loaded, error] = useFonts({
    PlayfairDisplay_700Bold_Italic: require("../assets/fonts/PlayfairDisplay_700Bold_Italic.ttf"),
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
    Caprasimo_400Regular: require("@expo-google-fonts/caprasimo/400Regular/Caprasimo_400Regular.ttf"),
    ...FontAwesome.font,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);

  if (!loaded) return null;

  const stack = (
    <AuthGate>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="auth" options={{ presentation: "modal" }} />
        <Stack.Screen name="add" options={{ presentation: "fullScreenModal", gestureEnabled: false }} />
        <Stack.Screen name="entry/[date]" />
        <Stack.Screen name="profile" />
        <Stack.Screen name="community/[id]" />
        <Stack.Screen name="communities" />
        <Stack.Screen name="link-phone" />
      </Stack>
    </AuthGate>
  );

  if (Platform.OS === "web") {
    return (
      <View style={{ flex: 1, alignItems: "center", backgroundColor: "#F5DDD0" }}>
        <View style={{ width: "100%", maxWidth: 390, flex: 1 }}>{stack}</View>
      </View>
    );
  }

  return stack;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootLayoutNav />
    </AuthProvider>
  );
}
