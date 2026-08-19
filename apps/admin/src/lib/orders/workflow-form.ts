// workflow-form.ts — 後台改單 server action 的純函式核心(M-4a Slice C;可單測、無 'use server'/next 依賴)。
// authz(session/Origin)在 action 檔;本檔只做「Origin 白名單判斷」+「表單 → domain patch 解析」的
// 形狀層(語意 fail-closed 權威在 admin_update_order_workflow RPC,此處輕驗 + 縱深)。

import type { AdminOrderWorkflowPatch, InvoiceStatus } from '@pcm/domain';
// #365 片②:單值欄位的唯一讀法(見 `lib/forms/single-value.ts` 檔頭)。
import {
  type SingleValueFormLike,
  anyMalformed,
  readSingle,
  readSingleString,
} from '../forms/single-value';
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

/**
 * 表單讀取的最小介面 = **共用讀法自己的型別**(`lib/forms/single-value.ts`);
 * 本檔沿用 `FormLike` 這個名字,是因為 `wallet-form` / `tier-form` 從這裡 import 它。
 *
 * 🔴 **`get()` 與 `has()` 已於 #365 片② 具名移除,不是漏掉的**:
 *    · `has()` 分不出「送一份」與「送兩份」(兩者都回 `true`),而那正是本片要修的洞;
 *    · `get()` 取的是**第一筆**,同理。
 *    兩支留在型別上 = 下一個人寫 `if (form.has(x))` 就原地重生同一個洞。三態的 `readSingle`
 *    同時回答「有沒有提供」與「形狀對不對」⇒ 這兩支在本檔與 `wallet`/`tier` 皆已零呼叫端。
 *    ✅ **片③ 已把剩下三個面收完**(`staff-form.ts` / `supplier-form.ts` / `session/actor-actions.ts`)
 *    ⇒ `#365` 全線收工,admin 已無 `form.get()` / `form.has()` 讀單值欄位的路徑。
 *    (這一段原本寫的是「片③ 尚未轉」,片③ 收工同 commit 改掉 —— 留著就是指著已做完的檔喊沒做。)
 */
export type FormLike = SingleValueFormLike;

export type ParseResult =
  | {
      ok: true;
      orderId: string;
      expectedVersion: number;
      patch: AdminOrderWorkflowPatch;
      returnTo: string;
    }
  | { ok: false };

// #365 片②:本地 `asString` 已刪,改用共用的「`getAll()` 恰一筆」三態讀法。
//
// 🔴 **舊行為是兩種、不是一種**(關卡2 code-reviewer must-fix 1 更正我原本說過頭的那句;
//    我自己開 `git show 48a99080:` 逐行複驗過)。
// ⚠️ **範圍限 `shipping_method` / `invoice_number` / `invoice_amount` 這三個欄**(R2 nit-1:
//    我重寫時把 R1 版原有的範圍字弄丟了)——`invoice_status` 舊碼是**裸的** `asString(get())`、
//    沒有 `?? ''` 也沒有 trim ⇒ 它送 File 時 `raw` 是 null、直接 `ok:false`,從來不會被清空。
//    那三個欄走的是 `(asString(get()) ?? '').trim()`:
//    · **送兩份**:`get()` 回**第一筆字串** ⇒ `asString` 不回 null ⇒ `?? ''` 根本沒觸發
//      ⇒ **靜默採第一筆**(寫進去的是錯的那個值,不是清空);
//    · **送單一 File**:`asString` 回 null ⇒ 收斂成 `''`,而 `''` 在 `invoice_number` /
//      `invoice_amount` 的語意是**「清空這一欄」** ⇒ **靜默清掉發票號 / 發票金額**。
//    兩條的共同點是「零紅燈」,但**受害方向不同**,寫成同一句會讓下一個人估錯風險。
//    改用三態後:「送了但形狀不對」與「根本沒送」分得開,前者一律 `ok:false`。

