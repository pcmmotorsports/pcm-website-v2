// audit-field-label.ts — `#27`:把「改了什麼」那欄的**英文欄位名稱與列舉值**換成中文。
//
// ── 🔴 這片真正的難點不是翻譯,是【哪些不該翻】(Sean 2026-08-22 提出、主視窗定界)──────
//   可以翻:**欄位名稱**(`refund_amount` ⇒ 退款金額)、**封閉字集的列舉值**(`partial` ⇒ 部分退款)
//   🔴 不能翻:**識別碼本身**(`JtI9i1rusy9SQaCCBXVj` / `D20260819P8ZewM` / uuid)
//      —— 那些要拿去跟銀行 / TapPay 對帳,**改一個字就對不起來**。
//
//   ⇒ **機制上怎麼保證不會翻到識別碼**(不是靠自律,是靠形狀):
//     值的字典是 **`Record<欄位, Record<值, 中文>>`,不是一張全域的 `Record<值, 中文>`**。
//     ⇒ 只有**那一欄自己登記過的字面**才會被換掉;`bank_refund_id` 沒有值字典
//       ⇒ 它的值**永遠原樣輸出**,即使那串字剛好長得像某個列舉值。
//     🔴 全域字典會踩的坑很具體:`partial` 同時是 `kind` 與 `reply_status` 的合法值,
//       **而兩邊的中文不一樣**(全額/部分退款 vs 部分可供)⇒ 全域表必然翻錯其中一邊。
//
// ── 🔴 分母是量出來的,不是照畫面上看到的那幾個 ──────────────────────────────
//   **欄位 75 種**(~~69~~ ⇒ `#858` 2026-08-24 新增 6 種:`display_id` / `customer_user_id` /
//   `order_source` / `payment_channel` / `shipping_fee` / `item_count`,寫入端=`20260824020000`)。
//   🔴 **75 的量法與下面那套【不是同一套】**:下面是 2026-08-22 那次的掃描;
//      75 是**數字典條目**得到的 —— 而那之所以成立,是因為本檔的兩道測試合起來把字典
//      **夾成恰好等於分母**(一格要求分母 ⊆ 字典,另一格要求字典 ⊆ 分母)。
//      量法逐字可重跑:抽出 `AUDIT_FIELD_LABEL` 物件、數行首 `  key:` 的行 ⇒ 75、零重複。
//   ⚠️ 下面 63 / 6 那兩個數字**是 2026-08-22 的,我沒有重跑那套掃描** —— 別把它們相加去對 75。
//     · **migrations 63 種** —— 掃 `supabase/migrations/*.sql` 裡的
//       `INSERT INTO public.admin_audit_log`(22 個檔),取其 `jsonb_build_object` 的**奇數位字面**。
//       🔴 **字面命中 41 段,而【真的會執行的】只有 29 段**(codex R1 nit,實測收下):
//         其餘 12 段住在 `--` 註解或 migration 自檢用的**字串常數**裡。
//         ⚠️ **63 這個結論不受影響**(那 12 段的 key 是真 INSERT 的子集),
//         但**「41 段」寫在檔頭會讓下一個人以為分母是 41** ⇒ 改掉。
//         📌 母題:**grep 的分母是整支檔的全部字元**,註解與字串都算。
//       ⚠️ 用**跨行**切段(從 `INSERT` 到下一個 `;`)—— 同行 grep 會漏掉大半,稽核 INSERT 都是跨行的。
//     · **app 層 6 種** —— `payment/refund-unknown-state-audit.ts:buildAfter` 的
//       `site` / `error_class` / `resolved_status_type` / `resolved_status_length`(另 4 個與 DB 重疊),
//       加 `staff-repository.ts:4-9` `StaffRow` 的 `id` / `is_manager`(`label`/`is_active` 與 DB 重疊)。
//   ⚠️ **只掃 migrations 會少 6 種** —— 而畫面上正在出事的那一筆(`order_refund.unknown_state`)
//      **整筆都是 app 層寫的**。分母漏了 app 層,等於漏掉 Sean 螢幕上那一列。
//
// 🔴 **這份字典一定會過期,而那和 `AUDIT_ACTION_LABEL` 是同一個病**:
//   新的寫入端隨時會多一個欄位,**不會有任何東西提醒我們來補這裡**。
//   ⇒ 所以未知欄位**不可以靜靜印原文** —— `formatAuditFieldKey()` 回一個 `known: false`,
//     由 `audit-detail.tsx` 在畫面上標出來。**「看不懂」與「我們還沒對照」要分得開。**

