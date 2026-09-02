'use client';

// CartView.tsx — 購物車頁 client 殼(M-3-S2-b2-d;e1 改用 useResolvedCart 共用 hook)
//
// 直接搬 design-reference/components/AccountPages.jsx CartPage(L11-178、鐵則 1 字面)。
// route adaptation(對齊 storefront 慣例、非 design 視覺偏離):
//   - <Header>/<HomeFooter>(取代 design 的 Header/Footer onNav prop);Header 無 cartCount prop。
//   - 商品連結 → <Link href={/products/${slug}}>;繼續購物 → /products;前往結帳 → /checkout。
//
// 🔴 cart 線契約只存 {productId,variantId,qty}、不存價:server-resolve 邏輯抽到 useResolvedCart
//   共用 hook(M-3-S2-b2-e1、與 CheckoutView 共用單一真相;鐵則 12 價由 server 取、不存 client)。
//
// design 偏離(commit body + manifest 揭示):優惠券/折扣不搬(plan §3.2 + #202)、經銷劃線價不渲染
//   (階段① general-only)、運費統一 5000/未滿 100(Sean 拍 B + #161)、checkout 守門移 /checkout server、
//   變體識別顯 spec 值(variant 粒度 b2-c)、cart-loading net-new。

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FREE_SHIPPING_THRESHOLD } from '@pcm/domain';
import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';
import { useCart } from '@/contexts/CartContext';
import { CartQtyInput } from '@/components/CartQtyInput';
import { useResolvedCart } from '@/hooks/useResolvedCart';
import { isBalancePaymentOnlyCart } from '@/lib/balance-payment';
import { CartVehicleField } from '@/components/CartVehicleField';
import { CartVehicleMixNotice } from '@/components/CartVehicleMixNotice';
import { resolveGaragePrefillVehicle } from '@/lib/garage-chip';
import { navigateToCatalog } from '@/lib/catalog-navigation';
import type { GarageChipItem } from '@/components/GarageChips';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import type { CartItem, CartItemVehicle } from '@/contexts/CartContext';

/** 站內佔位圖(`apps/storefront/public/placeholder-product.png`,實查 25,300 bytes)。
 *  ponytail: 這是本站第 3 份同字面(另兩份 `ProductGallery.tsx:45`、`ProductImage.tsx:48`,
 *  皆為私有 const)。抽成共用模組要動那兩支別人的檔,不在本條範圍;三份都是同一個 public 路徑,
 *  真改檔名時三處會用**同一種看得見的方式**一起壞 ⇒ 風險可接受。要收就三處一起收。 */
const PLACEHOLDER_IMAGE = '/placeholder-product.png';

/** React key:productId + variantId(JSON、零碰撞、純 ASCII)。 */
function lineKey(line: { productId: string; variantId?: string }): string {
  return JSON.stringify([line.productId, line.variantId ?? null]);
}

/** 全列車款一致=回該車款(頂部整車欄顯示值);混車/空=undefined(頂欄顯未套用)。 */
function commonVehicle(items: CartItem[]): CartItemVehicle | undefined {
  if (items.length === 0) return undefined;
  const first = JSON.stringify(items[0]!.vehicle ?? null);
  if (first === 'null') return undefined;
  return items.every((i) => JSON.stringify(i.vehicle ?? null) === first) ? items[0]!.vehicle : undefined;
}

