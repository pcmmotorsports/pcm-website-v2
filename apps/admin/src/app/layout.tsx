import type { Metadata, Viewport } from 'next';
import ThemeProvider from '@/components/theme-provider';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { Header } from '@/components/layout/header';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import './globals.css';

export const metadata: Metadata = {
  title: 'PCM 後台',
  description: 'PCM Motorsports 後台管理(M-4a)',
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
};

// M0-S1 骨架:單一殼 layout(sidebar + header + content),light 預設、dark 可切。
// 尚未接資料、無登入(SSO 收端等提案批准後於後續 slice 加 middleware)。
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='zh-Hant' suppressHydrationWarning>
      <body className='bg-background text-foreground font-sans antialiased'>
        <ThemeProvider
          attribute='class'
          defaultTheme='light'
          enableSystem={false}
          disableTransitionOnChange
        >
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
              <Header />
              <main className='flex-1 p-6'>{children}</main>
            </SidebarInset>
          </SidebarProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
