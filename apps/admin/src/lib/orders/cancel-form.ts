// cancel-form.ts — M-4b E10 A9d2-2a:訂單取消表單的純解析器(無 IO / 無 Next 依賴)。
//
// 🔴🔴 **本檔會被 client 端 import**(同 `note-form.ts` 的理由)⇒ 不得引入 `server-only`。
//
// 🔴 **鏡像範圍(不說滿,逐字沿用 `note-form.ts:5-9` 的紀律)**:本檔只做「形狀」與「型別分流」,
//    **刻意不重做** RPC 的**業務**值域判定 —— 可取消量上限、「肉眼全白」碼位的完整清單
//    (`:136-140`)**單一真相在 RPC**,重做一份就會有兩份會漂移的規格。
//    ⚠️ 例外 = 數量的 int4 上界(關卡2 R2 nit 更正檔頭原本的自相矛盾):它**有**在這層擋,
//    因為那是欄位型別邊界(`20260730130000:223` 的 int4 欄)而不是業務規則 —— 理由見 `parseItemEntry`。
//    ⇒ 可主張的是「經由本解析器的欄位不會觸發 RPC 步 2 **形狀類**的 RAISE」,
//      **不是**「RPC 的輸入類 RAISE 都不可達」。
//
// 🔴 **這條主張還要再扣掉一格**(R1 must-fix,誠實邊界):本層判空白用 `rpcTrim`(31 碼位,
//    `supplier-form.ts` 的集合),而本 RPC 的 `other` 判空用 **34 碼位**(`20260805100000:136`,
//    多了 U+00AD 軟連字號 / U+2800 點字空方 / U+3164 韓文填充)⇒ **凡是「肉眼全白、但至少含
//    一個那三碼位」的說明都會穿過這層**(關卡2 nit 更正:不只「純由那三個字組成」——
//    31 個既有碼位與那三個混在一起的字串同樣穿得過)、到 RPC 才被擋。維持與 `note-form.ts:95-96` 同一取捨(單一真相在 RPC、
//    這層不養第二份碼位清單),但要寫下代價差異:備註片那條路只是「改一改再送」,
//    取消片會走到 `rejected` ⇒ **導頁(D5 之後由帳本核對面板說「寫進去了沒有」;在那之前畫面空白)**,
//    而且 `E-014-A` Q2=A 之下員工的輸入不保留、要整份重填。(D2a 前的字面是「表單凍結」,已隨 PRG 換路作廢。)
//    ⇒ A13b 的說明欄建議加一道 client 端提示(「說明看起來是空的」),不要靠這層。
//
// 🔴 **為什麼形狀還是要在這裡擋一次**(不是重工):RPC 的輸入類 RAISE 與業務拒絕**同為 `P0001`**
//    且訊息在 UI 層不被解析(Sean Q1=A)⇒ 畸形輸入送進去,員工看到的會是
//    「這張單目前不能取消」這句**誤導**的話(plan §4.2 已把這個代價寫下來)。
//    本層擋掉形狀錯誤,員工才看得到「表單內容不正確」。

import { rpcTrim } from '../supplier-form';
import {
  CANCEL_ITEM_FIELD,
  CANCEL_MODE_FIELD,
  CANCEL_ORDER_ID_FIELD,
  CANCEL_REASON_CODE_FIELD,
  CANCEL_REASON_DETAIL_FIELD,
  CANCEL_REQUEST_TOKEN_FIELD,
  cancelItemQtyField,
  isCancelRequestToken,
} from './cancel-action-state';
import { isUuid } from './note-action-state';

/**
 * 最小 FormData 介面(同 `note-form.ts` 慣例:測試不必造真 FormData)。
 * 🔴 比備註片多一個 `getAll` —— 品項是**可重複**欄位,`get()` 只會拿到第一筆
 * ⇒ 只用 `get()` 會讓「勾了 5 個品項」靜默變成「只取消第 1 個」。
 */
export interface CancelFormLike {
  get(name: string): FormDataEntryValue | null;
  getAll(name: string): FormDataEntryValue[];
}

/**
 * 取消原因七碼(鏡像 `20260730130000:131-139` 的 CHECK、以及 RPC 的七值映射
 * `20260805100000:119-127`;Sean 2026-07-28 拍 Q18「照這份」)。
 * 🔴 權威是 DB,這裡是它的 TS 複本 —— DB 端改 CHECK 要同步改這裡(兩處都改才算改完)。
 */
