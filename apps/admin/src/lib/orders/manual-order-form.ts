// manual-order-form.ts — `#858` M12-A2 前半:後台手動建單表單的**唯一**解析器。
//
// 本檔的職責只有兩件:
//   ① 把一張 FormData 變成「那支建單 RPC 收得下的形狀」——**而且只有這一種形狀**
//   ② 產生 / 驗證冪等鍵(`manual_request_id`)
// 🔴 **不含 `p_actor`**:經手人由 server action 自己向 `authorizeAdminMutation()` 取,
//    本檔的產物**在型別上就沒有那一格** ⇒ 「表單指定經手人」寫不出來。
//    (座標:`lib/session/authorize.ts` 的 `authorizeAdminMutation`;而 `lib/session/actor.ts`
//     檔頭逐字自陳 actor cookie「不是登入 / 授權邊界」⇒ 那一層擋不住,這一層才擋得住。)
//
// 🔴🔴 **這裡一個字都不 normalize —— 送原文。**(cancel-form 同款理由,而本檔的代價更大)
//    那支 RPC 的冪等比對用的是**整包輸入的指紋**,而指紋量的是它自己 `btrim` 過的值。
//    本層若先修剪一次,重送時送出的內容就與第一次不同 ⇒ 指紋不同 ⇒ 回 `P858B`「內容不一樣」
//    ⇒ **一次合法的重送被判成撞鍵**,而員工看到的訊息會叫他不要重送。
//
// 🔴 **不得改用 `supplier-form.ts` 的 `rpcTrim()`**(實查,不是推論):
//    `rpcTrim` 綁的是**另一支** RPC(`20260801160000`)的 **31 字元**空白集;
//    而建單那支全部走 `pg_catalog.btrim(x)` **單參數 = 只剝半形空格**
//    (`20260824020000:311-313,317-319,337-341,345-346,390`;只有 `p_actor` 用 `E' \t\r\n'`,`:254`)。
//    ⇒ 拿 31 字元那把尺來剝,會剝掉 RPC 不會剝的字元 ⇒ 同上,合法重送被判內容不同。
//
// ⚠️ **本層【比 RPC 嚴】的一處,刻意的**:空值判斷用 JS `String.prototype.trim()`(含 tab / 換行 /
//    全形空格),而 RPC 只剝半形空格 ⇒ **一個只打了 tab 的收件人姓名,RPC 會收,本層會拒。**
//    嚴的方向是安全的(擋下來的是本來就該擋的輸入),而反過來不成立。
//    📌 這也是一條 finding:`20260824020000:440` 那句「收件 / 發票 / 規格的鍵與值全部 btrim
//       (空白只打了空白 ⇒ 等於沒填)」**對 tab / 換行不成立** —— 那支 RPC 不在本片射程,只記錄。

import {
  readSingle,
  readSingleString,
  type SingleValueFormLike,
} from '../forms/single-value';

/** 最小 FormData 介面(同 `cancel-form.ts` 慣例:測試不必造真 FormData)。 */
export interface ManualOrderFormLike extends SingleValueFormLike {
  getAll(name: string): FormDataEntryValue[];
}

// ── 欄位名(**唯一定義處**;表單與解析器共用,不得各自硬寫字串)────────────────
export const MANUAL_ORDER_REQUEST_ID_FIELD = 'manual_request_id';
export const MANUAL_ORDER_CUSTOMER_FIELD = 'customer_user_id';
export const MANUAL_ORDER_SOURCE_FIELD = 'order_source';
export const MANUAL_ORDER_PAYMENT_CHANNEL_FIELD = 'payment_channel';
export const MANUAL_ORDER_SHIPPING_METHOD_FIELD = 'shipping_method';
export const MANUAL_ORDER_SHIPPING_FEE_FIELD = 'shipping_fee';
export const MANUAL_ORDER_SHIP_TO_NAME_FIELD = 'ship_to_name';
export const MANUAL_ORDER_SHIP_TO_PHONE_FIELD = 'ship_to_phone';
export const MANUAL_ORDER_SHIP_TO_LINE_FIELD = 'ship_to_line';
export const MANUAL_ORDER_INVOICE_TYPE_FIELD = 'invoice_type';
export const MANUAL_ORDER_INVOICE_CARRIER_FIELD = 'invoice_carrier';
export const MANUAL_ORDER_INVOICE_TITLE_FIELD = 'invoice_title';
export const MANUAL_ORDER_INVOICE_TAX_ID_FIELD = 'invoice_tax_id';
export const MANUAL_ORDER_INVOICE_DONATE_CODE_FIELD = 'invoice_donate_code';
/** 品項:**可重複**欄位,每一筆是一個 JSON 物件字串(見 `parseLineEntry` 的取捨)。 */
export const MANUAL_ORDER_LINE_FIELD = 'manual_order_line';

