// CartContext.tsx — Phase 1 client-side cart state(localStorage mock、無後端、對齊 NORTHSTAR Phase 1 M-3 結帳前的 stub 範圍)
//
// 範圍 / 不範圍:
// - 本 Provider 只管「客人手上提籃」型 cart state(items / addItem / removeItem / updateQty / clear)
// - 真實結帳 / order / payment 是 M-3 範圍、不在本 slice
// - 無後端 API、無 syncEngine、無 server validation;經銷價驗證等鐵則「server 端鐵則」仍由 server route handler 守(本 Provider 不碰)
// - M-3 接真後端時、本 Provider 內部從 localStorage 換 API、useCart() 介面不變、調用端零修改
//
// SSR / hydration 安全:
// - Next.js SSR 階段 window/localStorage 不存在、initial state 永遠空陣列 []
// - 由 useEffect 在 client mount 後 hydrate from localStorage、避免 hydration mismatch
// - isHydrated flag 標示「是否已從 localStorage 載入」、UI 可選擇是否在 hydrate 前顯示 0
//
// localStorage key:`pcm-cart-mock-v2`(M-3-S2-b2-c 線契約改 variant_id → bump v1→v2;
//   舊 v1 sku-塞-color hack 資料隨 key-bump 自然失效〔v2 不讀 v1 key、production 等同丟棄〕;
//   readStorage 另對殘留 color/size 欄寬容忽略〔不解析為 variantId、合法 productId 行收為無變體〕。
//   不可靠反推〔color=sku 非 variant uuid〕+ Phase 1 localStorage mock cart〔無真結帳/金額/訂單、
//   丟棄成本=用戶重加幾筆〕→ 不寫 v1→v2 migration)
//
// Identity / line key 設計(M-3-S2-b2-c 改 variant_id 線契約;取代 M-1-13e-b 的 color=sku 權宜 hack):
// - productId 用 string(對齊 domain ProductId / Supabase uuid;mock 路徑傳 product.slug、stable + URL friendly)
// - addItem / removeItem / updateQty 統一用 { productId, variantId } 作 line key:variantId=變體 uuid
//   (= UIVariant.id、建單 RPC create_order 的 variant_id 來源);無變體商品 variantId undefined、退回 productId 當鍵
//   (防同商品不同變體誤殺;🔴 線上只存 variant_id + qty、**不存價**、價由 server 依 tier 取〔鐵則 12〕)
//
// qty guard(Codex review 小風險):readStorage / addItem / updateQty 三入口統一過 Number.isInteger + clamp [1, MAX_QTY]
//
// cart_session_id(M-3 3DS-7 冪等治本、plan §3 7a):購物車生命週期穩定的 idempotency key(uuid)、獨立
//   localStorage key `pcm-cart-session-v1`(與品項 key 分開、不動既有序列化契約);空車首件生、跨重結帳穩定、
//   成交換新(regenerateCartSession)。非價/tier/身分純去重子(鐵則 12 正交);7a 只持有 key、不送 server。
//   🔴 hydration:持久化 gate isHydrated、mount 讀用 `prev ?? stored`(不覆寫 pre-hydrate 已生成的 key、防
//   hydrate-race 覆寫回舊 key;對齊 ClearCartOnSuccess codex must-fix)。7b 送 server + 僅「DB 確定 paid」換新。
//
// 鐵則對齊:
// - 鐵則 9 L1 標記(API 結構穩定、M-3 swap 實作不動介面)
// - 鐵則 6:本檔 <300 軟警戒內(7a 加 cartSessionId state + 持久化、~230 行)
// - server 端鐵則「會員與價格」:本 Provider 不存價格(只存 productId + qty + color / size 規格)、價格永遠由 server 端 resolve

'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

const STORAGE_KEY = 'pcm-cart-mock-v2';
const SESSION_KEY = 'pcm-cart-session-v1'; // 3DS-7 cart-instance idempotency key(獨立、與品項 key 分開)
const MAX_QTY = 99;

export type CartLineKey = {
  productId: string;
  /** 變體 uuid(= UIVariant.id、建單 RPC create_order 的 variant_id 來源);無變體商品 undefined、退回 productId 當鍵 */
  variantId?: string;
};

export type CartItem = CartLineKey & {
  qty: number;
};

