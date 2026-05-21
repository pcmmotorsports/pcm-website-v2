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
// localStorage key:`pcm-cart-mock-v1`(v1 標示 schema version、未來 schema 改了 bump v2 + migration logic)
//
// Identity / line key 設計(對齊 Codex M-1-13e-b review P1 + P2):
// - productId 用 string(對齊 domain ProductId / Supabase uuid;mock 路徑傳 product.slug、stable + URL friendly)
// - addItem / removeItem / updateQty 統一用 { productId, color, size } 作 line key(防 variant 誤殺)
//
// qty guard(Codex review 小風險):readStorage / addItem / updateQty 三入口統一過 Number.isInteger + clamp [1, MAX_QTY]
//
// 鐵則對齊:
// - 鐵則 9 L1 標記(API 結構穩定、M-3 swap 實作不動介面)
// - 鐵則 6:本檔目標 <200 行
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

const STORAGE_KEY = 'pcm-cart-mock-v1';
const MAX_QTY = 99;

export type CartLineKey = {
  productId: string;
  color?: string;
  size?: string | null;
};

export type CartItem = CartLineKey & {
  qty: number;
};

export type CartContextValue = {
  items: CartItem[];
  totalQty: number;
  isHydrated: boolean;
  addItem: (item: CartItem) => void;
  removeItem: (key: CartLineKey) => void;
  updateQty: (key: CartLineKey, qty: number) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

function sameLine(a: CartLineKey, b: CartLineKey): boolean {
  return a.productId === b.productId && a.color === b.color && a.size === b.size;
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
      const color = typeof x.color === 'string' ? x.color : undefined;
      const size = typeof x.size === 'string' || x.size === null ? x.size : undefined;
      out.push({ productId: x.productId, qty, color, size });
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

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setItems(readStorage());
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (isHydrated) writeStorage(items);
  }, [items, isHydrated]);

  const addItem = useCallback((item: CartItem) => {
    const safeQty = clampQty(item.qty);
    if (safeQty < 1) return;
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

  const totalQty = useMemo(
    () => items.reduce((sum, item) => sum + item.qty, 0),
    [items]
  );

  const value = useMemo<CartContextValue>(
    () => ({ items, totalQty, isHydrated, addItem, removeItem, updateQty, clear }),
    [items, totalQty, isHydrated, addItem, removeItem, updateQty, clear]
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
