'use client';

import { ThemeProvider as NextThemesProvider, type ThemeProviderProps } from 'next-themes';

// fork 自 Kiranism starter src/components/themes/theme-provider.tsx(見 src/FORK-PROVENANCE.md);
// 攤平原多主題(active_theme cookie)為單一 light/dark class 切換。
export default function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
