import './global.css';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View, useColorScheme } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import type { Attachment, Conversation, ListResult, Message, Model, ModelRegistry, User, UserSettings } from '@omnichat/types';
import { api, configuredUrl, restoreSession, signOut } from './src/session';
import { Action, Field, Notice } from './src/components';
import { AuthScreen } from './src/AuthScreen';
import { ThemeContext, darkPalette, lightPalette, useTheme } from './src/theme';
import { MessageRow } from './src/MessageRow';
import { applyEvent, visibleBranch } from './src/chat-state';

type Panel = 'history' | 'models' | 'settings' | 'status' | 'branches' | null;
const useUI = create<{ panel: Panel; activeId: string | null; setPanel: (panel: Panel) => void; setActiveId: (activeId: string | null) => void }>(set => ({ panel: null, activeId: null, setPanel: panel => set({ panel }), setActiveId: activeId => set({ activeId }) }));
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 20000 }, mutations: { retry: false } } });
const errorText = (e: unknown) => e instanceof Error ? e.message : 'Something went wrong. Please try again.';

export default function App() { return <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><QueryClientProvider client={queryClient}><Root /></QueryClientProvider></SafeAreaProvider></GestureHandlerRootView>; }

function Root() {
  const [user, setUser] = useState<User | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const scheme = useColorScheme();
  const preferences = useQuery({ queryKey: ['settings', user?.id], queryFn: () => api.request<UserSettings>('/settings'), enabled: !!user });
  const theme = preferences.data?.theme ?? 'dark'; const light = theme === 'light' || (theme === 'system' && scheme === 'light');
  async function restore() { setLoading(true); setError(''); try { if (configuredUrl) setUser(await restoreSession()); } catch (e) { setError(errorText(e)); } finally { setLoading(false); } }
  useEffect(() => { void restore(); }, []);
  const colors = light ? lightPalette : darkPalette;
  return <ThemeContext.Provider value={colors}><SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}><StatusBar style={light ? 'dark' : 'light'} />
    {loading ? <View className="flex-1 items-center justify-center gap-4"><ActivityIndicator color={colors.accent} /><Text style={{ color: colors.muted }}>Opening your workspace…</Text></View> : error ? <View className="flex-1 justify-center gap-4 p-6"><Notice message={error} /><Action label="Retry connection" onPress={() => void restore()} /></View> : user ? <Workspace user={user} settings={preferences.data} onLogout={() => { queryClient.clear(); useUI.getState().setActiveId(null); useUI.getState().setPanel(null); setUser(null); }} /> : <AuthScreen onAuthenticated={setUser} />}
  </SafeAreaView></ThemeContext.Provider>;
}

function Sheet({ title, children }: { title: string; children: React.ReactNode }) {
  const c = useTheme(); const { panel, setPanel } = useUI();
  return <Modal visible={panel !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPanel(null)}><SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}><View className="flex-row items-center justify-between p-5" style={{ borderBottomWidth: 1, borderBottomColor: c.border }}><Text style={{ fontSize: 22, fontWeight: '600', color: c.text }}>{title}</Text><Action label="Done" quiet onPress={() => setPanel(null)} /></View>{children}</SafeAreaView></Modal>;
}

