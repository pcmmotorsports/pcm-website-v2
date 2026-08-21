'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icons } from '@/components/icons';
import { useSidebar } from '@/components/ui/sidebar';
import type { SidebarCounts } from '@/lib/layout/sidebar-counts';
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
 *
 * ✅ **W1-077(2026-08-20)接線**:呼叫端是本檔的 `railCountText()`。
 *   曾經有一段時間本函式零呼叫端(見 commit 歷史),那個「有測試≠有人用」的提醒仍然有效
 *   (同族:memory `feedback_apply-is-owned-wiring-is-not`),但已經不適用本函式本身 ——
 *   當場數呼叫端:`git grep -n 'formatNavCount' -- apps packages ':!*.test.*'`。
 */
export function formatNavCount(value: number): string {
  if (value > 99) return '99+';
  return value > 0 ? String(value) : '';
}

/**
 * 軌上一格要顯示的數字文字。W1-077:三格接上真數字之後 `formatNavCount` 有了第一個呼叫端。
 *
 * 🔴 `truncated=true` 時**強制 `'99+'`**、不看 `count` 本身多少 —— `count` 是兩支各自
 * 上限(200/50)相加後的 `rows.length`,截斷時可能落在 1-99 這個「看起來精確」的區間
 * (`refund-read.ts` §M3:actionable=5、stuck=51 ⇒ 顯示會是「55」,而真相 ≥56)。
 * `null` = 讀取失敗,同樣顯示空白(與「0」在畫面上刻意長得一樣,差別在軌底同步行,見 `AppSidebar`)。
 */
function railCountText(count: number | null, truncated: boolean): string {
  if (count === null) return '';
  if (truncated) return '99+';
  return formatNavCount(count);
}

/** 台北曆面 HH:MM(軌底同步行用)。`syncedAt` 由 server 端算好的 ISO 字串,client 端只負責格式化。 */
function formatSyncedAtTaipei(iso: string): string {
  return new Intl.DateTimeFormat('zh-Hant-TW', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Taipei',
  }).format(new Date(iso));
}

/**
 * nav item key → 這一格要顯示哪個 count(哪三格由 Sean 拍板 Q14 決定,見 `sidebar-counts.ts` 檔頭)。
 * 其餘 key(總覽/客戶/員工管理/供應商/操作紀錄)落 default 分支、回 `{ count: null }` ⇒ 空白。
 * ⚠️ **「設定」不會經過這支函式**:它不在 `nav-items.ts` 的 `buildNavItems()` 清單裡,
 * 而是在 `AppSidebar` 的 `navItems.map()` 迴圈之外、用單獨的 `<RailCell item={PARKED_NAV_ITEM} … />`
 * 呼叫渲染(沒有傳 `count`/`truncated`,靠 props 預設值 `null`/`false` 產生空白)。
 * 想改「設定」的顯示邏輯要去改那一行呼叫,不是這支函式。
 */
/**
 * 每一格那顆數字**在數什麼** —— 顯示在中文標籤下面那一列。
 *
 * 🔴 **為什麼需要它**(2026-08-22,`-86` 扮員工走一天時撞到):
 * 側欄寫「訂單 **23**」,點進去清單寫「共 **16** 筆」,而**畫面上沒有任何字說它們各自在數什麼**。
 * 那 10 筆沒有不見(勾「顯示刷卡未付款」⇒ 兩邊都 23,他量了兩次)——
 * **23 數的是 `unorderedOrderCount`(未訂貨),16 是清單當下篩選的結果。**
 * **兩個數字合法地在數不同的東西,而員工沒有辦法知道。**
 *
 * ⚠️ **所以修法不是「讓兩個數字一樣」** —— 那會把「還有幾張沒跟供應商下單」這個資訊消滅掉。
 *    修的是**那顆數字沒有名字**這件事。
 *
 * 🔴 **綁 `item.key` 不綁中文標籤**:標籤是文案、會被改;key 是識別字。
 *    用標籤當 key 的話,哪天有人把「訂單」改成「訂單管理」,這一列會**安靜地消失**(查表落空)。
 */
const COUNT_QUALIFIER: Partial<Record<NavItem['key'], string>> = {
  orders: '未訂貨',
  'refund-exceptions': '待處理',
  products: '缺貨',
};

