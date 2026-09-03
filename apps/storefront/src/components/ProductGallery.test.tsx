// @vitest-environment jsdom
//
// ProductGallery smoke test — 商品詳細頁圖片牆獨立單元測試
// M-1-13d 新建補 13c 違鐵則 11(動到前台元件未順手補 smoke test、本 sub-slice 順手補回)
// 驗 hero / thumbs / counter / 鍵盤切圖 / lightbox render 不報錯
// 不 mock next/navigation(ProductGallery 不用)、不 stub matchMedia(只 Header 用)
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { ProductGallery } from './ProductGallery';
import { MOCK_PRODUCTS, type UIVariant } from '../data/mock-products';

afterEach(() => {
  cleanup();
});

// 🔴🔴 2026-08-22:本檔原本大量用 `MOCK_PRODUCTS[0]`(它【一張圖都沒有】)當樣本,
//    而在那之前「沒有圖」會自動生出【三張 Unsplash 示意圖】⇒ 計數器剛好是 01 / 03。
//    ⇒ 那些驗【輪播 / 計數器 / 鍵盤切圖】的格子, 其實是踩在「假圖有三張」這個巧合上。
//    Sean 2026-08-22 答「甲」:無真圖改成【站內佔位圖一張】⇒ 那個巧合消失, 那幾格全紅。
//
//    ⚠️ **修法不是把期望值從 03 改成 01** —— 那會讓「輪播能不能翻頁」變成量不到的東西
//    (只有一張圖就沒有頁可翻)。**它們要驗的一直是輪播, 不是圖有幾張。**
//    ⇒ 改成餵一個【真的有三張圖】的樣本, 那幾格回到它們本來在守的事情上。
const 三張圖商品 = () => ({
  ...MOCK_PRODUCTS[0]!,
  images: [
    'https://cdn.example.com/g1.jpg',
    'https://cdn.example.com/g2.jpg',
    'https://cdn.example.com/g3.jpg',
  ],
  variants: [],
});

