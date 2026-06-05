'use client';

// CartView.tsx — 購物車頁 client 殼(M-3-S2-b2-d)
//
// 直接搬 design-reference/components/AccountPages.jsx CartPage(L11-178、鐵則 1 字面)。
// route adaptation(對齊 storefront 慣例、非 design 視覺偏離):
//   - <Header>/<HomeFooter>(取代 design 的 Header/Footer onNav prop);Header 無 cartCount prop
//     (讀 useCart().totalQty)。
//   - 商品連結 onNav('product',{productId}) → <Link href={/products/${slug}}>;
//     繼續購物 onNav('continue-shopping') → /products(catalog);前往結帳 → /checkout。
//
// 🔴 cart 線契約(M-3-S2-b2-c)只存 { productId, variantId?, qty }、不存價/標題/圖:
//   本元件 hydrate 後把 line keys 丟 resolveCartLines server action 換回顯示資料 + general 單價
//   (鐵則 12:價由 server 依 tier 取、client 永不存價;階段① general-only、tier-aware 待階段⓪)。
//
// design 偏離(commit body + manifest 揭示):
//   - 優惠券(cart-coupon block + 折扣列)不搬(plan v6 §3.2 不做、#202 HOLD)。
//   - 經銷劃線價(tier==='premium_store' strikethrough)不渲染(階段① general-only、階段⓪ 硬 gate)。
//   - 運費 design 3000/120 + perks「4,000」內部不一致 → 統一走 @pcm/domain calculateShippingFee
//     (home、5000/未滿 100、Sean 拍 B + memory iron-rule #161 永久);門檻文案用 FREE_SHIPPING_THRESHOLD。
//   - 前往結帳的 design client-side localStorage 登入檢查不複製;真守門在 /checkout server 端
//     (對齊 /account getUser() pattern);/checkout route 待 S2-b2-e+ 建。
//   - 變體識別:design「顏色: {color}」→ 真變體 spec 值合併(variant 粒度、b2-c justified)。

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { calculateShippingFee, toMoneyAmount, FREE_SHIPPING_THRESHOLD } from '@pcm/domain';
import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';
import { useCart, type CartItem } from '@/contexts/CartContext';
import { resolveCartLines, type CartLineInput, type ResolvedCartLine } from '@/app/cart/actions';

/**
 * line map key:用 JSON.stringify([productId, variantId|null]) 當複合鍵。
 * 純 ASCII、零分隔符碰撞(JSON 自動 escape 字串內任何字元)、不引入控制字元
 * (避免 16c-3 NUL byte 讓 git 判 binary 的同類問題)。
 */
function lineMapKey(line: { productId: string; variantId?: string }): string {
  return JSON.stringify([line.productId, line.variantId ?? null]);
}

