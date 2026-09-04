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
/**
 * 🔴🔴 **「要不要開發票」那顆勾選**(2026-09-04 `⟦b4-INVOICE5PCT⟧` 第 2 步;Sean 第十八題拍甲)。
 *
 * 🛑 **它與下面那五個 `invoice_*` 是【兩件事】** —— 那五個講的是「**開的話, 抬頭寫誰**」,
 *    本欄講的是「**開不開**」。⇒ 📌 勾了才輪得到那五個;沒勾, 那五個講的是一張不會存在的發票。
 *
 * ⚠️ **HTML checkbox 的形狀**:沒勾的時候**這個欄位根本不會出現在 payload 裡**
 *    ⇒ 🔴 **「沒勾」與「這個表單版本沒有這一格」在解析端【是同一個空白】。**
 *    ⇒ ✅ 修法**不在解析端**:表單那邊搭一個**同名 hidden(`off`)**, 讓這一欄永遠出現
 *       ⇒ 解析端用 **`getAll()`** 取最後一個值, 三個世界(不在 / off / on)才真的分得開。
 *       (⛔ ~~原本這裡寫「用 `has()` 而不是 `get()`」~~ —— 那是我第一版的寫法, 實碼從來不是。)
 */
export const MANUAL_ORDER_INVOICE_REQUESTED_FIELD = 'invoice_requested';
export const MANUAL_ORDER_INVOICE_TYPE_FIELD = 'invoice_type';
export const MANUAL_ORDER_INVOICE_CARRIER_FIELD = 'invoice_carrier';
export const MANUAL_ORDER_INVOICE_TITLE_FIELD = 'invoice_title';
export const MANUAL_ORDER_INVOICE_TAX_ID_FIELD = 'invoice_tax_id';
export const MANUAL_ORDER_INVOICE_DONATE_CODE_FIELD = 'invoice_donate_code';

// ── 面板裡「直接新增這位客人」那一小張表單的兩欄(`createManualCustomerAction` 專用)──────
// 🔴 **它們不進 `parseManualOrderForm()`** —— 那是**另一張 form**(HTML 不允許 form 巢狀,
//    而且它送去的是另一支 action)。放在這裡只是為了與其他欄名同一個定義處,
//    不得因為住在同一支檔就以為建單解析器讀得到它們。
// 🔴 **只有姓名與電話,沒有地址**:`createManualCustomer`
//    的 `ManualCustomerInput`(`lib/customers/manual-customer.ts:82`)**沒有地址那一格**。
//    ⚠️ 2026-08-28 訂正:上一版寫「就只有 `{ name, phone }`」——**而同一份 diff 剛給它加了第三個欄位
//    `requestId`** ⇒ 那不是行號漂移,是**我描述了一個我自己剛改掉的東西**(R3 F7)。
//    地址住在**訂單**上(`ship_to_*` 三欄)。
//    ⚠️ 2026-08-28 第二次訂正:~~「不住在客人檔案上 ⇒ 這裡多開一個地址欄會建出一個
//    **沒有人會去讀**的值」~~ **作廢**。客人的地址簿是 `customer_addresses`
//    (`supabase/migrations/20260523034911_init_customers_and_subtables.sql:40`),
//    欄名 `name` / `phone` / `line` 與 `ship_to_*` 三格**逐字同名**,
//    而後台**已經在讀它**(`apps/admin/src/lib/customers/load-customer-detail.ts:105`)。
//    ⇒ **它不是沒有人讀,是【沒有人寫】** —— 全 repo 唯一的寫入點是客人自己在前台
//      (`apps/storefront/src/app/account/address/actions.ts:70`)。
//    📌 **形狀:我當時沒查那張表就下了「沒有人會去讀」的結論,而那句話會擋住下一個人做對的事。**
//       一個沒查的前提被凍進註解之後,讀起來與一個查過的結論**長得一模一樣**。
//    ✅ Sean 2026-08-28 `Q-建單2 ⇒ 甲`:建單時要把收件那三格順手存進客人的地址簿(**片乙**)。
export const MANUAL_CUSTOMER_NEW_NAME_FIELD = 'new_customer_name';
export const MANUAL_CUSTOMER_NEW_PHONE_FIELD = 'new_customer_phone';