export type CartContextValue = {
  items: CartItem[];
  totalQty: number;
  isHydrated: boolean;
  /** 3DS-7 cart-instance idempotency key(uuid);空車首件生、成交換新;hydrate 前 null。非價/tier/身分。 */
  cartSessionId: string | null;
  addItem: (item: CartItem) => void;
  removeItem: (key: CartLineKey) => void;
  updateQty: (key: CartLineKey, qty: number) => void;
  clear: () => void;
  /** 成交後換新 key(7b 僅在「DB 確定 paid」呼;模糊態保留 key=dedup 防雙扣把手)。 */
  regenerateCartSession: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

function sameLine(a: CartLineKey, b: CartLineKey): boolean {
  // 變體 uuid 為主 discriminator;無變體商品(variantId undefined)退回 productId(undefined===undefined 同行)。
  return a.productId === b.productId && a.variantId === b.variantId;
}

function clampQty(qty: unknown): number {
  if (typeof qty !== 'number' || !Number.isFinite(qty)) return 0;
  const floored = Math.floor(qty);
  if (floored < 1) return 0;
  return Math.min(floored, MAX_QTY);
}

function readStorage(): CartItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: CartItem[] = [];
    for (const x of parsed) {
      if (!x || typeof x !== 'object') continue;
      if (typeof x.productId !== 'string' || x.productId.length === 0) continue;
      const qty = clampQty(x.qty);
      if (qty < 1) continue;
      // v2:只認 variantId(string 非空 → 帶、否則無變體 undefined);舊 v1 的 color/size 不解析、自然丟棄。
      const variantId =
        typeof x.variantId === 'string' && x.variantId.length > 0 ? x.variantId : undefined;
      out.push({ productId: x.productId, qty, variantId });
    }
    return out;
  } catch {
    return [];
  }
}

function writeStorage(items: CartItem[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // localStorage 滿 / 隱私模式 / disabled — 靜默失敗、cart 退化為 session-only
  }
}

function readSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

function writeSessionId(id: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (id) window.localStorage.setItem(SESSION_KEY, id);
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // 同 writeStorage:localStorage 滿 / 隱私模式 → 靜默失敗
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [cartSessionId, setCartSessionId] = useState<string | null>(null);

  useEffect(() => {
    const restored = readStorage();
    const storedSession = readSessionId();
    setItems(restored);
    // 🔴 prev ?? stored ?? 還原車補生:不覆寫 pre-hydrate 已 regenerate/addItem 的 key(hydrate-race 防線);
    //   storedSession 無但有還原品項(7a 前的舊車)→ 補生一把,使既有車也納入去重。
    setCartSessionId(
      (prev) => prev ?? storedSession ?? (restored.length > 0 ? crypto.randomUUID() : null),
    );
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (isHydrated) writeStorage(items);
  }, [items, isHydrated]);

  useEffect(() => {
    if (isHydrated) writeSessionId(cartSessionId);
  }, [cartSessionId, isHydrated]);

  const addItem = useCallback((item: CartItem) => {
    const safeQty = clampQty(item.qty);
    if (safeQty < 1) return;
    setCartSessionId((prev) => prev ?? crypto.randomUUID()); // 空車首件 → 生 key
    setItems((prev) => {
      const idx = prev.findIndex((p) => sameLine(p, item));
      if (idx >= 0) {
        return prev.map((p, i) =>
          i === idx ? { ...p, qty: clampQty(p.qty + safeQty) } : p
        );
      }
      return [...prev, { ...item, qty: safeQty }];
    });
  }, []);

  const removeItem = useCallback((key: CartLineKey) => {
    setItems((prev) => prev.filter((p) => !sameLine(p, key)));
  }, []);

  const updateQty = useCallback((key: CartLineKey, qty: number) => {
    const safeQty = clampQty(qty);
    setItems((prev) => {
      if (safeQty < 1) return prev.filter((p) => !sameLine(p, key));
      return prev.map((p) => (sameLine(p, key) ? { ...p, qty: safeQty } : p));
    });
  }, []);

  const clear = useCallback(() => setItems([]), []);

  // 成交換新 key(7b 僅「DB 確定 paid」呼)。hydrate 前呼也安全:mount 讀用 prev ?? 不覆寫、持久化 gate isHydrated。
  const regenerateCartSession = useCallback(() => setCartSessionId(crypto.randomUUID()), []);

  const totalQty = useMemo(
    () => items.reduce((sum, item) => sum + item.qty, 0),
    [items]
  );

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      totalQty,
      isHydrated,
      cartSessionId,
      addItem,
      removeItem,
      updateQty,
      clear,
      regenerateCartSession,
    }),
    [items, totalQty, isHydrated, cartSessionId, addItem, removeItem, updateQty, clear, regenerateCartSession]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error('useCart must be used within <CartProvider>');
  }
  return ctx;
}