/** 布林值兩態。`display()` 把 `true` 序列化成字串 `'true'`,所以這裡對的是字串。 */
const BOOL: Record<string, string> = { true: '是', false: '否' };

/**
 * 欄位名稱 → 中文。**75 種**(2026-08-24 `#858` 後),分母與量法見檔頭。
 * 🔴 用 Sean 看得懂的話,不用內部語彙(memory `project_admin-ux-operation-intuitiveness`)。
 *    例:`seq` 不寫「序號」寫「第幾次更正」——**前者要先知道它在數什麼才讀得懂**。
 */
export const AUDIT_FIELD_LABEL: Record<string, string> = {
  // ── 訂單 / 品項 ───────────────────────────────────────────
  order_id: '訂單編號',
  order_item_id: '訂單品項編號',
  quantity: '數量',
  unit_price: '單價',
  line_total: '這一項小計',
  subtotal: '小計',
  total: '總計',
  zero_price_reason: '改成零元的原因',
  shipping_method: '配送方式',
  workflow_status: '訂單流程狀態',
  cancellation_id: '取消紀錄編號',
  cancelled_at: '取消時間',
  closed: '是否已結案',
  // ── 後台手動建單(`#858`,2026-08-24)──────────────────────
  // 🔴 這六個是**新增的**,不是漏翻的 —— 在 `20260824020000` 那支 RPC 寫進 audit 之前,
  //    稽核表裡不存在這些欄位。(那道守門一直是綠的,它等的就是有人新增稽核欄位那一天。)
  // ⚠️ 口氣對齊本檔既有條目:**寫員工看到那一列時想知道的事**,不是把英文欄名翻過來。
  display_id: '單號(對客人講的那個)',
  customer_user_id: '客人',
  order_source: '這張單怎麼來的',
  payment_channel: '客人怎麼付款',
  shipping_fee: '運費',
  // 🔴 **不是「總件數」** —— 它數的是有幾『樣』不同的東西,一樣買三個仍算一樣。
  item_count: '幾種商品(不是總件數)',
  // ── 發票 ──────────────────────────────────────────────────
  invoice_number: '發票號碼',
  invoice_amount: '發票金額',
  invoice_status: '發票狀態',
  // ── 收款 / 沖銷 ───────────────────────────────────────────
  payment_id: '收款紀錄編號',
  payment_status: '付款狀態',
  amount: '金額',
  rail: '收款管道',
  received_at: '收到款項的時間',
  rec_trade_id: 'TapPay 交易編號',
  has_bank_reference: '有沒有填銀行資訊',
  has_payer_note: '有沒有填付款人備註',
  reversal_id: '沖銷紀錄編號',
  reverses_payment_id: '被沖銷的那筆收款編號',
  // ── 退款 ──────────────────────────────────────────────────
  refund_id: '退款編號',
  refund_row_id: '退款紀錄編號',
  refund_amount: '退款金額',
  refund_amount_wire: '送給金流商的退款金額',
  bank_refund_id: '銀行對帳用的退款編號',
  tappay_refund_id: 'TapPay 退款編號',
  provider_refund_id_evidence: '金流商退款編號(佐證)',
  // 🔴🔴 **金額,不是「有沒有」**(codex R1 must-fix;實查收下)。
  //    `20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql:159` 逐字
  //    `ADD COLUMN record_refunded_before bigint NOT NULL`,RPC 入參同檔 `:876` 亦為 `bigint`。
  //    ⇒ 我原本照 `record…before` 的字面把它當成是非題,連值字典都掛了 `BOOL`
  //      ⇒ 畫面會把金額 `0` 印成「否」、`500` 印成原文。**兩種都是錯的,而都不會紅。**
  //    📌 判別句(下次照這個做):**欄名讀起來像問句,不代表它存的是答案** —— 去看建表的型別。
  record_refunded_before: '這筆之前已經退掉的金額',
  kind: '退款範圍',
  outcome: '處理結果',
  seq: '第幾次更正',
  corrected_to: '更正成什麼',
  correction_id: '這次更正的編號',
  effective_correction_id: '目前生效的那次更正編號',
  // ── unknown-state 稽核(app 層寫的)────────────────────────
  site: '在哪一步出的問題',
  error_class: '錯誤屬於哪一類',
  resolved_status_type: '回傳的狀態是什麼型態',
  resolved_status_length: '回傳的狀態有幾個字',
  // ── 採購 / 到貨 / 供應商 ──────────────────────────────────
  procurement_id: '採購紀錄編號',
  supplier_id: '供應商編號',
  supplier_order_no: '供應商那邊的單號',
  expected_arrival_date: '預計到貨日',
  submitted_at: '送出給供應商的時間',
  reply_status: '供應商回覆狀態',
  contact_channel: '用什麼方式聯絡供應商',
  allocated_quantity: '已分配數量',
  // 🔴🔴 **累計,不是本批**(codex R1 must-fix;我核過它才收)。
  //    寫進稽核的是 `v_proc.received_quantity` / `p.received_quantity`
  //    (`20260814180000_..._admin_void_item_procurement.sql:369` 與 `:379`),
  //    而那一欄的真相來源逐字是「`order_item_procurement.received_quantity` 的真相來源
  //    **= 本表 SUM(quantity)**」(`20260810233000_..._352a2_receipt_write_rpcs.sql:49`)。
  //    ⇒ 原本寫「這次到貨數量」會讓 `2→5` 被讀成**本批來了 5 件**,而事實是**總共到了 5 件**。
  //    🔴 **這種錯畫面完全正常** —— 它不是翻得不好,是翻成了另一個意思。
  received_quantity: '累計到貨數量',
  received_by: '登錄到貨的人',
  surplus_quantity: '多出來的數量',
  exception_reason: '例外情況的原因',
  has_note: '有沒有填備註',
  void_reason: '作廢原因',
  voided_at: '作廢時間',
  // ── 客人 / 儲值金 ─────────────────────────────────────────
  tier: '會員等級',
  wallet_balance: '儲值金餘額',
  total_deposit: '累計儲值金額',
  // ── 商品上下架 ────────────────────────────────────────────
  delisted_at: '下架時間',
  listing_set_by: '上下架是誰設定的',
  // ── 員工設定(`StaffRow`)/ 供應商共用 ─────────────────────
  id: '代號',
  label: '名稱',
  is_manager: '是不是管理者',
  is_active: '是否啟用中',
  // ── 儲存的檢視(`saved_order_views`)────────────────────────
  // 🔴 **這三個欄位【已經在線上】而字典缺中文** —— 員工在稽核紀錄裡看到的是三個英文字。
  //    來源 `supabase/migrations/20260828080000_m4b_b4views1_saved_order_views.sql`
  //    (`query` `:68` / `date_preset` `:74` / `is_shared` `:65`)。
  // 🔴 **用字由線C 選(2026-08-29),Sean 一個字就能改** —— 文案是他的板,
  //    而【螢幕上留三個英文字】比【一個他可能想改的中文】糟 ⇒ 不等他拍,先補。
  query: '篩選條件',
  // `:70` 逐字「存 preset 的 key(例 'this_week'),讀回來當天重算」⇒ 它是【相對】區間不是固定日期。
  date_preset: '日期區間',
  // `:65` `GENERATED ALWAYS AS (staff_id IS NULL)` ⇒ 沒有主人 = 共用;算出來的,寫不進去。
  is_shared: '是不是共用檢視',
  // ── 跨欄 ──────────────────────────────────────────────────
  request_id: '這次操作的請求編號',
};