export const CANCEL_REASON_CODES = [
  'customer_request',
  'out_of_stock',
  'long_leadtime',
  'price_change',
  'duplicate_order',
  'internal_error',
  'other',
] as const;
export type CancelReasonCode = (typeof CANCEL_REASON_CODES)[number];

/**
 * 七碼 → 員工看到的中文。
 *
 * 🔴 **住在這裡、與 `CANCEL_REASON_CODES` 同檔**(A13b D4 R1 nit 4):消費端有兩個 ——
 *    取消表單的下拉(D4)與取消歷程的顯示(`cancel-review-section.tsx`)。
 *    **兩邊必須是同一組字**,否則員工在下拉選「交期過長」、事後在歷程看到另一種說法。
 *    ⚠️ 原本放在 `cancel-review-section.tsx`(元件)、由表單反向 import 元件 ——
 *    那會為了一張字典把 `@pcm/domain` 與 `buildOrderCancelView` 整個模組圖拉進表單。
 * 🔴 `Record<七碼 union, string>` 不是 `Record<string, string>` ⇒ **少寫一碼編譯期紅**。
 * ⚠️ **它擋不到原型鏈**(R2 codex nit 更正原本說滿的字面):型別只約束**編譯期**的索引;
 *    執行期 `CANCEL_REASON_LABEL['constructor']` 照樣拿得到 `Object.prototype.constructor`(truthy)
 *    ⇒ 任何 `?? fallback` 都不會執行(memory `reference_js-index-lookup-hits-prototype-chain`,PCM 曾中 6 頁)。
 *    現況為什麼還安全:兩個消費端的索引值都**不是使用者自由輸入** ——
 *    表單下拉逐個走 `CANCEL_REASON_CODES`(不動態索引),歷程顯示的值由 DB CHECK 限成七碼。
 *    🔴 **哪天要拿它去查「來路不明的字串」,先改成 `Object.hasOwn` 或 `Map`**。
 */
export const CANCEL_REASON_LABEL: Record<CancelReasonCode, string> = {
  customer_request: '客人要求',
  out_of_stock: '缺貨',
  long_leadtime: '交期過長',
  price_change: '價格異動',
  duplicate_order: '重複下單',
  internal_error: '內部作業疏失',
  other: '其他',
};

/** 整單 / 部分兩種模式。 */
export const CANCEL_MODES = ['full', 'partial'] as const;
export type CancelMode = (typeof CANCEL_MODES)[number];

/**
 * 品項的形狀 —— **直接就是 RPC `p_items` 的 wire 形狀(snake_case)**,
 * 逐字對齊 `20260805100000:157-161` 的鍵名檢查。
 *
 * 🔴🔴 **為什麼不用 camelCase 再配一支 mapper**(關卡2 兩輪各抓一次同一個洞):
 * `p_items` 的生成型別是 `Json` —— 送錯鍵名**不會型別報錯**,RPC 才會 RAISE
 * 「品項元素需恰含 order_item_id 與 quantity」⇒ `rejected` ⇒ **導頁(D5 之後由帳本核對面板說「寫進去了沒有」;在那之前畫面空白)**。
 * 第一版加了 `toCancelItemsWire()` 想補這個洞,但 R2 指出它是 **opt-in** ——
 * 片 5 大可不呼叫、直接把 camelCase 丟給 `Json` 參數,而 mapper 的測試抓不到。
 * ⇒ 最省的解法不是多一層,是**根本不存在另一種形狀**:解析器只吐這一種,
 *   片 5 想傳錯也沒有東西可以傳錯。
 * ⚠️ 代價:這個型別**綁死 RPC 的欄位名**(不是 domain 命名)。刻意的 —— 它的唯一去處就是那支 RPC。
 */
export type CancelItemInput = { order_item_id: string; quantity: number };

/** PostgreSQL int4 上界 —— `order_cancellation_items.cancelled_quantity` 的欄位型別上限。 */
const INT4_MAX = 2147483647;

export type CancelParse =
  | {
      ok: true;
      orderId: string;
      reasonCode: CancelReasonCode;
      /**
       * 🔴 `other` 才有值、其餘恆 `null`(鏡像 RPC 的配對規則 `20260805100000:134-145`:
       * 非 other 帶說明會直接 RAISE)。
       * 值是**原文**(未正規化)—— RPC 的 `payload_hash` 量的是 `btrim` 後的原文,
       * 這層改寫內容會讓重送被判「內容不符」。
       */
      reasonDetail: string | null;
      /** 🔴 `null` = 整單取消(RPC `p_items` 送 NULL);非 null = 部分取消、且**必為非空**。 */
      items: CancelItemInput[] | null;
      requestToken: string;
    }
  | { ok: false };

