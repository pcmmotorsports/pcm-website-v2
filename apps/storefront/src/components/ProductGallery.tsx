// ProductGallery.tsx — 商品詳細頁圖片牆 + Lightbox 子元件(M-1-13c 拆檔 from ProductPage)
//
// 字面從 design-reference/components/ProductPage.jsx @ 25d3a2a 直接搬:
// - line 7-26 hooks(gallery useMemo / activeImg / lightbox / keyboard nav useEffect + body scroll lock)
// - line 140-141 derived(hasDiscount / discountPct)
// - line 189-265 gallery JSX(hero swipe + track + arrows + counter + thumb overlay + 2 badges)
// - line 547-590 lightbox JSX(close + lb-stage + lb-swipe + arrows + counter)
//
// 字面轉換:
// - window.__pdSwipeX/Y/T/DidSwipe + __lbSwipeX 全局 → 5 個 useRef(heroSwipeXRef / heroSwipeYRef / heroSwipeTRef / heroDidSwipeRef / lbSwipeXRef)
// - PRODUCT_IMG_POOL + productGallery inline(第 2 處、第 1 處在 `ProductImage.tsx`:POOL `:28-44` / productGallery `:46-54`〔2026-08-12 拆檔前在 ProductCard.tsx〕、第 3 處撞抽 backlog #155)
// - e.target → cast as Element 取 .closest()(TypeScript 嚴格)
// - product.origPrice! non-null assertion(hasDiscount guard 後安全)
//
// 'use client' 必要:useState / useEffect / useRef / useMemo + 互動 onClick / onTouch
// 對齊 ADR-0006 §1 白名單「Hooks → 'use client'」
//
// 拆檔原因:M-1-13c 落地後 ProductPage.tsx 累積達 366 行、超鐵則 6 「300 警戒 / 400 硬上限」;
// 立即拆 ProductGallery 對齊驗收條件「ProductPage.tsx 行數 < 300」、避免跨警戒。
//
// CSS 不拆:.pd-gallery / .pd-hero-* / .pd-thumb-* / .pd-lightbox / .pd-lb-* 等 selectors 留在
// apps/storefront/src/styles/product-page.css 內(ProductPage.tsx 已 import、本檔不額外 import)。

'use client';

import { hasNoRealImage } from '@pcm/domain';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MockProduct, UIVariant } from '@/data/mock-products';
import { useLightboxSwipe } from '@/hooks/useLightboxSwipe';

// 🔴 2026-08-22:這裡原本有 `PRODUCT_IMG_POOL`(15 個 Unsplash photo id)+ `productGallery(seed)`
//   + `resolveSrc(item, usingReal, …)` —— **商品沒有圖的時候, 詳情頁會去跟 `images.unsplash.com`
//   要三張示意圖**, 而那是從 design-reference 的示意稿逐字搬過來的(本檔檔頭第 11 行寫著)。
//
//   ⚠️ **這個分支影響幾件商品, 是量過的:【1 件】**(21,220 件裡, 群層與變體層都沒有圖的只有 1 件)。
//   ⇒ 換掉它幾乎不改變任何人看到的畫面 —— 它修的是「我們對外部服務的依賴」, 不是視覺。
//
//   `resolveSrc` 也一起拿掉了:它唯一在做的事是**替 Unsplash 那條路拼尺寸參數**
//   (`?w=&q=&auto=format&fit=`), 真圖那條路本來就是原封直送。
//   ⇒ 現在 gallery 裡的每一個字串都已經是「可以直接放進 src 的東西」, 不需要再解析一次。
//   📌 連帶:backlog `#155`(抽共用 PRODUCT_IMG_POOL + productGallery)自己說了
//      「M-1-16 真資料種子上線、PRODUCT_IMG_POOL + productGallery 整支廢、本條順手收」——
//      **那一天到了。** 兩支檔的定義都已刪除。

/** 站內自己的佔位圖(`apps/storefront/public/`)。與後台 `product-media.ts` 用的是同一張。 */
const PLACEHOLDER_IMAGE = '/placeholder-product.png';

export type ProductGalleryProps = { product: MockProduct; selectedVariant?: UIVariant | null };

