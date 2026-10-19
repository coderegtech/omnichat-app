import * as SecureStore from 'expo-secure-store';
import { ApiClient, ApiError } from '@omnichat/api-client';
import { fetch as expoFetch } from 'expo/fetch';
import type { User } from '@omnichat/types';

const TOKEN_KEY = 'omnichat.session.v1';
let token: string | null = null;
export const configuredUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') ?? '';
export const api = new ApiClient({ baseUrl: `${configuredUrl}/api`, token: () => token, fetch: ((input, init) => expoFetch(input as string, { ...init, credentials: 'omit' })) as typeof fetch });

export async function restoreSession(): Promise<User | null> {
  token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!token) return null;
  try { return (await api.request<{ user: User }>('/auth/me')).user; }
  catch (error) {
    if (error instanceof ApiError && error.status === 401) { await clearSession(); return null; }
    throw error; // A temporary connection failure must not destroy a valid saved session.
  }
}
export async function signIn(mode: 'login' | 'register', values: { name?: string; email: string; password: string }): Promise<User> {
  const result = await api.request<{ user: User; token?: string }>(`/auth/${mode}`, { method: 'POST', body: { ...values, client: 'native' } });
  if (!result.token) throw new Error('The server did not issue a native session. Check the backend configuration.');
  try { await SecureStore.setItemAsync(TOKEN_KEY, result.token, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }); }
  catch { throw new Error('Secure storage is unavailable. Your session could not be saved.'); }
  token = result.token;
  return result.user;
}
export async function clearSession() { token = null; await SecureStore.deleteItemAsync(TOKEN_KEY); }
export async function signOut() {
  // Server revocation must succeed before claiming the session was fully signed out.
  await api.request('/auth/logout', { method: 'POST' });
  await clearSession();
}