/**
 * 單值欄位的讀法 —— **`getAll()` 且必須恰一筆**,不是 `get()`。
 *
 * 🔴🔴 **`get()` 取的是第一筆,而「第一筆」是攻擊者可以決定的**(關卡2 codex 第三輪 #2):
 *    同名欄位送兩份,瀏覽器 / fetch 都送得出去,`get()` 靜默採前面那個 ⇒ 畫面上可見的 `2` 排在
 *    藏起來的 `5` 後面時,員工看到 2、系統取消 5。**方向就是 E-011 的方向。**
 *    ⚠️ 這條在本片之前就存在(所有單值欄位共用 `readString`),但**本片新增的數量欄讓它從
 *    「改不了取消量」變成「改得了取消量」** ⇒ 一起收緊,不留「只修自己那一條路」的半套。
 * 🔴 三態分開回,呼叫端才分得出「沒送」與「送壞了」:`reason_detail` 沒送是合法的、送兩份不是。
 */
type SingleRead =
  | { kind: 'value'; value: string }
  | { kind: 'missing' }
  | { kind: 'invalid' };

function readSingle(form: CancelFormLike, field: string): SingleRead {
  const all = form.getAll(field);
  if (all.length === 0) return { kind: 'missing' };
  if (all.length > 1) return { kind: 'invalid' };
  const raw = all[0];
  return typeof raw === 'string' ? { kind: 'value', value: raw } : { kind: 'invalid' };
}

/** 必填單值欄位:非「恰一筆字串」一律回 `null`(呼叫端一律當形狀錯)。 */
function readString(form: CancelFormLike, field: string): string | null {
  const read = readSingle(form, field);
  return read.kind === 'value' ? read.value : null;
}

/**
 * 解析一筆 `<order_item_id>:<quantity>`。
 *
 * 🔴 用 `:` 切而不是塞 JSON:JSON 要對使用者可控字串做 `JSON.parse`(多一個失敗面與型別面),
 * 而這裡只需要兩個純量。uuid 本身不含 `:`,所以**切第一個 `:`** 就夠且無歧義。
 * 🔴 數量鏡像 RPC 的「十進位整數字面」規則(`20260805100000:168-170`,`1.0` / `'3'` / `+3` 全拒)——
 * 那是 canonical hash 的單一產生式,寫法不同會產出不同的 hash。
 */
function parseItemEntry(raw: string): CancelItemInput | null {
  const sep = raw.indexOf(':');
  if (sep <= 0) return null;
  const orderItemId = raw.slice(0, sep);
  const quantityRaw = raw.slice(sep + 1);
  if (!isUuid(orderItemId)) return null;
  if (!/^[0-9]+$/.test(quantityRaw)) return null;
  const quantity = Number(quantityRaw);
  // 🔴 上界擋的是 **int4 的型別邊界**,不是業務值域(關卡2 must-fix 推翻我原本「刻意不鏡像」的判斷):
  //    實測 `2147483648` 原本回 `ok:true`,到 RPC 才在 `:172-175` RAISE ⇒ 走到 `rejected`
  //    ⇒ **導頁(D5 之後由帳本核對面板說「寫進去了沒有」;在那之前畫面空白)**、且輸入不保留要重填。`cancelled_quantity` 是 int4 欄
  //    (`20260730130000:223`),送得進去的值本來就不可能超過它 —— 這是形狀不是規則。
  //    ⚠️ 真正的業務上限(可取消量)仍**不在這層**,那是 A13b 依 quantitySummary 算。
  if (quantity < 1 || quantity > INT4_MAX || !Number.isSafeInteger(quantity)) return null;
  return { order_item_id: orderItemId, quantity };
}

