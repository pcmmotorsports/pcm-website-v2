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

import { NotificationEmailInput } from '@pcm/schemas';
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
export const MANUAL_ORDER_SHIPPING_FEE_TAX_BASIS_FIELD = 'shipping_fee_tax_basis';
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

/**
 * **瀏覽器這一側**讀那顆勾選(`⟦b4-INVOICE5PCT⟧` 2026-09-09)。
 *
 * 🔴 **為什麼要有這一支, 而不是各自 `querySelector`**:從 RPC 第 7 代起,
 *    「要不要開發票」決定了**含稅價要不要換算成未稅**(見 `parseLineEntry` 那一段)
 *    ⇒ 畫面上那兩道提示(單價對帳 / 除不盡擋送出)都要問同一個問題。
 *    ⇒ 📌 **各寫一份的話它們會分岔, 而分岔的那天只有一邊會錯。**
 *
 * 🔴🔴 **它照【送出去會長什麼樣】算, 不是只看那顆 checkbox 勾了沒。**
 *    ⛔ ~~第一版寫「只認 checkbox, 讀不到就回 `true`」~~ **codex R1 2026-09-09 nit ④ 打掉它**:
 *      只有 **checkbox 不見了而 hidden `off` 還在**的時候, 送出去的是 `['off']`
 *      ⇒ **server 合法解析成「沒勾」**, 而這裡回 `true`
 *      ⇒ 📌 **兩邊對同一張表單得到相反的答案**(反例:含稅單價 `999`,
 *         瀏覽器以「除不盡」擋住送出, 而 server 本來會原樣收下 999)。
 *    ✅ 改成**鏡像 server 的規則**:把會被送出的同名控制項依文件順序取**最後一個**的值
 *      —— 那正是 `parseManualOrderForm` 用 `getAll()` 取最後一個在做的事。
 *      (checkbox 沒勾就不會被送出 ⇒ 只剩 hidden 的 `off`;勾了就是 `['off','on']` ⇒ 取 `on`。)
 *
 * ⚠️ **回 `null` = 這張表單的那一格【壞掉了】**,不是「沒勾」:
 *    一個控制項都沒有, 或最後那個值不是逐字 `on`/`off`。
 *    🔴 **兩個呼叫端拿到 `null` 都【不說話】** —— 一句在錯的前提上算出來的提示,
 *      比沒有提示糟:它會叫員工去改一個沒有錯的數字。
 *    🛑 **而 server 那一側對同樣的世界是【拒絕建單】** —— 兩邊刻意不同:
 *      這裡決定「要不要多講一句話」, 那裡決定「錢怎麼算」。⇒ 提示層不猜, 金流層拒絕。
 */
export function readInvoiceRequestedFromForm(form: HTMLFormElement): boolean | null {
  // 🔴🔴 **用 `FormData` 而不是自己挑元素**(codex R2 2026-09-09 nit ②)。
  //    ⛔ ~~`querySelectorAll('input[name=…]')` 再濾掉沒勾的 checkbox~~ —— 那是**我重寫了一遍
  //      瀏覽器的送出規則**, 而它至少漏三種形狀:
  //      · 勾了而 **`disabled`** 的 checkbox(不會被送出, 而我的濾法把它算進去)
  //      · `disabled` 的 `<fieldset>` 裡的控制項(整組不送)
  //      · 用 `form="…"` 屬性關聯到這張表單的**外部**控制項(會送, 而我的 selector 找不到)
  //    ⇒ 📌 **`new FormData(form)` 就是瀏覽器【真的會送出去的那一份】** ——
  //      同一件事不要有第二個實作, 而那個實作遲早與真的那份分岔。
  //    🔵 `getAll()` 依文件順序回傳, 取最後一個 —— 與 `parseManualOrderForm` 那一側同一條規則。
  const values = new FormData(form).getAll(MANUAL_ORDER_INVOICE_REQUESTED_FIELD);
  const last = values[values.length - 1];
  if (typeof last !== 'string') return null;
  if (last !== 'on' && last !== 'off') return null;
  return last === 'on';
}

/**
 * 🔴 **通知 email —— 留白 = 不寄**(⟦f3-MAILFALLBACKVSRULING⟧ 片 E;Sean 已拍的語意)。
 *
 * 🛑 **它與 `invoice_requested` 那顆勾選【形狀不同】, 不要照抄那一套**:
 *    checkbox 沒勾時**根本不出現在 payload** ⇒ 那邊才需要 hidden + `getAll()` 三個世界。
 *    text input **一定會出現**(留白就是空字串)⇒ 這裡用 `get()` 就夠。
 * ⚠️ **而「缺欄」仍然當錯**(與那一顆同一個判準, 理由不同):
 *    text input 缺欄 = 這張表單不是本版 ⇒ 放行的話, 員工填的那格會被靜靜丟掉。
 *    🔵 我想過寬鬆版(缺欄 ⇒ 當作不寄)—— 那**在今天是安全的**(手動單本來就一律不寄),
 *       而它的代價是:表單與解析端漂開的那一天, **沒有東西會叫**。⇒ 選 fail-loud。
 */
export const MANUAL_ORDER_NOTIFICATION_EMAIL_FIELD = 'notification_email';
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
/**
 * 這一列的單價是**未稅**還是**含稅**(⟦b4-PURCHTAX1⟧ 2026-09-06,Sean `Q5 = 甲`)。
 *
 * 🔴🔴 **為什麼要多一格, 而不是「猜」**:代購品項(`variant_id` 留白)**沒有權威價可以比**
 *    —— 型錄品項靠 `manual-order-line-price-check.tsx` 拿經銷未稅價去對, 而代購沒有那個東西。
 *    ⇒ 任何「看起來像含稅就擋」的守門, 在代購這一側**只能是猜的**;
 *      而「**把一個猜測講成指示**」正是同一支比價元件上一輪 codex must-fix 修掉的東西。
 *    ⇒ 📌 **所以這一格不猜, 它【問】。** 一個不被強制的假設, 換成一個必須送上來的值。
 *
 * 🔴 **每一列都有這一格, 不是只有代購列** —— 那不是範圍擴張, 是 `readLines()` 逼出來的:
 *    它的不變式是「**這一列在席 ⇒ 每一格都必須在席**」(少一格是拒, 不是補空字串)。
 *    ⇒ 只長在代購列的話, 型錄列會少一格 ⇒ **整張表單被拒**。
 *    🔵 而型錄列的預設值與今天完全相同(未稅)⇒ **對它們是零行為改變、零額外點擊**。
 */
