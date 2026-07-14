// workflow-form.ts — 後台改單 server action 的純函式核心(M-4a Slice C;可單測、無 'use server'/next 依賴)。
// authz(session/Origin)在 action 檔;本檔只做「Origin 白名單判斷」+「表單 → domain patch 解析」的
// 形狀層(語意 fail-closed 權威在 admin_update_order_workflow RPC,此處輕驗 + 縱深)。

import type { AdminOrderWorkflowPatch, InvoiceStatus } from '@pcm/domain';

// ── 表單欄名(list inline 小 form 與明細頁表單共用)──
export const ORDER_ID_FIELD = 'order_id';
export const VERSION_FIELD = 'version';
export const RETURN_TO_FIELD = 'return_to';
export const WF_STATUS_FIELD = 'workflow_status';
export const SHIPPING_METHOD_FIELD = 'shipping_method';
export const INVOICE_NUMBER_FIELD = 'invoice_number';
export const INVOICE_AMOUNT_FIELD = 'invoice_amount';
export const INVOICE_STATUS_FIELD = 'invoice_status';

/** 「清空 workflow_status」的下拉哨兵值(明確清空 vs 未動;'unset' 是篩選哨兵、此處另用避免混淆)。 */
export const WF_CLEAR_VALUE = '__clear__';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WF_CODE_RE = /^[a-z0-9_]{1,64}$/;

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
 *   · workflow_status:`__clear__` 哨兵 → null(清空);合法 code → 設定;空/非法形狀 → 忽略該欄(不放);
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

  if (form.has(WF_STATUS_FIELD)) {
    const raw = asString(form.get(WF_STATUS_FIELD));
    if (raw === WF_CLEAR_VALUE) {
      patch.workflowStatus = null;
    } else if (raw === '' || raw === null) {
      // 空=不動該欄(不放進 patch)。
    } else if (WF_CODE_RE.test(raw)) {
      patch.workflowStatus = raw;
    } else {
      return { ok: false }; // 非法形狀=拒(不靜默丟成空 patch → 誤顯示「無變更」;Fable nit-4)
    }
  }

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

  // return_to:站內 /orders 路徑;拒 `..`(防 /orders/../../api/sso/start 站內 redirect gadget、Fable nit-6)
  // 與 open redirect(離站已由 regex 起始 /orders 擋)。
  const returnRaw = asString(form.get(RETURN_TO_FIELD));
  const returnTo =
    returnRaw && !returnRaw.includes('..') && /^\/orders(\/[^\s]*)?(\?[^\s]*)?$/.test(returnRaw)
      ? returnRaw
      : '/orders';

  return { ok: true, orderId, expectedVersion, patch, returnTo };
}