/**
 * 套用數量覆寫欄(A13b E1「挑數量」)。回 `null` = 整份表單作廢。
 *
 * 🔴🔴 **`null`(欄位不存在)與 `''`(欄位存在但空)必須分開**(關卡1 R2 #1,這條打到不變式心臟):
 *    - **不存在** = `maxCancellable === 1`、表單根本沒渲染這個欄位 ⇒ 沿用 checkbox 帶的數量。
 *      這不是靜默降級:checkbox 旁邊的字就是「這次可取消 N 件」,取消 N 就是它的字面意思。
 *    - **空字串** = 員工把數量清空了 ⇒ **整份 `{ok:false}`**。
 *      (⚠️ code-reviewer F8:第一版這裡還寫「或瀏覽器把非法輸入正規化成空」—— 那是 `type=number`
 *       的行為,而表單刻意用 `type=text` 正是為了避開它。前案的殘留理由,已刪。)
 *      ⚠️ 這一格若寫成「空的就沿用 checkbox 的 max」,就會**送出比畫面顯示的更多** ——
 *      那正是 `E-011-STOP` 誤送整單取消的傷害方向。第一版 plan 真的這樣寫,codex 兩輪都打對。
 *
 * 🔴 **上界比的是 checkbox 帶的數量,而那也是 client 送來的** ⇒ 這道是**形狀比較,不是授權**。
 *    真正的可取消量權威在 RPC(`20260805100000_m4b_e10_a8a2_partial_cancel.sql:395-405`,
 *    逐品項 `quantity − Σ已到貨 − Σ已取消`)。UI 與本層都只是 advisory,擋的是手滑不是竄改
 *    (威脅模型同 Sean Q3=A:動 DevTools 的員工本來就按得到整單取消鈕)。
 *
 * ⚠️ **三條誠實邊界(code-reviewer F5/F6/F7,都要竄改或手滑才到得了,但字面要收)**:
 *    ① ~~`readString` 回 `null` 有三義,三者都走「沿用 checkbox 值」~~ —— **關卡2 第三輪已修掉**:
 *      改用 `readSingle` 三態,`File` / 重複欄位一律 `invalid` ⇒ 整份退回;只有「欄位不存在
 *      **且** checkbox 說可取消 1」才沿用。本函式**不再有 fail-open 分支**。
 *    ② 查名用 `parsed.order_item_id` 的**原大小寫**,而去重刻意 `.toLowerCase()`(`:268`)
 *      ⇒ 同一顆 uuid 大小寫變體:去重認得出、覆寫查不到 ⇒ 靜默回退成 checkbox 的量(方向偏多)。
 *      表單自己渲染時兩邊同源、撞不到;竄改才到得了。
 *    ③ 覆寫**只讀被勾選的那幾筆** —— 沒勾的品項就算留著壞值也不影響送出(有測試釘住)。
 *      反面代價:員工「改了數量卻忘了勾」⇒ 那筆零取消、畫面上卻顯示 2,而且沒有任何提示。
 *      方向是「送得比畫面**少**」(不是 E-011 的多),但這是真的操作面陷阱,認列。
 *
 * ⚠️ **本片新增的代價**(同檔 `:19-21` 慣例):數量欄**清空**、或打成全形數字 / 「2件」/ 前導空白
 *    ⇒ 整份 `{ok:false}`,而 `E-014-A` Q2=A 之下輸入不保留、要整份重填。
 *    🔴 **「清空」那格前置擋不到**:E1 的送出鈕只看「有沒有勾品項」,不看數量欄的內容
 *    ⇒ 清空之後鈕仍可按、送出才被擋。認列,不在本片修(要修得把數量欄也納入 disabled 條件,
 *      那會讓不變式(ii) 的枚舉再長一條,得先想清楚 reset 窗口那格)。
 */
function applyQuantityOverride(
  form: CancelFormLike,
  parsed: CancelItemInput,
): CancelItemInput | null {
  const read = readSingle(form, cancelItemQtyField(parsed.order_item_id));
  if (read.kind === 'invalid') return null;
  if (read.kind === 'missing') {
    // 🔴🔴 **只有可取消量 1 的品項才准沒有這個欄位**(關卡2 codex 第三輪 #1)。
    //    表單的渲染條件是 `maxCancellable > 1`,所以「checkbox 說可取消 5、卻沒有數量欄」
    //    代表兩邊分岔了 —— 最可能的成因不是竄改,是**日後有人改了欄位名只改一邊**。
    //    第一版無條件沿用 checkbox 的數量 ⇒ 員工畫面上填 2、系統取消 5。**送出比看到的多。**
    //    ⇒ 這裡改成 fail-closed:分岔就整份退回,不猜。
    return parsed.quantity === 1 ? parsed : null;
  }
  // 🔴 沿用 `parseItemEntry` 的「十進位整數字面」規則 —— `''` / `1.0` / `+2` / `' 2'` 全拒。
  if (!/^[0-9]+$/.test(read.value)) return null;
  const quantity = Number(read.value);
  if (quantity < 1 || quantity > parsed.quantity) return null;
  return { ...parsed, quantity };
}

/**
 * 解析取消表單。任一欄形狀不合 → `{ ok: false }`(呼叫端導頁帶 `order_cancel_invalid`)。
 *
 * 🔴 誠實邊界:回傳只有單一 `ok: false`,**缺欄 / 形狀錯 / 品項重複在 UI 上分不出來**
 *    (同 `note-form.ts:76-77` 的已知取捨);要分得出來得先擴回傳型別,本片不做。
 */