// ── 封閉值集(權威在 DB,這裡是它的 TS 複本;DB 改了要同步改這裡)──────────────
/** `20260824020000:266`。 */
export const MANUAL_ORDER_SOURCES = ['manual_phone', 'manual_line', 'manual_other'] as const;
export type ManualOrderSource = (typeof MANUAL_ORDER_SOURCES)[number];

/**
 * `20260824020000:275`。
 * 🔴 `tappay` **不在集合裡,而且 RPC 另外具名拒它一次**(`:271`)——
 *    人工建單不得宣稱一筆刷卡交易(那條路由 TapPay 那一側寫)。
 *    ⇒ 本層不需要「特別擋 tappay」的分支:它不在白名單裡,自然就過不了。
 */
export const MANUAL_PAYMENT_CHANNELS = ['bank_transfer', 'cash'] as const;
export type ManualPaymentChannel = (typeof MANUAL_PAYMENT_CHANNELS)[number];

/** `20260824020000:279`。 */
export const MANUAL_SHIPPING_METHODS = ['home', 'store'] as const;
export type ManualShippingMethod = (typeof MANUAL_SHIPPING_METHODS)[number];

/** `20260824020000:323`。 */
export const MANUAL_INVOICE_TYPES = ['personal', 'company', 'donate'] as const;
export type ManualInvoiceType = (typeof MANUAL_INVOICE_TYPES)[number];

/**
 * 🔴 三個上限**全部鏡像 RPC**,而**它們不是拍板值**——RPC 自己逐字寫著
 * 「這個上限是保守預設值、未經拍板」(`20260824020000:361`)。
 * ⇒ 撞到就去改 RPC 並問 Sean,**不要在這一層拆單繞過去**。
 */
export const MANUAL_ORDER_MAX_LINES = 50; // `:236` c_max_lines
export const MANUAL_ORDER_MAX_QTY = 9999; // `:237` c_max_qty
/** PostgreSQL int4 上界;RPC `:430` 對 subtotal / total 各驗一次。 */
const INT4_MAX = 2147483647;

/**
 * 品項的形狀 —— **直接就是 RPC `p_lines` 元素的 wire 形狀(snake_case)**。
 *
 * 🔴 不做 camelCase + mapper(照 `cancel-form.ts` 那段被審過兩輪的論證):
 *    `p_lines` 的生成型別是 `Json`,**送錯鍵名不會型別報錯**,只會在執行期被 RPC RAISE。
 *    解析器只吐這一種形狀 ⇒ 呼叫端**沒有另一種形狀可以傳錯**。
 */
export type ManualOrderLineInput = {
  sku: string;
  title: string;
  qty: number;
  unit_price: number;
  /** 🔴 `null` = 代購品項(網站上沒有的東西);RPC `:368` 明文允許。 */
  variant_id: string | null;
  /** 🔴 只收「字串對字串」;RPC `:378-386` 兩道:全值皆字串 + 不得出現價格欄名。 */
  spec: Record<string, string>;
};

/** 收件快照 —— 鍵名逐字對齊 RPC `:311-319`。 */
export type ManualOrderShipTo = { name: string; phone: string; line: string };

/**
 * 發票 —— 鍵名逐字對齊 RPC `:337-341`。
 * ⚠️ `taxId` / `donateCode` 是 **camelCase**(那是 jsonb 裡的鍵,不是欄位名)⇒ 照抄,不要「統一風格」。
 */
export type ManualOrderInvoice = {
  type: ManualInvoiceType;
  carrier?: string;
  title?: string;
  taxId?: string;
  donateCode?: string;
};

