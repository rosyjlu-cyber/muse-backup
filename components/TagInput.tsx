import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { Theme } from '@/constants/Theme';

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}

export function TagInput({ value, onChange, placeholder = 'add tags...' }: TagInputProps) {
  const [input, setInput] = useState('');

  const commit = (raw: string) => {
    const tag = raw.trim().replace(/,+$/, '').trim().toLowerCase();
    if (tag && !value.includes(tag)) {
      onChange([...value, tag]);
    }
    setInput('');
  };

  const handleChange = (text: string) => {
    // Commit on comma or space
    if (text.endsWith(',') || text.endsWith(' ')) {
      commit(text.slice(0, -1));
    } else {
      setInput(text);
    }
  };

  const removeTag = (tag: string) => {
    onChange(value.filter(t => t !== tag));
  };

  return (
    <View style={styles.wrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsRow}
        keyboardShouldPersistTaps="handled"
      >
        {value.map(tag => (
          <TouchableOpacity
            key={tag}
            style={styles.chip}
            onPress={() => removeTag(tag)}
            activeOpacity={0.7}
          >
            <Text style={styles.chipText}>{tag}</Text>
            <Text style={styles.chipX}> ×</Text>
          </TouchableOpacity>
        ))}
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={handleChange}
          onSubmitEditing={() => commit(input)}
          placeholder={value.length === 0 ? placeholder : ''}
          placeholderTextColor={Theme.colors.disabled}
          returnKeyType="done"
          submitBehavior="blurAndSubmit"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.radius.md,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    minHeight: 48,
    justifyContent: 'center',
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.colors.accent,
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: {
    fontSize: Theme.font.xs,
    fontWeight: '700',
    color: Theme.colors.background,
    letterSpacing: 0.2,
  },
  chipX: {
    fontSize: Theme.font.xs,
    fontWeight: '700',
    color: Theme.colors.background,
  },
  input: {
    fontSize: Theme.font.base,
    color: Theme.colors.primary,
    minWidth: 80,
    paddingVertical: 2,
  },
});
