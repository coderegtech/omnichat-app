import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import type { User } from '@omnichat/types';
import { Action, Field, Notice } from './components';
import { signIn, configuredUrl } from './session';
import { useTheme } from './theme';

export function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const c = useTheme();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit() {
    if (busy) return;
    if (!configuredUrl) { setError('Set EXPO_PUBLIC_API_URL to your reachable OmniChat backend, then rebuild the app.'); return; }
    if (!email.trim() || password.length < 12 || password.length > 128 || (mode === 'register' && !name.trim())) { setError('Enter your email and a password of 12 to 128 characters. Registration also needs your name.'); return; }
    setBusy(true); setError('');
    try { const user = await signIn(mode, { name: name.trim(), email: email.trim(), password }); setPassword(''); onAuthenticated(user); }
    catch (e) { setError(e instanceof Error ? e.message : 'Sign in failed.'); }
    finally { setBusy(false); }
  }
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 28, gap: 24 }}>
    <View style={{ width: 60, height: 60, borderWidth: 1, borderColor: c.border, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: c.panel }}><Text style={{ fontSize: 36, color: c.accent }}>◎</Text></View>
    <View className="gap-3"><Text style={{ fontSize: 35, color: c.text, fontWeight: '600', letterSpacing: -1.5 }}>A little more possible.</Text><Text style={{ color: c.muted, fontSize: 16, lineHeight: 25 }}>Your ideas. Your models. One thoughtful space.</Text></View>
    <View className="gap-4">{mode === 'register' && <Field label="Name" value={name} onChangeText={setName} autoComplete="name" />}
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === 'register' ? 'new-password' : 'current-password'} onSubmitEditing={() => void submit()} />
      {error ? <Notice message={error} /> : null}
      <Action label={mode === 'login' ? 'Sign in' : 'Create account'} busy={busy} onPress={() => void submit()} />
      <Action label={mode === 'login' ? 'Create an account' : 'Back to sign in'} quiet disabled={busy} onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }} />
    </View><Text style={{ color: c.muted, fontSize: 12, lineHeight: 19 }}>Your conversations sync securely through your OmniChat account.</Text>
  </ScrollView></KeyboardAvoidingView>;
}
