import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/constants/supabase';

// expo-secure-store only works on native; fall back to localStorage on web.
// Guard typeof localStorage because Expo Router runs a node SSR pass where
// Platform.OS === 'web' but localStorage doesn't exist yet.
const storage = Platform.OS === 'web'
  ? {
      getItem: (key: string) =>
        typeof localStorage !== 'undefined'
          ? Promise.resolve(localStorage.getItem(key))
          : Promise.resolve(null),
      setItem: (key: string, value: string) =>
        typeof localStorage !== 'undefined'
          ? Promise.resolve(localStorage.setItem(key, value))
          : Promise.resolve(),
      removeItem: (key: string) =>
        typeof localStorage !== 'undefined'
          ? Promise.resolve(localStorage.removeItem(key))
          : Promise.resolve(),
    }
  : (() => {
      // SecureStore has a 2048-byte limit per key. Split large values into chunks.
      const CHUNK = 1800;
      const chunkKeys = (key: string, n: number) =>
        Array.from({ length: n }, (_, i) => `${key}.chunk_${i}`);

      return {
        getItem: async (key: string) => {
          const meta = await SecureStore.getItemAsync(`${key}.chunks`);
          if (meta) {
            const count = parseInt(meta, 10);
            const parts = await Promise.all(chunkKeys(key, count).map(k => SecureStore.getItemAsync(k)));
            return parts.every(p => p !== null) ? parts.join('') : null;
          }
          return SecureStore.getItemAsync(key);
        },
        setItem: async (key: string, value: string) => {
          if (value.length <= CHUNK) {
            await SecureStore.deleteItemAsync(`${key}.chunks`);
            return SecureStore.setItemAsync(key, value);
          }
          const chunks: string[] = [];
          for (let i = 0; i < value.length; i += CHUNK) chunks.push(value.slice(i, i + CHUNK));
          await SecureStore.setItemAsync(`${key}.chunks`, String(chunks.length));
          await Promise.all(chunks.map((c, i) => SecureStore.setItemAsync(`${key}.chunk_${i}`, c)));
          await SecureStore.deleteItemAsync(key);
        },
        removeItem: async (key: string) => {
          const meta = await SecureStore.getItemAsync(`${key}.chunks`);
          if (meta) {
            const count = parseInt(meta, 10);
            await Promise.all([
              SecureStore.deleteItemAsync(`${key}.chunks`),
              ...chunkKeys(key, count).map(k => SecureStore.deleteItemAsync(k)),
            ]);
          } else {
            await SecureStore.deleteItemAsync(key);
          }
        },
      };
    })();

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
