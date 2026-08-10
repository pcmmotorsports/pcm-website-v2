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
// 🔴 自我修復(#375 / #343,2026-08-10):resolve **成功**回來時,server 明確判定 found:false 的行
//   當場 removeItem 掉 —— 那些行渲染不出來、客人刪不掉,留著只會讓 Header 角標永遠多算。
//   移除只寫在 `.then()` 內(形狀即護欄,理由與突變靶見該處註解);`.catch()` 一行都不刪。
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
 * 🔴 **模組層**(跨 hook 實例)最新解析序號 —— 只決定「誰有資格動客人的購物車」,不碰顯示。
 *
 * 為什麼需要跨實例:`resolveSeq` 是 `useRef`,**每個 hook 實例一份**。本 hook 有兩個呼叫端
 * (`CartView` 與 `CheckoutView`),路由切換的過渡窗口裡兩者可能同時掛著。此時 H1 的**較舊**
 * 回應即使已被 H2 的較新回應推翻,仍能通過 H1 自己那把 `resolveSeq` 守衛 —— 於是「server 一度
 * 回 found:false、隨即回 found:true」的行會被 H1 刪掉 = **刪到客人還要的東西**(codex 關卡2 抓到)。
 *
 * 修法:移除決策改看這個模組層序號,**只有全 app 最新那次解析有資格刪**。
 * 失效方向是安全的:實例卸載或序號被別人推進 ⇒ 這次不刪(下一次解析會補上),**絕不會多刪**。
 */
let latestHealSeq = 0;

/**
 * 解析目前 cart 內容 → 顯示資料 + 金額(server-resolve、釘 general)。
 *
 * @param method 配送方式(home/store),只影響運費計算、不影響行解析;預設 home。
 */
export function useResolvedCart(method: ShippingMethod = 'home'): UseResolvedCart {
  const { items, isHydrated, removeItem } = useCart();

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
    const healSeq = ++latestHealSeq; // 跨實例:只有全 app 最新那次解析有資格動 cart(見上方 latestHealSeq)
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
        // 🔴 #375 / #343 自我修復:server **對該行明確判定** found:false → 當場從 cart 移除。
        //
        //   為什麼要修:角標數的是 raw items(`CartContext.tsx:298-301` → `Header.tsx:170,219`),
        //   購物車頁與結帳頁數的是過濾後的行(下方 `!r.found → null`)⇒ 幽靈行渲染不出來
        //   ⇒ 客人沒有那一列可以按刪除(`CartView.tsx` 全檔無「清空購物車」)⇒ 它永遠留在
        //   localStorage、角標永遠多算它。Sean 2026-08-10 正式站實測:刪光 3 項再加 1 項、角標仍 3。
        //
        // 🔴 **形狀即護欄 —— 這段字面上只存在於 `.then()` 裡。**
        //   下面的 `.catch()` 會把 resolved 清成 `[]`,那一刻**每一行都長得像幽靈行**;
        //   若把移除搬到 effect 外層或改成「不在 lines 裡就刪」,一次網路抖動就會清光客人整車。
        //   寫在成功分支內 ⇒「catch 不刪」不是靠條件判斷、是**結構上做不到**。
        //   ⚠️ 任何把這段搬出 `.then()` 的改動都是回歸,不是重構(負向測試 + 突變靶釘住)。
        //
        //   只認 `=== false`(不是 `!l.found`):`found` 今天是必填 boolean,但若哪天變成
        //   optional,`!l.found` 會把 undefined 也當成「該刪」= 往刪光的方向壞;`=== false` 往留著的方向壞。
        //   同理 `actions.ts:102-119` 的畸形行是 `continue`、**根本不產生 row** ⇒ 這裡看不到、不刪。
        //   ⇒ B 案不保證清乾淨每一種幽靈行,只清 server 明講 false 的那三種(`actions.ts:127/151/174`)。
        //
        //   📌 **本片不覆蓋的一種**(R1 審查記錄,刻意不修):server 對 productId / variantId 做了
        //   trim(`actions.ts:105,115-118`),而 cart 這側 `lineMapKey` 不 trim ⇒ 值帶空白的行
        //   會 key 對不上,removeItem 靜默 no-op、該行既刪不掉也顯示不出來。方向是安全的
        //   (不會誤刪),而且三個 `addItem` 呼叫端都查過、找不到產生帶空白值的路徑 ⇒ 不在本片修。
        //
        //   removeItem 是 provider 內 `useCallback([], …)` 的穩定參照,不進 deps(見下方 eslint-disable)。
        //   🔴 跨實例守衛(codex 關卡2 MF-A):`resolveSeq` 只管得住自己這個實例。
        //   CartView 與 CheckoutView 在路由過渡時可能同時掛著 ⇒ 較舊實例的過期 found:false
        //   仍能通過它自己那把守衛、把已經被較新解析翻回 found:true 的行刪掉。
        //   ⇒ 動 cart 前多過一道**模組層**最新序號;不是最新的就不刪(顯示不受影響)。
        if (healSeq === latestHealSeq) {
          for (const l of lines) {
            if (l.found === false) removeItem({ productId: l.productId, variantId: l.variantId });
          }
        }
      })
      .catch(() => {
        if (!active || seq !== resolveSeq.current) return;
        setResolved([]);
        setResolvedSignature(lineSignature);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 以 lineSignature 為穩定觸發鍵(items 每 render 新參照、qty 變動不該 re-resolve);isHydrated 觸發首解析;removeItem 是 provider 的 useCallback([]) 穩定參照(CartContext.tsx:254)、進 deps 只會製造無謂重解析
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
