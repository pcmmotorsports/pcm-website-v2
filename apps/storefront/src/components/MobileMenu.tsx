// MobileMenu.tsx — 手機頁首左側「選單鈕 + 全屏面板」
//
// 為什麼有這支(OD `pcm-home-redesign/DESIGN-HANDOFF-2026-08-05.md` §十一,Sean:
// 「手機版本沒有地方可以看品牌、預約車行、合作店家」):
//   Header.tsx 的 isMobile 分支原本只 render 搜尋鈕 / logo / 購物車鈕,整組 .pcm-nav
//   根本不輸出;MobileTabBar 五格是首頁/商品/找車/會員/購物車。品牌、新品、特價、
//   安裝預約、合作店家這五條在手機上只剩頁尾能到,要一路捲到最底;品牌總覽與品牌頁
//   連 TabBar 都沒有。本元件補這個真站既有缺口。
//
// 🔴 連結來源 = Header.tsx 既有的 `navItems`(props 傳入,不在本檔重寫第二份)。
//   OD 原型 `pcm-shell.js` 是用 DOM 掃描 `.pcm-nav` 生成面板——那是**原型的機制**
//   (它是純靜態 HTML,沒有 React 狀態可用);真站用同一份常數 + React state,
//   單一來源的**意圖**一樣、實作方式不同,不照搬 vanilla JS。
//
// 分區(OD §十一 表格逐字):
//   選購 = navItems 扣掉 install/stores 的其餘 5 條;服務 = install/stores 2 條;
//   帳戶 3 條不在 navItems(會員中心/購物車/配送&退貨,各自對應既有路由
//   /account、/cart、/info/shipping——後者已是 HomeFooter.tsx 現行連結)。
//   底部 LINE 鈕與門市資訊讀 `lib/site-config.ts`(既有 SSoT,HomeFooter 同源)。
//
// TabBar 五格維持不動(OD 🔴 已定案):這是補充,不是取代。
//
// 視覺(尺寸/色/間距/動畫)逐字照 OD `pcm-menu.css`(已原樣複製進
// `styles/pcm-menu.css`、由 `app/layout.tsx` 全域載入)。該檔用 `var(--c-red-dark)`
// 標特價、不是 `--c-ember-ink`——全站真 token(`tokens.css:81`)本來就對得上,無需替換。

'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { OPENING_HOURS, SOCIAL_URLS, STORE_ADDRESS } from '@/lib/site-config';

// 🔴 R1 修復(2026-08-07,真瀏覽器 390px 實測抓到):
//
// MF1 — 面板必須 portal 到 `document.body`,不能留在 `.pcm-header-left` 裡面。
//   `header.css` 的 `.pcm-header { backdrop-filter: blur(12px) }` 讓 `.pcm-header` 成為
//   `position:fixed` 後代的 containing block ⇒ 面板的 `inset:0` 量到 header 的 padding box、
//   不是 viewport(實測面板矩形被裁成 390×68,十條連結全部看不見)。OD 原型不中這招,
//   因為 `pcm-shell.js` 本來就是生到 `<body>` 底下;本實作原本 render 在 header 內部才踩到。
//   漢堡鈕留在 header(它本來就該在那),只有**面板**走 portal。
//
// MF2 — 掛載看 UA(`Header.tsx` 的 `ctxMobile`,SSR 一次決定、不隨 resize 變)、
//   隱藏看 viewport(`pcm-menu.css` 的 `@media (max-width:1079px) { .pcm-menu-btn }`)
//   ⇒ 平板 UA 在 800px 開了面板、拉寬到 1200px 之後,漢堡鈕被 CSS 藏起來但元件沒有
//   unmount,`is-open`/`body.pcm-menu-lock` 仍在 ⇒ 頁面被鎖捲又叫不出關閉鈕。
//   本檔自己再掛一個 `matchMedia('(min-width: 1080px)')` 監聽,命中就強制收起
//   ——斷點值取自 `pcm-menu.css` 的 `max-width: 1079px`(兩者互補、無縫隙無重疊)。

export type MobileMenuNavItem = {
  id: string;
  label: string;
  href: string;
  sale?: boolean;
};