function Workspace({ user, settings, onLogout }: { user: User; settings?: UserSettings; onLogout: () => void }) {
  const c = useTheme(); const cache = useQueryClient(); const { panel, setPanel, activeId, setActiveId } = useUI();
  const [draft, setDraft] = useState(''); const [selected, setSelected] = useState(''); const [messages, setMessages] = useState<Message[]>([]);
  const [leafId, setLeafId] = useState<string>(); const [branchParent, setBranchParent] = useState<string | null | undefined>();
  const [busy, setBusy] = useState(false); const [uploading, setUploading] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]); const [search, setSearch] = useState(''); const [modelSearch, setModelSearch] = useState(''); const [provider, setProvider] = useState('');
  const [rename, setRename] = useState(''); const [renameId, setRenameId] = useState<string | null>(null); const [reducedMotion, setReducedMotion] = useState(false);
  const controller = useRef<AbortController | null>(null); const generatingId = useRef<string | null>(null); const scroll = useRef<FlatList<Message>>(null); const nearBottom = useRef(true);
  const registry = useQuery({ queryKey: ['models'], queryFn: () => api.request<ModelRegistry>('/models') });
  const conversations = useQuery({ queryKey: ['conversations', search], queryFn: () => api.request<ListResult<Conversation>>(`/conversations?q=${encodeURIComponent(search)}`) });
  const detail = useQuery({ queryKey: ['conversation', activeId], queryFn: () => api.request<{ conversation: Conversation; messages: Message[] }>(`/conversations/${activeId}`), enabled: !!activeId && !busy });
  const models = registry.data?.models.filter(m => m.capabilities.chat === true && m.availability !== 'unavailable') ?? [];
  const model = models.find(m => m.id === selected); const animate = !reducedMotion && settings?.animations !== false;
  const branch = visibleBranch(messages, leafId);
  const title = detail.data?.conversation.title ?? 'New conversation';

  useEffect(() => { void AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion); const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion); return () => sub.remove(); }, []);
  useEffect(() => { if (detail.data && !busy) { setMessages(detail.data.messages); setLeafId(undefined); if (detail.data.conversation.modelId) setSelected(detail.data.conversation.modelId); } }, [detail.data]);
  useEffect(() => { if (!selected && models.length) setSelected(settings?.defaultModel && models.some(m => m.id === settings.defaultModel) ? settings.defaultModel : models[0]!.id); }, [registry.data, settings?.defaultModel, selected]);
  useEffect(() => () => { controller.current?.abort(); }, []);

  const edit = useCallback((message: Message) => { if (controller.current) return; setDraft(message.content); setBranchParent(message.parentId); setNotice('Editing creates a new branch; your original messages stay in history.'); }, []);
  async function refreshHistory() { await cache.invalidateQueries({ queryKey: ['conversations'] }); }
  async function saveSettings(patch: Partial<UserSettings>) {
    try { const result = await api.request<UserSettings>('/settings', { method: 'PATCH', body: patch }); cache.setQueryData(['settings', user.id], result); }
    catch (e) { setError(errorText(e)); }
  }
  function startNew() { if (busy) return; setActiveId(null); setMessages([]); setLeafId(undefined); setDraft(''); setAttachments([]); setBranchParent(undefined); setError(''); setNotice(''); setPanel(null); }
  async function openConversation(id: string) { if (busy) return; setMessages([]); setLeafId(undefined); setActiveId(id); setBranchParent(undefined); setAttachments([]); setDraft(''); setPanel(null); setError(''); }
  async function stop() {
    if (!generatingId.current) return;
    try { await api.request(`/conversations/${generatingId.current}/cancel`, { method: 'POST' }); }
    catch (e) { setError(`Stopping locally. ${errorText(e)}`); }
    finally { controller.current?.abort(); }
  }
  async function send(regenerate = false) {
    if (controller.current || !selected || !model) return;
    const lastUser = [...branch].reverse().find(m => m.role === 'user');
    const content = regenerate ? lastUser?.content ?? '' : draft.trim();
    if (!content) return;
    const abort = new AbortController(); controller.current = abort; setBusy(true); setError(''); setNotice('');
    let id = activeId; let assistant: Message | undefined; let currentMessages: Message[] = []; let lastFlush = 0;
    try {
      if (!id) { const created = await api.request<Conversation>('/conversations', { method: 'POST', body: { title: content.slice(0, 70), modelId: selected }, signal: abort.signal }); id = created.id; setActiveId(id); }
      generatingId.current = id;
      const parentId = regenerate ? lastUser!.id : branchParent !== undefined ? branchParent : branch[branch.length - 1]?.id ?? null;
      const optimisticUser: Message = { id: Crypto.randomUUID(), conversationId: id, parentId, role: 'user', content, modelId: selected, status: 'complete', createdAt: new Date().toISOString(), attachments };
      assistant = { id: Crypto.randomUUID(), conversationId: id, parentId: regenerate ? lastUser!.id : optimisticUser.id, role: 'assistant', content: '', modelId: selected, status: 'streaming', createdAt: new Date().toISOString() };
      currentMessages = [...messages, ...(regenerate ? [] : [optimisticUser]), assistant]; setMessages(currentMessages); setLeafId(assistant.id); setDraft(''); setBranchParent(undefined); setAttachments([]); nearBottom.current = true;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      for await (const event of api.streamMessage(id, { content, modelId: selected, requestId: Crypto.randomUUID(), parentId, regenerate, attachmentIds: attachments.map(a => a.id), stream: settings?.streaming !== false && model.capabilities.streaming !== false }, abort.signal)) {
        if (event.type === 'meta' && !regenerate) { optimisticUser.id = event.userMessageId; currentMessages[currentMessages.length - 2] = { ...optimisticUser }; }
        assistant = applyEvent(assistant, event); currentMessages[currentMessages.length - 1] = assistant;
        if (event.type === 'notice') setNotice(event.message);
        if (event.type === 'error') setError(event.message);
        if (Date.now() - lastFlush >= 50 || ['meta', 'done', 'error'].includes(event.type)) { setMessages([...currentMessages]); setLeafId(assistant.id); lastFlush = Date.now(); }
      }
      setMessages([...currentMessages]);
    } catch (e) {
      if (assistant) { assistant = { ...assistant, status: abort.signal.aborted ? 'cancelled' : 'error', error: abort.signal.aborted ? null : errorText(e) }; currentMessages[currentMessages.length - 1] = assistant; setMessages([...currentMessages]); }
      if (!abort.signal.aborted) setError(errorText(e));
    } finally {
      controller.current = null; generatingId.current = null; setBusy(false);
      if (id) void cache.invalidateQueries({ queryKey: ['conversation', id] });
      void refreshHistory();
    }
  }
  async function upload() {
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false }); if (result.canceled) return;
      const asset = result.assets[0]!; if ((asset.size ?? 0) > 10 * 1024 * 1024) throw new Error('Choose a file of 10 MB or smaller.');
      setUploading(true); const form = new FormData(); form.append('file', new File(asset.uri) as unknown as Blob, asset.name);
      const saved = await api.request<Attachment>('/attachments', { method: 'POST', body: form }); setAttachments(prev => [...prev, saved]);
    } catch (e) { setError(errorText(e)); } finally { setUploading(false); }
  }
  async function exportConversation(format: 'markdown' | 'json') {
    if (!activeId) return;
    try { const blob = await api.download(`/conversations/${activeId}/export?format=${format}`); const file = new File(Paths.cache, `omnichat-${Crypto.randomUUID()}.${format === 'json' ? 'json' : 'md'}`); file.write(await blob.text()); try { await Sharing.shareAsync(file.uri, { mimeType: format === 'json' ? 'application/json' : 'text/markdown' }); } finally { if (file.exists) file.delete(); } }
    catch (e) { setError(errorText(e)); }
  }
  async function mutateConversation(id: string, method: string, body?: unknown) { try { await api.request(`/conversations/${id}`, { method, body }); if (method === 'DELETE' && id === activeId) startNew(); await refreshHistory(); await cache.invalidateQueries({ queryKey: ['conversation', id] }); } catch (e) { setError(errorText(e)); } }
  const swipe = Gesture.Pan().runOnJS(true).activeOffsetX(30).failOffsetY([-15, 15]).onEnd(event => { if (event.translationX > 90 && !busy) setPanel('history'); });

  return <GestureDetector gesture={swipe}><View style={{ flex: 1 }}><View className="flex-row items-center justify-between px-4 py-3" style={{ borderBottomWidth: 1, borderBottomColor: c.border }}>
    <Action label="☰" quiet disabled={busy} onPress={() => setPanel('history')} /><Pressable accessibilityRole="button" accessibilityLabel="Choose model" disabled={busy} onPress={() => setPanel('models')} style={{ flex: 1, paddingHorizontal: 18 }}><Text numberOfLines={1} style={{ color: c.text, fontWeight: '600', fontSize: 16 }}>{model?.name ?? 'Choose a model'}⌄</Text><Text style={{ color: c.muted, fontSize: 11, marginTop: 3 }}>{model?.provider ?? 'OmniChat'} · {registry.data?.connection.status ?? 'Connecting'}</Text></Pressable><Action label="＋" quiet disabled={busy} onPress={startNew} />
  </View><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    {detail.isLoading && activeId ? <ActivityIndicator style={{ margin: 30 }} color={c.accent} /> : null}
    <FlatList ref={scroll} data={branch} keyExtractor={item => item.id} renderItem={({ item }) => <MessageRow message={item} animate={animate} onEdit={edit} />} contentContainerStyle={{ paddingTop: 25, flexGrow: 1 }} keyboardShouldPersistTaps="handled" onScroll={({ nativeEvent: e }) => { nearBottom.current = e.contentSize.height - e.layoutMeasurement.height - e.contentOffset.y < 100; }} scrollEventThrottle={100} onContentSizeChange={() => { if (nearBottom.current) scroll.current?.scrollToEnd({ animated: animate }); }}
      ListEmptyComponent={<View className="flex-1 justify-center px-8 pb-12"><Text style={{ color: c.accent, fontSize: 52, marginBottom: 24 }}>◎</Text><Text style={{ color: c.text, fontSize: 32, lineHeight: 39, letterSpacing: -1, fontWeight: '500' }}>What’s on your mind?</Text><Text style={{ color: c.muted, fontSize: 16, lineHeight: 25, marginTop: 16 }}>A question, a rough idea, or your next big thing. Let’s make room for it.</Text><View className="gap-3 mt-8">{['Explain something simply', 'Help me shape an idea', 'Write with me'].map(prompt => <Action key={prompt} label={prompt} quiet onPress={() => setDraft(prompt)} />)}</View></View>}
      ListFooterComponent={branch.length > 0 && !busy ? <View className="flex-row gap-2 px-5 pb-4"><Action label="Regenerate" quiet onPress={() => void send(true)} disabled={!model} /><Action label="Branches" quiet onPress={() => setPanel('branches')} /></View> : null} />
    {(error || detail.error || registry.error) ? <Notice message={error || errorText(detail.error || registry.error)} /> : null}
    {notice ? <Text style={{ color: c.muted, fontSize: 12, paddingHorizontal: 20, paddingBottom: 8 }}>{notice}</Text> : null}
    <View style={{ padding: 14, paddingTop: 6 }}><View style={{ backgroundColor: c.panel, borderColor: c.border, borderWidth: 1, borderRadius: 22, padding: 14 }}>
      {attachments.length > 0 && <ScrollView horizontal style={{ marginBottom: 8 }}>{attachments.map(a => <Pressable key={a.id} accessibilityRole="button" accessibilityLabel={`Remove ${a.name}`} onPress={() => setAttachments(prev => prev.filter(item => item.id !== a.id))}><Text style={{ color: c.accent, marginRight: 16 }}>↗ {a.name} ×</Text></Pressable>)}</ScrollView>}
      <TextInput accessibilityLabel="Message" value={draft} onChangeText={setDraft} editable={!busy} multiline placeholder={branchParent !== undefined ? 'Edit your message…' : 'Ask anything…'} placeholderTextColor={c.muted} style={{ fontSize: 16, color: c.text, minHeight: 48, maxHeight: 150, paddingVertical: 5 }} />
      <View className="flex-row items-center justify-between gap-2"><Action label={uploading ? 'Uploading…' : 'Attach'} quiet disabled={busy || uploading || attachments.length >= 5} onPress={() => void upload()} /><Text style={{ color: c.muted, fontSize: 11 }}>{busy ? 'Generating' : 'Your space to think'}</Text><Action label={busy ? 'Stop' : 'Send ↑'} disabled={!busy && (!draft.trim() || !model || uploading)} onPress={() => void (busy ? stop() : send())} /></View>
    </View><Text style={{ color: c.muted, fontSize: 10, textAlign: 'center', marginTop: 9 }}>AI can make mistakes. Check important information.</Text></View>
  </KeyboardAvoidingView>
  {panel === 'history' && <Sheet title="Your conversations"><View className="gap-3 p-4"><Action label="＋ New conversation" onPress={startNew} /><Field label="Search history" value={search} onChangeText={setSearch} /><View className="flex-row gap-2"><Action label="Models" quiet onPress={() => setPanel('models')} /><Action label="Settings" quiet onPress={() => setPanel('settings')} /><Action label="Status" quiet onPress={() => setPanel('status')} /></View></View>
    <FlatList data={conversations.data?.items ?? []} keyExtractor={item => item.id} refreshControl={<RefreshControl refreshing={conversations.isRefetching} onRefresh={() => void conversations.refetch()} tintColor={c.accent} />} ListEmptyComponent={<Text style={{ color: c.muted, padding: 24 }}>{conversations.isLoading ? 'Loading history…' : 'Your conversations will appear here.'}</Text>} renderItem={({ item }) => <View style={{ padding: 18, borderBottomWidth: 1, borderBottomColor: c.border }}><Pressable accessibilityRole="button" onPress={() => void openConversation(item.id)}><Text style={{ color: c.text, fontWeight: '600', fontSize: 16 }}>{item.pinned ? '◆ ' : ''}{item.title}</Text><Text style={{ color: c.muted, marginTop: 5, fontSize: 11 }}>{new Date(item.updatedAt).toLocaleDateString()}</Text></Pressable><View className="flex-row gap-3 mt-3"><Action label={item.pinned ? 'Unpin' : 'Pin'} quiet onPress={() => void mutateConversation(item.id, 'PATCH', { pinned: !item.pinned })} /><Action label="Rename" quiet onPress={() => { setRenameId(item.id); setRename(item.title); }} /><Action label="Delete" quiet onPress={() => Alert.alert('Delete conversation?', 'This removes the conversation from your history.', [{ text: 'Cancel' }, { text: 'Delete', style: 'destructive', onPress: () => void mutateConversation(item.id, 'DELETE') }])} /></View>{renameId === item.id && <View className="gap-2 mt-3"><Field label="Conversation title" value={rename} onChangeText={setRename} /><Action label="Save title" onPress={() => { void mutateConversation(item.id, 'PATCH', { title: rename }); setRenameId(null); }} /></View>}</View>} />{conversations.error && <Notice message={errorText(conversations.error)} />}</Sheet>}
  {panel === 'models' && <Sheet title="Find your model"><View className="gap-3 p-4"><Field label="Search models" value={modelSearch} onChangeText={setModelSearch} /><ScrollView horizontal showsHorizontalScrollIndicator={false}><View className="flex-row gap-2">{['', ...new Set(models.map(m => m.provider))].map(p => <Action key={p} label={p || 'All providers'} quiet={provider !== p} onPress={() => setProvider(p)} />)}</View></ScrollView><Text style={{ color: c.muted, fontSize: 12 }}>Catalog discovery is not an upstream health check.</Text></View><FlatList data={models.filter(m => (!provider || provider === m.provider) && `${m.name} ${m.id}`.toLowerCase().includes(modelSearch.toLowerCase())).sort((a, b) => Number(settings?.favoriteModels.includes(b.id)) - Number(settings?.favoriteModels.includes(a.id)))} keyExtractor={item => item.id} ListEmptyComponent={<Text style={{ color: c.muted, padding: 24 }}>No compatible chat models found. Refresh discovery in Status.</Text>} renderItem={({ item }) => <View className="flex-row items-center gap-3 px-5 py-4" style={{ borderBottomColor: c.border, borderBottomWidth: 1 }}><Pressable accessibilityRole="button" accessibilityLabel={`Select ${item.name}`} onPress={() => { setSelected(item.id); setPanel(null); if (activeId) void mutateConversation(activeId, 'PATCH', { modelId: item.id }); void Haptics.selectionAsync().catch(() => undefined); }} style={{ flex: 1 }}><Text style={{ color: selected === item.id ? c.accent : c.text, fontSize: 16 }}>{item.name}</Text><Text style={{ color: c.muted, marginTop: 5, fontSize: 12 }}>{item.provider} · {item.availability} · {item.contextWindow ? `${item.contextWindow.toLocaleString()} context` : 'context unknown'}</Text></Pressable><Action label={settings?.favoriteModels.includes(item.id) ? '★' : '☆'} quiet onPress={() => void saveSettings({ favoriteModels: settings?.favoriteModels.includes(item.id) ? settings.favoriteModels.filter(id => id !== item.id) : [...settings?.favoriteModels ?? [], item.id] })} /></View>} /></Sheet>}
  {panel === 'settings' && <Sheet title="Make it yours"><ScrollView contentContainerStyle={{ padding: 20, gap: 20 }}><Text style={{ color: c.text, fontSize: 17 }}>{user.name}</Text><Text style={{ color: c.muted }}>{user.email}</Text><Text style={{ color: c.muted }}>Appearance</Text><View className="flex-row gap-2">{(['dark', 'light', 'system'] as const).map(theme => <Action key={theme} label={theme} quiet={settings?.theme !== theme} onPress={() => void saveSettings({ theme })} />)}</View><Action label={settings?.animations === false ? 'Enable animations' : 'Reduce animations'} quiet onPress={() => void saveSettings({ animations: settings?.animations === false })} /><Action label={settings?.streaming === false ? 'Enable streaming' : 'Disable streaming'} quiet onPress={() => void saveSettings({ streaming: settings?.streaming === false })} /><Action label="Use current model by default" quiet disabled={!model} onPress={() => void saveSettings({ defaultModel: selected })} /><SystemPrompt value={settings?.systemPrompt ?? ''} onSave={value => void saveSettings({ systemPrompt: value })} />{activeId && <View className="gap-3"><Text style={{ color: c.muted }}>Export “{title}”</Text><Action label="Share Markdown" quiet onPress={() => void exportConversation('markdown')} /><Action label="Share JSON" quiet onPress={() => void exportConversation('json')} /></View>}<Action label="Sign out" quiet onPress={() => { void signOut().then(onLogout).catch(e => setError(errorText(e))); }} />{error && <Notice message={error} />}</ScrollView></Sheet>}
  {panel === 'status' && <Sheet title="Connection"><ScrollView contentContainerStyle={{ padding: 20, gap: 18 }}><Text style={{ color: c.accent, fontSize: 24 }}>{registry.data?.connection.status ?? 'Unknown'}</Text><Text style={{ color: c.muted }}>{registry.data?.connection.error || 'Model discovery confirms gateway reachability. Provider availability is verified only when a request succeeds.'}</Text><Text style={{ color: c.muted }}>Last checked: {registry.data?.connection.checkedAt ? new Date(registry.data.connection.checkedAt).toLocaleString() : 'Never'}</Text><Action label="Refresh discovery" onPress={() => { void api.request<ModelRegistry>('/models/refresh', { method: 'POST' }).then(data => cache.setQueryData(['models'], data)).catch(e => setError(errorText(e))); }} />{registry.data?.endpoints.map(endpoint => <View key={endpoint.id} style={{ padding: 16, borderRadius: 16, backgroundColor: c.panel }}><Text style={{ color: endpoint.available ? c.accent : c.muted, fontWeight: '600' }}>{endpoint.label} · {endpoint.available ? 'Configured' : 'Unavailable'}</Text><Text style={{ color: c.muted, marginTop: 7 }}>{endpoint.reason ?? `${endpoint.modelCount ?? 0} compatible models`}</Text></View>)}{error && <Notice message={error} />}</ScrollView></Sheet>}
  {panel === 'branches' && <Sheet title="Conversation branches"><ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>{messages.filter(message => !messages.some(child => child.parentId === message.id)).map(message => <Pressable key={message.id} accessibilityRole="button" onPress={() => { setLeafId(message.id); setPanel(null); }} style={{ padding: 16, borderRadius: 15, backgroundColor: c.panel }}><Text style={{ color: c.muted, fontSize: 12 }}>{new Date(message.createdAt).toLocaleString()} · {message.status}</Text><Text numberOfLines={4} style={{ color: c.text, lineHeight: 23, marginTop: 8 }}>{message.content || 'Empty response'}</Text></Pressable>)}</ScrollView></Sheet>}
  </View></GestureDetector>;
}

function SystemPrompt({ value, onSave }: { value: string; onSave: (value: string) => void }) { const [draft, setDraft] = useState(value); return <View className="gap-3"><Field label="Default system instructions" value={draft} onChangeText={setDraft} multiline style={{ minHeight: 110 }} /><Action label="Save instructions" quiet onPress={() => onSave(draft)} /></View>; }
