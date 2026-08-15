import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import ThemeProvider from '@/components/theme-provider';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { Header } from '@/components/layout/header';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { WorkspaceShell } from '@/components/layout/workspace-shell';
import { WORKSPACE_PANEL_COOKIE, parsePanelWidthCookie } from '@/lib/layout/workspace-panel';
import { isAuditUiEnabled } from '@/lib/audit/audit-ui-flag';
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
//
// #350b:content 之外多一個 `@panel` **平行路由槽**(共用右側面板系統,wave-plan `:23`)。
// 🔴 `panel` 這個 prop 名 = 資料夾名 `app/@panel`,**改一個就要同時改另一個**,
//    而漏改的症狀是「面板永遠不出現」且**不會有任何錯誤** ⇒ `workspace-shell.test.ts` 釘住兩邊字面。
//
// 🔴 **本 layout 因為 `cookies()` 變成動態渲染** —— 這是刻意的取捨:
//    面板寬度要**真的**在重整後還在(Sean 逐字「90% 時間都會是跟截圖一樣的狀態下工作」),
//    就必須在 server 端讀 cookie、在第一幀就用對的寬度,否則會先渲染一個寬度再跳。
//    admin 全站本來就幾乎都是 `force-dynamic`(訂單/客戶列表皆是),這裡不是新增成本。
//    ⚠️ 對照組:`ui/sidebar.tsx:117` 也寫 cookie,但**全樹沒有任何呼叫端傳 `defaultOpen`**
//    (實查 grep 零命中)⇒ 那顆只寫不讀、重整後側欄一律回展開。本片刻意不重蹈。
export default async function RootLayout({
  children,
  panel,
}: {
  children: React.ReactNode;
  panel: React.ReactNode;
}) {
  const initialPanelWidth = parsePanelWidthCookie(
    (await cookies()).get(WORKSPACE_PANEL_COOKIE)?.value,
  );
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
            {/* 🔴 `#27` D1c-1:旗標**在這裡(server)算**,不在側欄裡算。
                側欄是 `'use client'`,而 `AUDIT_UI_ENABLED` 不是 `NEXT_PUBLIC_*`
                ⇒ 在那邊呼叫會靜默拿到 `undefined`(理由與實測見 `app-sidebar.tsx` 檔頭)。
                形狀照抄 `components/orders/order-detail-route.tsx:250` 的既有前例。 */}
            <AppSidebar auditEnabled={isAuditUiEnabled()} />
            <SidebarInset>
              <Header />
              <WorkspaceShell panel={panel} initialPanelWidth={initialPanelWidth}>
                {children}
              </WorkspaceShell>
            </SidebarInset>
          </SidebarProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