// 服務類的兩個 id(對齊 OD `pcm-shell.js` 的 SERVICE 切法,改用 id 而非 href 比對
// ——href 是資料、id 是穩定鍵,避免 query string 之類的字面差異誤判)。
const SERVICE_IDS = new Set(['install', 'stores']);

// 帳戶三條不在 navItems(OD §十一 表格逐字);路由各自對應既有頁面
// /account(app/account/page.tsx)、/cart(app/cart/page.tsx)、
// /info/shipping(HomeFooter.tsx:93 現行連結)。
const ACCOUNT_ITEMS = [
  { label: '會員中心', href: '/account' },
  { label: '購物車', href: '/cart' },
  { label: '配送 & 退貨', href: '/info/shipping' },
] as const;

// 門市地址/營業時間組字:來源 = lib/site-config.ts(STORE_ADDRESS/OPENING_HOURS,
// Sean 2026-06-21 提供的 SSoT,HomeFooter.tsx 頁尾同一組資料的來源)。
const STORE_LINE_1 = `${STORE_ADDRESS.region}${STORE_ADDRESS.locality}${STORE_ADDRESS.street}`;
const STORE_LINE_2 = `週一-週六 ${OPENING_HOURS.opens}-${OPENING_HOURS.closes}`;

export function MobileMenu({ navItems }: { navItems: MobileMenuNavItem[] }) {
  const [open, setOpen] = useState(false);
  // MF1:SSR 沒有 `document`,面板要等 client mount 完才 portal;初值與 SSR 一致(不 render 面板)
  // ⇒ 不產生 hydration mismatch(button 那顆在兩端都一樣、差別只在 mount 後才出現的 portal 內容,
  //   那是 effect 驅動的後續更新、不是 hydrate 那一次比對)。
  const [mounted, setMounted] = useState(false);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  // 🔴 焦點交還用(OD §十一 把「焦點管理」列為選單行為之一;真瀏覽器實測抓到:
  //    原本按 Esc 收起後 `document.activeElement` 不是這顆鈕 ⇒ 鍵盤與讀屏使用者
  //    會掉回文件開頭、失去原本的位置。這是 a11y 基本盤,不是加分項。
  const openBtnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // nit①:點連結導覽時不搶焦點(新頁面自己接管焦點);只有 Esc / 關閉叉才把焦點交還開啟鈕。
  // ref 不是 state——在 click handler 裡同步寫入,effect cleanup 讀到的一定是這次的值。
  const skipFocusRestoreRef = useRef(false);
  const panelId = useId(); // nit③:開啟鈕 aria-controls 指向面板要有穩定 id

  const shopItems = navItems.filter((item) => !SERVICE_IDS.has(item.id));
  const serviceItems = navItems.filter((item) => SERVICE_IDS.has(item.id));

  useEffect(() => {
    setMounted(true);
  }, []);

  // MF2:掛載看 UA(Header 的 ctxMobile,SSR 一次決定、resize 不變)、隱藏看 viewport
  // (pcm-menu.css `@media (max-width:1079px)`)⇒ 平板 UA 拉寬會讓漢堡鈕被 CSS 藏起來、
  // 但元件沒 unmount,面板可能還開著又叫不出關閉鈕。這裡獨立於「開啟鎖捲」那個 effect,
  // 不論目前開或關都要掛著監聽——命中就強制收起。斷點與 CSS 同源(1079/1080 互補)。
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1080px)');
    const check = () => {
      if (mq.matches) setOpen(false);
    };
    check(); // 掛載當下就先查一次(使用者可能一開始就在 ≥1080px)
    mq.addEventListener('change', check);
    return () => mq.removeEventListener('change', check);
  }, []);

  // 背景鎖捲 + Esc 關閉 + focus trap(OD 驗收 #7/#8)。只在開啟時掛 listener,關閉時清掉。
  useEffect(() => {
    if (!open) return;
    // 🔴 在 effect 內先取節點、cleanup 用這個區域變數(react-hooks/exhaustive-deps 規則要求:
    //    cleanup 執行時 `ref.current` 可能已經換人)。這裡捕捉是安全的——那顆鈕在元件的
    //    生命週期內恆存在且不會被替換;而「元件已 unmount」那條仍由下面的 `isConnected` 擋住。
    const openBtn = openBtnRef.current;
    document.body.classList.add('pcm-menu-lock');
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
      // nit②:focus trap——面板沒有把背景 inert,Tab 會跳到面板後方的搜尋/logo/購物車鈕。
      // 只做「Tab 在面板內循環」,不加背景 inert(相容性未逐一驗證、範圍留給獨立片評估)。
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    closeBtnRef.current?.focus();
    return () => {
      document.body.classList.remove('pcm-menu-lock');
      document.removeEventListener('keydown', onKeyDown);
      // 收起後把焦點交還開啟鈕——但只限 Esc / 關閉叉這兩條路(nit①)。
      // 🔴 `isConnected` 是必要的閘:視窗拉寬到桌機時整棵 MobileMenu 會 unmount,
      //    那顆鈕已不在文件裡,此時搶焦點會把游標丟到 body、比不做還糟。
      if (!skipFocusRestoreRef.current && openBtn?.isConnected) openBtn.focus();
      skipFocusRestoreRef.current = false;
    };
  }, [open]);

  // 點面板內任何連結、或關閉鈕 → 收起(OD 驗收 #7)。用事件委派在面板容器上接一次,
  // 不必逐條連結各掛一個 onClick。連結路徑額外標記「跳過焦點交還」(nit①)。
  const handlePanelClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('a')) {
      skipFocusRestoreRef.current = true;
      setOpen(false);
      return;
    }
    if (target.closest('[data-menu-close]')) {
      setOpen(false);
    }
  };

  // MF1:面板本體抽成變數,交給 createPortal 掛到 document.body——不受 `.pcm-header` 的
  // backdrop-filter containing block 影響,`position:fixed; inset:0` 才會真的量到 viewport。
  const panel = (
    <div
      ref={panelRef}
      id={panelId}
      className={`pcm-menu-panel${open ? ' is-open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="網站選單"
      onClick={handlePanelClick}
    >
      <div className="pcm-menu-head">
        <Link href="/" aria-label="PCM MOTOR PARTS 首頁">
          {/* alt="" 刻意留空:上層 Link 已有 aria-label 當可及名稱,img 若再帶同一段 alt
              會讓報讀器唸兩次(Header.tsx 桌機/手機 logo 同款結構不重複、但那裡只有一顆 logo
              連結;本面板另開一顆同品牌 logo,兩者 alt 相同會讓 getByAltText 撞名)。 */}
          <img src="/pcm-compact-bicolor-on-light.png" width={1259} height={656} alt="" style={{ height: 30, width: 'auto' }} />
        </Link>
        <button ref={closeBtnRef} type="button" className="pcm-icon-btn" data-menu-close aria-label="關閉選單">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="pcm-menu-body">
        <div className="pcm-menu-group">
          <div className="pcm-menu-label">選購</div>
          {shopItems.map((item) => (
            <Link key={item.id} href={item.href} className={item.sale ? 'is-sale' : undefined}>
              {item.label}
            </Link>
          ))}
        </div>
        {serviceItems.length > 0 && (
          <div className="pcm-menu-group">
            <div className="pcm-menu-label">服務</div>
            {serviceItems.map((item) => (
              <Link key={item.id} href={item.href}>
                {item.label}
              </Link>
            ))}
          </div>
        )}
        <div className="pcm-menu-group">
          <div className="pcm-menu-label">帳戶</div>
          {ACCOUNT_ITEMS.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </div>
      </div>
      <div className="pcm-menu-foot">
        <a className="pcm-menu-line" href={SOCIAL_URLS.line} target="_blank" rel="noopener noreferrer">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.5 11.6a7.6 7.6 0 0 1-10.9 6.8L4.2 20l1.6-5.2a7.6 7.6 0 1 1 14.7-3.2z" />
          </svg>
          用 LINE 問技師
        </a>
        <p className="pcm-menu-store">
          {STORE_LINE_1}
          <br />
          {STORE_LINE_2}
        </p>
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={openBtnRef}
        type="button"
        className="pcm-icon-btn pcm-menu-btn"
        aria-label="開啟選單"
        aria-expanded={open}
        aria-controls={panelId}
        data-tip="選單"
        onClick={() => setOpen(true)}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17" />
        </svg>
      </button>
      {mounted ? createPortal(panel, document.body) : null}
    </>
  );
}