/** 送進 RPC 的全部參數,**除了 `p_actor`**(見檔頭)。 */
export type ManualOrderValues = {
  customerUserId: string;
  manualRequestId: string;
  orderSource: ManualOrderSource;
  paymentChannel: ManualPaymentChannel;
  shippingMethod: ManualShippingMethod;
  shipTo: ManualOrderShipTo;
  invoice: ManualOrderInvoice;
  shippingFee: number;
  lines: ManualOrderLineInput[];
};

/**
 * 🔴 失敗一律帶**一句給員工看的話**,不是一個代碼。
 * 理由 = `project_admin-ux-operation-intuitiveness`(Sean 2026-08-11 常設):
 * 文案寫「怎麼做」、不寫內部語彙 ⇒ 訊息要講**哪一格**、以及他該做什麼。
 */
export type ManualOrderParse = { ok: true; values: ManualOrderValues } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 十進位非負整數字面;`+3` / `3.0` / ` 3 ` / `3e0` 全拒(RPC 那側 `::integer` 會收其中幾種,本層更嚴)。 */
const NON_NEG_INT_RE = /^\d+$/;

/**
 * 產一顆新的建單冪等鍵。
 *
 * 🔴🔴 **它與 `lib/request-id.ts` 的 `generateRequestId()` 是【兩顆不同的東西】** ——
 *    那一支回的是 `req_<uuid>`(**帶前綴的文字**),而 RPC 這一格的型別是 **uuid**
 *    ⇒ 把它丟進來會被 PostgREST 拒。
 *
 * 🔴 **生命週期(這一格做錯不會有錯誤訊息,只會安靜地少建一張單)**:
 * ```
 * ✅ 產新的:員工【開啟一張空白建單表單】那一刻,一次,存進表單 state
 * ❌ 不產新的:按送出、送出失敗後重按、收到 P858A 之後重送(那三種都要沿用同一顆)
 * 🔴 【複製上一張單】必須產新的 —— 沿用舊的且內容沒改 ⇒ RPC 回 idempotent:true + 舊單號
 *    ⇒ 員工以為建了第二張, 其實沒有, 而**那條路回的是成功、不是錯誤**
 * ```
 * ⚠️ **本檔只提供這支產生器與格式驗證;「什麼時候呼叫它」住在表單元件裡**
 *    ⇒ 「複製上一張單 ⇒ 換新鍵」那一格守門**跟著那支元件一起交**,不在本檔。
 */
export function newManualRequestId(): string {
  return crypto.randomUUID();
}

/**
 * 讀一個**選填**單值欄位。
 *
 * 🔴 不能只用 `readSingleString`:它把「沒送」與「送壞了」都收斂成 `null`,
 *    而本檔對選填欄位的 `null` 是**放行**(當成沒填)⇒ 同一欄送兩份反而更容易通過。
 *    那正是 `forms/single-value.ts` 檔頭記載、退款線實測過的 fail-open 方向。
 *    ⇒ 三態分開:`missing` 放行、`invalid` 擋、`value` 收。
 */
function readOptional(form: ManualOrderFormLike, field: string): string | null | 'invalid' {
  const read = readSingle(form, field);
  if (read.kind === 'missing') return null;
  if (read.kind === 'invalid') return 'invalid';
  return read.value;
}

/** 空白判斷用 JS `trim()`(比 RPC 嚴,理由見檔頭)。 */
const isBlank = (v: string) => v.trim() === '';

