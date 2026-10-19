import React from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from './theme';

export function Action({ label, onPress, disabled = false, quiet = false, busy = false }: { label: string; onPress: () => void; disabled?: boolean; quiet?: boolean; busy?: boolean }) {
  const c = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, busy }} disabled={disabled || busy} onPress={onPress} style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 15, paddingVertical: 12, borderRadius: 13, backgroundColor: quiet ? c.raised : c.accent, opacity: disabled ? 0.4 : pressed ? 0.7 : 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 })}>{busy && <ActivityIndicator size="small" color={quiet ? c.text : c.accentText} />}<Text style={{ fontWeight: '600', color: quiet ? c.text : c.accentText }}>{label}</Text></Pressable>;
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const c = useTheme();
  return <View className="gap-2"><Text style={{ color: c.muted, fontSize: 13 }}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor={c.muted} {...props} style={[{ color: c.text, backgroundColor: c.raised, borderWidth: 1, borderColor: c.border, borderRadius: 13, padding: 14, minHeight: 48 }, props.style]} /></View>;
}
export function Notice({ message }: { message: string }) { const c = useTheme(); return <Text accessibilityRole="alert" style={{ color: c.danger, padding: 12, lineHeight: 21 }}>{message}</Text>; }