/**
 * **欄位 → (值 → 中文)**。只放**封閉字集**;字集來源逐一附在旁邊。
 *
 * 🔴 **沒有登記的欄位,值一律原樣輸出** —— 這就是識別碼不會被翻到的機制(檔頭)。
 * ⚠️ **只登記「能從 CHECK / IN constraint 或 TS 封閉字集當場數出來」的欄位。**
 *    數不出來的**刻意不登記**(它的值會原樣顯示,而不是被我猜一個中文蓋上去)——
 *    猜錯的方向是「員工讀到一個很篤定但是錯的中文」,比讀到英文糟。
 */
export const AUDIT_VALUE_LABEL: Record<string, Record<string, string>> = {
  // `20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql:472` `p_kind NOT IN ('full','partial')`
  kind: { full: '全額退款', partial: '部分退款' },
  // 同檔 `:659/:676/:706` 與 `20260812140000:*` 的 `p_outcome IN (…)` 聯集,加 `:735` 那個只在函式內指派的值。
  outcome: {
    accepted: '已受理',
    deferred_not_captured: '還沒請款,先擱著',
    recovered_confirmed: '事後補確認成功',
    rejected_out_of_range: '金額超出可退範圍,被擋下',
    not_sent: '沒有送出去',
    accepted_amount_mismatch_hold: '已受理,但金額對不上、先暫停',
    manual_failed: '人工標記為失敗',
  },
  // `refund-unknown-state-audit.ts:RefundUnknownStateSite`(TS 封閉字集)
  site: {
    adapter_threw: '打 TapPay 的時候就出錯了',
    finalize_threw_after_accepted: 'TapPay 已經受理,但我們這邊的帳沒結成',
    resolved_status_unrecognized: 'TapPay 回來了,但狀態我們看不懂',
  },
  // `refund-error-class.ts:40-46` `REFUND_ERROR_CLASSES`(TS 封閉字集)
  error_class: {
    aborted_or_timeout: '中斷或等太久',
    network_or_type: '網路或程式型別的問題',
    malformed_response: '對方回來的格式不對',
    error_unclassified: '有錯誤,但分不出是哪一類',
    other: '其他',
  },
  // `refund-error-class.ts:118-131` `describeUnknownValue`
  resolved_status_type: {
    string: '文字',
    number: '數字',
    boolean: '是/否',
    object: '一包資料',
    // 🔴 這三種是 codex R1 補的 —— `UNKNOWN_VALUE_TYPES` 有 **10 種**(`refund-error-class.ts:86-97`),
    //    我只登記了 7 種。TapPay 回一個 `1n` 就會在畫面上印 `bigint`。
    //    📌 **抄封閉字集要當場數它有幾個**,不要照著自己想得到的那幾個抄。
    bigint: '很大的整數',
    symbol: '一個內部符號',
    function: '一個函式',
    undefined: '根本沒有帶值',
    null: '空值',
    indeterminate: '連型態都判不出來',
  },
  // `20260729020000_m4b_e10_a2_order_item_procurement.sql:87` CHECK
  reply_status: {
    no_reply: '還沒回覆',
    confirmed: '已確認',
    price_changed: '價格有變動',
    out_of_stock: '沒貨了',
    partial: '只能供應一部分',
  },
  // `20260810100000_m4b_e10_op1_order_payments_m.sql:189` CHECK
  rail: { card: '刷卡', bank_transfer: '匯款', cash: '現金' },
  // `20260717010000_m4a_admin_set_customer_tier_rpc.sql:101` `p_tier NOT IN (…)`
  tier: { general: '一般會員', store: '經銷商', premiumStore: '高階經銷商' },
  // `20260714130000_m4a_admin_update_order_workflow*.sql` CHECK
  invoice_status: { not_issued: '還沒開立', issued: '已開立', voided: '已作廢' },
  // 各 RPC CHECK 的聯集(`unpaid`/`paid`/`partiallyRefunded`/`refunded`)
  payment_status: {
    unpaid: '未付款',
    paid: '已付款',
    partiallyRefunded: '部分退款',
    refunded: '已全額退款',
  },
  // `20260819040000_m4b_20_admin_set_product_listing.sql:176` 只寫入 `'staff'` 一種
  listing_set_by: { staff: '員工手動設定' },
  // 🔴 `20260814190000_m4b_e10_473b1_refund_manual_corrections.sql:69` CHECK —— **封閉字集,我漏了**。
  //    ⚠️ 而它漏得特別安靜:欄名 `corrected_to` **有**中文,所以畫面**不會**出現「還沒對照」標記,
  //    只有值那一格是英文 ⇒ **看起來像「這個值本來就長這樣」。**
  corrected_to: { money_moved: '錢真的動了', no_money_moved: '錢沒有動' },
  // 🔴 `20260714120000_m4a_order_workflow_status.sql:73-81` 的 `order_status_options` seed(9 種)。
  //    ⚠️ **我原本判「數不出合法字集」,那是錯的** —— 我只看了 `orders.workflow_status` 的 CHECK
  //    (`20260716120000:50` 是 `~ '^[a-z0-9_]{1,64}$'`,開放 regex)就下結論,
  //    **沒有去找「有沒有別的地方存著它的中文」**。codex R1 指出來,實查收下。
  //    🔴 **而那張表是 Sean 可以自己改的**(建表 COMMENT 逐字「Sean 可設定+顏色」)
  //      ⇒ 這裡是一份**會漂的抄本**。字集外的值照樣原樣輸出,那正是要的行為。
  workflow_status: {
    received_confirmed: '已收已定',
    received_unconfirmed: '已收未定',
    shipped_done: '出貨完成',
    unpaid_confirmed: '未收已定',
    unpaid_shipped: '未收出貨',
    unpaid_unconfirmed: '未收未定',
    unpaid_instock: '未收現貨',
    instock_available: '現貨在庫',
    cancelled: '已取消',
  },
  // 布林欄:`display()` 序列化成字串 `'true'` / `'false'`。
  closed: BOOL,
  has_note: BOOL,
  has_payer_note: BOOL,
  has_bank_reference: BOOL,
  is_active: BOOL,
  is_manager: BOOL,
};

