import type { ExpoConfig } from 'expo/config';
const config: ExpoConfig = {
  name: 'OmniChat', slug: 'omnichat', version: '0.1.0', scheme: 'omnichat', orientation: 'default', userInterfaceStyle: 'automatic',
  ios: { bundleIdentifier: 'app.omnichat.mobile', supportsTablet: true },
  android: { package: 'app.omnichat.mobile', softwareKeyboardLayoutMode: 'resize' },
  plugins: ['expo-secure-store', 'expo-document-picker'],
  extra: { apiUrlConfigured: Boolean(process.env.EXPO_PUBLIC_API_URL) },
};
export default config;