/**
 * 🔴 本解析器讀的**全部**單值欄位 —— 入口擋門(`anyMalformed`)吃這份清單。
 * ⚠️ 漏列一欄 = 那一欄退回「三態各自處理」的行為(仍 fail-closed,但變成**靜默不 patch**、
 *    員工看不到 `invalid`)⇒ 測試拿手寫清單比對這顆常數當完整性守門。
 * ⚠️ `return_to` **刻意不在清單內**(同 `lib/payment/refund-actions.ts` 的判斷):它不決定寫什麼、
 *    只決定寫完停在哪一頁,而非法值已有自己的 fail-closed(`parseOrderReturnTo` 退回本單明細頁)。
 */
export const WORKFLOW_SINGLE_FIELDS = [
  ORDER_ID_FIELD,
  VERSION_FIELD,
  SHIPPING_METHOD_FIELD,
  INVOICE_NUMBER_FIELD,
  INVOICE_AMOUNT_FIELD,
  INVOICE_STATUS_FIELD,
] as const;

/**
 * 表單 → { orderId, expectedVersion, patch }(形狀層;語意 fail-closed 在 RPC):
 * - order_id 須 UUID、version 須 1..2147483646 整數,否則 ok:false;
 * - patch 欄「未提供(表單無此欄)」= 不放進 patch(RPC 不動該欄);「提供」則按下列規則:
 *   · workflow_status:**D-2 起一律忽略**(orders 層停寫;A9w4a 後 item 層 parser 亦已移除);
 *   · shipping_method:**必須是 `home` / `store`**,否則 ok:false(片15;~~原「非空 → 設定(RPC 再驗長度)」~~
 *     —— 那一版只驗長度,而這一欄無表 CHECK、改單也不經過 create_order 的白名單);空 → ok:false(NOT NULL);
 *   · invoice_number:空 → null(清空);非空 → 設定;
 *   · invoice_amount:空 → null(清空);非空且為十進位整數 → 設定;非整數 → ok:false;
 *   · invoice_status:三值之一 → 設定;否則 ok:false。
 * - return_to:只接受站內絕對路徑 `/orders...`(防 open redirect);否則退 '/orders'。
 */