export function CartView({
  motoBrands = [],
  garage = [],
}: {
  /** V-2a:車款字典(VehicleSelect combobox);cart route server 傳入 */
  motoBrands?: MockMotoBrand[];
  /** V-2a:登入會員愛車(快選;未登入/失敗=[]) */
  garage?: GarageChipItem[];
} = {}) {
  const router = useRouter();

  const { items, updateQty, removeItem, setItemVehicle, setAllItemsVehicle } = useCart();
  // ── A4:購物車圖片載不到就破圖(補洞窗)────────────────────────────────────────
  // 病徵:本檔在這之前**全檔零 `onError`** ⇒ 圖載不到就是瀏覽器那個裂掉的圖示,
  //   而且 `line.image` 是空的時候整格是空白 —— 兩種都讓客人看不出那一列是什麼東西。
  // 🔴 有實績:2026-08-22 發生過**真實破圖**(外部圖 + `Accept: image/webp`)。
  //   ⇒ 這不是防禦性想像,是**已經發生過的事**再發生一次時的樣子。
  //
  // 抄的形狀:`ProductGallery.tsx:80-83` 三行(`brokenSrc` / `srcOrPlaceholder` / `markBroken`),
  //   連它的**鍵怎麼選**一起抄:key 用**解析後的 src 字串**而不是列的索引 ——
  //   同一列在不同時候可能換圖,而壞掉的是那個 URL、不是那一列。
  // 🔴 A 段 nit(2026-08-24):**這張表整個掛載期都不清,而那是刻意的。**
  //   代價:某張圖只是一時載不到(CDN 抖一下),那一列在客人離開這一頁之前都會是佔位圖。
  //   而「清掉它」的代價更差:清了就會**再送一次同一個已知壞掉的 URL** ——
  //   購物車列表每次數量變動都會重繪 ⇒ 那會變成「壞圖每改一次數量就重試一次、每次都閃一下」。
  //   ⇒ 兩害相權:**一張過期的佔位圖 vs 一個會閃的重試迴圈**,選前者。
  //   ⚠️ 而它不會長大到有意義的程度:鍵是 src 字串、只有真的 `onError` 過的才進來。
  //   📌 這一格寫下來是因為**看到它的人會以為是漏的**;它不是漏的,是量過代價之後留的。
  const [brokenSrc, setBrokenSrc] = useState<Record<string, true>>({});
  const srcOrPlaceholder = (src?: string | null) => (src && !brokenSrc[src] ? src : PLACEHOLDER_IMAGE);
  const markBroken = (src?: string | null) =>
    setBrokenSrc((prev) => (!src || prev[src] ? prev : { ...prev, [src]: true }));
  // 🔴 補差額商品整車 → 自取免運(對齊 CheckoutView + create_order store→0;購物車頁運費不漂移)。
  const cart = useResolvedCart(
    isBalancePaymentOnlyCart(items.map((i) => i.productId)) ? 'store' : 'home',
  );

  // V-2h/MF-5(spec §2 車庫預填):登入會員有唯一車或 primary 車 → 首次載入補未填列(標「來自您的車庫」)。
  // 🔴 只補未填列(!item.vehicle)=不覆蓋 search 帶入(優先序 search>garage);唯一精確解析才補=零猜。
  // run-once ref:清空後不再回填(尊重使用者清除意圖)、避免 setItemVehicle 觸發 cart 變更的回圈。
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (prefilledRef.current || cart.status !== 'ready') return;
    // 首次 ready 即定案(apply 落空亦置旗標=不重試):garage/motoBrands 為 server props、首繪即定值,
    // 故首個 ready render 資料必齊、不會漏預填。若未來改成 ready 後 async 載車庫,此處需改為僅成功才置旗標。
    prefilledRef.current = true;
    const apply = resolveGaragePrefillVehicle(motoBrands, garage);
    if (!apply) return;
    const gv: CartItemVehicle = {
      kind: 'dict',
      brand: apply.brand,
      model: apply.model,
      source: 'garage',
      ...(apply.year !== undefined ? { year: apply.year } : {}),
    };
    for (const l of cart.lines) {
      if (!l.item.vehicle) setItemVehicle(l.item, gv);
    }
  }, [cart, motoBrands, garage, setItemVehicle]);

  const goCheckout = () => router.push('/checkout');
  // 🔴 走 navigateToCatalog、不裸 push:購物車捲到下面按「繼續購物」時,落地不歸零同樣會讓
  //    首排商品被黏頂篩選列蓋住(與首頁 finder 同一根因;D-310-A Bug 2)。
  const goContinue = () => navigateToCatalog(router, '/products');

  if (cart.status === 'loading') {
    return <CartLoading />;
  }
  // 🔴 A2:`error` 必須排在 `empty` **旁邊而不是被它吃掉** —— 這兩件事對客人完全不同:
  //   `empty`「你沒有東西」/ `error`「**你的東西還在,我現在讀不到**」。
  //   在這之前 hook 的 catch 把失敗吞成 `empty` ⇒ 網路抖一下,客人看到的是「購物車是空的」。
  if (cart.status === 'error') {
    return <CartUnavailable />;
  }
  if (cart.status === 'empty') {
    return <CartEmpty onContinue={goContinue} />;
  }

  const { lines, subtotal, shipping, total, freeShipRemaining } = cart;

  return (
    <div data-screen-label="Cart" className="ap-page">
      <Header currentPage="cart" />
      <main className="cart-main">
        <div className="cart-head">
          <div>
            <div className="ap-mono">N°01 · Cart</div>
            <h1>購物車</h1>
          </div>
          <div className="cart-head-count">{lines.length} 件商品</div>
        </div>

        {/* 🔵 混車橫幅(plan `docs/specs/2026-09-03-cart-vehicle-mix-notice-plan.md`)。
            接線與判準都在該元件內 ⇒ 本頁只交出 `lines`(R1 nit 9:接線放這裡時零測試覆蓋)。 */}
        <CartVehicleMixNotice lines={lines} />

        {/* V-2a 整車套用:填一次全列帶入(§2「不造成選擇負擔」預設路);混車時單列可各自改 */}
        <div className="cart-vehicle-top">
          <CartVehicleField
            label="給哪台車用(套用全部商品)"
            hint="建議填寫車款,方便我們為您確認商品是否適用"
            // 以可見(server-resolved)列判一致態:server 濾掉的 stale 列不影響頂欄顯示(code-reviewer minor)
            value={commonVehicle(lines.map((l) => l.item))}
            onChange={setAllItemsVehicle}
            motoBrands={motoBrands}
            garage={garage}
          />
        </div>

        <div className="cart-layout">
          <div className="cart-items">
            {lines.map(({ item, resolved: line, lineTotal }) => {
              const href = `/products/${line.slug}`;
              return (
                <div key={lineKey(item)} className="cart-item">
                  <Link href={href} className="cart-item-img">
                    {/* A4:載不到 ⇒ 換佔位圖(不是破圖)。`line.image` 本來就沒有時也走佔位圖 ——
                        原本那條 `: null` 會留下一個**空白方框**,客人一樣看不出這列是什麼。 */}
                    <img
                      src={srcOrPlaceholder(line.image)}
                      onError={() => markBroken(line.image)}
                      alt={line.name}
                    />
                  </Link>
                  <div className="cart-item-body">
                    <div className="cart-item-brand">{line.brand}</div>
                    <Link href={href} className="cart-item-name">
                      {line.name}
                    </Link>
                    {/* V-2a2:料號恆顯行(sku 有值才顯)+ 規格行(有變體規格才顯)=與 PDP 資訊對齊 */}
                    {line.sku && <div className="cart-item-sku">料號 {line.sku}</div>}
                    {line.variantLabel && <div className="cart-item-variant">{line.variantLabel}</div>}
                    <div className="cart-item-vehicle">適用 {line.fits}</div>
                    {/* V-2a 單列車款欄(給哪台車用;覆寫整車套用值=混車訂單)
                        V-2e:傳該商品 fitments → dict 車款不符=紅膠囊「可能不適用」(重用 §7
                        checkFitment;free/年份未知=中性人工確認路;display-only 不擋結帳) */}
                    <CartVehicleField
                      label="這件給哪台車"
                      value={item.vehicle}
                      onChange={(v) => setItemVehicle(item, v)}
                      motoBrands={motoBrands}
                      garage={garage}
                      fitments={line.fitments}
                    />
                    <div className="cart-item-actions">
                      <CartQtyInput qty={item.qty} onCommit={(n) => updateQty(item, n)} />
                      <button className="cart-item-remove" onClick={() => removeItem(item)}>
                        移除
                      </button>
                    </div>
                  </div>
                  <div className="cart-item-price">
                    <div className="cart-item-price-main">NT$ {lineTotal.toLocaleString()}</div>
                    {item.qty > 1 && (
                      <div className="cart-item-price-unit">單價 NT$ {line.unitPrice.toLocaleString()}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <aside className="cart-summary">
            <div className="cart-summary-head">訂單摘要</div>

            <div className="cart-totals">
              <div className="cart-row"><span>小計</span><span>NT$ {subtotal.toLocaleString()}</span></div>
              <div className="cart-row"><span>運費</span><span>{shipping === 0 ? '免運' : `NT$ ${shipping}`}</span></div>
              {shipping > 0 && (
                <div className="cart-row-hint">再買 NT$ {freeShipRemaining.toLocaleString()} 享免運</div>
              )}
            </div>

            <div className="cart-grand">
              <span>總計</span>
              <span>NT$ {total.toLocaleString()}</span>
            </div>

            <button className="cart-checkout" onClick={goCheckout}>
              前往結帳
              <span>→</span>
            </button>

            <button className="cart-continue" onClick={goContinue}>繼續購物</button>

            <div className="cart-perks">
              <div><span>✓</span> 滿 NT$ {FREE_SHIPPING_THRESHOLD.toLocaleString()} 免運</div>
              <div><span>✓</span> 原廠正品販售，國際空運入台</div>
              <div><span>✓</span> 完善售後服務</div>
            </div>
          </aside>
        </div>
      </main>
      <HomeFooter />
    </div>
  );
}

// CartQtyInput 已抽成獨立檔案(2026-08-21 F-81):ProductPage.tsx(手機數量滑出列)要共用同一套
// 邏輯,而它不能 import 本檔(本檔有 useResolvedCart → server-only 鏈,'use client' 元件互相
// import 會在建置期炸)。見 './CartQtyInput.tsx' 檔頭說明。

/** 載入態(server resolve 非同步、首解析 / re-resolve 期間)。 */
function CartLoading() {
  return (
    <div data-screen-label="Cart" className="ap-page">
      <Header currentPage="cart" />
      <div className="cart-loading">載入購物車…</div>
      <HomeFooter />
    </div>
  );
}

/** A2:讀不到購物車(不是空車)。
 *  🔴 文案**不得**寫成「購物車是空的」或「沒有商品」—— 客人的品項一直好好地在 localStorage 裡,
 *  那樣寫是在對他說謊,而他很可能會因此重新加一次(結果買兩份)。
 *  ⚠️ 這裡**沒有**「繼續購物」按鈕(`CartEmpty` 有):空車的下一步是去逛,讀不到的下一步是**重試**。
 *  `role="alert"` = 讀螢幕的人會被主動念到,不必自己去找哪裡變了。 */
function CartUnavailable() {
  return (
    <div data-screen-label="Cart" className="ap-page">
      <Header currentPage="cart" />
      <div className="cart-empty" role="alert">
        <h2>暫時讀不到你的購物車</h2>
        <p>你的商品沒有不見,是我們這邊一時讀不到。請重新整理頁面再試一次。</p>
      </div>
      <HomeFooter />
    </div>
  );
}

/** 空車狀態(直接搬 design AccountPages CartPage L58-75)。 */
function CartEmpty({ onContinue }: { onContinue: () => void }) {
  return (
    <div data-screen-label="Cart" className="ap-page">
      <Header currentPage="cart" />
      <div className="cart-empty">
        <div className="cart-empty-icon">
          <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
            <path d="M3 6h18" />
            <path d="M16 10a4 4 0 0 1-8 0" />
          </svg>
        </div>
        <h2>購物車是空的</h2>
        <p>還沒選好部品嗎？去看看本週精選吧。</p>
        <button className="btn-primary" onClick={onContinue}>繼續購物</button>
      </div>
      <HomeFooter />
    </div>
  );
}
