import * as SecureStore from 'expo-secure-store';
import { api, clearSession, restoreSession, signIn, signOut } from '../src/session';
import { ApiError } from '@omnichat/api-client';
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn(), WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6 }));
const user = { id: 'u1', email: 'me@example.test', name: 'Mira' };
beforeEach(async () => { jest.restoreAllMocks(); jest.clearAllMocks(); await clearSession(); jest.mocked(SecureStore.deleteItemAsync).mockClear(); });
test('native auth requests a bearer token and saves it to secure storage', async () => {
  const request = jest.spyOn(api, 'request').mockResolvedValue({ user, token: 'test-token' });
  await expect(signIn('login', { email: user.email, password: 'long-password-42' })).resolves.toEqual(user);
  expect(request).toHaveBeenCalledWith('/auth/login', { method: 'POST', body: { email: user.email, password: 'long-password-42', client: 'native' } });
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('omnichat.session.v1', 'test-token', { keychainAccessible: 6 });
});
test('a network failure preserves the saved credential; expiration clears it', async () => {
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue('test-token');
  const request = jest.spyOn(api, 'request').mockRejectedValueOnce(new Error('Offline')).mockRejectedValueOnce(new ApiError(401, 'UNAUTHORIZED', 'Expired'));
  await expect(restoreSession()).rejects.toThrow('Offline');
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  await expect(restoreSession()).resolves.toBeNull();
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledTimes(2);
});
test('missing token never authenticates and logout revokes before removing storage', async () => {
  const request = jest.spyOn(api, 'request').mockResolvedValueOnce({ user });
  await expect(signIn('register', { name: user.name, email: user.email, password: 'long-password-42' })).rejects.toThrow('did not issue');
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  request.mockRejectedValueOnce(new Error('Offline'));
  await expect(signOut()).rejects.toThrow('Offline');
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  request.mockResolvedValueOnce({ ok: true }); await signOut();
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledTimes(1);
});