/**
 * 「這張表單此刻長在面板裡」的旗標(值恆為 `'1'`;沒送 = 整頁版)。
 *
 * 🔴 **它是【兩個值的封閉集】,不是導頁網址** —— 兩個 action 拿它去挑導頁基底,
 *    而一個只有兩個成員的集合構造不出第三個目標(理由全文在
 *    `manual-order-action-state.ts` 的 `manualOrderBasePath` 那一段)。
 * 🔴 **它不進 `parseManualOrderForm()`**:那支產的是「RPC 收得下的形狀」,
 *    而這個旗標一個字都不該送進資料庫。
 */
export const MANUAL_ORDER_IN_PANEL_FIELD = 'in_panel';
export const MANUAL_ORDER_IN_PANEL_VALUE = '1';
// ── 品項:**六個平行的可重複原生欄位**(A3-c;主視窗 2026-08-24 裁「丙」)────────────
// 🔴🔴 **為什麼不是一個 JSON 欄**(原本是,`~~manual_order_line~~` 已退場):
//    `cancel-form-body.tsx` 的**不變式 (i)** 逐字:
//      「送出值一律**不由 client state 產生或回寫;原生控制項才是送出來源**」
//    ——那是 `E-011-STOP` 四輪修不穩 + 一次**誤送整單取消**換來的。
//    而「把六格湊成一個 JSON 字串」一定得**讀值再組值**,那正是它禁止的動作。
//    ⇒ 兩者**形狀上互斥**,不是小心一點就能同時成立。
//    ⇒ 改成六個平行原生欄之後:**client 只決定「有幾列」,一個值都不碰。**
// ⛔ ~~**代價是平行陣列會失同步**,所以下面 `readLines()` 對「六個長度不全等」是**立即拒、不補齊**~~
// 🔴 **上面那句描述的是【第一版】(同名可重複 + 長度全等), 帶列號之後【沒有長度檢查這回事】。**
//    (Fable R3 F1:而我把那道檢查弄丟了 —— 換形狀時只搬了「重複」與「缺號」, **忘了「缺格」**。)
//    現行三道,逐條都有負測 + 突變釘住:
//      · 同一格送兩份 / 不是字串 ⇒ 拒(`readSingle` 的 `invalid`)
//      · 這一列在席而某一格【整個沒送】⇒ 拒(**不補空字串** —— 補了會讓 variant 靜默變代購)
//      · 列號中間缺一號而後面還有東西 ⇒ 拒(不得靜默截斷)
// ⚠️ **`line_spec` 本片【沒有畫面入口】**(它是任意鍵字典,原生控制項表達不出來)⇒ 一律送空。
//    **這是明說的缺口,不是做完了。** 要做 spec UI 請當獨立條目。
// 🔴🔴 **欄名帶列號 `line_sku_0` / `line_sku_1` …,而那是 codex R1 逼出來的第二版形狀。**
//    第一版是六個同名的可重複欄位 + 「六欄長度全等」拉鍊。codex 打破了它:
//      「第一列的 `line_qty` 因為 `disabled` 而不送,同一張表單尾端又有一個同名殘留欄位
//        ⇒ 六欄仍然等長,而 qty 變成 `[第二列數量, 殘留舊值]`
//        ⇒ 建出一張**第一列品項配第二列數量**的合法錯單。」
//    ⇒ **長度相等擋不住錯位** —— 因為長度裡沒有【身分】。
//    ⇒ 改成欄名自己帶列號之後,**每一格的身分寫在它自己的名字裡** ⇒ 那一整族不存在了,
//      不是被擋下來。同名重複送兩份也擋得住(`readSingle` 的 `invalid` 三態)。
//    📌 形狀:**「六個東西數量一樣多」不等於「它們配對正確」。要驗配對就得有配對的鍵。**
export const manualOrderLineField = (base: string, index: number) => `${base}_${index}`;
export const MANUAL_ORDER_LINE_SKU_BASE = 'line_sku';
export const MANUAL_ORDER_LINE_TITLE_BASE = 'line_title';
export const MANUAL_ORDER_LINE_QTY_BASE = 'line_qty';
export const MANUAL_ORDER_LINE_UNIT_PRICE_BASE = 'line_unit_price';
export const MANUAL_ORDER_LINE_VARIANT_BASE = 'line_variant_id';
export const MANUAL_ORDER_LINE_SPEC_BASE = 'line_spec';