export function CartView() {
  const router = useRouter();
  const { items, isHydrated, updateQty, removeItem } = useCart();

  const [resolved, setResolved] = useState<ResolvedCartLine[]>([]);
  // resolved 對應的行集合簽章;!== lineSignature 表示「resolve 尚未跟上目前行集合」(顯載入態)。
  // 初值 null 永不等於任何真實簽章(含空車的 '')→ 首次必載入。
  const [resolvedSignature, setResolvedSignature] = useState<string | null>(null);

  // 行集合簽章:只在「行集合(productId+variantId)」變動時改;qty 變動不改(單價與 qty 無關、
  // 小計 client 端乘算)→ qty 改不觸發 re-resolve、不閃載入態。
  const lineSignature = useMemo(
    () =>
      items
        .map((it) => lineMapKey(it))
        .sort()
        .join('|'),
    [items],
  );

  // 防 race:只採用最後一次 effect 的回應(序號比對)。
  const resolveSeq = useRef(0);
  useEffect(() => {
    if (!isHydrated) return;
    if (items.length === 0) {
      setResolved([]);
      setResolvedSignature(''); // 空車 lineSignature 亦為 ''、標記已跟上
      return;
    }
    const seq = ++resolveSeq.current;
    const payload: CartLineInput[] = items.map((it) => ({
      productId: it.productId,
      ...(it.variantId ? { variantId: it.variantId } : {}),
    }));
    let active = true;
    resolveCartLines(payload)
      .then((lines) => {
        if (!active || seq !== resolveSeq.current) return;
        setResolved(lines);
        setResolvedSignature(lineSignature); // 標記 resolved 已對應目前行集合
      })
      .catch(() => {
        if (!active || seq !== resolveSeq.current) return;
        // 解析失敗(網路 / server 錯)→ 視為空、標記已跟上(不卡載入態);不洩錯誤細節。
        setResolved([]);
        setResolvedSignature(lineSignature);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 以 lineSignature 為穩定觸發鍵(items 每 render 新參照、qty 變動不該 re-resolve);isHydrated 觸發首解析
  }, [lineSignature, isHydrated]);

  const resolvedMap = useMemo(() => {
    const m = new Map<string, ResolvedCartLine>();
    for (const r of resolved) m.set(lineMapKey(r), r);
    return m;
  }, [resolved]);

  // 合併:cart item(qty 即時)× resolved(server 顯示資料 + general 單價);found:false / 未解析 略過。
  const cartLines = useMemo(() => {
    return items
      .map((item: CartItem) => {
        const r = resolvedMap.get(lineMapKey(item));
        if (!r || !r.found) return null;
        return { item, resolved: r, lineTotal: r.unitPrice * item.qty };
      })
      .filter((x): x is { item: CartItem; resolved: ResolvedCartLine; lineTotal: number } => x !== null);
  }, [items, resolvedMap]);

  const subtotal = cartLines.reduce((sum, l) => sum + l.lineTotal, 0);
  // 運費:前台顯示鏡像(權威值由 create_order RPC 結帳當下自算);home 宅配 5000/未滿 100。
  const shipping = calculateShippingFee({ amount: toMoneyAmount(subtotal), currency: 'TWD' }, 'home').amount;
  const total = subtotal + shipping;
  const freeShipRemaining = FREE_SHIPPING_THRESHOLD - subtotal;

  const goCheckout = () => router.push('/checkout');
  const goContinue = () => router.push('/products');

  // ── 載入態(hydrate 前)──
  if (!isHydrated) {
    return <CartLoading />;
  }

  // ── 空狀態(直接搬 design L58-75)──
  if (items.length === 0) {
    return <CartEmpty onContinue={goContinue} />;
  }

  // ── 載入態(有商品但 resolve 尚未跟上目前行集合:首解析 / 加減行 re-resolve)──
  if (resolvedSignature !== lineSignature) {
    return <CartLoading />;
  }

  // resolve 完成、但全為 stale(found:false)→ 視同空車。
  if (cartLines.length === 0) {
    return <CartEmpty onContinue={goContinue} />;
  }

  return (
    <div data-screen-label="Cart" className="ap-page">
      <Header currentPage="cart" />
      <main className="cart-main">
        <div className="cart-head">
          <div>
            <div className="ap-mono">N°01 · Cart</div>
            <h1>購物車</h1>
          </div>
          <div className="cart-head-count">{cartLines.length} 件商品</div>
        </div>

        <div className="cart-layout">
          <div className="cart-items">
            {cartLines.map(({ item, resolved: line, lineTotal }) => {
              const key = lineMapKey(item);
              const href = `/products/${line.slug}`;
              return (
                <div key={key} className="cart-item">
                  <Link href={href} className="cart-item-img">
                    {line.image ? <img src={line.image} alt={line.name} /> : null}
                  </Link>
                  <div className="cart-item-body">
                    <div className="cart-item-brand">{line.brand}</div>
                    <Link href={href} className="cart-item-name">
                      {line.name}
                    </Link>
                    {line.variantLabel && <div className="cart-item-variant">{line.variantLabel}</div>}
                    <div className="cart-item-vehicle">適用 {line.fits}</div>
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
