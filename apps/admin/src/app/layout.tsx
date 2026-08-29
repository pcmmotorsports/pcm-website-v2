import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import ThemeProvider from '@/components/theme-provider';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { Header } from '@/components/layout/header';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { WorkspaceShell } from '@/components/layout/workspace-shell';
import { SessionRenew } from '@/components/session/session-renew';
import { WORKSPACE_PANEL_COOKIE, parsePanelWidthCookie } from '@/lib/layout/workspace-panel';
import { isAuditUiEnabled } from '@/lib/audit/audit-ui-flag';
import { getSidebarCounts } from '@/lib/layout/sidebar-counts';
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
  // W1-077:側欄軌上三格數字,每一頁都要算(含列印頁,print:hidden 只藏像素、不減查詢)。
  const sidebarCounts = await getSidebarCounts();
  return (
    <html lang='zh-Hant' suppressHydrationWarning>
      {/* 🔴🔴 **後台的中文字型**(`Q-FONT2`,Sean 2026-08-29 逐字答「甲 後台接上顧客站已經在用的那條」)
          ⚠️ **他重答過** —— 原答是「把字型檔放進來」(= 那次的乙),引用時不要只引後面那次。

          ## 為什麼要載:字型堆疊【一直都寫著】它,而沒有人把它載進來
          `globals.css:244-246` 的 `--font-sans` 第 6 順位是 `'Noto Sans TC'`;
          🔴 而**列印那支的第一順位就是它**:`app/print/print-a4.css:244`
          `--pd-body: 'Noto Sans TC', 'PingFang TC', …` ⇒ **第一順位是一個 no-op**。
          ⇒ macOS 上落到 `'PingFang TC'` ⇒ **看起來完全正常**;
            而 Vercel 是 Linux 容器、預設映像通常一個 CJK 字型都沒有 ⇒ **豆腐字**。
          📌 **⇒ 失敗形狀:開發的人在 macOS 看到正確中文, 只有正式站是壞的**
            ⇒ **所有本機驗證、三綠、截圖對這一格【零判別力】。**

          ## 為什麼放在【root layout】而不是 print 那一層
          `app/print/layout.tsx` 逐字「本檔刻意不畫任何東西(直接回 `children`)」
          ⇒ 它是**巢狀** layout, root 仍然包著它 ⇒ 放這裡涵蓋列印路徑。
          🔴 而用 `<link>` 而**不用 `next/font`** 是刻意的:
            `next/font` 把字型綁在它被 import 的那一層的 class 上
            ⇒ 那正是「接上了而列印時仍然沒生效」的形狀。

          ## 🔴 而這三行是【從 storefront 機械抽出來的】, 不是手打
          來源 `apps/storefront/src/app/layout.tsx` 的 `<head>`。
          ⚠️ **兩處要一致** —— `layout-font-link.test.tsx` 逐字比對兩邊的 URL, **分歧就紅**。
          ## ⚠️ 兩個代價(code-reviewer 2026-08-29 點名,寫下來而不是修掉)
          🔴 **① `<link rel=stylesheet>` 是 render-blocking**:`fonts.googleapis.com` 不可達時
             (內網 / 擋外連), 後台首屏會**等到瀏覽器逾時才畫**。
             ⚠️ `display=swap` **管不到這一段** —— 它只管字型檔, 不管這張樣式表。
             ⇒ storefront 已經接受這個代價, 而**後台是員工工具、網路環境不一定同一種**。
             ⇒ 目前照 Sean 的拍板「接上顧客站那條」⇒ 不另外做非同步載入(那會與顧客站分歧)。
          🔴 **② 全 repo 今天【零 CSP】**(`apps/admin/vercel.json` 只有 framework+regions;
             `next.config.ts` 無 `headers()`)⇒ 今天不會被擋。
             **而日後誰加 CSP, `style-src` 要放 `fonts.googleapis.com`、
             `font-src` 要放 `fonts.gstatic.com`** —— **漏掉的症狀就是豆腐字, 而它不會報錯。**
          ⚠️ **③ Next 內建的 `global-error` 會自己畫 `<html>/<body>`** ⇒ **崩潰頁吃不到這顆 link**。
             (repo 內今天無自訂 `global-error.tsx` ⇒ 不修, 而寫下來。)

          ⚠️ **未確認(不要讀得比它大)**:「Vercel 預設映像沒有 CJK 字型」是**讀來的**,
             沒有人在正式站上量過;「Windows 員工現在看到別的字型」是由列印頁測試的
             射程宣告**推出**的。⇒ 兩格都要在真的量得到的時候補。 */}
      <head>
        <link rel='preconnect' href='https://fonts.googleapis.com' />
        <link rel='preconnect' href='https://fonts.gstatic.com' crossOrigin='anonymous' />
        <link
          rel='stylesheet'
          href='https://fonts.googleapis.com/css2?family=Antonio:ital,wght@0,500;0,700;1,500;1,700&family=Inter:wght@400;500;600;700&family=Noto+Sans+TC:wght@400;500;600;700&family=Noto+Serif+TC:ital,wght@0,400;0,500;1,400&family=Cormorant+Garamond:ital,wght@0,500;1,400;1,500&family=JetBrains+Mono:wght@400;500&display=swap'
        />
      </head>
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
            <AppSidebar auditEnabled={isAuditUiEnabled()} counts={sidebarCounts} />
            {/* 🔴🔴 `min-w-0` 不是排版微調,它是「訂單面板被往右推」那個 bug 的修法本體
                (2026-08-21 Sean 在正式站肉眼抓到;診斷全文 `~/pcm-mailbox/A-bc-004-*.md`)。
                `SidebarInset` 是 flex item 且帶 `w-full flex-1`,而 flex item 預設
                `min-width: auto` ⇒ **撐不下時它不縮,整條 row 連同訂單面板一起被推出視窗右緣**,
                推出去的量**恰好等於左側欄軌道寬**(實測:軌道 84 ⇒ 溢出 84;124 ⇒ 124;1 ⇒ 1)。
                🔴 **面板【有】自己的橫向捲軸,救不了它** —— 溢出不在面板裡面,
                   是面板這個盒子本身被放到螢幕外面。**盒子在螢幕外,盒子裡的捲軸沒有意義。**
                🔴 **負對照**:同樣給 `.workspace-row` 加 `min-width:0` **完全沒效**
                   (溢出仍 84)⇒ 病灶確定在這一層,不是在下面那層。
                ⚠️ **改在這裡而不是 `components/ui/sidebar.tsx`**:那支是 vendored shadcn,
                   改它下次同步上游會被蓋掉;而 `<SidebarInset>` 全 repo 只有這一個使用點。
                ⚠️ 發作條件:視窗越窄越嚴重(實測 1024 ⇒ 溢出 84 · 1100 ⇒ 28 ·
                   1200/1280/1440 ⇒ 0)。⇒ **寬螢幕看不到它,不代表它不在。** */}
            {/* B5-b′ 片二:靜默續期。**不渲染任何東西**,只在票快到期時去換一張新的。
                🔴 掛在這裡而**不是改 `WorkspaceShell` 內部**:改既有共用元件 = 改所有頁面的行為;
                   掛一個新節點 = 影響面只有那個節點自己。
                🔴 而它與 TTL 縮短(12h ⇒ 15 分鐘)**必須一起出** —— 只縮短不續期
                   ⇒ 每人每天被打斷約 32 次(`8h ÷ 15min`)= 做一半。 */}
            <SessionRenew />
            <SidebarInset className='min-w-0'>
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