export function parseOrderCancelForm(form: CancelFormLike): CancelParse {
  const orderId = readString(form, CANCEL_ORDER_ID_FIELD);
  if (orderId === null || !isUuid(orderId)) return { ok: false };

  const requestToken = readString(form, CANCEL_REQUEST_TOKEN_FIELD);
  if (requestToken === null || !isCancelRequestToken(requestToken)) return { ok: false };

  const reasonCodeRaw = readString(form, CANCEL_REASON_CODE_FIELD);
  if (
    reasonCodeRaw === null ||
    !(CANCEL_REASON_CODES as readonly string[]).includes(reasonCodeRaw)
  ) {
    return { ok: false };
  }
  const reasonCode = reasonCodeRaw as CancelReasonCode;

  // 🔴 型別分流(不是「有填就送」):`other` 必須有非空白說明、其餘**必須送 null**。
  //    用「有填就送」會讓非 other 帶著空字串撞 `非 other 不得填說明`(`:141-142`)。
  //    空白判定用 `rpcTrim` 不用 `.trim()`:`.trim()` 不剝 U+200B / U+2060 等零寬字,
  //    而 RPC 會剝(`:134-138`)⇒ 純零寬字的說明在 `.trim()` 下是「非空」、會漏到 RPC 才被擋。
  // 🔴🔴 **`reason_detail` 不能用 `readString`**(關卡2 codex 複審 #2):它把「沒送」與「送壞了」
  //    都壓成 `null`,而非 other 的路徑把 `null` 當成「合法的沒填」⇒ **重複欄位 / File 直接放行**,
  //    上一版宣稱的「重複 / File 全拒」對這個欄位並不成立。三態分開才對得起那句宣稱。
  const detail = readSingle(form, CANCEL_REASON_DETAIL_FIELD);
  if (detail.kind === 'invalid') return { ok: false };
  const detailRaw = detail.kind === 'value' ? detail.value : null;
  let reasonDetail: string | null = null;
  if (reasonCode === 'other') {
    if (detailRaw === null || rpcTrim(detailRaw) === '') return { ok: false };
    reasonDetail = detailRaw;
  } else if (detailRaw !== null && rpcTrim(detailRaw) !== '') {
    // 🔴 非 other 卻填了實質內容 = 表單狀態不對(不是靜默丟掉)——
    //    丟掉的話員工會以為說明存進去了,而那段字永久消失。
    return { ok: false };
  }

  const modeRaw = readString(form, CANCEL_MODE_FIELD);
  if (modeRaw === null || !(CANCEL_MODES as readonly string[]).includes(modeRaw)) {
    return { ok: false };
  }
  const entries = form.getAll(CANCEL_ITEM_FIELD);

  if (modeRaw === 'full') {
    // 🔴 整單取消卻帶了品項 = 表單狀態不對,**不是**「忽略多餘欄位」:
    //    整單取消送出去會取消全部品項,而員工可能以為只取消勾的那幾個。
    if (entries.length > 0) return { ok: false };
    return { ok: true, orderId, reasonCode, reasonDetail, items: null, requestToken };
  }

  // 部分取消:至少一筆(鏡像 `:149-152` 的「需為非空陣列」)。
  if (entries.length === 0) return { ok: false };
  const items: CancelItemInput[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== 'string') return { ok: false };
    const parsed = parseItemEntry(entry);
    if (parsed === null) return { ok: false };
    // 🔴 重複品項 RPC 會 RAISE(`:176-180`)⇒ 這層先擋,免得員工看到誤導的「不能取消」。
    // 🔴 **比對前先轉小寫**(R1 must-fix):`isUuid` 是 `/i`、RPC 去重用 `(el->>'order_item_id')::uuid`
    //    (大小寫不敏感)⇒ 同一顆 uuid 一大寫一小寫會過得了這層、到 RPC 才被 RAISE,
    //    而那條路的終點是「導頁(D5 之後由帳本核對面板說「寫進去了沒有」;在那之前畫面空白)、輸入不保留」。
    const dedupKey = parsed.order_item_id.toLowerCase();
    if (seen.has(dedupKey)) return { ok: false };
    seen.add(dedupKey);
    const overridden = applyQuantityOverride(form, parsed);
    if (overridden === null) return { ok: false };
    items.push(overridden);
  }
  return { ok: true, orderId, reasonCode, reasonDetail, items, requestToken };
}