export const MANUAL_ORDER_LINE_TAX_BASIS_BASE = 'line_tax_basis';
/** 未稅(預設)—— 畫面那句橘字逐字要求的那一種,而 RPC 第 6 代自己算稅。 */
export const MANUAL_ORDER_LINE_TAX_BASIS_UNTAXED = 'untaxed';
/** 含稅 —— 員工手上那張單就是含稅價(代購常見)⇒ 由我們換算回未稅再送出去。 */
export const MANUAL_ORDER_LINE_TAX_BASIS_TAXED = 'taxed';

/**
 * 含稅 ⇒ 未稅。**除得盡才回數字, 除不盡回 `null`。**
 *
 * 🔴🔴 **整數運算, 不用 `/ 1.05`** —— 5% 的關係是 21/20。
 *  ⛔ ~~理由原本寫「浮點除法會給 `4200 / 1.05 = 3999.9999999999995`」~~ ——
 *     🔴 **那個數字是我編的, 而 codex 當場戳破**(2026-09-06)。
 *     🔬 我自己複量:`4200/1.05 = 4000`(整數), 而**21 的倍數到 210,000 為止, `/1.05` 全是整數**
 *        ⇒ 那個例子在實務金額範圍內**根本構造不出來**。
 *     📌 ⇒ **一個正確的決定, 配一個我沒有量過的理由。** 決定留著, 理由換成量到的:
 *  ✅ **真正的理由有兩個**:
 *     ① `x % 1.05` 這種寫法要問「除得盡嗎」很彆扭, 而 `(x*20) % 21` 是**精確的整數判準**
 *        —— 它等價於「x 是 21 的倍數」(codex 複核同意)。
 *     ② 🔬 而浮點確實會在**很大**的數上出事:codex 量到 `x*20` 的第一個失真點是
 *        **1,801,439,850,948,199** —— 遠在實務金額之外(解析器與 int4 上限先擋住),
 *        ⇒ **那是「為什麼這樣寫仍然對」, 不是「為什麼非這樣寫不可」。**
 *  🛑 **而【不四捨五入】那個決定, 有一個量到的理由**(codex 提供, 我複核):
 *     含稅 999 ⇒ 若四捨五入成未稅 951, 數量 1 加回 5% 是 999 ✅, 而**數量 2 是 1,997 而不是 1,998**
 *     ⇒ 一塊錢的洞, 每一筆都長得很正常。⇒ **拒絕比反推安全。**
 * 🛑 **除不盡【不四捨五入】, 回 `null` 讓呼叫端擋下來** ——
 *    差一塊錢在對帳上是一個永遠找不到的洞, 而它每一筆都長得很正常。
 * 🔵 **共用同一支** —— 瀏覽器那一側(`manual-order-submit.tsx` 的送出前守門)
 *    與 server 這一側(`parseLineEntry`)呼叫的是**這一支**。
 *    各寫一份的話, 員工看到的數字與進 DB 的數字會有兩個來源, 而它們遲早不一樣。
 */
/**
 * 除不盡時要說的那句話。**兩個數字都要在裡面。**
 * 🛑 只說「除不盡」的話, 員工的下一個動作是**亂改一個數字直到它過** —— 而那筆錢沒有人驗過。
 * 🔵 與 `untaxedFromTaxed` 一樣是共用的:瀏覽器擋下來時說的, 與 server 拒絕時說的,
 *    必須是**同一句** —— 兩句話會讓員工以為那是兩個不同的問題。
 */
export function taxBasisProblemMessage(at: string, taxed: number): string {
  return (
    `${at}的單價 ${taxed.toLocaleString()} 標成含稅,而它換算回未稅是 ` +
    `${((taxed * 20) / 21).toFixed(2)}(約) —— 不是整數,系統不敢自己四捨五入(那會安靜地改掉金額)。` +
    `請跟對方問到未稅金額,填進去之後把這一列改回「未稅」。` +
    `⚠️ 不要把上面那個約略的小數填進來,它不是正確答案。`
  );
}

/**
 * **【運費】的含稅換未稅 —— 除不盡就不收。**
 *
 * 🔴🔴 **[2026-09-10] 這一支【只剩運費在用】,而那個限縮是承重的。**
 *    ⛔ ~~本支原本同時給【品項】與【運費】用~~ ⇒ 品項那半改走殘差(`untaxedForTaxedLine`)。
 *    🛑 **而運費【不准】跟著放寬** —— 那支殘差 migration(`20260910090000`)的檔頭 `:120-122`
 *      **點名警告過「下一片」,而那一片就是這一次的改動**,逐字:
 *      「運費仍呼叫同一支 `untaxedFromTaxed` ⇒ 下一片若把它改成四捨五入,運費會【同步】被放寬,
 *        而本函式收不到運費稅基 ⇒ 含稅品項 1,050 + 含稅運費 31 ⇒ 總額 1,082 而應收 1,081」
 *    🔬 **而我照 RPC 的算式逐格重算過,沒有只信那句註解**:
 *      品項 1,050 ⇒ 未稅 1,000 · 殘差 50;運費 31 若放寬 ⇒ 30
 *      `v_untaxed_base = 0`(含稅列不進正推稅基)· `v_tax = round((0+30)×5%) + 50 = 52`
 *      ⇒ `v_total = 1000 + 30 + 52 = 1,082`,而應收 `1050 + 31 = 1,081` ⇒ **差一塊,對上了。**
 *    🎯 **成因**:RPC **收不到運費的稅基** ⇒ 運費永遠走正推 ⇒ **它的殘差沒有人補回來。**
 *    🔴🔴 **而方向要說對**(2026-09-10 codex 唯讀審 nit,採信):那個反例是
 *      應收 1,081 而算成 **1,082** ⇒ **多收一塊,不是少收。**
 *      ⚠️ 我第一版逐字寫成「少收」—— **而錢的方向寫反,會讓下一個人以為它站在客人那邊。**
 *      📌 **一般地說它是【可能多收也可能少收】** —— 取決於捨入往哪一邊落;
 *        這個反例落在「多收」那一側。
 *    ⇒ 📌 **運費那半要等 RPC 收得到運費稅基才動,那是另一片。**
 *
 * 🛑 **除不盡【不四捨五入】,回 `null` 讓呼叫端擋下來** ——
 *    差一塊錢在對帳上是一個永遠找不到的洞,而它每一筆都長得很正常。
 */
