// workflow-form.ts — 後台改單 server action 的純函式核心(M-4a Slice C;可單測、無 'use server'/next 依賴)。
// authz(session/Origin)在 action 檔;本檔只做「Origin 白名單判斷」+「表單 → domain patch 解析」的
// 形狀層(語意 fail-closed 權威在 admin_update_order_workflow RPC,此處輕驗 + 縱深)。

import type { AdminOrderWorkflowPatch, InvoiceStatus } from '@pcm/domain';

// ── 表單欄名(list inline 小 form 與明細頁表單共用)──
export const ORDER_ID_FIELD = 'order_id';
// 🔴 A9w4a 後 `ITEM_ID_FIELD` 已零 consumer(唯一 production 使用者 `item-workflow-status-cell.tsx`
// 與測試側 `workflow-form.test.ts` 的 item 那組 import 皆同片刪除)。
// **不是無主死碼** —— 它與 `WF_STATUS_FIELD`/`WF_CLEAR_VALUE`/`WF_RECEIVED_UNCONFIRMED` 同屬
// 九碼詞彙面,plan `2026-08-06-e10-a11a-list-rebuild-plan.md` §4 裁定一併歸 **A9w4c 後半**收。
export const ITEM_ID_FIELD = 'item_id'; // M-4a D-2:per-item 改狀態表單 target
export const VERSION_FIELD = 'version';
export const RETURN_TO_FIELD = 'return_to';
export const WF_STATUS_FIELD = 'workflow_status';
export const SHIPPING_METHOD_FIELD = 'shipping_method';
export const INVOICE_NUMBER_FIELD = 'invoice_number';
export const INVOICE_AMOUNT_FIELD = 'invoice_amount';
export const INVOICE_STATUS_FIELD = 'invoice_status';

/** 「清空 workflow_status」的下拉哨兵值(明確清空 vs 未動;'unset' 是篩選哨兵、此處另用避免混淆)。 */
export const WF_CLEAR_VALUE = '__clear__';

/**
 * paid 且尚未設定狀態時,下拉預選的預設狀態 code(Sean 2026-07-24 已收未定 A 案 Q3=A)。
 * 🔴 純顯示層預設:DB 仍為 null,operator 按「存」才真正寫入(不自動落庫)。
 * 對應 seed 2×4 矩陣 paid×notOrdered → 已收未定(design §6.1)。
 */
