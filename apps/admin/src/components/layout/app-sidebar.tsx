'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icons } from '@/components/icons';
import { useSidebar } from '@/components/ui/sidebar';
import { buildNavItems, PARKED_NAV_ITEM, type NavItem } from './nav-items';

// 精簡自 Kiranism starter(見 src/FORK-PROVENANCE.md):砍 Clerk / nav-config 動態導覽 / user dropdown。
//
// 🔴 `#27` D1c-1:導覽清單本體已搬到 `nav-items.ts`(**零 runtime 依賴**),理由與代價寫在該檔檔頭
//    —— 一句話:旗標控制的「有沒有被濾掉」在本檔測不到(`@/` alias 進不了 jsdom),搬出去才測得到。
//
// ── 🔴🔴 旗標為什麼由 `app/layout.tsx` 算好傳進來,而不是本檔自己呼叫 `isAuditUiEnabled()` ──────
//   **本檔是 `'use client'`,而 `AUDIT_UI_ENABLED` 不是 `NEXT_PUBLIC_*`。**
//   ⇒ 在這裡呼叫旗標函式會拿到 `undefined`,**不會報錯、不會紅,只會靜默把入口關掉** ——
//     症狀是「功能做完了但員工看不到」,而三綠全綠。
//   📎 **實測(2026-08-15,本片實作第一步;丟棄式探針,已還原、shasum 對回 baseline)**
//     量法:在本檔(client component)暫時放一行 `process.env.AUDIT_UI_ENABLED`,跑 `next build`,
//     然後比對 client 與 server 兩邊產物裡**同一行**被編成什麼:
//       · client(`.next/static/chunks/…`):`…,d=t.default.env.AUDIT_UI_ENABLED;…`
//       · server(`.next/server/…`)      :`…,k=process.env.AUDIT_UI_ENABLED;…`
//     ⇒ **client 那側沒有被換成值,而是改讀一個被 bundler 換掉的 `process` 模組**
//       (`t.default`,不是 Node 的 `process`)⇒ **瀏覽器端拿不到這個變數。**
//     🔴 **誠實邊界**:我量的是**編出來的 code**,不是**瀏覽器裡跑出來的值** ——
//       我沒有在真瀏覽器觀察到 `undefined`。已證的是「**bundler 沒有把值內聯進去**」,
//       那已足以否決「在這裡直接呼叫旗標函式」的寫法,但別把它引用成「已驗證恆為 undefined」。
//     ⚠️ **測得到的那一半有守門,測不到的那一半才靠這段註解**(E 窗 R1 must-fix 更正我的原句):
//       · **測不到**:「bundler 把 env 編成什麼」——vitest 跑在 Node、`process.env` 是通的,
//         要複現得真跑 `next build` ⇒ **這半只有上面那段實測紀錄,別刪。**
//       · **✅ 測得到,而且已經守了**:「**有沒有人在 client component 寫下那條 import**」——
//         那是**倉庫裡的一行字**,不是瀏覽器行為 ⇒ 守門在 `lib/audit/audit-ui-flag.test.ts` 檔尾。
//       🔴 **我原本把這兩件併成一件,然後宣稱「寫不成測試」** —— 錯的那半讓一道 10 行的守門
//         差點沒被寫出來(該檔已有 **21 支**測試用同一種手法)。**別再用「難測」把可測的那半一起放掉。**
//   ✅ 形狀**照抄** repo 既有前例:`components/orders/order-detail-route.tsx:250`
//     逐字 `refundEnabled={isRefundUiEnabled()}`(server 元件算完、當 prop 交給 client 元件)。

/** 目前路徑是否命中此 nav('/' 精確;其餘含子路徑)。 */
function isNavActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * 數字規則 —— **逐字搬定案稿 `admin-sidebar-rail-final.html:414`**:
 * ```js
 * const show = v => (v > 99 ? '99+' : (v > 0 ? String(v) : ''));
 * ```
 * 🔴 `0` 回空字串**不是省略,是規格**(稿 `:287` 逐字:「0 不是資訊,只有非 0 才是」)。
 */
