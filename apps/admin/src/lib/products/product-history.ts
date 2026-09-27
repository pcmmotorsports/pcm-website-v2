import type { AdminAuditLogRow } from '../audit/types';
import type { StaffActor } from '../staff';
import { formatAuditAction, formatAuditActorSnapshot } from '../audit/audit-list-view';
import { formatAuditFieldValue } from '../audit/audit-field-label';
import { formatOrderDateTime } from '../orders/order-detail-view';

// product-history.ts — 商品頁「最近的變更」的顯示層(商品編輯計畫片 9;Sean 2026-09-27 C4 甲:全員可改、留變更紀錄)。
// 資料 = admin_audit_log 裡這件商品的兩種動作,由 `getAdminAuditLogReader().listForTarget` 讀。
// 版面照設計稿(~/pcm-mailbox/設計稿-商品編輯-基本資料-20260927.html「最近的變更」):時間 / 誰 / 欄位 / 原本 / 改成。
// 🔴 純函式、不 import server-only(同 `audit-list-view.ts` 的分層理由)⇒ 單測載得起來。

/** 兩支寫入 RPC 的 action 字面:20260819040000(上下架)、20260927060000(標題 / 副標 / 賣點)。 */
export const PRODUCT_HISTORY_ACTIONS = ['product.override.change', 'product.listing.change'] as const;
/** 商品頁一次列幾筆(設計稿只列最近的;要看更舊的去「操作紀錄」)。 */
export const PRODUCT_HISTORY_LIMIT = 20;

/** 兩支 RPC 都寫 `'product:' || id`。 */
export function productHistoryTarget(productId: string): string {
  return `product:${productId}`;
}

export interface ProductHistoryRow {
  readonly id: string;
  readonly at: string;
  readonly actor: string;
  readonly field: string;
  readonly from: string;
  readonly to: string;
}

/** 「沒有我們的版本」= 網站顯示供應商的(RPC 寫 value = null)。 */
const SUPPLIER = '(用供應商的)';
const UNKNOWN_SHAPE = '格式不同，請到「操作紀錄」查看';

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function overrideValue(v: unknown): string | null {
  if (v === null || v === undefined) return SUPPLIER;
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v.join('\n');
  return null;
}

function listing(v: Record<string, unknown>): string | null {
  if (!('delisted_at' in v)) return null;
  return v.delisted_at === null ? '上架中' : '已下架';
}

function describe(row: AdminAuditLogRow): Pick<ProductHistoryRow, 'field' | 'from' | 'to'> {
  const before = obj(row.before);
  const after = obj(row.after);
  if (row.action === 'product.override.change' && before && after && typeof after.field === 'string') {
    const from = overrideValue(before.value);
    const to = overrideValue(after.value);
    if (from !== null && to !== null) return { field: formatAuditFieldValue('field', after.field), from, to };
  }
  if (row.action === 'product.listing.change' && before && after) {
    const from = listing(before);
    const to = listing(after);
    if (from !== null && to !== null) return { field: '上架狀態', from, to };
  }
  // 不認得的形狀不猜內容,只講動作名稱,請員工去看完整紀錄
  return { field: formatAuditAction(row.action), from: '—', to: UNKNOWN_SHAPE };
}

/** 稽核原始列(最近在前)⇒ 畫面列。誰 = 寫入當下的名字快照(同「操作紀錄」頁)。 */
export function toProductHistoryRows(
  rows: readonly AdminAuditLogRow[],
  staff: readonly StaffActor[],
): ProductHistoryRow[] {
  return rows.map((row) => ({
    id: row.id,
    at: formatOrderDateTime(row.created_at),
    actor: formatAuditActorSnapshot(staff, row),
    ...describe(row),
  }));
}
