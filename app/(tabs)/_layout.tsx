import { StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Theme } from '@/constants/Theme';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Theme.colors.background,
          borderTopColor: Theme.colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: 68,
          paddingBottom: 14,
          paddingTop: 2,
        },
        tabBarActiveTintColor: Theme.colors.brandWarm,
        tabBarInactiveTintColor: 'rgba(0,0,0,0.45)',
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          letterSpacing: 0.2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'your journal',
          tabBarIcon: ({ color, size }) => (
            <Feather name="calendar" color={color} size={size - 2} />
          ),
        }}
      />
      <Tabs.Screen
        name="two"
        options={{
          title: 'community',
          tabBarIcon: ({ color, size }) => (
            <Feather name="users" color={color} size={size - 2} />
          ),
        }}
      />
    </Tabs>
  );
}