export function formatNavCount(value: number): string {
  if (value > 99) return '99+';
  return value > 0 ? String(value) : '';
}

/**
 * 84px 圖示軌 —— **定案稿 `admin-sidebar-rail-final.html`(Aug-19 11:20,`<title>` 逐字「定案:圖示軌 + 狀態驅動」)**。
 * 過程稿 `admin-sidebar-four-directions.html` **不是權威**,只用來理解為什麼選這個。
 *
 * ── 🔴 為什麼不再用 shadcn 的 `<Sidebar>`(而 `ui/sidebar.tsx` 一個字沒動)──────────
 * 稿要的三件(84px 固定軌 / hover ⇒ 236px **覆蓋不推開** / 軌底常駐同步時間)**全部是 CSS**,
 * 沒有一項需要 shadcn 的 context 或 state ⇒ 本檔只是它的**消費者**,不是它的一部分。
 * **量到的**(2026-08-20,真 Chromium,獨立 28 行 HTML 模擬 `SidebarProvider` 的 `flex min-h-svh w-full`):
 * ```
 * railW 84 / flyoutW 236 / z-index 30
 * mainLeft   展開前 84、展開後 84   ⇒ 內容沒有被推開
 * col1Left   展開前 109、展開後 109 ⇒ 表格欄寬不動（稿 :298 的要求）
 * railIsHovered true（真 :hover，不是 JS 切狀態）；未 hover 時 flyout 不可見（雙向）
 * ```
 * ⚠️ **射程**:那是**模擬外殼**,不是真的 `SidebarProvider`。真殼裡的驗證見本片 commit body。
 *
 * ── 🔴🔴 `SidebarTrigger` 這一格會【靜默壞掉】,所以它在這裡被處理 ────────────────
 * 不再渲染 `<Sidebar>` ⇒ header 那顆 `SidebarTrigger` 會變成**按了沒反應的按鈕**,
 * 而**不會有任何測試紅**(它住在 `layout/header.tsx`,不在本檔)。
 * ⇒ 本元件讀 `useSidebar()` 的 `state`,`collapsed` 時**整條軌不渲染** ——
 *   這樣 **Sean `#380`(2026-08-10 正式站肉眼驗,逐字要「整條滑走」不要「收成窄圖示列」)仍然成立**。
 * 📌 **稿沒有講那顆鈕,而沒講不等於取消**:稿講的是**預設狀態**,`#380` 講的是**按下去之後**。
 *   兩者是不同狀態 ⇒ 都成立。
 * ⚠️ `useSidebar` **只 import,不改 `ui/sidebar.tsx`** ⇒ 鐵則 12⑥ 不觸發。
 */