function countForItem(
  item: NavItem,
  counts: SidebarCounts,
): { count: number | null; truncated: boolean } {
  switch (item.key) {
    case 'orders':
      return { count: counts.unorderedOrderCount, truncated: false };
    case 'refund-exceptions':
      return { count: counts.refundExceptionCount, truncated: counts.refundExceptionTruncated };
    case 'products':
      return { count: counts.outOfStockProductCount, truncated: false };
    default:
      return { count: null, truncated: false };
  }
}

/**
 * 84px 圖示軌 —— **定案稿 `admin-sidebar-rail-final.html`(Aug-19 11:20,`<title>` 逐字「定案:圖示軌 + 狀態驅動」)**。
 * 過程稿 `admin-sidebar-four-directions.html` **不是權威**,只用來理解為什麼選這個。
 *
 * ── 🔴 為什麼不再用 shadcn 的 `<Sidebar>`(而 `ui/sidebar.tsx` 一個字沒動)──────────
 * 稿要的兩件(84px 固定軌 / 軌底常駐同步時間)**全部是 CSS**,
 * 沒有一項需要 shadcn 的 context 或 state ⇒ 本檔只是它的**消費者**,不是它的一部分。
 * 🔴 ~~原本是「三件」,第三件是 hover ⇒ 236px 覆蓋不推開~~ ——
 *    **2026-08-20 Sean 拿掉了那個互動**(見下方那塊註解)。**論證不受影響**:
 *    剩下兩件仍然全是 CSS ⇒ 「不需要 shadcn」這個結論照樣成立。
 *    📌 而**這一行是我改完 flyout 之後回頭 grep `236px` 才發現的** ——
 *    同一支檔、相隔 60 行、對「稿要幾件」講不同的話。
 *    那正是 `docs/patterns/guard-and-instrument-traps.md`「情況 A」的**作者側**動作:
 *    **改完一句話之後,拿它的關鍵詞在【同一支檔】再 grep 一次。**
 * **量到的**(2026-08-20,真 Chromium,獨立 28 行 HTML 模擬 `SidebarProvider` 的 `flex min-h-svh w-full`):
 * ```
 * railW 84（← 這一格仍然是現況）
 * 🪦 flyoutW 236 / z-index 30 / mainLeft 展開前後皆 84 / col1Left 109 不變 / railIsHovered true
 *    —— 這幾格量的是【已經拿掉的那塊】，保留為「它當時真的做到了」的紀錄
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
export function AppSidebar({
  auditEnabled,
  counts,
}: {
  auditEnabled: boolean;
  counts: SidebarCounts;
}) {
  const pathname = usePathname();
  const { state } = useSidebar();
  const navItems = buildNavItems(auditEnabled);

  // #380:整條滑走。`collapsed` 時連 DOM 都不留 —— 半透明或 `w-0` 都還是「收成一條」。
  if (state === 'collapsed') return null;

  return (
    <aside
      data-testid='nav-rail'
      aria-label='主導覽'
      /*
        🔴🔴 **`print:hidden` —— 而它是我這一片弄丟的,2026-08-20 補回。**
        原本它掛在 shdcn 的 `ui/sidebar.tsx:249`;而本檔 `:72` 那段就寫著
        「**為什麼不再用 shadcn 的 `<Sidebar>`(而 `ui/sidebar.tsx` 一個字沒動)**」
        ⇒ **元件被換掉,規則留在被淘汰的那一支** ⇒ 列印出貨單時紙上會多一整條 84px 的欄。
        🔴 **而守門是恆綠的**:`print/orders/[id]/picking/page.test.tsx` 原本釘的是
           「`ui/sidebar.tsx` 這支檔裡有那個字面」—— 那支檔還在、字面還在、**而它已經不在渲染樹上**
           ⇒ 元件被換掉它不紅,紙上多一條黑邊它也不紅。**同一片已把那格改成跟著渲染樹走。**
        📌 而那支測試 `:372` 的註解逐字寫著它在防什麼:
           「刪掉之後三綠全綠、畫面完全看不出來,紙上卻多一整條 144px 空白欄」
           ⇒ **它防的正是這件事,而它沒防到 —— 因為它釘的是【檔案】不是【渲染的那一支】。**
      */
      className='group bg-sidebar relative w-[84px] shrink-0 border-r print:hidden'
    >
      <div className='flex h-full flex-col'>
        <div className='flex flex-col items-center gap-1 px-1 py-3'>
          <Icons.logo className='size-5' />
          {/* M 三色條:全系統唯一的裝飾元素(OD `overview-desktop-bmw-m.html:83-88`)。 */}
          <div aria-hidden className='m-stripe mt-2 h-1 w-full' />
        </div>
        <nav className='flex-1 overflow-y-auto'>
          {navItems.map((item) => {
            const { count, truncated } = countForItem(item, counts);
            return (
              <RailCell key={item.key} item={item} pathname={pathname} count={count} truncated={truncated} />
            );
          })}
          {/*
            🔴 **「設定」排在軌上最下面、灰字、點不動 —— Sean 2026-08-20 拍板(甲)。**
            ⚠️ **這是【第二次推翻同一份定案稿】**:稿 `:357` 逐字
               「『設定』**不在軌上出現** —— 它連預設狀態都沒有,只在滑出清單底部…存在」
               ⇒ **作廢**。而它是第一處推翻的**連帶**:設定原本住在滑出清單裡,
                  清單被拿掉之後它必須換地方,而他選了軌上。
            📌 寫在這裡的理由與上一處相同:**下一個開那份稿的人會照著做回來,而稿不會自己知道它被推翻了。**
            ⚠️ 而**我與主視窗都推薦乙(先整個拿掉),他選了甲** —— 照拍板做,不打折。
          */}
          <RailCell item={PARKED_NAV_ITEM} pathname={pathname} disabled />
        </nav>
        {/*
          🔴 軌底常駐同步時間 —— **它是量具,不是裝飾**(稿 `:288` 逐字):
          「留白會跟『資料還沒載入』長得一樣,所以軌底部常駐一行同步時間。
            看到時間戳,留白就等於『真的沒事』,不是『還沒算完』。」
          W1-077 接上真數字:三格全部成功 ⇒ 顯示「同步 HH:MM」(台北時間);
          任一格讀取失敗(`sidebar-counts.ts` 的 `syncedAt` 為 `null`)⇒ 顯示「讀取失敗」,
          **不印時間戳**——印一個時間會讓留白變成一句謊話(員工會讀成「這幾格今天沒事」)。
        */}
        {/* 🔴 A2(2026-08-21 Sean 拍板乙=最小13px):10px → 13px,見 STATUS Q26 決策。 */}
        <div className='text-muted-foreground border-t px-1 py-2 text-center text-[13px]'>
          {counts.syncedAt ? (
            <>
              同步
              <br />
              {formatSyncedAtTaipei(counts.syncedAt)}
            </>
          ) : (
            '讀取失敗'
          )}
        </div>
      </div>
      {/*
        🔴🔴 **這裡原本有一塊 236px 的滑出清單(hover ⇒ 覆蓋內容區),2026-08-20 拿掉。**
        **Sean 看過線上版後逐字**:「滑鼠移過去 ⇒ 清單蓋在畫面上面…**這個我忘記跟你說,
        就維持小的窄窄的就好,不用做這個蓋在畫面上的方式。但是功能成功沒錯**。」
        ⇒ 他確認**實作是對的**,要拿掉的是**那個互動本身**。
        🔴 **定案稿 `admin-sidebar-rail-final.html:164` 的 `.sheet`(236px / z-index:3)自此作廢** ——
           寫在這裡是因為**下一個開那份稿的人會照著做回來**,而稿不會知道自己被推翻了。
        ⚠️ **而拿掉它導航一格都沒少**:軌上本來就有完整中文(`RailCell` 那一行 `{item.label}`),
           那正是稿 `:283` 的 `<h1>` 逐字主張:「84px 的軌,同時放得下圖示、完整中文、待辦數字」。
           📌 而「窄軌 = 只有圖示」是一般人對窄側欄的既有印象,**它強到讓讀過反例的人仍然套上去**
           (2026-08-20 主視窗與我各犯一次)⇒ 留這句給下一個想「補 tooltip」的人。
        ✅ **而「設定」那一格已經有去處了**:Sean 同日拍板**甲 = 軌上最下面、灰字、點不動**
           (~~原本這裡寫「暫時不在任何地方,等 Sean 答」~~ —— 他答了,見上方 `<RailCell … disabled />` 那段)。
           📌 **這一行是我加完設定那格之後,回頭在同一支檔 grep「設定」才發現的** ——
              **同檔矛盾,而這是兩片之內的第二次**(上一次是「稿要的三件」)。
      */}
    </aside>
  );
}

