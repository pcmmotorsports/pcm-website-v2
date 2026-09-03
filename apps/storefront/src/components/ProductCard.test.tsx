// @vitest-environment jsdom
//
// ProductCard smoke test — WO-3 工作流優化、前台 regression 安全網。
// 驗「render 不報錯 + hover 切換不報錯」。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { CartProvider } from '@/contexts/CartContext';
import { ProductCard } from './ProductCard';
import { MOCK_PRODUCTS } from '../data/mock-products';

// 2026-08-08 快速加購接線:`ProductCard` 從此吃 `useCart()`(它本來就不是純展示元件——早有
// hover/liked state),無 provider 會 throw(`CartContext.tsx:325-327`)。
// 🔴 這裡遮蔽 `render` 而不是逐處包 `<CartProvider>`:呼叫端與**斷言一字未動**,
// 只補上元件本來就需要的 provider(正式站的在根 layout `app/layout.tsx:106-109`)。
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: CartProvider });

// 🔴 2026-08-08 加購鈕接線:明確給 `variantCount: 0`(=這是無規格商品)。
//    缺這個欄位 = **不知道有沒有規格** ⇒ 卡片走安全側「當作有規格、讓外層 <Link> 導去商品頁」,
//    那條路**刻意不呼叫 `preventDefault`** ⇒ 下面 it.each 的加購那格會紅。
//    這不是把期望值改掉遷就實作:該條測的意圖是「鈕自己要處理點擊、不得誤跳頁」,
//    而那個意圖只在鈕真的要處理點擊(無規格=直加)時才成立;
//    有規格時鈕的職責**就是**讓它跳頁,那一格由 `product-card-quick-add.test.tsx` 正面守。
const product = { ...MOCK_PRODUCTS[0]!, variantCount: 0 };

afterEach(cleanup);

