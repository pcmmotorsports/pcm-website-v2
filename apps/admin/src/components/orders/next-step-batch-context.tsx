'use client';

import { createContext, useContext } from 'react';
import type { BatchKind, BatchRowOutcome } from '../../lib/orders/next-step-batch';

// next-step-batch-context.tsx — 批次表單 ↔ 列 之間的 context(B9-b)。
// 🔴 獨立成檔、**零 action import**:列元件(`item-procurement-form` / `receipt-record-form`)只 import 這支,
//    不會把 `next-step-batch-actions`('use server' → server-only)拖進它們的 import 圖(vitest 沒有 server/client 之分,
//    拖進去會讓所有渲染那兩支表單的測試整檔載入即炸)。外殼 `next-step-batch-form.tsx` 才 import action。

export const PROC_SUBMITTED_AT_ORIGINAL_FIELD = 'submitted_at_original';

export type BatchCtx = {
  kind: BatchKind;
  pending: boolean;
  outcomeOf: (rowId: string) => BatchRowOutcome | null;
};

export const BatchRowContext = createContext<BatchCtx | null>(null);

/** 列用:不在批次表單裡 ⇒ `null`(單列模式,原樣)。 */
export function useBatchRow(): BatchCtx | null {
  return useContext(BatchRowContext);
}
