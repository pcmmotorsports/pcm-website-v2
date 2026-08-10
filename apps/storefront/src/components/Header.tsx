// Header.tsx — Light theme, sticky, multi-variant, nav-aware
//
// 字面從 design-reference/components/Header.jsx @ 25d3a2a 直接搬:
// - jsx → tsx + props type 推斷
// - React.useState / useEffect → import { useState, useEffect }
// - window.Header UMD 註冊移除(改 ES export)
// - className 字面完全不動
//
// M-1-04 Header mini-slice:Header 維持 client(useState searchQuery/autoMobile + useEffect + dispatchEvent)、
// 9 a 標籤(2 logo + 7 navItems)改 <Link href>(對齊刀 1 全範圍 + Q-Header A3 拍板);
// M-1-04 刀 3-b:3 nav button(mobile cart / desktop cart / desktop account)舊 useCallback stub 整段移除 → handleNav 改寫 router.push(NAV_ROUTE_MAP)+ props.onNav fallback;
// mobile search(dispatchEvent)/ desktop search div / input(非 nav)字面不動;handleNav wrapper + MouseEvent type 保留(props.onNav fallback 維持)
//
// M-1-13e-b-2:cartCount prop 整段移除(Sean Q-13e-b-2-prop=A 拍板「單一資料源、不留 manual override」);
// Header badge 改讀 useCart().totalQty、totalQty=0 走既有 `cartCount > 0` 守門自動隱(SSR / hydrate 前
// totalQty=0、不顯 dot、hydrate 後 useEffect 從 localStorage 載入才浮出真實數字、無 mismatch)

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import type { MouseEvent } from 'react';
import { useCart } from '@/contexts/CartContext';
import { useServerMobile } from '@/contexts/MobileContext';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';
import { MobileMenu } from '@/components/MobileMenu';

// 🔶 R2-3(2026-08-05,第0批 0b):頁首 logo 由文字改品牌圖檔。
// 真權威 = OD `pcm-home-redesign/products-list-page.html:380` 逐字
// (`<a class="pcm-logo" href="/" aria-label="PCM MOTOR PARTS 首頁"><img src="assets/brand/pcm-compact-bicolor-on-light.png" alt="PCM MOTOR PARTS"></a>`)
// + `products-list-handoff.md:212`「頁首 logo = pcm-compact-bicolor-on-light.png 34px(原商品頁誤用 master 版)」。
// 🔴 w/h 寫**原生像素**(1259×656,`sips` 實量)不是顯示尺寸:瀏覽器只拿它算 aspect-ratio 佔位、
//    實際高度由 `header.css` `.pcm-logo img { height:34px; width:auto }` 決定。寫 65×34 也不會錯,
//    但原生值才是「這張圖真的長這樣」的事實,換圖時不會忘記同步。
// 走原生 <img> 不走 next/image:對齊 storefront 既有慣例(`BonamiciShowcase.tsx:10` 註解逐字)。
const HEADER_LOGO = { src: '/pcm-compact-bicolor-on-light.png', w: 1259, h: 656 } as const;

const NAV_ROUTE_MAP: Record<string, string> = {
  cart: '/cart',
  // 'account' 刻意不入此表:g-1b 起改「條件路由」(見 handleNav)— 已登入→/account、未登入→/login
  // (取代 f1-a 的 /login stopgap;#179 D-f 收尾)。真守門在 /account server 端 getUser()(g-1a)。
};

export type HeaderProps = {
  onMenuClick?: () => void;
  isMobile?: boolean;
  currentPage?: string;
  onNav?: (target: string, ctx?: object) => void;
};

