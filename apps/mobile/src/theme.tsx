import { createContext, useContext } from 'react';
export const darkPalette = { bg: '#101214', panel: '#191c20', raised: '#22272b', border: '#30363b', text: '#eff3f1', muted: '#9ba8a5', accent: '#9de3ce', accentText: '#102c24', danger: '#ffaaa3' };
export const lightPalette = { bg: '#f5f7f5', panel: '#ffffff', raised: '#e8efeb', border: '#d4dfd9', text: '#16241f', muted: '#5c7066', accent: '#246d57', accentText: '#ffffff', danger: '#ad332a' };
export const ThemeContext = createContext(darkPalette);
export const useTheme = () => useContext(ThemeContext);