export function untaxedFromTaxedShippingFee(taxed: number): number | null {
  if (!Number.isInteger(taxed) || taxed < 0) return null;
  return (taxed * 20) % 21 === 0 ? (taxed * 20) / 21 : null;
}

/**
 * **【品項】的含稅換未稅 —— 用減的(殘差),不拒收。**
 *
 * ✅ Sean 2026-09-10 拍「Q2′ 甲 = 改成用減的」。而**殘差本來就在 RPC 裡等著**
 * (`20260910090000`:`v_taxed_residual := … + (v_line_taxed − v_unit_price) × qty`),
 * 只是**在此之前,這個版本的 app 路徑沒有任何一處送 `unit_price_taxed`**
 * ⇒ 📌 **走 app 建單的那條路不會觸發殘差。**
 * ⚠️ **而【一次都沒跑過】那句話超過證據**(2026-09-10 codex 唯讀審 nit,採信)——
 *   我量的是「這一版的 `apps/` 與 `packages/` 沒有送那個鍵」,
 *   它**答不出**有沒有人直接呼叫 RPC、或別的部署版本送過。
 *
 * 🎯 **「用減的」的意思**:不是四捨五入回去,是**湊回員工打的那個數**。
 * ```
 * 含稅 1,100 ⇒ 未稅 round(1100×20/21) = 1,048 · 殘差 1100 − 1048 = 52
 *            ⇒ 小計 1,048 + 稅 52 = 1,100   ✅ 一塊都不差
 * ```
 * 🟢 **而「湊得回」是【結構上必然】不是巧合**:`(t − u) + u ≡ t`,與 `u` 怎麼算無關。
 *
 * 🔴🔴 **捨入:half-up。而【為什麼不是 banker's】要寫在這裡,不是只寫在 plan 裡。**
 * ```
 * PG   round()          ⇒ half-up   (0.5 ⇒ 1)
 * JS   Math.round()     ⇒ half-up   (0.5 ⇒ 1)   ← 本支用的就是它
 * 🔴 Python 內建 round   ⇒ 銀行家捨入(0.5 ⇒ 0)
 * ```
 * 📌 **這一句要救的是【下一個拿 Python 算一份對照表來對答案的人】** ——
 *    那份表在**每 21 個金額就有一個是錯的**,而**兩邊都不會紅**(它只是給出另一個合理的整數)。
 * 🎯 **而 2026-09-10 那個人就是我**:我用 Python 的 `round` 挑驗收的判別格,
 *    挑出「含稅 11」—— 而在 half-up 之下**殘差與正推都給 11** ⇒ **那一格零判別力。**
 *    ✅ 真正分得開的是**含稅 10**(殘差 ⇒ 10 · 正推 ⇒ 11)。
 *
 * 🔵 **回 `null` 只剩一種意思:輸入本身不是非負整數。** 不再有「除不盡」那一種。
 */
export function untaxedForTaxedLine(taxed: number): number | null {
  if (!Number.isInteger(taxed) || taxed < 0) return null;
  // 🔴 `Math.round` 是 half-up ⇒ 與 PG 的 `round()` 同一個行為(見上方那段)。
  //    而 `taxed × 20 / 21` **永遠落不到 .5**(`20t = 21k + 10.5` 無整數解)
  //    ⇒ 📌 這一格其實踩不到 half-up 與 banker's 的分歧, 而上面那段仍然要留著:
  //      **它擋的是【拿 Python 去算對照表】那個動作, 不是這一行本身。**
  return Math.round((taxed * 20) / 21);
}

/** 營業稅率 —— 5%,而它在 SQL 那側是 `admin_create_manual_order` 的 `* 0.05`(唯讀正式庫實量)。 */
export const MANUAL_ORDER_VAT_RATE = 0.05;

/** 一列的預覽輸入。**與送出去的欄位同名同義**,不是另一組概念。 */
export type ManualOrderPreviewLine = {
  readonly qty: number;
  readonly unitPrice: number;
  /** `untaxed` | `taxed` —— 與 `MANUAL_ORDER_LINE_TAX_BASIS_*` 同一個值集。 */
  readonly taxBasis: string;
};

export type ManualOrderPreview =
  | { readonly kind: 'ok'; readonly subtotal: number; readonly shippingFee: number; readonly tax: number; readonly total: number }
  /** 有一格含稅價換不回整數 ⇒ 送出去會被擋 ⇒ **預覽不編一個數字出來**。 */
  | { readonly kind: 'blocked'; readonly at: string; readonly taxed: number };