export function Header({
  isMobile: isMobileProp,
  currentPage = 'products',
  onNav,
}: HeaderProps) {
  const router = useRouter();
  const { totalQty } = useCart();
  const [searchQuery] = useState('');

  const openSearch = (q: string = '') => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('pcm-open-search', { detail: { query: q } }));
  };

  const [autoMobile, setAutoMobile] = useState<boolean>(false);
  useEffect(() => {
    const check = () => {
      const dm = document.querySelector('[data-mobile="true"]');
      setAutoMobile(!!dm || window.innerWidth < 1080);
    };
    check();
    const mq = window.matchMedia('(max-width: 1079px)');
    mq.addEventListener('change', check);
    // Poll for tweaks change (data-mobile attr flips)
    const id = setInterval(check, 500);
    return () => { mq.removeEventListener('change', check); clearInterval(id); };
  }, []);
  // isMobile 決議:明確 prop(單元測試 / dev-preview)優先 → 否則 layout SSR UA(首屏正確、無閃爍)
  //   OR client viewport(桌機縮窗 <1080 響應)。修 iPhone 卡桌機 header:SSR 即用 server UA、不靠 client 切換。
  const ctxMobile = useServerMobile();
  const isMobile = isMobileProp ?? (ctxMobile || autoMobile);

  // Header 會員態(g-1b、純 cosmetic):決定會員圖示去向(已登入→/account、未登入→/login)。
  // 真守門在 /account server 端 getUser();此處查不到 / 出錯一律退化未登入(安全方向、server 擋)。
  // isAuthed 不進任何 render 輸出(僅 click 時 handleNav 讀)→ initial false 無 SSR hydration mismatch。
  const [isAuthed, setIsAuthed] = useState(false);
  useEffect(() => {
    let active = true;
    let subscription: { unsubscribe: () => void } | undefined;
    try {
      const supabase = createBrowserSupabaseClient();
      // onAuthStateChange 訂閱後即 emit INITIAL_SESSION(讀本地 session、不打網路)= 初始 auth-state,
      // 之後登入 / 登出即時更新;cleanup 必 unsubscribe(active 旗標防 unmount 後 setState)。
      subscription = supabase.auth.onAuthStateChange((_event, session) => {
        if (active) setIsAuthed(!!session?.user);
      }).data.subscription;
    } catch {
      // env / browser client 不可用(如測試環境)→ 維持未登入預設、不阻斷 Header render。
    }
    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);

  // 🔴 型別寫明,不靠字面推導(2026-08-11 #269-a):
  //    `sale?: boolean` 原本是**從「特價」那一列的 `sale: true` 推導出來的**,
  //    移除那一列之後 TS 就推不到它,`:192` 的 `item.sale` 與 `MobileMenu.tsx:199` 的
  //    `item.sale` 會直接編譯失敗。
  //    ⇒ 這個欄位是**契約的一部分**(特價回來時要用),不是某一列的副產品,所以寫進型別。
  const navItems: { id: string; label: string; href: string; sale?: boolean }[] = [
    { id: 'catalog', label: '商品目錄', href: '/products' },
    // 2026-08-03 Sean 拍 B 案「同落地 + 開燈」:首頁維持錨點(finder 就在同一頁、捲過去即可),
    // 其他頁改連 /products?pick=vehicle —— 落地即開燈(桌機聚焦廠牌欄、手機自動開選車面板)。
    // 與上一列「商品目錄」(/products 乾淨落地)以此區分:一個是逛、一個是開始選車。
    // 🔴 currentPage 預設為 'products'(見上方 props 解構),所以沒帶 currentPage 的掛載點
    //    一律走 ?pick=vehicle;只有 app/page.tsx 傳 currentPage="home"。
    {
      id: 'vehicle',
      label: '依車輛搜尋',
      href: currentPage === 'home' ? '/#vehicle-finder' : '/products?pick=vehicle',
    },
    // ✅ **D3c-5 改回 `/brands`**(這一顆的歷史:Q4-S5 當年指 `/products`,理由是
    //   「`/brands` route 不存在、客人按了吃 404」;那個前提在 D3c-3 落地時就消失了)。
    //   ⚠️ 這是**全站每一頁**的導覽目的地 ⇒ `Header.test.tsx` 的導覽對照表同片改、
    //      並實際點過(不只改字面)。
    { id: 'brands', label: '品牌', href: '/brands' },
    { id: 'new', label: '新品', href: '/products?filter=new' },
    // 🔴 「特價」那一顆 2026-08-11 移除(#269-a;Sean 逐字:**特價這個概念還不存在**,
    //    要等商品編輯後台能設優惠價才有)。它原本指 `/products?filter=sale`,而 `filter`
    //    這個 query key **全站零個地方在讀**(`lib/catalog-query.ts` 的 `parseCatalogQuery`
    //    只認 page/per/sort/pbrand/category/pmin/pmax/price/vehicle)
    //    ⇒ 客人按下去拿到的是**未篩選的全目錄**,而畫面上沒有任何跡象說它沒生效。
    //    這顆在**全站每一頁**都有,桌機導覽與手機選單共用本陣列(`MobileMenu` 收 props、不自己寫一份)。
    // ⚠️ **`sale?: boolean` 的樣式鉤子刻意留著**(本檔 `pcm-nav-item` 那個 className 模板裡的
    //    `pcm-nav-sale`、以及 `MobileMenu` 的 `is-sale`):特價是「還沒做」不是「不做」——
    //    後台能設優惠價時把上面那一行加回來即可,不必重接樣式。
    //    🔴 引符號不引行號:上一版這裡寫「本檔 `:184`」,而同一片的編輯把它推到 `:197` ⇒ 當場過期。
    //    守門 = `MobileMenu.test.tsx` 的「帶 sale:true 要掛 is-sale」那格(#269-a 補,原本零守門)。
    { id: 'install', label: '安裝預約', href: '/install' },
    { id: 'stores', label: '合作店家', href: '/stores' },
  ];
  const handleNav = (e: MouseEvent, id: string) => {
    e.preventDefault();
    if (onNav) {
      onNav(id);
      return;
    }
    // 會員圖示條件路由(g-1b、#179 D-f 收尾):已登入→/account、未登入→/login。
    // 純 cosmetic;真守門在 /account server 端 getUser()(g-1a)、此處指錯 server 也擋得住。
    if (id === 'account') {
      router.push(isAuthed ? '/account' : '/login');
      return;
    }
    router.push(NAV_ROUTE_MAP[id] ?? `/${id}`);
  };

  return (
    <header className="pcm-header">
      <div className="pcm-header-inner">
        {isMobile ? (
          <>
            <div className="pcm-header-left">
              {/* 手機選單(OD `pcm-home-redesign/DESIGN-HANDOFF-2026-08-05.md` §十一):
                  補真站既有導航缺口——手機原本只有搜尋/logo/購物車,品牌/新品/特價/
                  安裝預約/合作店家五條只剩頁尾能到。連結來源=同一份 navItems(下方定義),
                  不另寫第二份清單。TabBar 五格維持不動,選單是補充不是取代。 */}
              <MobileMenu navItems={navItems} />
              <button className="pcm-icon-btn" aria-label="搜尋商品" data-tip="搜尋" onClick={() => openSearch()}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
                </svg>
              </button>
            </div>
            <Link href="/" className="pcm-logo" aria-label="PCM MOTOR PARTS 首頁">
              <img src={HEADER_LOGO.src} width={HEADER_LOGO.w} height={HEADER_LOGO.h} alt="PCM MOTOR PARTS" />
            </Link>
            <div className="pcm-header-right">
              <button className="pcm-icon-btn pcm-cart" aria-label="購物車" data-tip="購物車" onClick={(e) => handleNav(e, 'cart')}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
                  <path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>
                </svg>
                {totalQty > 0 && <span className="pcm-cart-dot">{totalQty}</span>}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="pcm-header-left">
              <Link href="/" className="pcm-logo" aria-label="PCM MOTOR PARTS 首頁">
                <img src={HEADER_LOGO.src} width={HEADER_LOGO.w} height={HEADER_LOGO.h} alt="PCM MOTOR PARTS" />
              </Link>
              <nav className="pcm-nav">
                {navItems.map(item => (
                  <Link key={item.id}
                        href={item.href}
                        className={`pcm-nav-item ${currentPage === item.id ? 'is-active' : ''} ${item.sale ? 'pcm-nav-sale' : ''}`}>
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
            <div className="pcm-header-right">
              <div className={`pcm-search ${searchQuery ? 'is-focus' : ''}`}
                   onClick={() => openSearch(searchQuery)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
                </svg>
                <input
                  /* R2-3 表列「搜尋框 = placeholder『搜尋商品 / 車款 / 品牌...』+ aria-label『搜尋』」。
                     placeholder 本來就對,少的是 aria-label —— 這欄沒有 <label>,報讀器原本只念得到
                     placeholder(且部分瀏覽器在有值時不念)⇒ 補上不是樣式偏好,是可及性。 */
                  aria-label="搜尋"
                  placeholder="搜尋商品 / 車款 / 品牌..."
                  value={searchQuery}
                  readOnly
                  onFocus={(e) => { e.target.blur(); openSearch(searchQuery); }}
                  onClick={(e) => { e.stopPropagation(); openSearch(searchQuery); }}
                />
              </div>
              <button className="pcm-icon-btn" aria-label="會員" data-tip="會員" onClick={(e) => handleNav(e, 'account')}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              </button>
              <button className="pcm-icon-btn pcm-cart" aria-label="購物車" data-tip="購物車" onClick={(e) => handleNav(e, 'cart')}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
                  <path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>
                </svg>
                {totalQty > 0 && <span className="pcm-cart-dot">{totalQty}</span>}
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