export const WF_RECEIVED_UNCONFIRMED = 'received_unconfirmed';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Origin 白名單(must-fix 3 fail-closed):
 * - 缺 Origin(null/空)→ **拒**(不放行);
 * - prod:精確等值 `https://admin.pcmmotorsports.com`(不比 Host、不 suffix match);
 * - dev(devBypass=true):額外允許 localhost origin(http://localhost:*、http://127.0.0.1:*)。
 */
export function isAllowedOrigin(
  origin: string | null | undefined,
  opts: { devBypass: boolean },
): boolean {
  if (typeof origin !== 'string' || origin === '') return false;
  if (origin === 'https://admin.pcmmotorsports.com') return true;
  if (opts.devBypass && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
}

/** 表單讀取的最小介面(FormData 相容;單測用 Map 亦可)。 */
export interface FormLike {
  get(name: string): FormDataEntryValue | null;
  has(name: string): boolean;
}

export type ParseResult =
  | {
      ok: true;
      orderId: string;
      expectedVersion: number;
      patch: AdminOrderWorkflowPatch;
      returnTo: string;
    }
  | { ok: false };

function asString(v: FormDataEntryValue | null): string | null {
  return typeof v === 'string' ? v : null;
}

/**
 * 表單 → { orderId, expectedVersion, patch }(形狀層;語意 fail-closed 在 RPC):
 * - order_id 須 UUID、version 須 1..2147483646 整數,否則 ok:false;
 * - patch 欄「未提供(表單無此欄)」= 不放進 patch(RPC 不動該欄);「提供」則按下列規則:
 *   · workflow_status:**D-2 起一律忽略**(orders 層停寫;A9w4a 後 item 層 parser 亦已移除);
 *   · shipping_method:非空 → 設定(RPC 再驗長度);空 → ok:false(NOT NULL、UI 不該送空);
 *   · invoice_number:空 → null(清空);非空 → 設定;
 *   · invoice_amount:空 → null(清空);非空且為十進位整數 → 設定;非整數 → ok:false;
 *   · invoice_status:三值之一 → 設定;否則 ok:false。
 * - return_to:只接受站內絕對路徑 `/orders...`(防 open redirect);否則退 '/orders'。
 */
export function parseWorkflowPatchForm(form: FormLike): ParseResult {
  const orderId = asString(form.get(ORDER_ID_FIELD));
  if (!orderId || !UUID_RE.test(orderId)) return { ok: false };

  const versionRaw = asString(form.get(VERSION_FIELD));
  if (!versionRaw || !/^\d{1,10}$/.test(versionRaw)) return { ok: false };
  const expectedVersion = Number(versionRaw);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1 || expectedVersion > 2147483646) {
    return { ok: false };
  }

  const patch: AdminOrderWorkflowPatch = {};

  // 🔴 D-2(Codex R1 must-fix 1):order 層 workflow_status **寫入路徑關死** —— 本 parser 不再讀
  // WF_STATUS_FIELD(手工 POST 加該欄=一律忽略、不進 patch),AdminOrderWorkflowPatch 型別已無
  // workflowStatus、adapter 亦不映射 → admin server 無任何路徑把該 key 送進舊 RPC。
  // 🔴 A9w4a 後連 item 層 parser 也移除 ⇒ **admin 應用層已無任何 workflow_status 表單解析面**
  // (殘留的 port/adapter 方法歸 A9w4c 後半、DB 端 RPC EXECUTE 歸 A9v);orders.workflow_status=停寫欄。

  if (form.has(SHIPPING_METHOD_FIELD)) {
    const raw = (asString(form.get(SHIPPING_METHOD_FIELD)) ?? '').trim();
    if (raw === '') return { ok: false }; // NOT NULL
    patch.shippingMethod = raw;
  }

  if (form.has(INVOICE_NUMBER_FIELD)) {
    const raw = (asString(form.get(INVOICE_NUMBER_FIELD)) ?? '').trim();
    patch.invoiceNumber = raw === '' ? null : raw;
  }

  if (form.has(INVOICE_AMOUNT_FIELD)) {
    const raw = (asString(form.get(INVOICE_AMOUNT_FIELD)) ?? '').trim();
    if (raw === '') {
      patch.invoiceAmount = null;
    } else if (/^\d{1,10}$/.test(raw) && Number(raw) <= 2147483647) {
      patch.invoiceAmount = Number(raw); // form 層加 int4 上限(Fable nit-5;避免 10 位溢位走 error 而非 invalid)
    } else {
      return { ok: false }; // 非十進位整數 / 溢位 / 小數 / 負號 / 千分位
    }
  }

  if (form.has(INVOICE_STATUS_FIELD)) {
    const raw = asString(form.get(INVOICE_STATUS_FIELD));
    if (raw !== 'not_issued' && raw !== 'issued' && raw !== 'voided') return { ok: false };
    patch.invoiceStatus = raw as InvoiceStatus;
  }

  return { ok: true, orderId, expectedVersion, patch, returnTo: parseReturnTo(form) };
}

/**
 * return_to:站內 /orders 路徑;拒 `..`(防 /orders/../../api/sso/start 站內 redirect gadget、Fable nit-6)
 * 與 open redirect(離站已由 regex 起始 /orders 擋);非法 → 退 '/orders'。order/item 兩表單共用。
 */
function parseReturnTo(form: FormLike): string {
  const returnRaw = asString(form.get(RETURN_TO_FIELD));
  return returnRaw && !returnRaw.includes('..') && /^\/orders(\/[^\s]*)?(\?[^\s]*)?$/.test(returnRaw)
    ? returnRaw
    : '/orders';
}

// ── per-item 改狀態表單:🔴 **A9w4a(2026-08-06)已具名移除** ────────────────────────────
// `parseItemWorkflowForm` / `ItemParseResult` / `WF_CODE_RE`(該 parser 的唯一 consumer)
// 隨 `updateOrderItemWorkflowAction` 一併刪除,母 plan row 53 逐字「server action 與 form parser」。
// 本檔自此**只剩 order 層 parse**(`parseWorkflowPatchForm`)+ 表單欄名常數 + `isAllowedOrigin`。