/** 六欄的 base 名。順序**綁死**下面 `readLines()` 的取值順序。 */
const LINE_BASES = [
  MANUAL_ORDER_LINE_SKU_BASE,
  MANUAL_ORDER_LINE_TITLE_BASE,
  MANUAL_ORDER_LINE_QTY_BASE,
  MANUAL_ORDER_LINE_UNIT_PRICE_BASE,
  MANUAL_ORDER_LINE_VARIANT_BASE,
  MANUAL_ORDER_LINE_SPEC_BASE,
] as const;

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
  /**
   * 🔴 **這張單要不要開發票**(勾選欄;沒勾 = `false`)。
   * 🛑 與 `invoice` 是兩件事:那個講「開的話抬頭寫誰」, 本欄講「開不開」。
   */
  invoiceRequested: boolean;
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
/**
 * 「0 或正整數」的**單一權威**。⚠️ 2026-09-03 從 `const` 改成 `export`:
 * `manual-order-line-price-check.tsx` 要用**同一把尺**判「這個字串會不會被送出解析器接受」。
 * 🔴 **不要在別處重打一份** —— 今天實測過同型:重打的那份會比原本窄, 而窄化在 diff 上看不出來。
 */
export const NON_NEG_INT_RE = /^\d+$/;

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

/**
 * 空白判斷用 JS `trim()`(比 RPC 嚴,理由見檔頭)。
 *
 * ⚠️ **它量的是 Unicode code point,不是「員工眼裡看起來有沒有東西」**(codex R1 #3):
 *   · 貼進一個 **U+200B 零寬空白** ⇒ 畫面看起來完全空的,而 `isBlank()` 回 `false`
 *     ⇒ 那一列**不算空白列** ⇒ 他會看到「第 N 個品項沒有品名」而畫面上那格看起來就是空的。
 *   · 反過來,**U+3000 全形空白 / NBSP** 會被 `trim()` 吃掉 ⇒ 那一列被當成全空**靜默跳過**。
 * 🔴 **兩個方向都不好,而今天不修** —— 修它要決定「什麼叫做員工看得到的字」,那是拍板題。
 *    ⇒ 這裡只把限度寫下來,**不得讀成「空白列規則等於畫面上看起來空的列」**。
 */
const isBlank = (v: string) => v.trim() === '';

/** 一列品項的**原始六格**(全是字串,因為它們來自六個原生控制項)。 */
type RawLine = { sku: string; title: string; qty: string; unitPrice: string; variantId: string; spec: string };

