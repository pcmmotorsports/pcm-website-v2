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

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FREE_SHIPPING_THRESHOLD } from '@pcm/domain';
import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';
import { useCart } from '@/contexts/CartContext';
import { useResolvedCart } from '@/hooks/useResolvedCart';
import { CartVehicleField } from '@/components/CartVehicleField';
import { resolveGaragePrefillVehicle } from '@/lib/garage-chip';
import type { GarageChipItem } from '@/components/GarageChips';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import type { CartItem, CartItemVehicle } from '@/contexts/CartContext';

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
  const { updateQty, removeItem, setItemVehicle, setAllItemsVehicle } = useCart();
  const cart = useResolvedCart('home');

  // V-2h/MF-5(spec §2 車庫預填):登入會員有唯一車或 primary 車 → 首次載入補未填列(標「來自你的車庫」)。
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
  const goContinue = () => router.push('/products');

  if (cart.status === 'loading') {
    return <CartLoading />;
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

        {/* V-2a 整車套用:填一次全列帶入(§2「不造成選擇負擔」預設路);混車時單列可各自改 */}
        <div className="cart-vehicle-top">
          <CartVehicleField
            label="給哪台車用(套用全部商品)"
            hint="建議填寫車款,方便我們為你確認商品是否適用"
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
                    {line.image ? <img src={line.image} alt={line.name} /> : null}
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
                      <div className="cart-qty">
                        <button
                          aria-label="減少數量"
                          onClick={() => updateQty(item, item.qty - 1)}
                          disabled={item.qty <= 1}
                        >
                          −
                        </button>
                        <span>{item.qty}</span>
                        <button aria-label="增加數量" onClick={() => updateQty(item, item.qty + 1)}>
                          +
                        </button>
                      </div>
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