/**
 * 🔴 **這個字面與 `audit-diff.ts:118` 是同一個東西,而它們在兩支檔裡** ——
 *    那邊的註解逐字寫著「換字時要同步改 `audit-diff.test.ts` 的兩格斷言」,
 *    現在**多一處**。⇒ 在這裡具名,讓 grep 得到;守門在 `audit-field-label.test.ts`。
 */
export const WHOLE_PAYLOAD_KEY = '(整筆)';

/** 欄位名稱的顯示結果。`known: false` = **字典裡沒有**,畫面必須標出來(不得靜靜印原文)。 */
export interface AuditFieldLabel {
  readonly label: string;
  readonly known: boolean;
}

/**
 * 欄位名稱 → 中文;**沒有對照就原樣回代碼,並標 `known: false`**。
 *
 * 🔴 為什麼不回「未知欄位」四個字:稽核的用途是**追查**,把原代碼吃掉就查不出是哪一欄
 *    ——同一個判斷 `formatAuditAction()` 上面那段已經寫過,這裡沿用。
 * 🔴 而**光是原樣回代碼還不夠**:那正是今天畫面上的樣子,員工分不出
 *    「這欄本來就沒有中文」和「我們漏了」。⇒ 多回一個 `known`,讓畫面講出來。
 *
 * ⚠️ `diffAuditPayload` 會產生一個中文鍵 `(整筆)`(`audit-diff.ts:118`)——
 *    它本來就是中文、不在本字典裡,**不得被標成「未對照」**。⇒ 這裡明確放行。
 */
