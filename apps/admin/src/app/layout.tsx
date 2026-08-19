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
  description: 'PCM重機零件販售 後台管理(M-4a)',
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
};

// M0-S1 骨架:單一殼 layout(sidebar + header + content)。
// 🔴 **原字面逐字「light 預設、dark 可切」已於 2026-08-16 作廢**(Sean 拍板「不要深色模式」)——
//    現況:**恆亮色**,由下方 `forcedTheme='light'` 強制,切換入口已從 `header.tsx` 移除。
// 🔴 **登入閘早就上線了,別照舊字面判斷**(#10 片1 順帶修;原字面逐字「尚未接資料、**無登入**
// (SSO 收端等提案批准後於後續 slice 加 middleware)」)。現況:`apps/admin/src/proxy.ts:39-50`
// 是 fail-closed 全站閘(無 session → 303 導 `/api/sso/start`),matcher `proxy.ts:64` 逐字
// `'/((?!_next/static|_next/image|favicon.ico).*)'` ⇒ 除靜態資源外**每一條路由都在閘後**。
// 改這行的理由不是順手整理:照舊字面做判斷的人會以為 admin 是裸的,那是**安全誤判**。
// (Next 16 把 `middleware.ts` 改名 `proxy.ts` ⇒ 找不到 middleware 檔不代表沒有閘。)
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
        {/* 🔴🔴 `forcedTheme='light'` = **深色模式關閉的真正機制**(2026-08-16 Sean 拍板「不要深色模式」)。
            ⚠️ **`defaultTheme` 擋不住** —— `next-themes` 的 `setTheme` **無條件**把選擇寫進 localStorage
            (**與 `attribute` 無關**,換 attribute 一樣會存),而 `defaultTheme` **只在沒存過時生效**
            ⇒ 在這個 prop 之前曾經切過深色的人
            **會鎖死在深色、而且畫面上已經沒有切回去的按鈕**(那顆鈕同片自 `header.tsx` 移除)。
            ⇒ **要復原深色:先拿掉這個 prop,再把按鈕加回去。只做後者不會有任何效果。** */}
        <ThemeProvider
          attribute='class'
          defaultTheme='light'
          forcedTheme='light'
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