/**
 * 建單畫面那個**預覽**的算式。⟦b4-INVOICE5PCT⟧ ①+④(Sean 2026-09-10 拍 §4-c 丙)。
 *
 * 🔴🔴 **這是【第二份算式】,而那正是 `manual-order-lines.tsx:341` 那句話警告的東西**:
 *    「這裡沒有小計 —— 金額由 RPC 自己算,它不信任何 client 送的合計。
 *      **在畫面上算一份會生出「畫面說 A、單子是 B」的第二個真相。**」
 * 🛑 **而本函式【沒有推翻那句話】,它只鬆開一半**:
 *    · 那句話擋的是「client 算的數字**被送出去**」⇒ ✅ **本函式的輸出一個位元都不會送出去**,
 *      表單送的仍然只有「單價 + 稅基 + 那顆勾選」,總額仍然由 RPC 自己算。
 *    · 而它擔心的另一半(**兩份算式遲早不一樣**)⇒ 🔴 **是真的,而且無法用共用函式解決**:
 *      RPC 那一份**住在 SQL 裡**(`admin_create_manual_order` 的 `v_tax := round(...)`)。
 *    ⇒ ✅ **所以那一半靠【測試】守**:同一組輸入餵本函式與餵真的 RPC(拋棄式 PG),
 *      兩邊的總額必須相同。**沒有那一格,這一片就是在製造那句話警告的東西。**
 *
 * 🔵 **為什麼 Sean 要它**(2026-09-10 逐字):「我輸入單價,然後勾選開發票自己幫我 +5% 上去」
 *    —— 而今天要**建完單進訂單頁**才看得到。⇒ 這一格讓他**勾下去當場看到**。
 * 🎯 **而它同時是 §4-c 丙**:稅基下拉預設「未稅」,而他有時心裡填的是含稅價
 *    ⇒ 勾下去看到 1155 而不是他心裡的 1100 ⇒ **當場發現**,不必等到單建出來。
 *
 * 🛑 **規則【逐條鏡像 `parseManualOrderForm`】,不是我自己定的**:
 *    ① 含稅 ⇒ 未稅的換算**只在勾了發票時才做**(`:788` 逐字:沒勾 ⇒ 原樣送出,
 *       因為「沒勾就是他打的數字即總額」)。
 *    ② 除不盡 ⇒ **不四捨五入**,回 `blocked`(同一支 `untaxedFromTaxed` 回 `null` 的那條路)。
 *    ③ 稅基**含運費**:`round((小計 + 運費) × 5%)` —— 與 RPC 逐字相同。
 * ⚠️ **而規則 ②【將來會變】**:Sean 2026-09-10 拍了「反推那條路把稅帶著走」(plan §8),
 *    那一片落地之後**這裡要跟著改**,否則預覽會比實際嚴格。📌 兩者是同一批,不要各自演化。
 */
export function manualOrderPreview(input: {
  readonly lines: readonly ManualOrderPreviewLine[];
  readonly shippingFee: number;
  readonly shippingFeeTaxBasis: string;
  readonly invoiceRequested: boolean;
}): ManualOrderPreview {
  // 🔴🔴 **[2026-09-10] 這裡拆成【兩支】—— 而拆的理由是「它們現在的規則不一樣了」。**
  //    品項:走殘差,**不再拒收**(Sean 拍「用減的」)。
  //    運費:**維持整除才收**(RPC 收不到運費稅基 ⇒ 放寬會少收一塊;見那兩支的 docstring)。
  //    ⛔ ~~原本一支 `conv` 同時給兩者用~~ ⇒ 🛑 **一支共用函式在兩邊規則相同時是資產,
  //      而在規則分岔之後就是一個【看不見的耦合】** —— 改一邊會靜靜地改到另一邊。
  //    📌 而那正是那支 migration 檔頭 `:120-122` 點名警告的那一種改法。
  const convLine = (raw: number, basis: string): number => {
    // 🔴 沒勾發票 ⇒ **原樣**(規則①)—— 這一行是本函式與「無條件換算」的分界。
    if (!input.invoiceRequested || basis !== MANUAL_ORDER_LINE_TAX_BASIS_TAXED) return raw;
    // 🔵 `null` 只在「不是非負整數」時出現, 而那在呼叫端已經濾過 ⇒ 這裡退回原值而不是編一個數。
    return untaxedForTaxedLine(raw) ?? raw;
  };
  const convShipping = (raw: number, basis: string, at: string): number | { at: string; taxed: number } => {
    if (!input.invoiceRequested || basis !== MANUAL_ORDER_LINE_TAX_BASIS_TAXED) return raw;
    const untaxed = untaxedFromTaxedShippingFee(raw);
    return untaxed === null ? { at, taxed: raw } : untaxed;
  };

  let subtotal = 0;
  // 🔴🔴 **殘差要跟預覽一起走** —— RPC 第 8 代改成「含稅列走殘差、未稅列與運費走正推」
  //    (`20260910090000_m4b_manual_order_taxed_line_residual.sql`)。
  //    ⛔ ~~預覽照舊整包正推~~ ⇒ 含稅 1,100 × 2 預覽印 2,201 而系統實際收 2,200
  //      ⇒ 📌 **這個包存在的理由就是「員工打的含稅數字要回得來」, 預覽自己先違反它。**
  //    ⇒ 兩邊用同一個算法:未稅底 + 運費走正推, 含稅列的 `含稅 − 未稅` 直接相加。
  let taxedResidual = 0;
  let untaxedBase = 0;
  for (const [i, line] of input.lines.entries()) {
    // 🔵 品項那條路【不再回 blocked】—— 殘差把「除不盡」那個狀態消掉了。
    const unit = convLine(line.unitPrice, line.taxBasis);
    subtotal += unit * line.qty;
    if (input.invoiceRequested && line.taxBasis === MANUAL_ORDER_LINE_TAX_BASIS_TAXED) {
      taxedResidual += (line.unitPrice - unit) * line.qty;
    } else {
      untaxedBase += unit * line.qty;
    }
  }

  const shippingFee = convShipping(input.shippingFee, input.shippingFeeTaxBasis, '運費');
  if (typeof shippingFee !== 'number') {
    return { kind: 'blocked', at: shippingFee.at, taxed: shippingFee.taxed };
  }

  // 🔴 稅基**含運費**, 而**沒勾就是 0** —— 兩者都是 RPC 第 7 代的行為(plan §0-a 逐字量到)。
  const tax = input.invoiceRequested
    ? Math.round((untaxedBase + shippingFee) * MANUAL_ORDER_VAT_RATE) + taxedResidual
    : 0;
  return { kind: 'ok', subtotal, shippingFee, tax, total: subtotal + shippingFee + tax };
}