/** 軌上一格:上排圖示＋數字、下排完整中文(稿 `:283` 標題逐字「84px 的軌,同時放得下…」)。 */
function RailCell({
  item,
  pathname,
  disabled = false,
  count = null,
  truncated = false,
}: {
  item: NavItem;
  pathname: string;
  /** 灰字、點不動(目前唯一用途 = 「設定」,它沒有頁面可去)。 */
  disabled?: boolean;
  /** 這一格要顯示的數字;`null` = 這一項不放數字(五格)或讀取失敗。 */
  count?: number | null;
  /** `count` 是否被上游截斷(目前只有退款異常那格會是 true)。 */
  truncated?: boolean;
}) {
  const ItemIcon = Icons[item.icon];
  const active = item.href !== undefined && isNavActive(pathname, item.href);
  const qualifier = COUNT_QUALIFIER[item.key];
  const inner = (
    <>
      <span className='flex items-center justify-center gap-1'>
        <ItemIcon className='size-5' />
        {/*
          數字位固定 22px、靠右(稿 `:143` `min-width: 22px; text-align: right`)。
          🔴 **這個空 `<span>` 是承重的,不是垃圾** —— 稿 `:384` 逐字:
          「數字位固定 22px 寬、等寬數字,1 到 99 都塞得下且不推擠中文」
          ⇒ 拿掉它,**有數字的那幾格與沒數字的那幾格,中文會對不齊**。
          ⚠️ 五格(總覽/客戶/員工管理/供應商/設定)仍然是空的 ——
          前四項落 `countForItem` 的 default 分支;「設定」不經過那支函式,見它自己的
          `<RailCell … />` 呼叫。⇒ 那五格看起來最像可以順手刪掉的東西。守門在 `app-sidebar-rail.test.tsx`。
        */}
        <span aria-hidden data-testid='rail-count-slot' className='min-w-[22px] text-right text-xs font-bold'>
          {railCountText(count, truncated)}
        </span>
      </span>
      {/* 🔴 A2(2026-08-21 Sean 拍板乙=最小13px):11px → 13px。 */}
      <span className='mt-1 block text-center text-[13px] leading-tight'>{item.label}</span>
      {/*
        🔴 那顆數字在數什麼(2026-08-22)。**只在真的有數字時才出現** ——
        沒有數字的五格不長高,九格不會為了三格一起變胖。
        ⚠️ **數字本身刻意留在上面那個 22px 槽裡沒有搬下來**:
           `app-sidebar-rail.test.tsx:211-214` 逐字釘住 `ordersSlot?.textContent` 的值,
           把數字搬走會讓那四條斷言紅 —— 而**改測試期望值不屬於本片可以拍的板**。
           ⇒ 本列是**純新增**,不動任何既有被釘住的行為。
        📐 寬度實量(13px、軌內可用 73px):未訂貨 39 / 待處理 50.3 / 缺貨 35.5 ⇒ 三個都不會被切。
           (同列塞不下 —— icon 20 + gap 4 + 數字槽 22 = 46,同列只剩 29px,連 10px 字都差 1px。
            而 Sean 2026-08-21 拍板最小字 13px ⇒ 縮字那條路本來就不能走。)
      */}
      {qualifier !== undefined && count !== null && (
        <span className='text-muted-foreground block text-center text-[13px] leading-tight'>
          {qualifier}
        </span>
      )}
      {/*
        🔴 **讀螢幕的人原本聽不到那顆數字**(2026-08-22 `-86` 查到):
        數字那個 `<span>` 是 `aria-hidden`、沒有 `title`、旁邊也沒有旁白文字
        ⇒ **那顆數字對輔助工具而言不存在**。
        ⚠️ **不是把 `aria-hidden` 拿掉就好** —— 拿掉的話輔助工具會唸出一個裸數字「23」,
           它接在「訂單」後面唸出來是「訂單 23」,**跟看得到的人遇到的是同一個問題**
           (23 在數什麼?)。
        ⇒ 補一句**完整的話**,而視覺那兩塊維持 `aria-hidden`(它們是同一份資訊的視覺版)。
           `railCountText` 會把 >99 變成 `99+`,這裡用同一支 ⇒ 唸出來與看到的一致。
      */}
      {qualifier !== undefined && count !== null && (
        <span className='sr-only'>
          {`${qualifier} ${railCountText(count, truncated)} 筆`}
        </span>
      )}
    </>
  );
  const cls = `block w-full border-l-2 px-1 py-2 ${
    active ? 'border-l-primary text-primary bg-sidebar-accent' : 'border-transparent'
  }${disabled ? ' text-muted-foreground' : ''}`;
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

