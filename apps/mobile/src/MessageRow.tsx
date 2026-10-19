import React, { memo } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { MotiView } from 'moti';
import * as Clipboard from 'expo-clipboard';
import type { Message } from '@omnichat/types';
import { useTheme } from './theme';

export const MessageRow = memo(function MessageRow({ message, animate, onEdit }: { message: Message; animate: boolean; onEdit: (message: Message) => void }) {
  const c = useTheme(); const own = message.role === 'user';
  return <MotiView from={animate ? { opacity: 0, translateY: 7 } : undefined} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: animate ? 200 : 0 }} style={{ marginBottom: 24, paddingHorizontal: 20 }}>
    <View className="flex-row items-center gap-2" style={{ marginBottom: 10 }}><Text style={{ fontSize: 13, fontWeight: '600', color: own ? c.muted : c.accent }}>{own ? 'YOU' : '◎ OMNICHAT'}</Text><Text style={{ fontSize: 11, color: c.muted }}>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text></View>
    <View style={{ backgroundColor: own ? c.raised : 'transparent', borderRadius: 18, paddingHorizontal: own ? 16 : 0, paddingVertical: own ? 8 : 0 }}>
      <Markdown style={{ body: { color: c.text, fontSize: 16, lineHeight: 25 }, code_inline: { backgroundColor: c.raised, color: c.accent }, fence: { backgroundColor: c.raised, borderColor: c.border, color: c.text, padding: 14, fontSize: 13 }, code_block: { backgroundColor: c.raised, borderColor: c.border, color: c.text }, link: { color: c.accent }, blockquote: { backgroundColor: c.panel, borderColor: c.accent } }} onLinkPress={url => { if (/^https?:\/\//i.test(url)) void Linking.openURL(url); return false; }}>{message.content || (message.status === 'streaming' ? 'Thinking…' : '')}</Markdown>
    </View>
    {message.attachments?.map(file => <Text key={file.id} style={{ color: c.muted, paddingVertical: 6 }}>↗ {file.name}</Text>)}
    {message.error ? <Text accessibilityRole="alert" style={{ color: c.danger }}>{message.error}</Text> : null}
    <View className="flex-row items-center gap-4" style={{ marginTop: 4 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Copy message" onPress={() => void Clipboard.setStringAsync(message.content)} style={{ minHeight: 36, justifyContent: 'center' }}><Text style={{ fontSize: 12, color: c.muted }}>Copy</Text></Pressable>
      {own && <Pressable accessibilityRole="button" accessibilityLabel="Edit and branch message" onPress={() => onEdit(message)} style={{ minHeight: 36, justifyContent: 'center' }}><Text style={{ fontSize: 12, color: c.muted }}>Edit & branch</Text></Pressable>}
      {message.status !== 'complete' && <Text style={{ color: c.muted, fontSize: 11 }}>{message.status}</Text>}
      {message.outputTokens != null && <Text style={{ color: c.muted, fontSize: 11 }}>{message.outputTokens} output tokens</Text>}
    </View>
  </MotiView>;
});
