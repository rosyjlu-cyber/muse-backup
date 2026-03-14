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
          borderTopWidth: 0,
          height: 56,
          paddingBottom: 8,
          paddingTop: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -3 },
          shadowOpacity: 0.10,
          shadowRadius: 6,
          elevation: 12,
        },
        tabBarActiveTintColor: Theme.colors.brandWarm,
        tabBarInactiveTintColor: 'rgba(0,0,0,0.35)',
        tabBarShowLabel: false,
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