/**
 * 照**列號**把品項讀出來(`line_sku_0` / `line_title_0` … / `line_sku_1` …)。
 *
 * 🔴 **每一格的身分寫在它自己的名字裡** ⇒ 沒有「拉鍊對錯位」這件事可以發生(見上方那段)。
 * 🔴 **一格同名送兩份 ⇒ 拒**(`readSingle` 的 `invalid`)—— 那正是第一版擋不住的攻擊面。
 * 🔴 **列號必須從 0 起連續** —— 中間缺一號就停,而**後面若還有東西就拒**:
 *    「第 0、1、3 列」代表有一列在路上不見了,而**靜默只收 0 與 1** 會讓那一列憑空消失。
 *
 * ⚠️⚠️ **它【做不到】什麼(照實寫,不要讀成「亂寫的列號會被拒絕」)**:
 *    本函式拿到的介面只有 `getAll(name)` —— **它沒有辦法列舉表單上到底有哪些欄名**。
 *    ⚠️ **精確一格**(Fable R3 F7):gap 檢查掃到 `j < MAX + 2` ⇒ `base_51` **看得到**
 *       (有缺號時會拒);**`base_52` 之後才是純忽略**。原文寫成「51 之外」是差一格。
 *    ⇒ 名字不是 `base_0` … `base_51` 的東西
 *      (`line_sku_9999` / `line_sku_-1` / `line_sku_00` / `line_sku_x`)
 *      **它根本看不到** ⇒ 那些格子是被【忽略】,不是被【擋下】。
 *    ✅ 而忽略是安全的那一邊:它們進不了訂單,不會憑空多出一列(有測試釘住)。
 *    🔴 要真的「擋下」得換介面(拿得到全部 key),那是另一件事;**今天只把限度寫在這裡。**
 */
function readLines(form: ManualOrderFormLike): RawLine[] | string {
  const rows: RawLine[] = [];
  // 🔴 `present` 的極性:**只要有一格【不是 missing】就算這一列在席**(含 `invalid`)。
  //    ⚠️ 寫成 `=== 'value'` 會讓「六格【全部】invalid(全部送兩份 / 全部是檔案)的一列」
  //    被判成不在席 ⇒ **整列靜默消失**, 而上面那道 invalid 守門根本走不到。
  //    (Fable R3 F3:那一發突變在 84 格全綠之下存活 —— 因為每個 invalid 測項的那一列
  //     都還有【別的字串格】撐住 `present()`。有負測釘住了。)
  const present = (i: number) => LINE_BASES.some((b) => readSingle(form, manualOrderLineField(b, i)).kind !== 'missing');
  for (let i = 0; i < MANUAL_ORDER_MAX_LINES + 1; i += 1) {
    if (!present(i)) {
      // 🔴 停在第一個空號之後,**還有東西 ⇒ 拒**(不得靜默截斷)。
      for (let j = i + 1; j < MANUAL_ORDER_MAX_LINES + 2; j += 1) {
        if (present(j)) {
          return '品項那幾欄對不起來了(可能是頁面沒載完就送出)。請重新整理這一頁,重新填一次品項。';
        }
      }
      break;
    }
    const cell: string[] = [];
    for (const b of LINE_BASES) {
      const read = readSingle(form, manualOrderLineField(b, i));
      if (read.kind === 'invalid') {
        // 同一格送了兩份(或不是字串)⇒ 拒。**不得挑一個用** —— 挑哪一個都是猜。
        return '品項那幾欄對不起來了(可能是頁面沒載完就送出)。請重新整理這一頁,重新填一次品項。';
      }
      // 🔴🔴 **這一列既然在席, 六格就【必須全部在席】** —— 少一格是拒, 不是補空字串。
      //    (Fable R3 F1 must-fix;而**這道檢查是我在第二版裡弄丟的**:
      //     第一版的「六欄長度全等」擋得住它, 換成帶列號之後我只擋了「重複」與「缺號」,
      //     **忘了擋「缺格」** ⇒ 一個原本會紅的情況被我改綠了。)
      //    🔴 失敗形狀最貴的是 `line_variant_id_i` 那一格:整個欄位沒送 ⇒ 補成空字串
      //    ⇒ **靜默退化成代購品項** ⇒ 員工畫面上打了商品編號, 建出來的是一個憑空的新品項,
      //      而每一格都合法、沒有東西會紅。正是本檔 `parseLineEntry` 三行註解說不准發生的事。
      //    ⚠️ 空字串 ≠ 沒送:`readSingle` 的三態把它們分得開, 而這裡靠的就是那個分別。
      if (read.kind === 'missing') {
        return '品項那幾欄對不起來了(可能是頁面沒載完就送出)。請重新整理這一頁,重新填一次品項。';
      }
      cell.push(read.value);
    }
    rows.push({
      sku: cell[0] ?? '', title: cell[1] ?? '', qty: cell[2] ?? '',
      unitPrice: cell[3] ?? '', variantId: cell[4] ?? '', spec: cell[5] ?? '',
    });
  }
  return rows;
}