export function parseWorkflowPatchForm(form: FormLike): ParseResult {
  // 🔴 重複 / 非字串欄位在語意層之前擋掉(理由見 `anyMalformed` docstring):
  //    下面三個 patch 欄是「空字串 = 清空」的語意,不先擋就會把形狀錯誤讀成「員工要清空」。
  if (anyMalformed(form, WORKFLOW_SINGLE_FIELDS)) return { ok: false };

  const orderId = readSingleString(form, ORDER_ID_FIELD);
  if (!orderId || !UUID_RE.test(orderId)) return { ok: false };

  const versionRaw = readSingleString(form, VERSION_FIELD);
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

  // 🔴 `has()` → 三態 `readSingle`(#365 片②):`kind === 'value'` 就是原本的「有提供這一欄」,
  //    而 `kind === 'invalid'`(送兩份 / 非字串)在上面的入口擋門已被擋掉 ⇒ 到這裡只剩
  //    「有提供且是恰一筆字串」與「沒提供」兩種,`?? ''` 那層收斂因此整個不需要了。
  const shippingRead = readSingle(form, SHIPPING_METHOD_FIELD);
  if (shippingRead.kind === 'value') {
    const raw = shippingRead.value.trim();
    if (raw === '') return { ok: false }; // NOT NULL
    // 🔴🔴 **片15(2026-08-19):白名單擋在這裡,不是只擋在畫面上。**
    //    畫面那顆 `<select>`(`order-edit-form.tsx`)只是 UX —— **一發 POST 就繞過去了**,
    //    ⇒ 真正的守門必須在這一層。**這一層之前只驗長度**(本檔 docstring 原句逐字
    //       「shipping_method:非空 → 設定(RPC 再驗長度)」)。
    //    🔴 **而下游沒有第二道**:
    //      · `orders.shipping_method` **沒有表 CHECK** —— 建表 migration
    //        `20260604120000_m3_s2a_orders_order_items.sql:105` 逐字「白名單在 RPC…**不加表 CHECK**」、
    //        `:135` COLUMN COMMENT 逐字「白名單 home/store…驗證在 create_order RPC、本欄 text 無表 CHECK」
    //      · 而那道 RPC 驗證(`20260630120000_m3_241_checkout_consent.sql:144-145`)**只在【下單】那條路上**,
    //        **改單這條路根本不經過它**。
    //    ⇒ 在這一行之前,後台改單可以把**任何 64 字以內的字串**寫進正式欄位,而沒有東西會紅。
    //    🔴 **下游真的在讀它**:退款運費重算走 `mode === 'store' ? 0 : fee`
    //       ⇒ 任何非 `store` 的雜訊值都會被當成宅配算運費。
    //    📎 而凍結運費快照那套設計的 apply 前置斷言逐字要求
    //       「`admin_audit_log` 內真的改過 `shipping_method` 的筆數 = 0」
    //       (`docs/archive/2026-07-25-docs-cleanup/handoff/2026-07-25-rf2a0-freeze-shipping-handoff.md:57`)
    //       ⇒ **那套設計是踩在「沒有人從後台改過它」上面的,而後台一直改得動。**
    //    ✅ **收窄不影響任何既有資料**:正式庫實量(2026-08-19,W5 與主視窗**兩把獨立的尺**)
    //       `select shipping_method, count(*) from orders group by 1` ⇒ `home 14 / store 5`,**零第三種值**。
    //    ⚠️ **這一改收窄了寫入能力**(原本打得出自訂快遞名)。主視窗 2026-08-19 裁「照做、不問 Sean」,
    //       理由:查無任何拍板說自訂是刻意的 / 正式庫 0 筆在用 / 後台尚未對員工開放。
    //       **若日後要支援自訂送法,那要另外設計一個真的欄位,不是借這一欄。**
    if (raw !== 'home' && raw !== 'store') return { ok: false };
    patch.shippingMethod = raw;
  }

  const invoiceNumberRead = readSingle(form, INVOICE_NUMBER_FIELD);
  if (invoiceNumberRead.kind === 'value') {
    const raw = invoiceNumberRead.value.trim();
    patch.invoiceNumber = raw === '' ? null : raw;
  }

  const invoiceAmountRead = readSingle(form, INVOICE_AMOUNT_FIELD);
  if (invoiceAmountRead.kind === 'value') {
    const raw = invoiceAmountRead.value.trim();
    if (raw === '') {
      patch.invoiceAmount = null;
    } else if (/^\d{1,10}$/.test(raw) && Number(raw) <= 2147483647) {
      patch.invoiceAmount = Number(raw); // form 層加 int4 上限(Fable nit-5;避免 10 位溢位走 error 而非 invalid)
    } else {
      return { ok: false }; // 非十進位整數 / 溢位 / 小數 / 負號 / 千分位
    }
  }

  const invoiceStatusRead = readSingle(form, INVOICE_STATUS_FIELD);
  if (invoiceStatusRead.kind === 'value') {
    const raw = invoiceStatusRead.value;
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
    //    🔴 #365 片②:`return_to` 同樣改走「恰一筆」讀法(送兩份 ⇒ 讀成 null ⇒ 走 fallback),
    //    但**不進入口清單** —— 理由同 `lib/payment/refund-actions.ts` 的 `return_to` 那段:
    //    它決定不了寫什麼、只決定寫完停在哪一頁。
    returnTo: parseOrderReturnTo(readSingleString(form, ORDER_RETURN_TO_FIELD), orderId),
  };
}

// ── per-item 改狀態表單:🔴 **A9w4a(2026-08-06)已具名移除** ────────────────────────────
// `parseItemWorkflowForm` / `ItemParseResult` / `WF_CODE_RE`(該 parser 的唯一 consumer)
// 隨 `updateOrderItemWorkflowAction` 一併刪除,母 plan row 53 逐字「server action 與 form parser」。
// 本檔自此**只剩 order 層 parse**(`parseWorkflowPatchForm`)+ 表單欄名常數 + `isAllowedOrigin`。