export function formatAuditFieldKey(key: string): AuditFieldLabel {
  // 🔴🔴 **`Object.hasOwn` 不是潔癖,是這裡真的會出事**(codex R1 must-fix):
  //    `AUDIT_FIELD_LABEL['constructor']` 命中的是 **Object.prototype 上的函式**,不是 undefined
  //    ⇒ 舊寫法會判成「已對照」、回傳一個**函式**當 label,而且**未對照標記不會出現**。
  //    ⚠️ 稽核的 key 來自 **DB 的自由 jsonb**(`audit-diff.ts` 檔頭逐字「每個寫入端形狀不同」)
  //      ⇒ 那不是理論上的輸入,是**外部可控**的輸入。
  //    📌 用 `Object.hasOwn` 而不是 `Object.create(null)`:前者在**查找點**擋住,
  //      後者要每一張表都記得那樣建 —— **會忘的那個防線不算防線。**
  if (Object.hasOwn(AUDIT_FIELD_LABEL, key)) {
    return { label: AUDIT_FIELD_LABEL[key]!, known: true };
  }
  // `audit-diff.ts` 自己產的中文鍵,不是來自任何寫入端 ⇒ 不算未對照。
  if (key === WHOLE_PAYLOAD_KEY) return { label: key, known: true };
  return { label: key, known: false };
}


/**
 * 值 → 中文;**只有登記過值字典的欄位才換,其餘原樣輸出**。
 *
 * 🔴🔴 **識別碼不會被翻到,靠的是這個 `[key]` 查找,不是靠字面判斷**:
 *    沒有「看起來像 uuid 就不要翻」這種啟發式 —— 那種判斷會在
 *    **識別碼剛好長得像列舉值**的時候失效,而那正是最難發現的一次。
 * ⚠️ `null` 由呼叫端顯示成 `(無)`,不進本函式。
 */
export function formatAuditFieldValue(key: string, value: string): string {
  // 同一個 prototype 洞:`value` 是 `'toString'` 時,舊寫法回的是函式不是字串。
  if (!Object.hasOwn(AUDIT_VALUE_LABEL, key)) return value;
  const dict = AUDIT_VALUE_LABEL[key]!;
  return Object.hasOwn(dict, value) ? dict[value]! : value;
}