function parseLineEntry(raw: string, index: number): ManualOrderLineInput | string {
  // 🔴 用 JSON 而不是 `cancel-form.ts` 那種 `a:b` 切法:那支切的是兩個純量(uuid + 數字),
  //    本檔一筆品項有六格、其中兩格是員工自由輸入的文字(品名 / 料號)、還有一個任意鍵的 spec
  //    ⇒ 分隔符一定會撞到內容。JSON 多的那個失敗面(parse 失敗)在這裡是**看得見的**。
  const at = `第 ${index + 1} 個品項`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return `${at}的資料壞掉了,請把那一列刪掉重新加一次。`;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return `${at}的資料壞掉了,請把那一列刪掉重新加一次。`;
  }
  const o = parsed as Record<string, unknown>;

  if (typeof o.sku !== 'string' || isBlank(o.sku)) return `${at}沒有料號。`;
  if (typeof o.title !== 'string' || isBlank(o.title)) return `${at}沒有品名。`;

  if (typeof o.qty !== 'number' || !Number.isInteger(o.qty) || o.qty <= 0) {
    return `${at}的數量要是大於 0 的整數。`;
  }
  if (o.qty > MANUAL_ORDER_MAX_QTY) {
    return `${at}的數量超過單筆上限 ${MANUAL_ORDER_MAX_QTY};真的要這個量請找系統維護。`;
  }
  if (typeof o.unit_price !== 'number' || !Number.isInteger(o.unit_price) || o.unit_price < 0) {
    return `${at}的單價要是 0 或正整數。`;
  }

  // 🔴 `variant_id` 三態:沒帶 / null ⇒ 代購品項;帶了就必須是 uuid。
  //    帶一個不是 uuid 的字串**不得**默默退化成代購 —— 那會把「選錯商品」變成「憑空新增一個品項」。
  let variantId: string | null = null;
  if (o.variant_id !== undefined && o.variant_id !== null && o.variant_id !== '') {
    if (typeof o.variant_id !== 'string' || !UUID_RE.test(o.variant_id)) {
      return `${at}的商品編號格式不對,請重新從商品清單挑一次。`;
    }
    variantId = o.variant_id;
  }

  // spec:沒帶 ⇒ 空物件。每個值都必須是字串(RPC `:381` 那道自驗的鏡像)。
  const spec: Record<string, string> = {};
  if (o.spec !== undefined && o.spec !== null) {
    if (typeof o.spec !== 'object' || Array.isArray(o.spec)) return `${at}的規格格式不對。`;
    for (const [k, v] of Object.entries(o.spec as Record<string, unknown>)) {
      if (typeof v !== 'string') return `${at}的規格「${k}」只能填文字。`;
      spec[k] = v;
    }
  }

  return { sku: o.sku, title: o.title, qty: o.qty, unit_price: o.unit_price, variant_id: variantId, spec };
}

/**
 * 解析一張手動建單表單。
 *
 * ⚠️ **本層不做的兩件**(RPC 做,而且它的訊息比這裡準):
 *   · 跨列去重(`:404-412`;代購品項的鍵含規格與單價,那個規則在這一層複製一份只會漂移)
 *   · 規格裡不得出現價格欄名(`:384`;那是 DB 的隱私紅線,守在最靠近資料的地方才對)
 * ⇒ **不得讀成「本層過了就一定建得起來」。**
 */