describe('ProductCard', () => {
  it('should render a product card without crashing', () => {
    render(<ProductCard p={product} />);
    expect(screen.getByText(product.brand)).toBeDefined();
    expect(screen.getByText(product.name)).toBeDefined();
  });

  it('should not crash on hover enter / leave', () => {
    render(<ProductCard p={product} />);
    const card = screen.getByText(product.name).closest('article')!;
    fireEvent.mouseEnter(card);
    fireEvent.mouseLeave(card);
    expect(card).toBeDefined();
  });

  it('should toggle the like button without crashing', () => {
    render(<ProductCard p={product} />);
    fireEvent.click(screen.getByLabelText('收藏'));
    expect(screen.getByLabelText('收藏')).toBeDefined();
  });

  it('should render an anchor with href when href prop is provided', () => {
    render(<ProductCard p={product} href={`/products/${product.slug}?from=catalog`} />);
    const anchor = screen.getByText(product.name).closest('a');
    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute('href')).toBe(`/products/${product.slug}?from=catalog`);
  });

  // 🔴 2026-08-07 焦點查修片:卡內按鈕不得觸發外層 `<a>` 的原生導航。
  //    這個組合(**有 href** 且 **點卡內按鈕**)原本零覆蓋 —— 上面兩條各測一半、沒有交叉:
  //    「收藏鈕點擊」那條沒傳 href、「href 存在」那條沒點按鈕 ⇒ 少了 `preventDefault` 也全綠。
  //    量的是 `defaultPrevented`(瀏覽器是否會執行 `<a>` 的 default action),
  //    不是「有沒有呼叫某個函式」—— 後者是形狀、前者才是行為。
  // 🛑 skip:卡片直加那條路今天不可達(零變體不賣 ⇒ 沒有商品走得到)。理由全文見 product-card-quick-add.test.tsx 檔頭。
  it.skip.each([
    ['收藏', 'pcard-heart'],
    ['+ 加入購物車', 'pcard-quick-btn'],
  ])('有 href 時點「%s」不得觸發外層 <a> 的原生導航(defaultPrevented)', (label, cls) => {
    const { container } = render(<ProductCard p={product} href={`/products/${product.slug}`} />);
    const btn = container.querySelector(`.${cls}`) as HTMLElement;
    expect(btn, `找不到 .${cls} ⇒ 本條前提失效`).not.toBeNull();
    // 前提:它真的在一顆 <a> 裡面,否則這條測的東西不存在。
    expect(btn.closest('a'), `.${cls} 不在 <a> 內 ⇒ 本條前提失效`).not.toBeNull();
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    btn.dispatchEvent(ev);
    expect(
      ev.defaultPrevented,
      `點「${label}」沒有 preventDefault ⇒ 會連帶跳去商品頁(stopPropagation 擋不掉 <a> 的 default action)`,
    ).toBe(true);
  });

  it('should fall back to article + onClick when href is absent', () => {
    render(<ProductCard p={product} />);
    expect(screen.getByText(product.name).closest('a')).toBeNull();
    expect(screen.getByText(product.name).closest('article')).not.toBeNull();
  });

  // M-1-16c-1:真圖渲染 + 無圖 fallback
  it('should render the real product image when p.image is provided', () => {
    const realUrl = 'https://cdn.shopify.com/s/files/test-carbon.jpg';
    render(<ProductCard p={{ ...product, image: realUrl }} />);
    const imgs = screen.getAllByAltText(product.brand);
    expect(imgs.some((el) => el.getAttribute('src') === realUrl)).toBe(true);
    // 🔴 2026-08-22:原本這一行斷言的是「不走 unsplash placeholder」。
    //    unsplash 那條路【整支被刪掉了】(Sean 答「甲」:無真圖改用站內佔位圖)
    //    ⇒ 舊斷言會變成【恆真】—— 沒有人在渲染 unsplash 了, 它永遠不會出現。
    //    ⚠️ **這格原本在擋什麼?擋「真圖分支跑去渲染 placeholder」。那件事沒有變**
    //       ⇒ 判準不變、只是 placeholder 換了身分 ⇒ 改斷言那張新的佔位圖不該出現。
    expect(imgs.some((el) => el.getAttribute('src') === '/placeholder-product.png')).toBe(false);
  });

  // 🔴🔴 2026-08-22:這一格【翻面了】—— 而翻的是規格不是實作。
  //    ~~原本斷言:無真圖 ⇒ src 含 `images.unsplash.com`(那是【期望】它去外部圖庫拿圖)~~
  //    **商品沒有圖的時候, 顧客站在向 `images.unsplash.com` 熱連** —— 對方掛掉或擋流量
  //    ⇒ 客人看到破圖, 而我們沒有任何控制權。Sean 2026-08-22 答「甲」⇒ 改用站內佔位圖。
  //    ⚠️ **這格原本在擋什麼?擋「無真圖時什麼都不渲染」。那件事沒有變** ——
  //       它仍然在守「一定要有一張圖」, 只是那張圖從別人家的變成我們自己的。
  it('should show the brand logo + 「暫無照片」 when p.image is absent', () => {
    render(<ProductCard p={product} />);
    const imgs = screen.getAllByAltText(product.brand);
    // 🔴🔴 2026-09-03 這一格【又翻了一次】—— Sean 拍甲:無真照片改顯示【品牌 logo + 小字「暫無照片」】。
    //    ⚠️ **這格原本在擋什麼?擋「無真圖時什麼都不渲染」。那件事仍然沒有變** ——
    //       它還是在守「一定要有一張圖」, 只是那張圖從站內佔位圖換成了品牌 logo。
    //    🔵 而沒有 logo 的品牌仍然退回站內佔位圖(另一格釘住)⇒ 兩條路都有圖, 不變式沒破。
    expect(imgs.some((el) => el.getAttribute('src') === '/brands/lightech/logo.png')).toBe(true);
    expect(screen.getByText('暫無照片')).toBeTruthy();
    // 🔴 負向那半:不准再有任何東西打向外部圖庫(這條在 unsplash 整支刪掉前是紅的)
    expect(imgs.some((el) => el.getAttribute('src')?.includes('unsplash'))).toBe(false);
  });

  // 🔴 2026-08-07(R1 MF3):以下幾條(trim/contain/漸層)量的是 jsdom 產出的 React inline style
  // **字串**(`el.style.background` 等),沒有 cascade/合成/真瀏覽器——不是「畫面實測」。本片沒有
  // 任何真瀏覽器證據(本機三條路由都渲染不出商品卡、無法起站量測),實際外觀待 Sean 在有資料的
  // 站上看。products-r1.test.ts 那邊若引用這裡,引的也只是「字面對不對」,不是「畫面對不對」。
  // trim 線 S4b:去白邊模式 vs cover fallback
  it('should apply trim positioning and white background when p.imageTrim resolves', () => {
    const realUrl = 'https://cdn.shopify.com/s/files/test-trim.jpg';
    // l=t=0.1 w=h=0.5 方圖 → computeTrimStyle width 184% / left top -14.4%
    const trim = { l: 0.1, t: 0.1, w: 0.5, h: 0.5, nw: 1000, nh: 1000 };
    render(<ProductCard p={{ ...product, image: realUrl, imageTrim: trim }} />);
    const img = screen.getAllByAltText(product.brand).find((el) => el.getAttribute('src') === realUrl)!;
    expect(img.style.width).toBe('184%');
    expect(img.style.left).toBe('-14.4%');
    expect(img.style.top).toBe('-14.4%');
    expect(img.style.transformOrigin).toBe('35% 35%');
    expect(img.style.objectFit).toBe('');
    const gallery = img.closest('.pcard-gallery') as HTMLElement;
    expect(gallery.style.background, '前提(非獨立防線,被下面的 toContain 嚴格蘊含):gallery 有算出 background(非空字串)').not.toBe('');
    expect(gallery.style.background).toContain('255, 255, 255');
  });

  it('should use object-fit contain (full image, no crop) when imageTrim is absent or too small', () => {
    // Sean 2026-07-24 拍板:非 trim 的 fallback 由 cover→contain(非正方形合成圖 cover 會裁掉上下)。
    const realUrl = 'https://cdn.shopify.com/s/files/test-cover.jpg';
    // 無 trim → contain fallback
    render(<ProductCard p={{ ...product, image: realUrl }} />);
    // 內容過小(w=h=0.2 → 460% 超 300% 上限)→ 一樣走 contain fallback
    render(<ProductCard p={{ ...product, image: realUrl, imageTrim: { l: 0.4, t: 0.4, w: 0.2, h: 0.2, nw: 1000, nh: 1000 } }} />);
    const covers = screen.getAllByAltText(product.brand).filter((el) => el.getAttribute('src') === realUrl);
    expect(covers.length).toBe(2);
    for (const img of covers) {
      expect(img.style.objectFit).toBe('contain');
      expect(img.style.width).toBe('100%');
      const gallery = img.closest('.pcard-gallery') as HTMLElement;
      // 圖框白底(Sean 2026-08-06 拍 A、推翻 07-24 拍板 Q1=A 的 --c-surface-2 灰底 letterbox)
      expect(gallery.style.background, '前提(非獨立防線,被下面的 toContain 嚴格蘊含):gallery 有算出 background(非空字串)').not.toBe('');
      expect(gallery.style.background, 'contain fallback 應是純白 #ffffff').toContain('255, 255, 255');
      expect(gallery.style.background, '不該殘留舊的 --c-surface-2 灰底').not.toContain('--c-surface-2');
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // 🔴🔴 image 有值【不等於】有照片(2026-09-03 量:來源 1,011 列的 image_url 是「查無圖片」的卡)
  // ══════════════════════════════════════════════════════════════════════
  const PCM_CARD = 'https://quote.pcmmotorsports.com/no-photo.png';
  const SUPPLIER_PH = 'https://www.extreme-components.com/x/noimage.jpg';

  it.each([
    ['PCM 自己的卡', PCM_CARD],
    ['供應商的佔位圖', SUPPLIER_PH],
  ])('🔴 image 是【%s】⇒ 走無真照片分支(顯示品牌 logo, 不把那張卡當商品照片放大)', (_k, url) => {
    // 🎯 這一格是這一片的本體。少了 ProductImage 的 hasNoRealImage(image),
    //    這些商品會走「真圖」分支 ⇒ 客人看到一張「暫無照片」的卡被當成商品照片顯示,
    //    而下面整個無真圖分支對它們永遠到不了。
    render(<ProductCard p={{ ...product, image: url }} />);
    const imgs = screen.getAllByAltText(product.brand);
    expect(imgs.some((el) => el.getAttribute('src') === '/brands/lightech/logo.png')).toBe(true);
    expect(screen.getByText('暫無照片')).toBeTruthy();
    // 🔴 而那張佔位圖本身【不准】被渲染出來
    expect(imgs.some((el) => el.getAttribute('src') === url)).toBe(false);
  });

  it('🟢 反向那半:真圖照樣是真圖(證明上面那把尺不是恆真)', () => {
    const real = 'https://cdn.shopify.com/s/files/real-carbon.jpg';
    render(<ProductCard p={{ ...product, image: real }} />);
    const imgs = screen.getAllByAltText(product.brand);
    expect(imgs.some((el) => el.getAttribute('src') === real)).toBe(true);
    expect(imgs.some((el) => el.getAttribute('src') === '/brands/lightech/logo.png')).toBe(false);
    expect(screen.queryByText('暫無照片')).toBeNull();
  });

  it('🛑 品牌沒有 logo 檔 ⇒ 退回站內佔位圖(不得破圖、不得只剩文字)', () => {
    // 「一定要有一張圖」這個不變式沒有變 —— 只是有 logo 的走 logo、沒有的走原本那張。
    // 🔴 用 `WRS` 而不是中文假品牌:`brandToSlug('沒有這個品牌')` 會回**空字串**
    //    ⇒ 打到的是 `brandLogoSrc` 的 `if (!slug)` 早退, **不是「slug 在而表裡沒有」那條**。
    //    而 WRS 是真的有這個情況的那一家(它有 brands-dark 檔而刻意不入表)。
    render(<ProductCard p={{ ...product, image: null, brand: 'WRS', brandSlug: undefined }} />);
    const imgs = screen.getAllByAltText('WRS');
    expect(imgs.some((el) => el.getAttribute('src') === '/placeholder-product.png')).toBe(true);
  });

  // 圖框白底(2026-08-06 拍 A)· 漸層 placeholder 分支釘住不變(本片刻意不動、見 ProductCard.tsx 元件註解)
  it('should keep the colored gradient background for the no-real-image placeholder path (untouched by 08-06 white-card change)', () => {
    render(<ProductCard p={{ ...product, image: null }} />);
    // 🔴 2026-08-22:取法從「找 unsplash 那張」改成「找佔位圖那張」——
    //    同一個目的(拿到 placeholder 分支渲染出來的那張圖), 只是它的 src 換了。
    // 🔴 2026-09-03:取法第三次改 —— unsplash 那張 → 站內佔位圖 → **品牌 logo**。
    //    目的始終是同一個:拿到【無真圖分支】渲染出來的那張圖, 只是它的 src 換了三次。
    const img = screen.getAllByAltText(product.brand).find((el) => el.getAttribute('src') === '/brands/lightech/logo.png')!;
    const gallery = img.closest('.pcard-gallery') as HTMLElement;
    expect(gallery.style.background, '前提(非獨立防線,被下面的 toContain 嚴格蘊含):gallery 有算出 background(非空字串)').not.toBe('');
    expect(gallery.style.background, 'placeholder 分支應仍是 linear-gradient、不是純白').toContain('linear-gradient');
    // 🔴 2026-08-07(R1 nit):這條前提是 PALETTES(宣告 `ProductImage.tsx:60`、六色 `:61-66`;2026-08-12 拆檔前在 ProductCard.tsx)六色沒有一個含
    // rgb(255, 255, 255) —— 日後有人加一個含白的 palette(例如更淺的 cool 色),這條會無聲失效
    // (linear-gradient 字串裡混進 '255, 255, 255' 也一樣通過上面那條 toContain)。
    expect(gallery.style.background, 'placeholder 分支不該被誤改成 #fff').not.toContain('255, 255, 255');
  });
  // ══════════════════════════════════════════════════════════════════════
  // 🔴 N4(2026-08-24 補洞窗):**卡片快速加入的靜默夾**
  //
  //   車上已 99 再按這顆 ⇒ `addItem` 一件都沒放進去,而鈕照樣閃「✓ 已加入」1.5 秒。
  //   ⇒ 與 `#883` 的 `/logout`「您已登出」同族:**一句斷言它沒有造成的事**。
  //   而 Sean 2026-08-23 拍的是「不要靜默夾」—— 在這之前**他的拍板只落到了桌機商品頁**。
  //
  //   ⚠️ `已達上限 99` 是**工作字面**,待 Sean 定字(它擠在一顆卡片按鈕裡、不是一整列)。
  //     改字時這兩格會紅 —— 那是**要的**:字面是客人看得到的東西,不該可以安靜地改掉。
  //
  //   實走佐證(2026-08-24、真 dev server `localhost:3020`、首頁 rail、
  //   **點擊與讀值在同一發 evaluate 裡**,因為那個回饋只活 1500ms ——
  //   分兩發讀會讀到它已經消失、而那看起來就像「功能沒做」):
  //     車 99 ⇒ label `+ 加入購物車` → `已達上限 99` · cart 前後同值
  //     車  0 ⇒ label `✓ 已加入`     · cart 真的多出一列 `{"productId":"g3-probe-0011","qty":1}`
  // ══════════════════════════════════════════════════════════════════════
  describe('N4:車上已達上限時,這顆鈕不准說「已加入」', () => {
    const CART_KEY = 'pcm-cart-mock-v2';

    const clickQuickAdd = () => {
      const { container } = render(<ProductCard p={product} />);
      const btn = container.querySelector('.pcard-quick-btn') as HTMLButtonElement;
      fireEvent.click(btn);
      return { container, btn };
    };

    afterEach(() => window.localStorage.clear());

    // 🛑 skip:卡片直加那條路今天不可達(零變體不賣 ⇒ 沒有商品走得到)。理由全文見 product-card-quick-add.test.tsx 檔頭。
    it.skip('車上已 99 → 鈕改說「已達上限」,而購物車一件都沒動', () => {
      window.localStorage.setItem(CART_KEY, JSON.stringify([{ productId: product.slug, qty: 99 }]));
      const { btn } = clickQuickAdd();
      // ① 東西真的沒進去 —— 沒有這一格,「字面對」與「東西也對」分不開
      expect(JSON.parse(window.localStorage.getItem(CART_KEY)!)).toEqual([
        { productId: product.slug, qty: 99 },
      ]);
      // ② 而鈕不准講「已加入」
      expect(btn.textContent).toBe('已達上限 99');
    });

    // 🛑 skip:卡片直加那條路今天不可達(零變體不賣 ⇒ 沒有商品走得到)。理由全文見 product-card-quick-add.test.tsx 檔頭。
    it.skip('對照組:車上是空的 → 鈕照舊說「✓ 已加入」(否則就是恆真的「已達上限」)', () => {
      const { btn } = clickQuickAdd();
      expect(JSON.parse(window.localStorage.getItem(CART_KEY)!)).toEqual([
        { productId: product.slug, qty: 1 },
      ]);
      expect(btn.textContent).toBe('✓ 已加入');
    });
  });
});

describe('🔴 SALE 角標:拿不到價格時不得編造一個折扣(Sean 2026-08-25 兩板)', () => {
  // ── 為什麼要有這一格 ────────────────────────────────────────────────
  // 2026-08-25 突變實測:把 `ProductCard.tsx` 那個 `&& p.price !== null` 整句拿掉
  // ⇒ 這支測試檔 **14 格全綠, 一格都沒紅** ⇒ **那個守門當時沒有任何測試在守它。**
  // 📌 這是本 repo 記過的形狀:「照處方加上去的子句, 可以完全沒有獨立判別力,
  //    而它看起來裝好了。」⇒ 補這一格就是讓它變成量得到的。
  //
  // ⚠️ 這個輸入組合【今天從 RPC 那條路走不到】(`catalog-page.ts` 的 `isSale` 寫死 false、
  //    `origPrice` 寫死 null)⇒ 這一格守的是**縱深防線**, 不是現在會發生的事。
  //    ⇒ 而元件的 props 是公開介面, 任何呼叫端都能構造出這組值。
  const withBadge = (price: number | null) => ({
    ...MOCK_PRODUCTS[0]!, variantCount: 0,
    price, origPrice: 5000, isSale: true, isNew: false,
  });

  it('price = null ⇒ 不得出現角標(現在會算成 -100%:JS 把 null 當 0)', () => {
    const { container } = render(<ProductCard p={withBadge(null)} badgeStyle="corner" />);
    expect(container.querySelector('.badge-corner')).toBeNull();
    expect(container.textContent ?? '').not.toContain('-100%');
  });

  it('🔴 price = 0(贈品)⇒ 角標【要】出現且是 -100% —— 守門不可寫成 `> 0`', () => {
    // Sean 2026-08-25 拍板:0 是合法價格(贈品)。原價 5000、現在 0 元 = 真的 100% off。
    // 寫成 `p.price > 0` 會把這一格一起擋掉, 而畫面上只是少一個角標 ⇒ 沒有人會發現。
    const { container } = render(<ProductCard p={withBadge(0)} badgeStyle="corner" />);
    expect(container.querySelector('.badge-corner')).not.toBeNull();
    expect(container.textContent ?? '').toContain('-100%');
  });

  it('正對照:price = 3000 / origPrice = 5000 ⇒ -40%(證明這把尺會動)', () => {
    const { container } = render(<ProductCard p={withBadge(3000)} badgeStyle="corner" />);
    expect(container.textContent ?? '').toContain('-40%');
  });
});