export function AppSidebar({ auditEnabled }: { auditEnabled: boolean }) {
  const pathname = usePathname();
  const { state } = useSidebar();
  const navItems = buildNavItems(auditEnabled);

  // #380:整條滑走。`collapsed` 時連 DOM 都不留 —— 半透明或 `w-0` 都還是「收成一條」。
  if (state === 'collapsed') return null;

  return (
    <aside
      data-testid='nav-rail'
      aria-label='主導覽'
      className='group bg-sidebar relative w-[84px] shrink-0 border-r'
    >
      <div className='flex h-full flex-col'>
        <div className='flex flex-col items-center gap-1 px-1 py-3'>
          <Icons.logo className='size-5' />
          {/* M 三色條:全系統唯一的裝飾元素(OD `overview-desktop-bmw-m.html:83-88`)。 */}
          <div aria-hidden className='m-stripe mt-2 h-1 w-full' />
        </div>
        <nav className='flex-1 overflow-y-auto'>
          {navItems.map((item) => (
            <RailCell key={item.key} item={item} pathname={pathname} />
          ))}
        </nav>
        {/*
          🔴 軌底常駐同步時間 —— **它是量具,不是裝飾**(稿 `:288` 逐字):
          「留白會跟『資料還沒載入』長得一樣,所以軌底部常駐一行同步時間。
            看到時間戳,留白就等於『真的沒事』,不是『還沒算完』。」
          ⚠️ **而現在數字還沒接** ⇒ 這裡**不能印一個時間**(那會讓留白變成一句謊話)。
             印「未接」是稿留給我們的那個解的**誠實版本**:留白現在**不代表沒事**。
             接上真資料是另一片(count 查得到查不到由別人盤)。
        */}
        <div className='text-muted-foreground border-t px-1 py-2 text-center text-[10px]'>
          同步
          <br />
          未接
        </div>
      </div>
      {/*
        hover ⇒ 236px 清單**滑出覆蓋內容區,不推開**(稿 `:298`/`:164`)。
        🔴 `.flyout` 是軌的**子代** ⇒ 滑到清單上仍算 hover 著軌 ⇒ 不會閃爍關掉(量過)。
      */}
      <div className='bg-sidebar invisible absolute inset-y-0 left-0 z-30 w-[236px] border-r group-hover:visible'>
        <div className='flex h-full flex-col'>
          <div className='flex items-center gap-2 px-4 py-3'>
            <Icons.logo className='size-5 shrink-0' />
            <span className='text-sm font-semibold'>PCM 後台</span>
          </div>
          <nav className='flex-1 overflow-y-auto px-2'>
            {navItems.map((item) => (
              <FlyoutRow key={item.key} item={item} pathname={pathname} />
            ))}
          </nav>
          {/* 「設定」**只在這裡**、灰字＋未啟用(稿 `:357` 逐字「不在軌上出現」)。 */}
          <div className='border-t px-2 py-2'>
            <FlyoutRow item={PARKED_NAV_ITEM} pathname={pathname} />
          </div>
        </div>
      </div>
    </aside>
  );
}

/** 軌上一格:上排圖示＋數字、下排完整中文(稿 `:283` 標題逐字「84px 的軌,同時放得下…」)。 */
function RailCell({ item, pathname }: { item: NavItem; pathname: string }) {
  const ItemIcon = Icons[item.icon];
  const active = item.href !== undefined && isNavActive(pathname, item.href);
  const inner = (
    <>
      <span className='flex items-center justify-center gap-1'>
        <ItemIcon className='size-5' />
        {/* 數字位固定 22px、靠右(稿 `:143`)⇒ 兩位數不擠壓中文,中文永遠置中在自己那一行。 */}
        <span aria-hidden className='min-w-[22px] text-right text-xs font-bold' />
      </span>
      <span className='mt-1 block text-center text-[11px] leading-tight'>{item.label}</span>
    </>
  );
  const cls = `block w-full border-l-2 px-1 py-2 ${
    active ? 'border-l-primary text-primary bg-sidebar-accent' : 'border-transparent'
  }`;
  return item.href === undefined ? (
    <span className={cls} aria-disabled>
      {inner}
    </span>
  ) : (
    <Link href={item.href} className={cls} aria-current={active ? 'page' : undefined}>
      {inner}
    </Link>
  );
}

/** 滑出清單裡的一列:圖示＋完整中文;無 href = 未啟用。 */
function FlyoutRow({ item, pathname }: { item: NavItem; pathname: string }) {
  const ItemIcon = Icons[item.icon];
  const active = item.href !== undefined && isNavActive(pathname, item.href);
  if (item.href === undefined) {
    return (
      <span
        aria-disabled
        className='text-muted-foreground flex items-center gap-2 rounded-md px-2 py-2 text-sm'
      >
        <ItemIcon className='size-4 shrink-0' />
        <span>{item.label}</span>
        <span className='ml-auto text-[10px]'>未啟用</span>
      </span>
    );
  }
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2 rounded-md px-2 py-2 text-sm ${
        active ? 'text-primary bg-sidebar-accent' : ''
      }`}
    >
      <ItemIcon className='size-4 shrink-0' />
      <span>{item.label}</span>
    </Link>
  );
}
