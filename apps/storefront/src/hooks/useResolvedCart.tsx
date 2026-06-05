'use client';

// useResolvedCart.tsx — 購物車 server-resolve 共用 hook(M-3-S2-b2-e1;.tsx 取 react-hooks 規則守門)
//
// 由 CartView(購物車頁)+ CheckoutView(結帳頁右側摘要)共用,集中「cart 線契約 → server 解析
// 顯示資料 + general 單價」的單一真相(審查側 e1 條件 1:摘要價 server-resolve、不存 client)。
//
// 🔴 鐵則 12:cart 線只存 {productId,variantId,qty}、不存價;hydrate 後丟 resolveCartLines server
//   action 換回 unitPrice/標題/圖(fetchProductByHandle 釘 general、strip priceByTier、逐欄白名單)。
//   價由 server 取、client 永不存價;階段① general-only、tier-aware 待階段⓪。
//
// 狀態機(resolvedSignature):loading(hydrate 前 / resolve 未跟上行集合)→ empty(空車 / 全 stale)
//   → ready;qty 變動不改 lineSignature 故不 re-resolve、不閃載入;resolveSeq 防 race。
//
// 運費(method 參數):純函式 calculateShippingFee 顯示鏡像(權威值由 create_order RPC 結帳當下自算);
//   method 改變只重算 shipping、不重 resolve。

import { useEffect, useMemo, useRef, useState } from 'react';
import { calculateShippingFee, toMoneyAmount, FREE_SHIPPING_THRESHOLD } from '@pcm/domain';
import type { ShippingMethod } from '@pcm/domain';
import { useCart, type CartItem } from '@/contexts/CartContext';
import { resolveCartLines, type CartLineInput, type ResolvedCartLine } from '@/app/cart/actions';

/** 合併後的單行(cart item 即時 qty × server resolved 顯示資料)。 */
export type ResolvedCartLineView = {
  item: CartItem;
  resolved: ResolvedCartLine;
  lineTotal: number;
};

export type UseResolvedCart = {
  /** loading=hydrate前/resolve未跟上;empty=空車或全 stale;ready=可渲染 */
  status: 'loading' | 'empty' | 'ready';
  lines: ResolvedCartLineView[];
  subtotal: number;
  shipping: number;
  total: number;
  /** 距免運門檻差額(= FREE_SHIPPING_THRESHOLD − subtotal;shipping>0 時顯示用) */
  freeShipRemaining: number;
};

/**
 * line map key:JSON.stringify([productId, variantId|null])。純 ASCII、零分隔符碰撞、無控制字元
 * (避免 16c-3 NUL byte 讓 git 判 binary 的同類問題)。
 */
function lineMapKey(line: { productId: string; variantId?: string }): string {
  return JSON.stringify([line.productId, line.variantId ?? null]);
}

/**
 * 解析目前 cart 內容 → 顯示資料 + 金額(server-resolve、釘 general)。
 *
 * @param method 配送方式(home/store),只影響運費計算、不影響行解析;預設 home。
 */
export function useResolvedCart(method: ShippingMethod = 'home'): UseResolvedCart {
  const { items, isHydrated } = useCart();

  const [resolved, setResolved] = useState<ResolvedCartLine[]>([]);
  // resolved 對應的行集合簽章;!== lineSignature 表示 resolve 尚未跟上(顯載入態)。初值 null 永不等真實簽章。
  const [resolvedSignature, setResolvedSignature] = useState<string | null>(null);

  // 行集合簽章:只在行集合(productId+variantId)變動時改;qty 變動不改(單價與 qty 無關)。
  const lineSignature = useMemo(
    () => items.map((it) => lineMapKey(it)).sort().join('|'),
    [items],
  );

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
        setResolvedSignature(lineSignature);
      })
      .catch(() => {
        if (!active || seq !== resolveSeq.current) return;
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

  const lines = useMemo(
    () =>
      items
        .map((item: CartItem) => {
          const r = resolvedMap.get(lineMapKey(item));
          if (!r || !r.found) return null;
          return { item, resolved: r, lineTotal: r.unitPrice * item.qty };
        })
        .filter((x): x is ResolvedCartLineView => x !== null),
    [items, resolvedMap],
  );

  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const shipping = calculateShippingFee({ amount: toMoneyAmount(subtotal), currency: 'TWD' }, method).amount;
  const total = subtotal + shipping;
  const freeShipRemaining = FREE_SHIPPING_THRESHOLD - subtotal;

  const status: 'loading' | 'empty' | 'ready' = !isHydrated
    ? 'loading'
    : items.length === 0
      ? 'empty'
      : resolvedSignature !== lineSignature
        ? 'loading'
        : lines.length === 0
          ? 'empty'
          : 'ready';

  return { status, lines, subtotal, shipping, total, freeShipRemaining };
}