describe('ProductGallery', () => {
  it('should render 3 thumbnails + counter 01 / 03', () => {
    render(<ProductGallery product={三張圖商品()} />);
    expect(screen.getByLabelText('圖片 1')).toBeDefined();
    expect(screen.getByLabelText('圖片 2')).toBeDefined();
    expect(screen.getByLabelText('圖片 3')).toBeDefined();
    expect(screen.getByText('01 / 03')).toBeDefined();
  });

  it('should advance activeImg when right arrow clicked', () => {
    render(<ProductGallery product={三張圖商品()} />);
    fireEvent.click(screen.getByLabelText('下一張'));
    expect(screen.getByText('02 / 03')).toBeDefined();
  });

  it('should not render lightbox dialog by default', () => {
    render(<ProductGallery product={MOCK_PRODUCTS[0]!} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('should render sale badge when product.isSale is true', () => {
    // 找 isSale=true 的樣本(akrapovic-6 isSale=true 且 origPrice=112000、有 discount %)
    const saleSample = MOCK_PRODUCTS.find((p) => p.isSale && p.origPrice !== null)!;
    render(<ProductGallery product={saleSample} />);
    // hero badge 顯示 −XX%(對齊 design L261 字面 isSale ? `−{discountPct}%`)
    const expectedPct = Math.round(
      (1 - saleSample.price / (saleSample.origPrice as number)) * 100,
    );
    expect(screen.getByText(`−${expectedPct}%`)).toBeDefined();
  });

  it('should render NEW badge when product.isNew && !isSale', () => {
    const newSample = MOCK_PRODUCTS.find((p) => p.isNew && !p.isSale)!;
    render(<ProductGallery product={newSample} />);
    expect(screen.getByText('NEW')).toBeDefined();
  });

  // OD-4a/OD-7d:選中變體有自己的圖 → 圖庫顯變體圖。MOCK_PRODUCTS[0] 無 product.images/variants,
  //   故池 = 變體 2 張(OD-7d 聚合無其他圖可補、退化為變體圖 only 的特例)。
  it('should show selected variant images when product has no other images', () => {
    const variant: UIVariant = {
      id: 'v-X-G-F',
      sku: 'X-G-F',
      spec: { weave: 'Forged', finish: 'Glossy' },
      price: 8400,
      images: [
        'https://cdn.example.com/v1.jpg',
        'https://cdn.example.com/v2.jpg',
      ],
    };
    render(<ProductGallery product={MOCK_PRODUCTS[0]!} selectedVariant={variant} />);
    // 2 張變體圖 → counter 01 / 02(覆蓋 MOCK_PRODUCTS[0] 無圖時的 seed 3 張路徑)
    expect(screen.getByText('01 / 02')).toBeDefined();
    expect(screen.getByLabelText('圖片 1')).toBeDefined();
    expect(screen.getByLabelText('圖片 2')).toBeDefined();
    expect(screen.queryByLabelText('圖片 3')).toBeNull();
  });

  // OD-7d(Sean 2026-06-03 Q2):選中變體圖排最前 + 其餘所有變體圖 + 群代表圖補後、去重保序
  it('should put selected variant images first then append all other images (dedup)', () => {
    const variants: UIVariant[] = [
      { id: 'v-A', sku: 'A', spec: { weave: 'Twill', finish: 'Glossy' }, price: 1, images: ['https://cdn.example.com/a1.jpg', 'https://cdn.example.com/a2.jpg'] },
      { id: 'v-B', sku: 'B', spec: { weave: 'Plain', finish: 'Glossy' }, price: 1, images: ['https://cdn.example.com/b1.jpg'] },
    ];
    const product = {
      ...MOCK_PRODUCTS[0]!,
      images: ['https://cdn.example.com/b1.jpg'], // 代表圖 = B 的圖(模擬真 DB「代表圖已在某變體」、應去重)
      variants,
    };
    // 選變體 B(圖 b1)→ 池 = b1(選中)+ a1,a2(其餘變體)+ 代表圖 b1(去重)→ 3 張
    render(<ProductGallery product={product} selectedVariant={variants[1]!} />);
    expect(screen.getByText('01 / 03')).toBeDefined();
    // 第一張 = 選中變體 B 的圖 b1(排最前)
    const thumb1 = screen.getByLabelText('圖片 1').querySelector('img');
    expect(thumb1?.getAttribute('src')).toBe('https://cdn.example.com/b1.jpg');
    // 其餘 a1 / a2 接在後(可一路滑)
    const thumb2 = screen.getByLabelText('圖片 2').querySelector('img');
    expect(thumb2?.getAttribute('src')).toBe('https://cdn.example.com/a1.jpg');
  });

  // Fix A(Sean 2026-06-03 :3001 驗):縮圖列 >5 張顯翻頁箭頭、≤5 張不顯;全部縮圖仍渲染(視窗化靠 CSS 捲動)
  it('should render thumbnail paging arrows only when more than 5 images', () => {
    const make = (n: number): UIVariant => ({
      id: 'v-M',
      sku: 'M',
      spec: { weave: 'Twill', finish: 'Glossy' },
      price: 1,
      images: Array.from({ length: n }, (_, i) => `https://cdn.example.com/m${i}.jpg`),
    });
    const { unmount } = render(
      <ProductGallery product={MOCK_PRODUCTS[0]!} selectedVariant={make(6)} />,
    );
    expect(screen.getByLabelText('上一批縮圖')).toBeDefined();
    expect(screen.getByLabelText('下一批縮圖')).toBeDefined();
    expect(screen.getByText('01 / 06')).toBeDefined();
    expect(screen.getByLabelText('圖片 6')).toBeDefined(); // 全 6 縮圖渲染(5 格視窗 + 捲動)
    unmount();
    render(<ProductGallery product={MOCK_PRODUCTS[0]!} selectedVariant={make(5)} />);
    expect(screen.queryByLabelText('上一批縮圖')).toBeNull();
    expect(screen.queryByLabelText('下一批縮圖')).toBeNull();
  });

  // Fix(Sean 2026-06-03 :3001 手機驗:大圖無法放大):手機 tap(touchend)開大圖 lightbox。
  // ⚠️ jsdom 不合成 touch 後的 ghost click,本測只驗 tap-open 路徑;ghost-click-close 根因(已加 preventDefault)需真機驗。
  it('opens lightbox on a mobile tap (touchstart + touchend at same point)', () => {
    render(<ProductGallery product={MOCK_PRODUCTS[0]!} />);
    const hero = document.querySelector('.pd-hero-img') as HTMLElement;
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.touchStart(hero, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchEnd(hero, { changedTouches: [{ clientX: 100, clientY: 100 }] });
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('should clamp counter at 03 / 03 when right arrow reaches last image', () => {
    // ProductGallery.tsx line 150-151:setActiveImg(Math.min(gallery.length - 1, ...)) + disabled
    // 不 wraparound、clamped at last index
    render(<ProductGallery product={三張圖商品()} />);
    fireEvent.click(screen.getByLabelText('下一張'));
    fireEvent.click(screen.getByLabelText('下一張'));
    expect(screen.getByText('03 / 03')).toBeDefined();
    // 已 disabled、再 click 無效、仍 03 / 03
    fireEvent.click(screen.getByLabelText('下一張'));
    expect(screen.getByText('03 / 03')).toBeDefined();
  });

  // Sean 2026-07-19:桌機主要用鍵盤翻 lightbox,原本 ←/→ 獨走 clamp → 頭尾卡住,
  // 與同一 lightbox 內的箭頭按鈕/觸控左右滑(皆已無限輪播)不一致。
  describe('lightbox 鍵盤 ←/→ 無限輪播', () => {
    // ⚠️ hero 與 lightbox 各有一個 "NN / 03" 計數器 → 必須指名 .pd-lb-counter,
    //    用 screen.getByText 會多重命中。
    const lbCounter = () => document.querySelector('.pd-lb-counter')!.textContent;

    function openLightbox() {
      render(<ProductGallery product={三張圖商品()} />);
      fireEvent.click(document.querySelector('.pd-hero-img') as HTMLElement);
      expect(screen.getByRole('dialog')).toBeDefined();
    }

    it('最後一張按 → 回到第一張', () => {
      openLightbox();
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      expect(lbCounter()).toBe('03 / 03');
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      expect(lbCounter()).toBe('01 / 03');
    });

    it('第一張按 ← 回到最後一張', () => {
      openLightbox();
      expect(lbCounter()).toBe('01 / 03');
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
      expect(lbCounter()).toBe('03 / 03');
    });

    it('lightbox 未開時 ←/→ 仍為 clamp(Q-2=C hero 行為不變)', () => {
      render(<ProductGallery product={三張圖商品()} />);
      expect(screen.queryByRole('dialog')).toBeNull();
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
      expect(screen.getByText('01 / 03')).toBeDefined(); // 停在第一張、不繞到最後
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      expect(screen.getByText('03 / 03')).toBeDefined(); // 停在最後一張、不繞回第一張
    });
  });

  // ── 一張圖都沒有的時候(2026-08-22)──────────────────────────────────────
  //
  // 🔴 這條路以前會去跟 `images.unsplash.com` 要【三張示意圖】—— 那是從 design 示意稿
  //   逐字搬進來的,而它被當成正式站的 fallback 用了。對方掛掉或擋流量 ⇒ 客人看到破圖。
  //   ⚠️ 影響幾件商品是量過的:**1 件**(正式庫 21,220 件裡, 群層與變體層都沒有圖的只有 1 件)。
  // 🔴🔴 2026-09-03:有網址【不等於】有照片(來源 1,011 列的圖是「查無圖片」的卡)
  describe('圖是「查無圖片」的卡 ⇒ 不得當成商品照片顯示', () => {
    const PCM_CARD = 'https://quote.pcmmotorsports.com/no-photo.png';
    const SUPPLIER_PH = 'https://www.extreme-components.com/x/noimage.jpg';

    it.each([
      ['PCM 自己的卡', PCM_CARD],
      ['供應商的佔位圖', SUPPLIER_PH],
    ])('🔴 只有【%s】⇒ hero 顯示站內佔位圖, 不是那張卡', (_k, url) => {
      // ⛔ ~~原本寫「mapper 那層的 `dropSupplierPlaceholders` 刻意保留 PCM 自己的卡 ⇒ 它到得了這裡」~~
      //    🔴 **兩半都過期了**(2026-09-04):函式已改名為 `dropImagesWithoutRealPhoto`, 而它**現在也濾那張卡**。
      // 🔵 現況:mapper 那層已先濾一次 ⇒ 正常路徑到不了這裡 ⇒ **本格守的是這個元件自己的行為契約**
      //    (有人改壞 mapper 時這裡會紅)。少了 `hasNoRealImage`, 這張卡會當 hero 全尺寸顯示、進縮圖列、還能放大。
      //    少了 hasNoRealImage, 這張卡會當 hero 全尺寸顯示、進縮圖列、還能點開放大。
      const p = { ...MOCK_PRODUCTS[0]!, images: [url], variants: [] };
      const { container } = render(<ProductGallery product={p} />);
      const hero = container.querySelector('.pd-hero-slide img') as HTMLImageElement;
      expect(hero.getAttribute('src')).toBe('/placeholder-product.png');
      // 🔴 而那張卡【不准】出現在任何一個 img 上(縮圖列與 lightbox 也算)
      const srcs = [...container.querySelectorAll('img')].map((el) => el.getAttribute('src') ?? '');
      expect(srcs.some((s) => s === url)).toBe(false);
    });

    it('🟢 反向那半:真圖照樣顯示(證明這把尺不是恆真)', () => {
      const real = 'https://cdn.example.com/real-1.jpg';
      const p = { ...MOCK_PRODUCTS[0]!, images: [real], variants: [] };
      const { container } = render(<ProductGallery product={p} />);
      const hero = container.querySelector('.pd-hero-slide img') as HTMLImageElement;
      expect(hero.getAttribute('src')).toBe(real);
    });

    it('🔵 混合:真圖 + 佔位圖 ⇒ 只留真圖(佔位圖不佔一格縮圖)', () => {
      const real = 'https://cdn.example.com/real-1.jpg';
      const p = { ...MOCK_PRODUCTS[0]!, images: [PCM_CARD, real], variants: [] };
      const { container } = render(<ProductGallery product={p} />);
      const hero = container.querySelector('.pd-hero-slide img') as HTMLImageElement;
      expect(hero.getAttribute('src')).toBe(real);
    });
  });

  describe('一張圖都沒有 ⇒ 用站內佔位圖, 不向外部圖庫要圖', () => {
    const 沒有圖的商品 = () => ({ ...MOCK_PRODUCTS[0]!, images: [], variants: [] });

    it('🔴 無真圖 ⇒ 顯示 /placeholder-product.png(改回 Unsplash 這格會紅)', () => {
      const { container } = render(<ProductGallery product={沒有圖的商品()} />);
      const hero = container.querySelector('.pd-hero-slide img') as HTMLImageElement;
      expect(hero.getAttribute('src')).toBe('/placeholder-product.png');
    });

    it('🔴 而【任何一個】圖片網址都不准指向站外', () => {
      const { container } = render(<ProductGallery product={沒有圖的商品()} />);
      const srcs = [...container.querySelectorAll('img')].map((el) => el.getAttribute('src') ?? '');
      expect(srcs.length).toBeGreaterThan(0);            // 正向對照:真的有圖在渲染
      expect(srcs.every((src) => src.startsWith('/'))).toBe(true);
      expect(srcs.some((src) => src.includes('unsplash'))).toBe(false);
    });

    it('🔴 反向那半:有真圖的時候【不准】被佔位圖蓋掉', () => {
      const { container } = render(<ProductGallery product={三張圖商品()} />);
      const hero = container.querySelector('.pd-hero-slide img') as HTMLImageElement;
      expect(hero.getAttribute('src')).toBe('https://cdn.example.com/g1.jpg');
      expect(hero.getAttribute('src')).not.toBe('/placeholder-product.png');
    });
  });

  // ── 圖片載不到時的備援(2026-08-22)────────────────────────────────────────
  //
  // 🔴 這一組之前【一格都沒有】—— 本元件三個 `<img>` 的 `onError` 命中數是 0。
  //   商品圖是【外部網址】(Shopify CDN),載不到的時候詳情頁上就是瀏覽器那個「?」方塊。
  //   正式庫今天 21,220 件商品裡, 21,219 件的圖住在別人家的網域上。
  //
  // ⚠️ **jsdom 不會真的去載圖** ⇒ 這裡用 `fireEvent.error()` 手動觸發那個事件。
  //   ⇒ 這幾格證明的是「**收到 error 事件之後會換成佔位圖**」,
  //     **不是**「那張圖在真瀏覽器裡真的載不到會怎樣」。兩者的差別要帶著引用。
  //
  // 🔴🔴 **本組的第一版是【量錯東西】的,而突變當場抓到 —— 這件事值得留在這裡:**
  //   我用 `getByLabelText('圖片 1')` 當「hero 圖」,而那個 aria-label 掛在**縮圖按鈕**上。
  //   ⇒ 我把 hero 的 `onError` 整行拿掉當突變 ⇒ **17 格全綠**(因為我量的一直是縮圖)。
  //   ⇒ 現在 hero 走 `.pd-hero-slide img`、縮圖走 `getByLabelText`、lightbox 走 role=dialog,
  //     **三個位置各有自己的取法, 而每一個都有自己的突變證明。**
  describe('圖片載不到 ⇒ 退回站內佔位圖', () => {
    const 壞圖商品 = () => ({
      ...MOCK_PRODUCTS[0]!,
      images: ['https://cdn.example.com/broken.jpg', 'https://cdn.example.com/ok.jpg'],
      variants: [],
    });
    const heroImgs = (c: HTMLElement) => [...c.querySelectorAll('.pd-hero-slide img')] as HTMLImageElement[];

    it('🔴 hero 圖載不到 ⇒ 換成 /placeholder-product.png(拿掉 hero 的 onError 這格會紅)', () => {
      const { container } = render(<ProductGallery product={壞圖商品()} />);
      const hero = heroImgs(container)[0]!;
      // 正向對照:一開始它是真的那張 —— 沒有這一行, 下面那條在「一開始就是佔位圖」時也會過
      expect(hero.getAttribute('src')).toBe('https://cdn.example.com/broken.jpg');
      fireEvent.error(hero);
      expect(hero.getAttribute('src')).toBe('/placeholder-product.png');
    });

    it('🔴 縮圖載不到 ⇒ 也要換(它是另一個 URL, hero 的 onError 救不到它)', () => {
      render(<ProductGallery product={壞圖商品()} />);
      const thumb = screen.getByLabelText('圖片 1').querySelector('img')!;
      expect(thumb.getAttribute('src')).toBe('https://cdn.example.com/broken.jpg');
      fireEvent.error(thumb);
      expect(thumb.getAttribute('src')).toBe('/placeholder-product.png');
    });

    it('🔴 lightbox 裡那張載不到 ⇒ 也要換(放大看的時候最不能是問號)', () => {
      const { container } = render(<ProductGallery product={壞圖商品()} />);
      fireEvent.click(container.querySelector('.pd-hero-img')!);
      const lb = screen.getByRole('dialog').querySelector('.pd-lb-stage img') as HTMLImageElement;
      expect(lb.getAttribute('src')).toBe('https://cdn.example.com/broken.jpg');
      fireEvent.error(lb);
      expect(lb.getAttribute('src')).toBe('/placeholder-product.png');
    });

    it('🔴 反向那半:圖【載得到】就不准被佔位圖蓋掉', () => {
      const { container } = render(<ProductGallery product={壞圖商品()} />);
      const [第一張, 第二張] = heroImgs(container);
      const 原本 = 第二張!.getAttribute('src');
      fireEvent.error(第一張!);                       // 只讓第一張壞掉
      expect(第二張!.getAttribute('src')).toBe(原本);
      expect(第二張!.getAttribute('src')).not.toBe('/placeholder-product.png');
    });

    it('佔位圖自己再壞一次也不會無限迴圈(同一個 src 只會被標記一次)', () => {
      const { container } = render(<ProductGallery product={壞圖商品()} />);
      const hero = heroImgs(container)[0]!;
      fireEvent.error(hero);
      expect(hero.getAttribute('src')).toBe('/placeholder-product.png');
      fireEvent.error(hero);                          // 佔位圖也壞
      expect(hero.getAttribute('src')).toBe('/placeholder-product.png');
    });
  });
});