/**
 * ⛔ ~~六欄~~ ⇒ **七欄**的 base 名(⟦b4-PURCHTAX1⟧ 2026-09-06 加了稅基那一格)。
 * 順序**綁死**下面 `readLines()` 的取值順序。
 * 🔴 加一格的連帶:`readLines()` 的「在席就必須全部在席」會跟著變成七格
 *    ⇒ **畫面上每一列都要送這一格**, 少送 = 整張表單被拒(那是刻意的,見該處註解)。
 */
const LINE_BASES = [
  MANUAL_ORDER_LINE_SKU_BASE,
  MANUAL_ORDER_LINE_TITLE_BASE,
  MANUAL_ORDER_LINE_QTY_BASE,
  MANUAL_ORDER_LINE_UNIT_PRICE_BASE,
  MANUAL_ORDER_LINE_VARIANT_BASE,
  MANUAL_ORDER_LINE_SPEC_BASE,
  MANUAL_ORDER_LINE_TAX_BASIS_BASE,
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
  /**
   * 🔴🔴 **員工在這一列選的是「未稅」還是「含稅」——【原樣送給 RPC, 只為了記進稽核】。**
   *
   * ⛔ 第 7 代之前它**沒有離開過瀏覽器與這支解析器**:換算完就被消耗掉了。
   * 🔬 而 codex R3(2026-09-09, 換模型換角度)指出那是一個**看不見的資訊遺失**:
   *    沒勾開發票的時候兩者都不換算 ⇒ 「填 1,050 選含稅」與「填 1,050 選未稅」
   *    在資料庫裡**長得一模一樣** ⇒ 📌 三個月後退款爭議, 查不到他當初的意思。
   *    🛑 **不是 log 難找, 是那個資訊根本沒有被存下來。**
   * ✅ Sean 2026-09-09 拍甲逐字:「先上, 而同一片多做一件:把他選的『未稅/含稅』記進稽核紀錄」。
   *
   * 🔵 **它只進 audit, 不進金額、不進 `order_items`、不進冪等指紋** —— 三個都是刻意的:
   *    · 金額:它對錢的作用已經在這支檔裡算完了(見 `parseLineEntry` 那段換算)。
   *    · `order_items`:那要動表結構, 而 Sean 拍的範圍不含它。
   *    · 冪等指紋:🔴 **加進去會在部署窗製造一個真的失敗** —— 舊版表單不送這個鍵,
   *      新舊兩版對同一筆重送會算出不同指紋 ⇒ 被判「同鍵不同內容」而拒。
   *      ⇒ 📌 而它不影響「這是不是同一個請求」的答案:**錢一模一樣。**
   */
  tax_basis: typeof MANUAL_ORDER_LINE_TAX_BASIS_UNTAXED | typeof MANUAL_ORDER_LINE_TAX_BASIS_TAXED;
  /**
   * 🔴🔴 **員工打的【含稅原值】—— 只有「含稅 + 勾發票」那一種才有。**
   *
   * RPC(`20260910090000`)拿它做兩件事:
   *   ① 自己再算一次 `round(taxed×20/21)` 與我們送的 `unit_price` 比對, 不符就 RAISE
   *      ⇒ 📌 **我們不是唯一算的人** —— 兩邊算式分岔的那一天, 是 RPC 擋下來而不是安靜收下。
   *   ② `含稅 − 未稅` 當【殘差】加進稅額, 而且**乘以數量**
   *      ⇒ 🎯 總額湊回他打的那個數(`(t − u) + u ≡ t`, 結構上必然)。
   *
   * 🛑 **沒勾發票時不送(`undefined`)** —— RPC 對沒勾的單要求兩者相等, 不等就 RAISE。
   *    ⇒ 送 `null`/相等值都只是多一個可以說謊的欄位。
   */
  unit_price_taxed?: number;
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
  /**
   * 🔴 **通知 email;`null` = 不寄**(留白就是 `null`, 不是空字串)。
   * 🛑 空字串會被 `orders_notification_email_valid` 的 `~ '^[!-~]+$'` 擋掉 ⇒ 整張單建不出來。
   */
  notificationEmail: string | null;
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
type RawLine = { sku: string; title: string; qty: string; unitPrice: string; variantId: string; spec: string; taxBasis: string };

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
      taxBasis: cell[6] ?? '',
    });
  }
  return rows;
}

/**
 * 這一列**員工填的那幾格全空** ⇒ 他按了「加一列」但沒填 ⇒ 跳過它。
 *
 * 🔴🔴 **`taxBasis` 【刻意不算在裡面】, 而這一行是承重的**(⟦b4-PURCHTAX1⟧ 2026-09-06):
 *    那一格是一組 radio, **它永遠有值**(預設 `untaxed`)——
 *    ⇒ 把它加進這個 `&&` 的話,**畫面上那個空白開場列就再也不算「空」**
 *      ⇒ 它會掉進 `parseLineEntry` ⇒ 回「第 1 個品項沒有料號」
 *      ⇒ 🛑 **每一張單都送不出去**, 而錯誤訊息指著一列員工根本沒打算填的東西。
 *    📌 **判別句:這一格是【員工填的內容】還是【系統一定會送的東西】?**
 *      後者不能拿來判斷「他有沒有填這一列」。
 * ⚠️ 同理, 未來再加任何「一定有值」的欄位(hidden / select / checkbox 的預設)
 *    都**不得**加進這一行 —— 加進去的那一刻,空列就消失了。
 */
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
 *    ⇒ 員工在畫面上看到的是 `result-banner.tsx` 那句固定文案「表單有地方不對,沒有存進去。」
 *    ⇒ **這個列號到得了 log,到不了人。**
 * 🔴 **那它為什麼還要對?** —— 因為災難當天有人拿著 log 去對畫面,列號錯一格就對到別的品項。
 *    (而「怎麼把這句話送回畫面上」是 `manual-order-actions.ts` 檔頭點名**還沒做**的那一題。)
 */