export function ProductGallery({ product, selectedVariant }: ProductGalleryProps) {
  // OD-7d(Sean 2026-06-03 Q2:選中變體圖排前 + 其餘全部補後、可一路滑):
  //   gallery = 選中變體的圖排**最前**(正確的那幾張)+ 其餘所有變體圖(變體順序)+ 群代表圖,
  //   Set 去重保序(RPM 各變體圖無跨變體重複;群代表圖通常已是某變體的圖、去重不重出)。
  //   取代 OD-4a「只顯示該變體那幾張」— 現在點某紋路會看到該紋路照片在前、剩下的接著看(全 ~22 張)。
  //   皆無真圖則 fallback seed placeholder gallery;gallery 來源變更時下方 activeImg reset effect 歸 0。
  const { gallery } = useMemo(() => {
    const seen = new Set<string>();
    const pool: string[] = [];
    const push = (arr?: readonly string[]) => {
      for (const u of arr ?? []) {
        // 🔴🔴 2026-09-03:`hasNoRealImage` —— 有網址【不等於】有照片。
        //   來源 1,011 列的圖是「查無圖片」的卡(882 列是 PCM 自己那張、119 列是供應商的)。
        //   🔵 **2026-09-04 起 mapper 那層已經先濾一次**(`dropImagesWithoutRealPhoto`)
        //      ⇒ 正常路徑上這裡收到的已經是乾淨的 ⇒ **這一行現在是第二道, 不是唯一一道**。
        //   🛑 **而它仍然要留著**, 理由**一個**(而它夠):
        //      這一格的測試是**這個元件自己**的行為契約 —— 拿掉它, 有人改壞 mapper 時這裡不會紅。
        //   ⛔ ~~原本還寫了理由①:「`product.image` 與 variant images 不見得都經過那一層」~~
        //      🔴 **那是假的**(R1 抓到):`product.image` 就是 `lib/products.ts:200` 從**已濾過的陣列**取的;
        //      variant images 走 `mappers/product.ts:342` 的 `dropImagesWithoutRealPhoto`。**兩條都經過。**
        //      📌 同檔上游記過:「照著假理由走的人, 會拿一個不存在的限制去做別的決定。」
        //      ⇒ 📌 **兩道都在同一個謂詞上, 所以它們不會分岔**(不是重複兩份判斷)。
        //   ⇒ 少了這一句, 那張「暫無照片」的卡會在商品詳情頁**當 hero 全尺寸顯示**,
        //     還會進縮圖列、還能點開 lightbox 放大。⇒ 🎯 **比在卡片上更難看。**
        //   ⇒ 🔵 全部濾光 ⇒ pool 空 ⇒ 走下面那個站內佔位圖(= 本來就有的最後一層)。
        if (u && !hasNoRealImage(u) && !seen.has(u)) {
          seen.add(u);
          pool.push(u);
        }
      }
    };
    push(selectedVariant?.images); // 選中變體圖排最前
    for (const v of product.variants ?? []) push(v.images); // 其餘變體圖(變體順序)
    push(product.images); // 群代表圖(通常已含於變體圖、去重)
    if (product.image) push([product.image]);
    return pool.length > 0
      ? { gallery: pool }
      // 一張圖都沒有 ⇒ 站內佔位圖一張(原本是 Unsplash 三張, 見本檔上方那段)
      : { gallery: [PLACEHOLDER_IMAGE] };
  // 🔴 2026-08-22:相依陣列拿掉了 product.id —— 它唯一的用途是餵 productGallery(product.id)
  //   去挑 Unsplash 示意圖, 而那整段已經刪掉。留著會被 react-hooks/exhaustive-deps 判為多餘。
  }, [selectedVariant?.images, product.variants, product.images, product.image]);
  const [activeImg, setActiveImg] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  // 載不到的圖片網址。key 用【解析後的 src】而不是 gallery 的索引 ——
  // 同一張圖在 hero / 縮圖 / lightbox 是三個不同尺寸的 URL, 壞掉的可能只有其中一個。
  const [brokenSrc, setBrokenSrc] = useState<Record<string, true>>({});
  const srcOrPlaceholder = (src: string) => (brokenSrc[src] ? PLACEHOLDER_IMAGE : src);
  const markBroken = (src: string) => setBrokenSrc((prev) => (prev[src] ? prev : { ...prev, [src]: true }));

  // M-1-16c-3:gallery 來源變更(換商品 / 16c-4 變體換圖)時 reset activeImg 到 0、
  //   防 gallery[activeImg] 越界空圖(codex 關卡2 consider;route 重掛載已 0、此為 in-place 換源防線)。
  useEffect(() => {
    setActiveImg(0);
  }, [gallery]);

  const heroSwipeXRef = useRef(0);
  const heroSwipeYRef = useRef(0);
  const heroSwipeTRef = useRef(0);
  const heroDidSwipeRef = useRef(false);
  const thumbsRef = useRef<HTMLDivElement>(null); // 縮圖列捲動容器(箭頭翻頁用)

  // Sean Q-2=C 拍板偏離 design 字面:桌機 hero 不開 lightbox 也能 ←/→ 切圖
  // (原 design line 12-26 useEffect 條件 `if (!lightbox) return;`、lightbox-only;本實作改 always-on listener、
  //  ESC + scroll lock 仍 lightbox-only、PCM 業務 UX 擴張、commit body 揭示鐵則 11 字面 vs 事實偏離)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightbox) setLightbox(false);
        return;
      }
      if (gallery.length === 0) return;
      // Sean 2026-07-19:lightbox 開啟時 ←/→ 也要無限輪播,與同一 lightbox 內的箭頭按鈕、
      // 觸控左右滑同語意(桌機主要靠鍵盤,原本 clamp 會在頭尾卡住 = 手機能循環、桌機不能)。
      // lightbox 未開的 hero 切圖維持 clamp(Q-2=C 原行為,不在本次範圍)。
      if (e.key === 'ArrowRight') {
        setActiveImg((i) => (lightbox ? (i + 1) % gallery.length : Math.min(gallery.length - 1, i + 1)));
      } else if (e.key === 'ArrowLeft') {
        setActiveImg((i) => (lightbox ? (i - 1 + gallery.length) % gallery.length : Math.max(0, i - 1)));
      }
    };
    window.addEventListener('keydown', onKey);
    let prevOverflow: string | null = null;
    if (lightbox) {
      prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', onKey);
      if (prevOverflow !== null) {
        document.body.style.overflow = prevOverflow;
      }
    };
  }, [lightbox, gallery.length]);

  const hasDiscount = product.origPrice != null && product.origPrice > product.price;
  const discountPct = hasDiscount ? Math.round((1 - product.price / product.origPrice!) * 100) : 0;

  // Lightbox 無限輪播(Sean 2026-07-09:滑到最後一張再往右 → 回第一張)。
  const lbNext = () => setActiveImg((i) => (i + 1) % gallery.length);
  const lbPrev = () => setActiveImg((i) => (i - 1 + gallery.length) % gallery.length);
  // Lightbox 觸控手勢:上下滑關閉(手指跟隨 + 保守門檻)+ 左右滑輪播(共用 hook、SwatchLightbox 同款)。
  const lbSwipe = useLightboxSwipe({
    count: gallery.length,
    goNext: lbNext,
    goPrev: lbPrev,
    onDismiss: () => setLightbox(false),
  });
  // V-2g:換圖/開關 lightbox 重置縮放(避免上一張縮放殘留;resetZoom 走 stable refs)。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { lbSwipe.resetZoom(); }, [activeImg, lightbox]);

  return (
    <>
      <div className="pd-gallery">
        <div
          className="pd-hero-img"
          onTouchStart={(e) => {
            heroSwipeXRef.current = e.touches[0]!.clientX;
            heroSwipeYRef.current = e.touches[0]!.clientY;
            heroSwipeTRef.current = Date.now();
            heroDidSwipeRef.current = false;
          }}
          onTouchEnd={(e) => {
            const dx = e.changedTouches[0]!.clientX - heroSwipeXRef.current;
            const dy = e.changedTouches[0]!.clientY - heroSwipeYRef.current;
            const dt = Date.now() - heroSwipeTRef.current;
            if (Math.abs(dx) < 8 && Math.abs(dy) < 8 && dt < 280) {
              // 手機 tap 開大圖 lightbox:必須 preventDefault 抑制隨後的 ghost click,
              // 否則 ghost click 會落在剛渲染的 .pd-lightbox 上、其 onClick 立刻 setLightbox(false)
              // 把 lightbox 關掉 → 手機上看起來「大圖無法點擊放大」(Sean 2026-06-03 :3001 手機驗根因)。
              try { e.preventDefault(); } catch { /* noop */ }
              setLightbox(true);
              return;
            }
            if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
              if (dx < 0 && activeImg < gallery.length - 1) setActiveImg(activeImg + 1);
              else if (dx > 0 && activeImg > 0) setActiveImg(activeImg - 1);
              heroDidSwipeRef.current = true;
              try { e.preventDefault(); } catch { /* noop */ }
            }
          }}
          onClick={(e) => {
            // M-1-13H-1: .pd-thumb-overlay 已搬出 hero-img(對齊 HANDOFF #3 thumb 移下方)、不再 closest 檢測;
            // .pd-hero-dot 無對應 CSS、一併清理
            const target = e.target as Element;
            if (target.closest('.pd-hero-arrow, .pd-hero-counter')) return;
            if (heroDidSwipeRef.current) { heroDidSwipeRef.current = false; return; }
            setLightbox(true);
          }}
        >
          <div className="pd-hero-track" style={{ transform: `translateX(-${activeImg * 100}%)` }}>
            {gallery.map((id, i) => (
              <div key={i} className="pd-hero-slide">
                <img
                  src={srcOrPlaceholder(id)}
                  onError={() => markBroken(id)}
                  alt={product.name}
                />
              </div>
            ))}
          </div>
          <button
            className="pd-hero-arrow pd-hero-arrow-left"
            onClick={(e) => { e.stopPropagation(); setActiveImg(Math.max(0, activeImg - 1)); }}
            disabled={activeImg === 0}
            aria-label="上一張"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <button
            className="pd-hero-arrow pd-hero-arrow-right"
            onClick={(e) => { e.stopPropagation(); setActiveImg(Math.min(gallery.length - 1, activeImg + 1)); }}
            disabled={activeImg === gallery.length - 1}
            aria-label="下一張"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m9 18 6-6-6-6"/></svg>
          </button>
          <div className="pd-hero-counter">
            {String(activeImg + 1).padStart(2, '0')} / {String(gallery.length).padStart(2, '0')}
          </div>
          {product.isSale && <div className="pd-hero-badge">−{discountPct}%</div>}
          {product.isNew && !product.isSale && <div className="pd-hero-badge pd-hero-badge-new">NEW</div>}
        </div>
        {/* 縮圖列:5 格視窗 + 左右翻頁(Sean 2026-06-03 :3001 驗:>5 張不一次全列、橫向 swipe + 箭頭翻頁)。
            主圖庫(.pd-hero-track)仍含全部圖、可一路滑;thumb 放主圖下方(HANDOFF #3)。 */}
        <div className="pd-thumbs-wrap">
          {gallery.length > 5 && (
            <button
              type="button"
              className="pd-thumbs-nav pd-thumbs-nav-left"
              onClick={() => { const el = thumbsRef.current; if (el) el.scrollBy({ left: -el.clientWidth, behavior: 'smooth' }); }}
              aria-label="上一批縮圖"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m15 18-6-6 6-6"/></svg>
            </button>
          )}
          <div className="pd-thumbs" ref={thumbsRef}>
            {gallery.map((id, i) => (
              <button
                key={i}
                className={`pd-thumb-btn ${activeImg === i ? 'is-active' : ''}`}
                onClick={() => setActiveImg(i)}
                aria-label={`圖片 ${i + 1}`}
              >
                <img
                  src={srcOrPlaceholder(id)}
                  onError={() => markBroken(id)}
                  alt=""
                  loading="lazy"
                />
              </button>
            ))}
          </div>
          {gallery.length > 5 && (
            <button
              type="button"
              className="pd-thumbs-nav pd-thumbs-nav-right"
              onClick={() => { const el = thumbsRef.current; if (el) el.scrollBy({ left: el.clientWidth, behavior: 'smooth' }); }}
              aria-label="下一批縮圖"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m9 18 6-6-6-6"/></svg>
            </button>
          )}
        </div>
      </div>

      {lightbox && (
        <div className="pd-lightbox" ref={lbSwipe.overlayRef} onClick={() => setLightbox(false)} role="dialog" aria-label="放大檢視">
          <button
            className="pd-lb-close"
            onClick={(e) => { e.stopPropagation(); setLightbox(false); }}
            aria-label="關閉"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
          {/* 手勢:上下滑關閉(手指跟隨 + 保守門檻)+ 左右滑無限輪播(useLightboxSwipe、touch-action:none) */}
          <div className="pd-lb-stage" ref={lbSwipe.stageRef} {...lbSwipe.stageProps}>
            {/* V-2g:雙指縮放/平移套 imageRef;放大態單擊不關閉(pinch 縮回或 X/滑下/ESC/背景) */}
            <img
              ref={lbSwipe.imageRef}
              src={srcOrPlaceholder(gallery[activeImg]!)}
              onError={() => markBroken(gallery[activeImg]!)}
              alt={product.name}
              onClick={() => { if (!lbSwipe.isZoomed()) setLightbox(false); }}
              style={{ cursor: 'zoom-out' }}
            />
          </div>
          {gallery.length > 1 && (
            <>
              <button
                className="pd-lb-arrow pd-lb-arrow-left"
                onClick={(e) => { e.stopPropagation(); lbPrev(); }}
                aria-label="上一張"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m15 18-6-6 6-6"/></svg>
              </button>
              <button
                className="pd-lb-arrow pd-lb-arrow-right"
                onClick={(e) => { e.stopPropagation(); lbNext(); }}
                aria-label="下一張"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m9 18 6-6-6-6"/></svg>
              </button>
            </>
          )}
          <div className="pd-lb-counter">
            {String(activeImg + 1).padStart(2, '0')} / {String(gallery.length).padStart(2, '0')}
          </div>
        </div>
      )}
    </>
  );
}
