// workflow-form.ts — 後台改單 server action 的純函式核心(M-4a Slice C;可單測、無 'use server'/next 依賴)。
// authz(session/Origin)在 action 檔;本檔只做「Origin 白名單判斷」+「表單 → domain patch 解析」的
// 形狀層(語意 fail-closed 權威在 admin_update_order_workflow RPC,此處輕驗 + 縱深)。

import type { AdminOrderWorkflowPatch, InvoiceStatus } from '@pcm/domain';
// #350d:`return_to` 的守門集中在 order 域共用解析器(五支 action 的 choke point)。
import { ORDER_RETURN_TO_FIELD, parseOrderReturnTo } from './order-return-to';

// ── 表單欄名(list inline 小 form 與明細頁表單共用)──
export const ORDER_ID_FIELD = 'order_id';
export const VERSION_FIELD = 'version';
// #350d-2:欄名的定義搬到 `order-return-to.ts`(order 域五支表單共用一顆);這裡 re-export
// 讓既有 import 路徑不變。兩邊各打一次字面 = 打錯的那一支靜默走 fallback、面板被關掉。
export { ORDER_RETURN_TO_FIELD as RETURN_TO_FIELD } from './order-return-to';
export const SHIPPING_METHOD_FIELD = 'shipping_method';
export const INVOICE_NUMBER_FIELD = 'invoice_number';
export const INVOICE_AMOUNT_FIELD = 'invoice_amount';
export const INVOICE_STATUS_FIELD = 'invoice_status';

// 🔴 **九碼詞彙面四常數已於 A9w4c 後半(2026-08-06)一併移除**(plan §4 裁定):
//    `ITEM_ID_FIELD` / `WF_STATUS_FIELD` / `WF_CLEAR_VALUE` / `WF_RECEIVED_UNCONFIRMED`。
//    最後的 consumer(`workflow-select-options.ts`、`workflow-status-select.tsx`)同片刪除。
//    ⚠️ order 層那條「送 `workflow_status` 一律忽略」的**負向守門測試仍在**、只是改用 wire literal
//    `'workflow_status'` / `'__clear__'` —— 欄名是 **wire 契約**、不是 TS 常數,而且
//    `nine-code-retire.test.tsx` 早有「常數名不是欄名」被 R1 抓過的先例,literal 反而更誠實。

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
  /**
   * #365:單值欄位一律走「`getAll()` 恰一筆」(見 `lib/forms/single-value.ts`)。
   * ⚠️ 本檔自己的呼叫點**還沒轉**(#365 片②的範圍);型別先補是因為共用本型別的
   *    `wallet-form` / `tier-form` 在片①已經轉了。
   */
  getAll(name: string): FormDataEntryValue[];
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
  // 🔴 A9w4a 拆了 item 層 parser、**A9w4c 後半又拆了 port/adapter 方法** ⇒ **admin 應用層與 adapter
  // 都已無任何 workflow_status 寫入面**。⚠️ 但**不是**「九碼寫不進去」:DB 端
  // `admin_update_order_item_workflow` RPC 仍在(**REVOKE 非 DROP**);其 EXECUTE 權由
  // **A9v `20260807120000`** 撤除、**apply 後 service_role 叫不動**;orders.workflow_status=停寫欄。

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

  // 🔴 #350d:`return_to` 的守門搬到 `order-return-to.ts`(order 域五支 action 的共同 choke point);
  //    本檔原本那份正規式版本**已刪除**,不是留著沒人用 —— 兩份會漂移,而漂移的症狀
  //    (某一支沒剝掉 `rt` ⇒ 重複鍵 ⇒ 取消面板永遠讀不到)在畫面上看不出是哪一支造成的。
  //    ⚠️ **fallback 從 `/orders` 改成 `/orders/{orderId}`**(契約 §3 逐字):非法的 `return_to`
  //    不該把正在看這張單的員工踢回列表;`orderId` 在上面已經過 uuid 閘,拼進去是安全的。
  return {
    ok: true,
    orderId,
    expectedVersion,
    patch,
    returnTo: parseOrderReturnTo(form.get(ORDER_RETURN_TO_FIELD), orderId),
  };
}

// ── per-item 改狀態表單:🔴 **A9w4a(2026-08-06)已具名移除** ────────────────────────────
// `parseItemWorkflowForm` / `ItemParseResult` / `WF_CODE_RE`(該 parser 的唯一 consumer)
// 隨 `updateOrderItemWorkflowAction` 一併刪除,母 plan row 53 逐字「server action 與 form parser」。
// 本檔自此**只剩 order 層 parse**(`parseWorkflowPatchForm`)+ 表單欄名常數 + `isAllowedOrigin`。