function parseLineEntry(
  raw: RawLine,
  index: number,
  invoiceRequested: boolean,
): ManualOrderLineInput | string {
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
  const typedPrice = Number(raw.unitPrice);

  // ── 稅基(⟦b4-PURCHTAX1⟧ 2026-09-06,Sean `Q5 = 甲`)──────────────────────────────
  // 🔴 **封閉值集, 不接受任何第三種值** —— 「看不懂就當未稅」會讓一個壞掉的表單
  //    靜默送出一個**沒有人宣告過**的稅基, 而那正是這一片在關的洞。
  if (
    raw.taxBasis !== MANUAL_ORDER_LINE_TAX_BASIS_UNTAXED &&
    raw.taxBasis !== MANUAL_ORDER_LINE_TAX_BASIS_TAXED
  ) {
    return `${at}沒有說單價是未稅還是含稅。請重新整理這一頁,重新填一次品項。`;
  }
  // 🔴🔴 **換算在這裡做, 不在瀏覽器做** —— 瀏覽器那一側只【預覽】同一條算式。
  //    兩邊各算一次的話, 員工看到的數字與進 DB 的數字會有兩個來源, 而它們遲早不一樣。
  //    ⛔ ~~送給 RPC 的**永遠是未稅**(RPC 第 6 代 `price_tax_mode='exclusive'` 自己加 5%)~~
  //
  // 🔴🔴 **2026-09-09 `⟦b4-INVOICE5PCT⟧`:「永遠」那兩個字不成立了 —— 而它是一個【少收錢】的洞。**
  //    RPC 第 7 代(`20260909030000`)之後, **沒勾「這張單要開發票」的單一毛稅都不加**
  //    (Sean 2026-09-04 逐字「那如果我沒有勾選開發票價錢都不加」)。
  //    🛑 **而這裡若照舊無條件把含稅價換成未稅**:
  //      員工打 1,050 標「含稅」· 沒勾發票 ⇒ 這裡換成 1,000 ⇒ RPC 不加稅 ⇒ **總額 1,000。**
  //      ⇒ 📌 **他打了 1,050 而客人付 1,000 —— 安靜地少收 50, 沒有任何一格會紅。**
  //    ✅ **所以換算與那顆勾選【綁在一起】**:沒勾 ⇒ **一個字都不換, 原樣送出**,
  //      因為 Sean 同一段逐字說的是「**沒勾就是他打的數字即總額**」——
  //      ⇒ 🎯 **沒勾的時候, 未稅/含稅那個標籤對【錢】沒有作用**(它仍然記在品項上供日後看)。
  //    🔴 **這兩件事必須同一次上線**(板列 `⟦b4-PRICECOPYTAX⟧` 逐字「文案與 RPC 算稅同一次」):
  //      只上 RPC ⇒ 上面那個少收 50;只上這裡 ⇒ 沒勾的含稅列會被 RPC 再加一次 5%。
  //
  // 🔴 **整數運算, 不用 `/ 1.05`** —— 5% 的關係是 21/20, 而浮點除法會給出
  //    `4200 / 1.05 = 3999.9999999999995` 這種東西。
  // ⛔ ~~⇒ 先問「除得盡嗎」(`× 20 % 21`), 除不盡**擋下來**, 而不是四捨五入。~~
  // ⛔ ~~🛑 **擋的時候【兩個數字都要說】**…只說「除不盡」他會亂改一個數字直到它過。~~
  //
  // 🔴🔴 **[2026-09-10] 上面那兩句【對品項】不再成立 —— Sean 拍「Q2′ 甲 = 改成用減的」。**
  //    ⛔ 舊行為:除不盡 ⇒ **整張單退件**。🔬 **在 1..20,000 這個【均勻的數值空間】裡**,
  //      收得下來的只有 **4.8%**(`t % 21 == 0` 的 952 個)。
  //      ⚠️ **而那【不是】退件頻率**(2026-09-10 codex 唯讀審 nit,採信)——
  //        要講頻率得知道員工實際會打哪些金額的分佈, 而**那個分佈沒有人量過**。
  //        📌 我第一版寫「二十次退件十九次」= 把數值空間的比例推成了使用者的經驗。
  //    ✅ 新行為:`round(含稅×20/21)` 當未稅,**而含稅原值一起送**(`unit_price_taxed`)
  //      ⇒ RPC(`20260910090000`)自己再算一次比對, 不符就 RAISE ⇒ **我們不是唯一算的人**;
  //      而它把 `含稅 − 未稅` 當殘差加進稅額 ⇒ 🎯 **總額湊回他打的那個數, 一塊都不差。**
  //    🛑 **而【運費】那半刻意沒跟** —— 見 `untaxedFromTaxedShippingFee` 的 docstring。
  //    🔵 **舊字面留著劃掉**:下一個人會拿「不四捨五入」當理由把運費那半也改掉, 而那會少收一塊。
  let unitPrice = typedPrice;
  let unitPriceTaxed: number | null = null;
  if (invoiceRequested && raw.taxBasis === MANUAL_ORDER_LINE_TAX_BASIS_TAXED) {
    const converted = untaxedForTaxedLine(typedPrice);
    // 🔵 現在 `null` 只剩一種意思:輸入不是非負整數(上面已經擋過)。
    //    留著這一格是因為型別上它仍可能是 `null` —— 而靜默當成 0 會是一張零元的單。
    if (converted === null) return taxBasisProblemMessage(at, typedPrice);
    unitPrice = converted;
    unitPriceTaxed = typedPrice;
  }

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
      // 🔴🔴 **⛔ ~~「請重新從商品清單挑一次」~~ —— 那句話指向一個【不存在的動作】**
      //    (`⟦b4-MANUALORDERDEADEND⟧`, 2026-09-05 走查 + 讀碼各驗一次)。
      //    🔬 ①**那個清單不能挑**:`manual-order-catalog-lookup.tsx:145` 的 `<li>` 沒有 button、
      //      沒有 role、沒有 onClick(鑽機上點過, 五格 `line_*_0` 全部沒變)。
      //    🔬 ②**那串編號他從來看不到**:同一支檔 `h.variantId` **全檔 1 命中, 而那一處是
      //      React 的 `key=`** ⇒ 它從來沒有被印出來過。
      //    ⇒ 🎯 **所以原句對員工是:「回去挑」而沒有東西可挑、「重新輸入」而他沒看過那個值。**
      //
      // 🛑 **而新訊息裡那句警告【不是順手加的】** —— 它擋的是這一格最自然的錯誤動作:
      //    商品列表是 `.from('products')`(`product-repository.ts:315`), 網址 `/products/{id}`
      //    帶的是 **product 的 id**;而這一格要的是 **product_variants 的 id**。
      //    🔴 **兩者都是 UUID、長得一模一樣** ⇒ 貼錯那一種**過得了這道格式檢查**,
      //      而錯誤會往下走。⇒ 📌 **一個「看起來完全合理」的動作, 會製造一個不會叫的錯。**
      return `${at}的商品編號格式不對。這一格留白就好(當代購處理);⚠️ 不要把商品頁網址上的編號貼進來,那是另一種編號。`;
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

  // 🔴 `tax_basis` **原樣帶出去** —— 它上面那道封閉值集已經擋掉第三種值,
  //    到這裡它一定是 `untaxed` / `taxed` 其中一個。用途只有一個:記進稽核(見型別註解)。
  return {
    sku: raw.sku,
    title: raw.title,
    qty,
    unit_price: unitPrice,
    variant_id: variantId,
    spec,
    tax_basis: raw.taxBasis,
    // 🔴🔴 **含稅原值 —— 只有【含稅 + 勾發票】那一種才送。**
    //    ⛔ 在 2026-09-10 之前這個鍵**沒有任何呼叫端送過** ⇒ RPC 那支殘差【一次都沒跑過】
    //      (該 migration `:53` 逐字「新增一個【選填鍵】就夠」⇒ 沒送就走舊路 ⇒ fail-safe,
    //       而那也正是它做了一半卻沒有人發現的原因)。
    //    🛑 **沒勾發票時【不要送】** —— RPC 那一側對沒勾的單要求 `unit_price_taxed = unit_price`,
    //      不相等就 RAISE(它防的是「送 unit_price=1 配 taxed=1050 ⇒ 成立一張 1 元的單」)。
    //      ⇒ 📌 送 `null` 比送一個相等的數安全:**少一個可以說謊的欄位。**
    ...(unitPriceTaxed === null ? {} : { unit_price_taxed: unitPriceTaxed }),
  };
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

  // 🔴🔴 **這一段【搬上來了】(2026-09-09 `⟦b4-INVOICE5PCT⟧`)—— 而搬的理由是【下面那段運費要用它】。**
  //    ⛔ ~~原本它排在運費、收件人、發票類型之後~~
  //    ✅ 現在排在運費【之前】, 因為運費的含稅→未稅換算從今天起要看這顆勾選(理由見下面那一段)。
  // ⚠️ **代價要明寫:錯誤的先後順序變了。**
  //    表單同時「運費填錯」而且「那顆勾選的欄位壞掉」時, 員工先看到的從運費那句變成勾選那句。
  //    🔵 而那不影響正常操作 —— 勾選那兩句錯誤只在**表單本身壞掉/被竄改**時出得來
  //    (欄位不見, 或值不是逐字 `on`/`off`), 那不是他填錯得出來的世界。

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

  const shippingFeeRaw = readSingleString(form, MANUAL_ORDER_SHIPPING_FEE_FIELD);
  if (shippingFeeRaw === null || !NON_NEG_INT_RE.test(shippingFeeRaw)) {
    return { ok: false, error: '運費要填 0 或正整數(不收就填 0)。' };
  }
  const typedShippingFee = Number(shippingFeeRaw);
  if (typedShippingFee > INT4_MAX) return { ok: false, error: '運費超出可以記錄的上限。' };

  // ── 運費的稅基(⟦b4-SHIPFEETAXBASIS⟧ 2026-09-07;形狀照品項那一格 ⟦b4-PURCHTAX1⟧)──────
  // 🔴 **成因與品項那一格同一個**:`p_shipping_fee` 進 RPC 時**沒有人說過它是未稅還是含稅**,
  //    而 RPC 一律當未稅再加 5%。
  //    🔬 codex `gpt-6-astra` 2026-09-06 算的例子(`-ship` 複核算式):
  //      含稅品項 4,200(⇒ 未稅 4,000)+ 員工填運費 **105**(他手上那張單的 105 是含稅)
  //      ⇒ `round((subtotal + shipping) * 0.05)` 算成 **4,310**, 而正確答案 **4,305**
  //      ⇒ 📌 **差 5 元, 而每一筆都長得很正常。**
  // 🔴 **封閉值集, 不接受第三種值** —— 同品項那一格的理由:「看不懂就當未稅」會讓一個壞掉的
  //    表單靜默送出一個**沒有人宣告過**的稅基。
  // 🔵 **共用 `untaxedFromTaxed` 與 `taxBasisProblemMessage`** ——
  //    瀏覽器擋下來時說的、與 server 拒絕時說的必須是**同一句**。
  // 🛑 **這一格【不是】品項那個 `isEmptyRow` 的世界**:那句「刻意不算在裡面」講的是
  //    **品項列**的空列判斷(一組永遠有值的 radio 會讓空白開場列不再算空)——
  //    運費是**單一欄位、不成列**, 沒有「這一列空不空」這個問題 ⇒ 不受那條約束。
  const shippingTaxBasis = readSingleString(form, MANUAL_ORDER_SHIPPING_FEE_TAX_BASIS_FIELD);
  if (
    shippingTaxBasis !== MANUAL_ORDER_LINE_TAX_BASIS_UNTAXED &&
    shippingTaxBasis !== MANUAL_ORDER_LINE_TAX_BASIS_TAXED
  ) {
    return { ok: false, error: '運費沒有說是未稅還是含稅。請重新整理這一頁,重新填一次。' };
  }
  // 🔴🔴 **2026-09-09 `⟦b4-INVOICE5PCT⟧`:換算與那顆勾選【綁在一起】, 理由同品項那一格。**
  //    RPC 第 7 代之後**沒勾就不加稅** ⇒ 這裡若照舊把含稅運費換成未稅,
  //    員工填 105(含稅)· 沒勾發票 ⇒ 送出 100 ⇒ RPC 不加稅 ⇒ **運費收 100, 少收 5。**
  //    ✅ 沒勾 ⇒ **原樣送出**(Sean 2026-09-04 逐字「沒勾就是他打的數字即總額」)。
  let shippingFee = typedShippingFee;
  if (invoiceRequested && shippingTaxBasis === MANUAL_ORDER_LINE_TAX_BASIS_TAXED) {
    // 🛑🛑 **運費【維持整除才收】** —— 品項那半 2026-09-10 改走殘差了,**而這裡刻意沒跟**。
    //    ⛔ ~~原註解:「除不盡 ⇒ 擋下來,不四捨五入(**同品項那一格**)」~~
    //      🔴 那句話的後半今天不成立了 —— **品項那一格現在【就是】四捨五入(殘差)。**
    //      ⇒ 📌 留著劃掉,因為下一個人會拿「同品項那一格」當理由把這裡也放寬。
    //    ✅ 真正的理由在 `untaxedFromTaxedShippingFee` 的 docstring:
    //      **RPC 收不到運費的稅基** ⇒ 運費永遠走正推 ⇒ 它的殘差沒有人補得回來
    //      ⇒ 放寬它 ⇒ 含稅品項 1,050 + 含稅運費 31 ⇒ 總額 1,082 而應收 1,081(我逐格重算過)。
    const converted = untaxedFromTaxedShippingFee(typedShippingFee);
    if (converted === null) return { ok: false, error: taxBasisProblemMessage('運費', typedShippingFee) };
    shippingFee = converted;
  }

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


  // 🔴 **驗證重用 `@pcm/schemas` 的 `NotificationEmailInput`, 不在這裡寫第二份。**
  //    它的四個條件:可列印 ASCII / ≤254 octet / 單一 @ 兩側非空且 domain 含點 / 禁合成域。
  //
  // ⛔ ~~「與 `orders_notification_email_valid`(`20260718120000:128-134`)**逐條對齊**」~~
  // 🔴🔴 **那句話是我寫的, 而它【不成立】**(codex R2 抓到, 我開檔複驗屬實):
  //    · DB 那條只禁 `line.pcmmotorsports.local` 與它的子網域(`:132-133`)
  //    · 而 `isSyntheticEmailDomain`(`packages/schemas/src/notification-email.ts:68-72`)
  //      禁的是**整個 `pcmmotorsports.local` 基底域**與它的**任何**子網域
  //    ⇒ 例:`u@manual.pcmmotorsports.local` —— **表單拒、DB 收。**
  // ✅ **而我【不把表單放寬去對齊 DB】**, 三個理由:
  //    ① 方向:表單比 DB 嚴 ⇒ 擋掉的是「DB 會收但寄不出去」的位址(`.local` 不可路由)
  //       ⇒ 放寬 = 讓一封注定寄不到的信被登記成「會寄」。**那是往壞的方向對齊。**
  //    ② `isSyntheticEmailDomain` 是**多處共用**的那一份(註冊擋、outbox 閘都在用)
  //       ⇒ 為了本片放寬它, 會同時放寬那兩處。
  //    ③ 兩邊不一致的**代價**只有一種:員工被表單擋下來、看得到一句人話。**那是可接受的。**
  // 🔬 而這個不一致現在**有測試釘著**(見 `manual-order-form.test.ts` 那族的基底域兩格)
  //    ⇒ 📌 **它從「我沒發現的分岔」變成「寫下來的選擇」。**
  // 🛑 **寫第二份的代價不是多幾行, 是【兩份會分岔而沒有東西會叫】** ——
  //    而分岔的方向若是「這裡比 DB 寬」⇒ 員工看到的錯誤訊息會是一個約束名。
  // 🔵 用 `readSingle` 而不是 `get()`:它把**缺欄**與**同名欄出現兩次**分開回報,
  //    而後者是 payload 被動過的訊號 —— `get()` 對那個世界會安靜地回第一個值。
  const notificationEmailRead = readSingle(form, MANUAL_ORDER_NOTIFICATION_EMAIL_FIELD);
  if (notificationEmailRead.kind !== 'value') {
    return {
      ok: false,
      error:
        notificationEmailRead.kind === 'missing'
          ? '這張表單少了「通知 email」那一格,不能建單。請重新開一張空白建單表單再試一次。'
          : '「通知 email」那一格的值看不懂,不能建單。請重新開一張空白建單表單再試一次。',
    };
  }
  const notificationEmailTrimmed = notificationEmailRead.value.trim();
  let notificationEmail: string | null = null;
  if (notificationEmailTrimmed !== '') {
    const parsedEmail = NotificationEmailInput.safeParse(notificationEmailTrimmed);
    if (!parsedEmail.success) {
      return {
        ok: false,
        // 🔴 訊息要講**哪一格**與**留白也可以** —— 員工最常見的下一步就是把它清空。
        error:
          '「通知 email」看起來不是一個信箱。請檢查有沒有打錯;這張單不用寄通知的話,把這一格清空就好。',
      };
    }
    notificationEmail = parsedEmail.data;
  }
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
    // 🔴 **那顆勾選在這裡才進得了品項這一層** —— 它決定「含稅價要不要換成未稅」,
    //    見 `parseLineEntry` 裡那一段。`invoiceRequested` 在同一支檔上面(搜 `invoiceRequestedLast === 'on'`)就解析好了, 順序沒有問題。
    const parsed = parseLineEntry(row, i, invoiceRequested);
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
      notificationEmail,
      shippingFee,
      lines,
    },
  };
}