/** 這一列六格**全空** ⇒ 員工按了「加一列」但沒填 ⇒ 跳過它。 */
const isEmptyRow = (r: RawLine) =>
  isBlank(r.sku) && isBlank(r.title) && isBlank(r.qty) && isBlank(r.unitPrice) && isBlank(r.variantId) && isBlank(r.spec);

/**
 * 解析一列品項。
 *
 * 🔴 **每一條欄位規則都是從原本那支 JSON 版【原封搬過來的】,一條都沒有重寫**
 *    (主視窗 2026-08-24 裁丙時逐字要求:「照抄的時候把旁邊的註解一起搬」)——
 *    差別只在**值從哪裡來**:原本是 `JSON.parse` 出來的 `unknown`,現在是六個字串。
 *
 * 🔴 **`index` 是【畫面上的列號】,不是有效列的序號** —— 跳過空列**不得**讓後面的列改號。
 *
 * ⚠️ **而理由不是「員工照訊息去找」**(我第一版這樣寫,2026-08-24 夜 R1 抓到那是假的):
 *    `manual-order-actions.ts` 把 `parsed.error` 送進 `console.warn`,**導頁只帶一個固定碼 `invalid`**
 *    ⇒ 員工在畫面上看到的是 `result-banner.tsx` 那句固定文案「表單內容不正確,未儲存。」
 *    ⇒ **這個列號到得了 log,到不了人。**
 * 🔴 **那它為什麼還要對?** —— 因為災難當天有人拿著 log 去對畫面,列號錯一格就對到別的品項。
 *    (而「怎麼把這句話送回畫面上」是 `manual-order-actions.ts` 檔頭點名**還沒做**的那一題。)
 */