export function parseManualOrderForm(form: ManualOrderFormLike): ManualOrderParse {
  const requestId = readSingleString(form, MANUAL_ORDER_REQUEST_ID_FIELD);
  if (requestId === null || !UUID_RE.test(requestId)) {
    return { ok: false, error: '這張表單的編號不見了,請重新開一張空白建單表單。' };
  }

  const customerUserId = readSingleString(form, MANUAL_ORDER_CUSTOMER_FIELD);
  if (customerUserId === null || !UUID_RE.test(customerUserId)) {
    return { ok: false, error: '沒有選客人。請先挑一位客人,沒有的話要先去客戶頁建立。' };
  }

  const orderSource = readSingleString(form, MANUAL_ORDER_SOURCE_FIELD);
  if (orderSource === null || !(MANUAL_ORDER_SOURCES as readonly string[]).includes(orderSource)) {
    return { ok: false, error: '沒有選這張單是怎麼來的(電話 / LINE / 其他)。' };
  }

  const paymentChannel = readSingleString(form, MANUAL_ORDER_PAYMENT_CHANNEL_FIELD);
  if (
    paymentChannel === null ||
    !(MANUAL_PAYMENT_CHANNELS as readonly string[]).includes(paymentChannel)
  ) {
    return { ok: false, error: '沒有選收款方式。手動建的單只能選匯款或現金,線上刷卡的單不能用這裡建。' };
  }

  const shippingMethod = readSingleString(form, MANUAL_ORDER_SHIPPING_METHOD_FIELD);
  if (
    shippingMethod === null ||
    !(MANUAL_SHIPPING_METHODS as readonly string[]).includes(shippingMethod)
  ) {
    return { ok: false, error: '沒有選配送方式(宅配 / 門市自取)。' };
  }

  const shippingFeeRaw = readSingleString(form, MANUAL_ORDER_SHIPPING_FEE_FIELD);
  if (shippingFeeRaw === null || !NON_NEG_INT_RE.test(shippingFeeRaw)) {
    return { ok: false, error: '運費要填 0 或正整數(不收就填 0)。' };
  }
  const shippingFee = Number(shippingFeeRaw);
  if (shippingFee > INT4_MAX) return { ok: false, error: '運費超出可以記錄的上限。' };

  const name = readSingleString(form, MANUAL_ORDER_SHIP_TO_NAME_FIELD);
  const phone = readSingleString(form, MANUAL_ORDER_SHIP_TO_PHONE_FIELD);
  const line = readSingleString(form, MANUAL_ORDER_SHIP_TO_LINE_FIELD);
  if (name === null || isBlank(name)) return { ok: false, error: '收件人姓名沒有填。' };
  if (phone === null || isBlank(phone)) return { ok: false, error: '收件人電話沒有填。' };
  if (line === null || isBlank(line)) return { ok: false, error: '收件地址沒有填。' };

  const invoiceType = readSingleString(form, MANUAL_ORDER_INVOICE_TYPE_FIELD);
  if (
    invoiceType === null ||
    !(MANUAL_INVOICE_TYPES as readonly string[]).includes(invoiceType)
  ) {
    return { ok: false, error: '沒有選發票類型(個人 / 公司 / 捐贈)。' };
  }
  const invoice: ManualOrderInvoice = { type: invoiceType as ManualInvoiceType };
  const optionalInvoice = [
    [MANUAL_ORDER_INVOICE_CARRIER_FIELD, 'carrier', '載具'],
    [MANUAL_ORDER_INVOICE_TITLE_FIELD, 'title', '抬頭'],
    [MANUAL_ORDER_INVOICE_TAX_ID_FIELD, 'taxId', '統編'],
    [MANUAL_ORDER_INVOICE_DONATE_CODE_FIELD, 'donateCode', '愛心碼'],
  ] as const;
  for (const [field, key, label] of optionalInvoice) {
    const read = readOptional(form, field);
    if (read === 'invalid') return { ok: false, error: `發票${label}這一格送出的資料壞掉了,請重新整理再試。` };
    // 🔴 「只打了空白」與「沒填」歸位到同一件事 —— 與 RPC `:338-341` 的 `NULLIF(btrim(…),'')` 同向。
    //    ⚠️ 這裡是**不放進 payload**(不是送空字串):送空字串會與「沒填」產生兩種不同的指紋。
    if (read !== null && !isBlank(read)) invoice[key] = read;
  }

  const rawLines = form.getAll(MANUAL_ORDER_LINE_FIELD);
  if (rawLines.length === 0) return { ok: false, error: '這張單還沒有品項,至少要加一個。' };
  if (rawLines.length > MANUAL_ORDER_MAX_LINES) {
    return { ok: false, error: `一張單最多 ${MANUAL_ORDER_MAX_LINES} 個品項,超過請拆成兩張單。` };
  }
  const lines: ManualOrderLineInput[] = [];
  let subtotal = 0;
  for (let i = 0; i < rawLines.length; i += 1) {
    const raw = rawLines[i];
    if (typeof raw !== 'string') return { ok: false, error: `第 ${i + 1} 個品項的資料壞掉了。` };
    const parsed = parseLineEntry(raw, i);
    if (typeof parsed === 'string') return { ok: false, error: parsed };
    lines.push(parsed);
    subtotal += parsed.unit_price * parsed.qty;
  }
  // 🔴 鏡像 RPC `:429-431`。本層先擋是為了給員工看得懂的話 —— **不是**代替它:
  //    真正的金額由 RPC 自己算(它不信任何 client 送的合計),這裡只是同一條線的第一道。
  if (subtotal > INT4_MAX || subtotal + shippingFee > INT4_MAX) {
    return { ok: false, error: '這張單的總金額超出可以記錄的上限,請拆成兩張單。' };
  }

  return {
    ok: true,
    values: {
      customerUserId,
      manualRequestId: requestId,
      orderSource: orderSource as ManualOrderSource,
      paymentChannel: paymentChannel as ManualPaymentChannel,
      shippingMethod: shippingMethod as ManualShippingMethod,
      shipTo: { name, phone, line },
      invoice,
      shippingFee,
      lines,
    },
  };
}
