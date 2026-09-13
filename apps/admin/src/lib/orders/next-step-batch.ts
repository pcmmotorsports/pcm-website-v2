// next-step-batch.ts — 「下一步」彈窗**一張表單多列一次送**的純函式層(B9-b,2026-09-14,主視窗裁:Sean「一次做到完畢」)。
//
// 🔴 **零 runtime import、client 與 server 都 import 得到**:欄位命名 / 拆列 / 型別住這裡,
//    寫入在 `next-step-batch-actions.ts`('use server'),畫面在 `components/orders/next-step-batch-form.tsx`。
// 🔴 一列的欄位 = 現在那份單列表單的欄位**原樣**,只是名字前面掛 `r.<rowId>.`;server 端拆回每列一份 FormData
//    再交給**既有的**單列 action(`upsertItemProcurementAction` / `recordItemReceiptAction`,inline 模式)。
//    ⇒ 解析器 / 授權閘 / 歸屬閘 / RPC / 稽核 一個字不動,零新 RPC、零第二條寫入路。
// 🔴 **不整批回滾**:RPC 各自一交易,成功的列已經寫進去;失敗的列留著印原因。畫面要把這句講明。

export const BATCH_KIND_FIELD = 'batch_kind';
export const BATCH_KINDS = ['order', 'receipt'] as const;
export type BatchKind = (typeof BATCH_KINDS)[number];
/** 一發最多幾列(主視窗裁:10 張單 / 50 列)。超過 ⇒ 整批 invalid、一列都不寫。 */
export const BATCH_ROWS_MAX = 50;
const ROW_PREFIX = 'r.';

/** 列 id 只認這個形狀(uuid;procurement id / order_item id)—— 名字裡有 `.` 的話拆不出來。 */
const ROW_ID_RE = /^[0-9a-f-]{36}$/;

/** `r.<rowId>.<field>`。 */
export function batchFieldName(rowId: string, field: string): string {
  return `${ROW_PREFIX}${rowId}.${field}`;
}

/**
 * 整張表單 → 每列一份 FormData(去掉前綴;列依第一次出現的順序)。
 * 不帶前綴的欄位(`batch_kind` 等)不進任何一列。列 id 形狀不對的欄位丟掉(不讓它變成一列)。
 */
export function splitBatchRows(formData: FormData): Map<string, FormData> {
  const rows = new Map<string, FormData>();
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith(ROW_PREFIX)) continue;
    const rest = name.slice(ROW_PREFIX.length);
    const dot = rest.indexOf('.');
    if (dot <= 0) continue;
    const rowId = rest.slice(0, dot);
    const field = rest.slice(dot + 1);
    if (!ROW_ID_RE.test(rowId) || field === '') continue;
    let row = rows.get(rowId);
    if (row === undefined) {
      row = new FormData();
      rows.set(rowId, row);
    }
    row.append(field, value);
  }
  return rows;
}

export type BatchRowOutcome = { ok: true; text: string } | { ok: false; message: string };

export type BatchActionState =
  | { status: 'idle' }
  /** 整批沒送:沒權限 / 表單形狀不對 / 超過上限。一列都沒寫。 */
  | { status: 'rejected'; message: string }
  /** 逐列跑完(不整批回滾)。`rows` 以列 id 為鍵。`halted` = 中途有一列被拒(登入過期),後面的列沒跑。 */
  | { status: 'done'; rows: Record<string, BatchRowOutcome>; okCount: number; failCount: number; halted: boolean };