function parseLineEntry(raw: RawLine, index: number): ManualOrderLineInput | string {
  const at = `第 ${index + 1} 個品項`;

  if (isBlank(raw.sku)) return `${at}沒有料號。`;
  if (isBlank(raw.title)) return `${at}沒有品名。`;

  // 🔴 數字這兩格與原版的差別**只有型別入口**:原本 JSON 直接給 number(於是檢查 `Number.isInteger`),
  //    現在是字串 ⇒ 先用 `NON_NEG_INT_RE` 擋掉 `+3` / `3.0` / ` 3 ` / `3e0`(**與運費那一格同一把尺**),
  //    再轉成 number。**規則本身沒有放寬:仍然是「大於 0 的整數」與「0 或正整數」。**
  if (!NON_NEG_INT_RE.test(raw.qty)) return `${at}的數量要是大於 0 的整數。`;
  const qty = Number(raw.qty);
  if (qty <= 0) return `${at}的數量要是大於 0 的整數。`;
  if (qty > MANUAL_ORDER_MAX_QTY) {
    return `${at}的數量超過單筆上限 ${MANUAL_ORDER_MAX_QTY};真的要這個量請找系統維護。`;
  }
  if (!NON_NEG_INT_RE.test(raw.unitPrice)) return `${at}的單價要是 0 或正整數。`;
  const unitPrice = Number(raw.unitPrice);

  // 🔴 `variant_id` 三態:**完全沒打字**(空字串)⇒ 代購品項;打了東西就必須是 uuid。
  //    帶一個不是 uuid 的字串**不得**默默退化成代購 —— 那會把「選錯商品」變成「憑空新增一個品項」。
  //
  // 🔴🔴 **這裡用 `!== ''` 而【不是】`isBlank()`,而我第一版寫錯了**(2026-08-24 夜 R1 抓到):
  //    `isBlank()` 會把「只打了空白的商品編號」也當成沒填 ⇒ **靜默退化成代購品項**,
  //    正好是上面那句話說不准發生的事。**而我還寫了一格測試把那個行為釘成期望值** ——
  //    ⇒ 那條規則被放寬了,而**沒有任何東西會紅**。
  //    ⚠️ 真實情境:從 Excel 貼一格帶前後空白的編號 ⇒ 建出一個沒連到商品的憑空品項。
  //    📌 **與本檔其他欄位刻意不一致,而那是對的**:別處用 `isBlank()` 是為了「比 RPC 嚴」,
  //       這一格用 `!== ''` 也是為了嚴 —— **同一個目的,在這一格要用另一個運算子。**
  //       (只打空白 ⇒ 落進下面的 uuid 檢查 ⇒ 被指名擋下,而不是靜默改變品項的性質。)
  let variantId: string | null = null;
  if (raw.variantId !== '') {
    if (!UUID_RE.test(raw.variantId)) {
      return `${at}的商品編號格式不對,請重新從商品清單挑一次。`;
    }
    variantId = raw.variantId;
  }

  // spec:空 ⇒ 空物件。每個值都必須是字串(RPC `:381` 那道自驗的鏡像)。
  // ⚠️ 本片**沒有畫面入口**送這一格(見上方欄位常數那段)⇒ 實務上一律走空的那條路。
  //    規則留著是因為欄位存在;**不得**因為「反正沒人送」就把它拿掉。
  // 🔴 **這裡也用 `!== ''` 而不是 `isBlank()`,理由同 `variant_id` 那格**(codex R1 #5):
  //    舊的 JSON 版對 `spec: "   "` 會因為「不是物件」而**拒**;用 `isBlank()` 會把它變成 `{}`
  //    ⇒ 又是一條被靜默放寬的規則。**完全沒送(空字串)才等於沒填。**
  const spec: Record<string, string> = {};
  if (raw.spec !== '') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.spec);
    } catch {
      return `${at}的規格格式不對。`;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return `${at}的規格格式不對。`;
    }
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v !== 'string') return `${at}的規格「${k}」只能填文字。`;
      spec[k] = v;
    }
  }

  return { sku: raw.sku, title: raw.title, qty, unit_price: unitPrice, variant_id: variantId, spec };
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
    // 🔴 ~~原字面:「沒有的話要先去客戶頁建立」~~ —— **那是第三個把員工指到死路的地方**
    //    (客人頁沒有「新增」那顆鈕;前兩處已於 2026-08-28 改掉)。
    //    ⚠️ 而這一句本身現在**幾乎印不出來**:送出鈕沒選客人時是灰的(`manual-order-submit.tsx`)。
    //    ⇒ 留著它是 fail-safe(繞過 JS 直接 POST 也要有話說),**但它不得再說謊。**
    return { ok: false, error: '沒有選客人。請回建單畫面挑一位客人,找不到就在那裡直接建一位。' };
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

  // 🔴🔴 **checkbox 的「沒勾」與「表單壞了」在 payload 上是【同一個空白】**
  //   (2026-09-04 `⟦b4-INVOICE5PCT⟧` 第 2 步)
  //   HTML 的 checkbox **沒勾的時候整個欄位不出現** ⇒ 那與「**這個表單版本根本沒有這一格**」
  //   印同一個空白, 而兩者的正確答案**相反**(一個是他決定不開, 一個是**我不知道**)。
  //
  //   ✅ **⇒ 修法不是在解析端猜, 是讓那個欄位【永遠存在】**:表單那邊在 checkbox 前面
  //      放一個**同名的 hidden(值 `off`)** ⇒ 三個世界從此真的分得開。
  //
  //   🔴 **而三個世界的處置, 是 codex R1 五條 must-fix 改過的**(原本我寫錯兩件事):
  //     ① `[]`(欄位整個不在)⇒ **拒絕建單**。
  //        ⛔ ~~原本寫「fail-closed 退回常態 `true`」~~ —— **那個字用錯了**:`true` = 開發票 =
  //        **多做一件事**, 那是 **fail-open**。而它會在表單壞掉時**安靜地替他做一個決定**,
  //        且錯的方向剛好是「客人拿到一張他沒要的發票」。⇒ 錢路徑上, 契約壞掉要**停**, 不要猜。
  //     ② 值只認**逐字** `on` / `off` 兩種。⛔ ~~原本「最後一個值是不是 `on`」~~ ⇒
  //        `off, 亂碼` 也會安靜變成 `false`。錢路徑不接受「看不懂就當作沒勾」。
  //   📌 **⇒ 這一格是「兩個世界要印不同的東西」套在【HTML 表單】上** ——
  //      而 checkbox 天生違反它, 那個 hidden 就是把它補回來。
  const invoiceRequestedRaw = form
    .getAll(MANUAL_ORDER_INVOICE_REQUESTED_FIELD)
    .map((v) => String(v));
  if (invoiceRequestedRaw.length === 0) {
    return {
      ok: false,
      error:
        '這張表單少了「要不要開發票」那一格,不能建單。請重新開一張空白建單表單;還是這樣就找工程師。',
    };
  }
  const invoiceRequestedLast = invoiceRequestedRaw[invoiceRequestedRaw.length - 1];
  if (invoiceRequestedLast !== 'on' && invoiceRequestedLast !== 'off') {
    return {
      ok: false,
      error: '「要不要開發票」那一格的值看不懂,不能建單。請重新開一張空白建單表單。',
    };
  }
  const invoiceRequested = invoiceRequestedLast === 'on';
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

  const rows = readLines(form);
  if (typeof rows === 'string') return { ok: false, error: rows };
  // ⚠️ **這裡數的是【含空白列】的列數,而 RPC 數的是剝完空列的 `p_lines`**(`20260824020000:286`)
  //    ⇒ 兩層的分母不同。本層**比較嚴**(50 列裡只填 3 列也會被擋)⇒ 方向是安全的。
  //    UI 把「加一列」封頂在 50 ⇒ 正常操作到不了這裡;構造出來的 POST 才會讓兩層給不同答案。
  if (rows.length > MANUAL_ORDER_MAX_LINES) {
    return { ok: false, error: `一張單最多 ${MANUAL_ORDER_MAX_LINES} 個品項,超過請拆成兩張單。` };
  }
  const lines: ManualOrderLineInput[] = [];
  let subtotal = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row === undefined) return { ok: false, error: `第 ${i + 1} 個品項的資料壞掉了。` };
    // 🔴 **全空的列跳過,而【部分空】的列不跳過** —— 它會掉進 `parseLineEntry` 被指名擋下。
    //    ⚠️ **不得把部分空也靜默跳過**:員工填了料號忘了價格,靜默跳過會讓那一列**憑空消失**,
    //       而畫面回報「建立成功」⇒ 他要等到對帳那天才發現少一項。
    //       ⇒ 兩者的差別是「他沒打算填」與「他填到一半」,而只有後者需要被告知。
    if (isEmptyRow(row)) continue;
    const parsed = parseLineEntry(row, i);
    if (typeof parsed === 'string') return { ok: false, error: parsed };
    lines.push(parsed);
    subtotal += parsed.unit_price * parsed.qty;
  }
  // 🔴 這一格搬到迴圈**之後**(原本在之前):現在「零列」與「全部都是空列」是同一件事,
  //    而員工看到的下一步一樣 —— 都是「去填一個品項」。
  if (lines.length === 0) return { ok: false, error: '這張單還沒有品項,至少要加一個。' };
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
      invoiceRequested,
      shippingFee,
      lines,
    },
  };
}
