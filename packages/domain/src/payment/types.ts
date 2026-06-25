/**
 * @see backlog #11 — TapPay-specific type 位置純度待 M-3-08 重檢。
 *
 * 嚴格 ports 純度應放 packages/ports/src/tappay/types.ts;
 * 本 slice 暫放 domain/payment/types.ts、M-3-08 寫 ITapPayAdapter 實作時跟 adapter 一起重檢、
 * 不單獨開 slice 改。
 */

import type { Money, MoneyAmount } from '../shared/types';
import type { OrderId, PaymentStatus } from '../order/types';

/**
 * ChargeStatus: 金流交易結果狀態(domain enum)。
 *
 * 命名為 PCM 業務語意('succeeded' / 'failed')、非 TapPay wire 字串;
 * adapter 邊界做 wire ↔ domain mapping。
 */
export type ChargeStatus = 'succeeded' | 'failed';

/**
 * Cardholder: 持卡人資訊(TapPay charge 必填)。包含 PII(email / phoneNumber)。
 *
 * 🔴 TapPay 官方 pay-by-prime cardholder 之 name/email/phone_number 皆標必填(*);PCM domain
 * 三欄一律必填(對齊官方 + 移除 email/name 必填而 phone 可選之不對稱)。phoneNumber 來源 = 結帳
 * 地址 phone(②-③ 組裝、恆有);型別層必填 = fail-closed 強制 ②-③ 供 phone、adapter 不送空字串。
 *
 * @see backlog #16 — PII logging mask 規範待 M-3-08 寫實作前補
 * @see M-3-08 ITapPayAdapter 實作:logging 必 mask PII、rawResponse 不可直接寫 log
 */
export type Cardholder = {
  name: string;
  email: string;
  phoneNumber: string;
};

/**
 * TapPayChargePayload: charge use-case 輸入(M-3-08 結帳用)。
 */
export type TapPayChargePayload = {
  /** TapPay client SDK 產的 prime token */
  prime: string;
  amount: Money;
  orderId: OrderId;
  cardholder: Cardholder;
};

/**
 * TapPayChargeResult: charge use-case 結果。
 *
 * `rawResponse` 保留 TapPay wire 原樣、供 audit log;不在 storefront 顯示。
 */
export type TapPayChargeResult = {
  status: ChargeStatus;
  /** TapPay rec_trade_id 等交易識別字串 */
  transactionId: string;
  /**
   * TapPay 回報的「實扣金額」(wire `amount` + `currency` → domain Money)。
   *
   * 🔴 M-3 階段②-② PF-X3 在地金額防竄改縱深(webhook 對帳在 ②-⑥):confirm-payment use-case
   * 比對 `amount === server read-back orders.total`、不符即不 confirm、回孤兒 `amount_mismatch`
   * (全鏈唯一驗「TapPay 真扣了 total」之處)。adapter 邊界 wire→domain:`toMoneyAmount(wire.amount)`
   * + 斷言 `currency='TWD'`(單位斷言;非 TWD 視為金額異常)。整數比對、零浮點。
   */
  amount: Money;
  /** 原始回應、audit 用、不解析業務語意 */
  rawResponse: unknown;
};

// ── M-3 3DS-5a:3DS charge 啟動型別(回 payment_url 跳轉、不請款;與同步 charge 語意不同 → 獨立型別)──

/**
 * TapPayInitiationPayload:3DS charge 啟動輸入(`ITapPayAdapter.initiateThreeDSCharge`)。
 *
 * 與同步 `TapPayChargePayload` 的差異:多帶 caller 自產的唯一 `bankTransactionId`(charge 前 durable 存、
 * master plan §1 對帳鍵)+ 3DS 跳轉回程 URL(`frontendRedirectUrl` https / `backendNotifyUrl`)。
 * 🔴 `bankTransactionId` 由 5b use-case 以 `generateBankTransactionId()` 產(≤19 字大寫英數)、adapter 忠實透傳不自產。
 * URL 字串由 delivery 層(6)組、本型別只收參數(use-case 不自組 URL)。
 */
export type TapPayInitiationPayload = {
  /** TapPay client SDK 產的 prime token */
  prime: string;
  amount: Money;
  orderId: OrderId;
  cardholder: Cardholder;
  /** caller 自產唯一訂單編號(charge 前 durable 存;`^[A-Z0-9]{1,19}$`);adapter 原樣送 TapPay。 */
  bankTransactionId: string;
  /** 3DS 銀行 OTP 後前端跳轉網址(TapPay `result_url.frontend_redirect_url`;須 https)。 */
  frontendRedirectUrl: string;
  /** 3DS 結算 server 通知網址(TapPay `result_url.backend_notify_url`;webhook 祕密路徑段)。 */
  backendNotifyUrl: string;
};

/**
 * TapPayInitiationResult:3DS charge 啟動結果(**只有成功一態**;非成功一律 throw、見 adapter §2.1)。
 *
 * 🔴 codex 關卡1 #2:3DS 啟動回「payment_url 跳轉 + rec_trade_id」、**尚未請款無實扣金額**(語意 ≠ 同步
 * `TapPayChargeResult` 已扣款)。adapter **不自判 failed**(timeout 等模糊態未必明確未扣款)→ 唯
 * `status===0 && payment_url && rec_trade_id` 回 `pending_3ds`、其餘 throw(use-case 映 charge_unknown、
 * 不釋鎖;最終由 settleCharge / Record API 唯一權威裁決)。
 */
export type TapPayInitiationResult = {
  status: 'pending_3ds';
  /** TapPay `payment_url`:3DS 付款頁跳轉網址(🔴 含 token query、絕不入 log)。 */
  paymentUrl: string;
  /** TapPay `rec_trade_id`:結算對帳主鍵(settleCharge rec 優先序第一順位)。 */
  recTradeId: string;
  /** 回送 caller 自產的 `bankTransactionId`(charge 前已 durable;對帳次順位鍵)。 */
  bankTransactionId: string;
};

/**
 * TapPayRefundPayload: refund use-case 輸入。
 *
 * `amount` 不填表示全額退、填表示部分退。
 */
export type TapPayRefundPayload = {
  transactionId: string;
  amount?: Money;
};

/**
 * TapPayRefundResult: refund use-case 結果。
 */
export type TapPayRefundResult = {
  status: ChargeStatus;
  refundId: string;
  /** 原始回應、audit 用 */
  rawResponse: unknown;
};

// ── M-3 3DS-1a:Record API 反查型別(對帳 settleCharge 用、adapter 解析、不下裁決) ──────────────

/**
 * TapPayRecordQuery:Record API 反查 filter(3DS 結算對帳、3DS-1b settleCharge 決定帶哪把鍵)。
 *
 * 🔴 三把交易識別鍵**至少帶一**(全空 → adapter fail-closed throw、絕不送無 filter 全表查 → 防誤命中他單)。
 * `merchant_id` 由 adapter 從 config 注入(每查必帶、限本商戶;不在此型別)。
 * 鍵的**優先序**(rec → bank_txn → order_number + 窄窗)與**比對裁決**是 3DS-1b 的事;1a 只忠實送查 + 解析回欄。
 *
 * @see docs/specs/2026-06-13-m3-3ds-webhook-master-plan.md §1 step 1-2 / §7
 */
export type TapPayRecordQuery = {
  recTradeId?: string;
  orderNumber?: string;
  bankTransactionId?: string;
};

/**
 * TapPayTradeRecord:Record API `trade_records[]` 單筆解析(白名單欄、零 PII)。
 *
 * 🔴 `recordStatus` 保留 wire 原值 int、1a **不映語意裁決**(官方 reference 逐字 7 值:
 *   -1=ERROR / 0=AUTH(授權未請款) / 1=OK(交易完成) /
 *   2=PARTIALREFUNDED(部分退款) / 3=REFUNDED(完全退款) / 4=PENDING(待付款) / 5=CANCEL(取消交易));
 *   1a 保留原值、不下「已付款」裁決(留 1b)。
 *   🔴 Phase 1 1b 映射(S1「授權即成立」、設計包 2026-06-20):paid=0(AUTH)·1(OK)〔不再要求 is_captured〕 /
 *   pending 保留=4(待付款)·查不到·Record 失敗 / 明確 failed 放行重刷=-1·5 / 退款 2·3=異常走退款片(S2=B backlog)。
 * 🔴 #16 PII:不解析 `cardholder` / `card_info` / `pay_info`(masked card)等 PII 欄、只取白名單對帳欄。
 */
export type TapPayTradeRecord = {
  recTradeId: string;
  orderNumber: string;
  bankTransactionId?: string;
  merchantId: string;
  /** wire `amount`:整數最小貨幣單位(MoneyAmount 守門;3DS-1b 比對 orders.total)。 */
  amount: MoneyAmount;
  /** wire `currency`(原值;1b 比對時嚴格斷言 'TWD',1a 不斷言以免擋掉歷史紀錄)。 */
  currency?: string;
  /** wire `record_status` 原值 int:-1=ERROR / 0=AUTH / 1=OK / 2=PARTIALREFUNDED / 3=REFUNDED / 4=PENDING / 5=CANCEL。 */
  recordStatus: number;
  /** wire `is_captured`:true=已請款。🔴 S1「授權即成立」後 1b 裁決**不再讀**此欄(0/1 即成立);
   *  保留 parse/型別供未來精準帳務 authorized/captured 兩段 + audit。 */
  isCaptured: boolean;
  /** wire `refunded_amount`:整數最小貨幣單位(部分/全退時非 0)。 */
  refundedAmount?: MoneyAmount;
  /** wire `transaction_time_millis`:交易時間(epoch ms;3DS-1b order_number fallback 窄窗用)。 */
  transactionTimeMillis?: number;
};

/**
 * TapPayRecordResult:`recordQuery` 解析結果(top status + 計數 + 白名單 records、**不下裁決**)。
 *
 * 🔴 `queryStatus` = top-level `status`(§7:`0`=查詢成功有紀錄 / `2`=已無更多分頁;**兩者皆查詢成功、≠ 交易狀態**;
 *    有無紀錄由 `numberOfTransactions`/`records` 判、與 status 值正交)。
 * 3DS-1b 以 `queryStatus ∈ {0,2}`(成功白名單 fail-closed)+ `numberOfTransactions===1` + `records.length===1` + 鍵全對本機
 * + `record_status ∈ {0 AUTH,1 OK}` + amount/currency 嚴格 才判 paid(S1「授權即成立」、不再要求 is_captured;全條件在 1b、
 *    非此處;**status 只管查詢有沒有成功、record_status 才是成立權威**)。
 */
export type TapPayRecordResult = {
  queryStatus: number;
  numberOfTransactions: number;
  records: TapPayTradeRecord[];
};

// ── M-3 階段②-②b:confirm(付款確認)型別 ────────────────────────────────────

/**
 * ConfirmOrderPaymentInput:payment_confirmer 窄權 confirm RPC 輸入(IPaymentConfirmer port)。
 *
 * 對齊 `confirm_order_payment(p_order_id uuid, p_amount integer, p_rec_trade_id text)`;
 * adapter 取 `amount.amount`(整數元位)餵 p_amount integer、`orderId` 餵 p_order_id、`recTradeId` 餵 p_rec_trade_id。
 */
export type ConfirmOrderPaymentInput = {
  orderId: OrderId;
  /** server read-back orders.total(Money、整數元位、client 永不送價);adapter 取 amount.amount 餵 p_amount。 */
  amount: Money;
  /** TapPay rec_trade_id(charge 成功的 transactionId)。 */
  recTradeId: string;
};

/**
 * ConfirmOrderPaymentResult:confirm RPC 回 DTO(對齊 RPC `RETURNS jsonb {confirmed, idempotent}`)。
 *
 * 🔴 鐵則 12(PF-G):**不帶 total / 價結構**;只回成功與否 + 是否冪等重放。
 */
export type ConfirmOrderPaymentResult = {
  confirmed: boolean;
  /** true = 重放冪等 no-op(已 paid + 同 rec + 同 amount);false = 本次真翻 unpaid→paid。 */
  idempotent: boolean;
};

/**
 * ConfirmPaymentInput:confirm-payment use-case 輸入(編排 begin 佔鎖 → charge → markCharged 雙軌 → PF-X3 → confirm → 收斂補記;②-③c-2)。
 *
 * `amount` = server read-back orders.total(單一金額來源):同時餵 charge amount 與 confirm p_amount,
 * client 永不送價(鐵則 12);PF-X3 = use-case 比對 charge 實扣 == 此 amount。
 */
export type ConfirmPaymentInput = {
  prime: string;
  orderId: OrderId;
  amount: Money;
  cardholder: Cardholder;
};

/**
 * SettlementRequiredContext:settlement_required outcome 攜帶的 cart-instance dedup 上下文(3DS-7 7c-1 surface)。
 *
 * 🔴 承 `BeginChargeAttemptResult` D2/D4 既有 existing_* 形狀,下移到 use-case outcome 供 action 層即時裁決
 * (取代 7b「一律處理中」粗映射)。**不帶 existingBankTransactionId**:settleCharge 以 existingOrderId 重查
 * attempt 自取 bank_txn(buildRecordQuery 優先序)、action 不需 → 最小化 surface(只帶 action 真消費的欄)。
 *
 * action 層〔3DS-7 7c-2 charge-actions〕消費:
 * - `duplicate`(existingPaid:true)→ 既有單 DB 確定 paid → paid-equivalent 終態(顯 existingDisplayId、clear+regenerate)。
 * - `needs_settle` → settleCharge({orderId:existingOrderId, recTradeIdHint:existingRecTradeId ?? undefined})即時裁決。
 */
export type SettlementRequiredContext =
  | { reason: 'duplicate'; existingDisplayId: string; existingPaid: true }
  | {
      reason: 'needs_settle';
      existingOrderId: string;
      existingDisplayId: string;
      existingRecTradeId: string | null;
    };

/**
 * ConfirmPaymentOutcome:confirm-payment use-case 結果(🔴 孤兒單契約、MUST-FIX 2)。
 *
 * - `paid`:charge 成功 + 實扣金額符 + confirm 成功(`idempotent` 標重放 no-op)→ 完成頁。
 * - `charge_failed`:charge 業務失敗(卡拒等、status≠0)、**未扣款**(recordPersisted:true 才可立即重試;false 見變體註解)。
 * - `charge_unknown`:charge transport 失敗(網路/timeout)、扣款狀態未知、**無 rec_trade_id** → 勿重刷
 *   (②-⑥ webhook 經 order_number 對帳自癒)。
 * - `orphan`:charge 已扣款但無法確認(實扣≠total / confirm 連線層失敗 / confirm RPC 拒)→ ②-③ 回
 *   「付款已收、處理中、勿重複付款」+ 寫 charge-attempt 紀錄(`transactionId`+`orderId`);
 *   重試走「重呼 confirm 冪等」**非重 charge**;前端成功真相 = `paid`(非 charge.status)。
 *   `reason` 供 ②-③/②-⑥ 對帳分類(連線層=可重 confirm、RPC 拒/金額不符=孤兒對帳)。
 */
export type ConfirmPaymentOutcome =
  | { kind: 'paid'; idempotent: boolean }
  /**
   * `recordPersisted`(round5 MF1):卡拒後「已知未扣款」是否 durable 落 DB(markFailed 釋鎖成功)。
   * false = 主軌 ×3 全敗、pending 鎖殘留 → ②-③e 映 charge_failed_wait(誠實「未扣款 + 請稍候再試」、
   * 不誘導立即重試;per-user 閘 10 分鐘自動過期、殭屍 pending 列 ②-⑥ 清);true = 可立即重試。
   */
  | { kind: 'charge_failed'; recordPersisted: boolean }
  | { kind: 'charge_unknown'; orderId: OrderId }
  | {
      kind: 'orphan';
      reason: 'amount_mismatch' | 'confirm_unreachable' | 'confirm_rejected';
      transactionId: string;
      orderId: OrderId;
    }
  /**
   * `locked`:佔 charge 鎖失敗、**零扣款**(②-③a begin RPC、PF-X2;plan v6 §2/§6):
   * - `user_in_flight`:同會員另一筆未解決付款 10 分鐘內進行中(Q2=A 閘)→ ②-③e 映
   *   in_flight 態(不帶 displayId、不得回「付款已收」語意 —— 此請求的新單沒刷過卡)。
   * - `order_locked`:同單已有 active attempt(pending/charged)→ 映 processing(勿重複付款)。
   * - `not_unpaid`:order 非 unpaid(已 paid 等;與撞鎖同層級、RPC 不洩具體狀態)→ 映 processing。
   */
  | { kind: 'locked'; reason: ChargeLockReason }
  /**
   * `settlement_required`:begin 偵測同 cart_session_id 異單已扣款/扣款中(3DS-0b dedup duplicate/needs_settle)、
   * **零本次扣款**(begin !acquired、charge 未跑)→ ②-③ 映「狀態確認中、請勿重複付款」(非「付款失敗」、非 paid、非 locked)。
   *
   * 🔴 codex 關卡1 must-fix 2:**不得 alias 成 `{kind:'locked',reason:'order_locked'}`**(duplicate/needs_settle
   * 語意 ≠ 撞鎖、silent drift)。
   * 🔴 3DS-7 7b:client cart key 已 live(取代 option A per-call UUID)→ begin dedup 真正生效、此 outcome 不再 dormant。
   * 🔴 3DS-7 7c-1:擴帶 `dedup`(existing_*)供 action 層即時裁決(取代 7b「一律處理中」);duplicate→既有單號
   *    paid-equivalent、needs_settle→action 跑 settleCharge 裁決(paid/failed/pending)。begin 仍讀 DB row key、
   *    永不接受 client 重送 key 當比對輸入(plan §4 不變量)。
   */
  | { kind: 'settlement_required'; dedup: SettlementRequiredContext };

/** begin_charge_attempt 拒絕理由(②-③a RPC `{acquired:false, reason}` 對應、plan v6 §2)。 */
export type ChargeLockReason = 'user_in_flight' | 'order_locked' | 'not_unpaid';

/**
 * InitiatePaymentInput:3DS charge 啟動半段 use-case(initiatePayment、M-3 3DS-5b)輸入。
 *
 * 對齊 `ConfirmPaymentInput`(prime/orderId/amount/cardholder;amount=server read-back orders.total、
 * client 永不送價、鐵則 12)+ 多 3DS 跳轉回程 URL。🔴 `frontendRedirectUrl`/`backendNotifyUrl` 由
 * delivery 層(3DS-6)組 `${base}/checkout/callback?order=${orderId}`(對齊 3DS-3 callback)+
 * `${base}/api/checkout/tappay-notify/${secret}`(對齊 3DS-2 webhook secret path);use-case **收參數不自組 URL**
 * (URL 組裝 = 6 的 delivery 職責、plan §3.3;5b 簽章預留入參)。
 */
export type InitiatePaymentInput = {
  prime: string;
  orderId: OrderId;
  amount: Money;
  cardholder: Cardholder;
  /** 3DS 銀行 OTP 後前端跳轉網址(TapPay `result_url.frontend_redirect_url`;須 https;delivery 層組)。 */
  frontendRedirectUrl: string;
  /** 3DS 結算 server 通知網址(TapPay `result_url.backend_notify_url`;webhook 祕密路徑段;delivery 層組)。 */
  backendNotifyUrl: string;
};

/**
 * InitiatePaymentOutcome:3DS charge 啟動半段 use-case(initiatePayment、M-3 3DS-5b)結果。
 *
 * 🔴 與同步 `ConfirmPaymentOutcome` 的本質差異(plan §3.3):啟動半段 **charge 不回扣款結果、回 payment_url
 * 跳轉**(銀行 OTP → settleCharge 對帳脊椎裁決),故 **無 `paid` / `orphan` / `charge_failed` 態**;
 * initiate 全程不釋鎖(charge 非成功一律 `charge_unknown`、不 markFailed)、失敗-釋鎖唯一權威是 settleCharge
 * 經 Record API(record_status -1/5)。
 *
 * - `redirect`:bank_txn durable + initiateThreeDSCharge 回 `pending_3ds` → 3DS-6 delivery 層 `window.location`
 *   跳轉 `redirectUrl`(= TapPay payment_url、含 token query);rec 寫入 best-effort(失敗只 log、不阻跳轉)。
 * - `charge_unknown`:initiateThreeDSCharge throw(status≠0 / 421 timeout / HTTP / 格式)→ 扣款狀態未知、
 *   bank_txn **已 durable** → settleCharge 經 bank_txn 對帳;**不 markFailed**、pending 續持鎖、勿重刷。
 * - `settlement_required`:begin 偵測同 cart_session_id 異單已扣款/扣款中(0b dedup duplicate/needs_settle)、
 *   **零本次扣款** → 🔴 3DS-7 7c-1 擴帶 `dedup`(existing_*)供 action 即時裁決(對齊 ConfirmPaymentOutcome 同名態)。
 * - `locked`:佔 charge 鎖失敗(user_in_flight/order_locked/not_unpaid)、**零扣款**(begin !acquired)。
 * - `init_failed`:bank_txn 寫入未 durable(RPC false / throw)→ **零 TapPay 呼叫**、零 charge(安全);
 *   pending 鎖殘留交 expirer/sweeper 清(charge 前失敗、無扣款風險)。
 */
export type InitiatePaymentOutcome =
  | { kind: 'redirect'; redirectUrl: string }
  | { kind: 'charge_unknown'; orderId: OrderId }
  | { kind: 'settlement_required'; dedup: SettlementRequiredContext }
  | { kind: 'locked'; reason: ChargeLockReason }
  | { kind: 'init_failed' };

/**
 * BeginChargeAttemptResult:佔 per-order charge 鎖結果(IChargeAttemptStore.begin、②-③a begin RPC DTO)。
 *
 * 🔴 `fallbackToken`:備軌一次性權杖(round4 MF2)— DB 只存 sha256 hash、此明文**只活在 server
 * 記憶體**(use-case → 複合 adapter → 備軌 RPC 參數),絕不回 client、絕不入 log。
 */
export type BeginChargeAttemptResult =
  | { acquired: true; attemptId: string; fallbackToken: string }
  | { acquired: false; reason: ChargeLockReason }
  /**
   * 🔴 3DS-0b cart-instance dedup(D2):同 user 同 cart_session_id 異單、sibling 已 paid → DB 確定既有單
   * 已完成付款(begin RPC `reason:'duplicate'`、帶 `existingDisplayId`;`existingPaid` 恆 `true` = 此 reason 的
   * 定義)。🔴 3DS-7 7c-1:use-case 已把 existing_* 上帶到 settlement_required.dedup(不污染 ChargeLockReason)、
   * 由 action 層〔7c-2〕映 paid-equivalent 顯既有單號(duplicate)。
   */
  | { acquired: false; reason: 'duplicate'; existingDisplayId: string; existingPaid: true }
  /**
   * 🔴 3DS-0b cart-instance dedup(D4):同 user 同 cart_session_id 異單、sibling 有扣款跡象但 DB 無法確定
   * 錢扣了沒(charged-未-paid / pending-未-paid orphan)→ 交 3DS-1b settleCharge Record 即時裁決(begin RPC
   * `reason:'needs_settle'`)。`existingRecTradeId`/`existingBankTransactionId` 可為 null(pending orphan 無
   * rec=JSON null;bank_transaction_id 欄 0c 才加 → 0b-only 階段缺欄、adapter nullable 慣例容忍)。
   */
  | {
      acquired: false;
      reason: 'needs_settle';
      existingOrderId: string;
      existingDisplayId: string;
      existingRecTradeId: string | null;
      existingBankTransactionId: string | null;
    };

/**
 * MarkChargeAttemptChargedInput:PF-X1 麵包屑寫入(charge 成功、confirm 前;雙鍵驗 attemptId+orderId
 * 對齊 ②-③a RPC、round6)。`fallbackToken` 供備軌(主軌忽略;不入 log)。
 */
export type MarkChargeAttemptChargedInput = {
  attemptId: string;
  orderId: OrderId;
  recTradeId: string;
  fallbackToken: string;
};

/** MarkChargeAttemptFailedInput:卡拒(明確未扣款)釋鎖(雙鍵驗;僅主軌 — 備軌不可釋鎖)。 */
export type MarkChargeAttemptFailedInput = {
  attemptId: string;
  orderId: OrderId;
};

// ── M-3 3DS-1b:settleCharge 對帳脊椎型別 ─────────────────────────────────────────────────────

/**
 * ActiveChargeAttempt:`get_active_charge_attempt` RPC 回 DTO(3DS-1b settleCharge 依 orderId 反查)。
 *
 * 🔴 只非 PII 對帳欄(零 token/卡資料/經銷價)。`orderTotal` 走窄權 RPC —— `IOrderRepository.findTotal`
 * 是 RLS own-only(user-scoped),webhook/sweeper **無 user JWT** → findTotal 回 null,故對帳金額讀必走
 * payment_confirmer server-side。`orderPaymentStatus` 供 1b 缺陷C 短路(已 paid 不打 Record);
 * `orderDisplayId` 供 retry duplicate 回既有單號。
 *
 * @see supabase/migrations/20260614120000_m3_3ds_1b_get_active_charge_attempt.sql
 * @see supabase/migrations/20260624120007_m3_3ds_r1b3_record_released_failure_observation.sql (get_active 擴 released)
 */
export type ActiveChargeAttempt = {
  attemptId: string;
  // 🔴 M-3 3DS 乙路 R1b3/R2a:active 集擴 released(release CAS 釋鎖後續低頻對帳直到 terminal、§2.5/§2.6);
  //    PgChargeAttemptAdapter.parseActiveAttempt 同 slice 放行(原僅 pending/charged 會 throw)。
  status: 'pending' | 'charged' | 'released';
  recTradeId: string | null;
  bankTransactionId: string | null;
  /** attempt 建立時間(ISO 8601);弱識別(hint/order_number fallback)時間窗防誤命中用(master plan §1 step 2)。 */
  attemptCreatedAt: string;
  /** orders.total 整數元位(對帳比對;orders 無 currency 欄、Phase 1 TWD → 1b 以 'TWD' 常數斷言 currency)。 */
  orderTotal: number;
  orderPaymentStatus: PaymentStatus;
  orderDisplayId: string;
};

/**
 * SettleChargeInput:settleCharge use-case 輸入(master plan §1;三路 callback/webhook/sweeper + retry 共用)。
 *
 * `orderId` = 反查鍵(唯一輸入權威);`recTradeIdHint` = **僅 hint**(Record 驗、非本機權威鍵;master plan
 * §1 step 1 第 3 順位 rec→bank→hint→order_number)。
 */
export type SettleChargeInput = {
  orderId: OrderId;
  recTradeIdHint?: string;
};

/**
 * SettleChargeOutcome:settleCharge 結果(action 層〔3DS-5b〕映 duplicate/重刷/hold;settleCharge **不碰** UI/cart)。
 *
 * - `paid`:Record 證實 + markCharged→confirm→recordPendingInvoice 成(`idempotent`=重入 no-op;`displayId` 供 duplicate 回號)。
 * - `failed`:Record 明確未成功(record_status -1=ERROR / 5=CANCEL)→ markFailed 已釋鎖、caller 可放行重刷。
 * - `pending`:保留、不釋鎖 → sweeper/retry 再來。`reason`:
 *   - `auth_or_pending`:record_status 4=PENDING 待付款(尚未授權;0 AUTH/1 OK 已 S1「授權即成立」→ paid)。
 *   - `record_unverified`:金額不符 / 鍵不符 / number_of_transactions≠1 / 2·3 退款異常(不自動放行、S2=B)。
 *   - `record_unreachable`:recordQuery throw / confirm throw(已扣款不棄、retry)。
 *   - 🔴 `released_failure_observed`(M-3 3DS 乙路 R2a、canonical §5/§2.5):**released** attempt 讀 Record
 *     -1/5(明確失敗觀察)→ 經 `recordReleasedFailureObservation` 寫雙鍵 write-once、**不轉 failed**
 *     (released 續低頻對帳直到 terminal、§2.5);RPC throw / 回應不合法 → 退回 `record_unreachable`。
 *     🔴 兩者(released_failure_observed / record_unreachable)皆 pending、sweeper/inbox 一律 markRetry、
 *     markProcessed 不得被呼(§2.5/§5;released branch 行為在 R2b、本 R2a 只定義型別)。
 * - `no_attempt`:orderId 無 active(pending|charged|released)attempt(webhook 對不上本機 → route 丟棄)。
 */
export type SettleChargeOutcome =
  | { kind: 'paid'; idempotent: boolean; displayId: string }
  | { kind: 'failed' }
  | {
      kind: 'pending';
      reason: 'auth_or_pending' | 'record_unverified' | 'record_unreachable' | 'released_failure_observed';
    }
  | { kind: 'no_attempt' };

/**
 * SiblingLookupResult:`find_active_sibling_own` RPC 回 DTO(M-3 3DS 乙路 立即重刷 preflight;canonical §2.3/§3/§4 R1a2)。
 *
 * authenticated own-only 反查「同 cart_session_id 是否已有兄弟單」,放在 placeOrder **之前**(否則新單先建=孤兒):
 * - `none`:無兄弟單 → proceed 建新單重刷。
 * - `paid`:兄弟單已付款 → 顯既有單(零雙扣、不建新單、不 release);不強迫帶 attempt_id。
 * - `active`:兄弟單有 active(pending|charged|released)attempt → settleCharge(existingOrderId)裁決後決定 release/hold。
 *
 * 🔴 **資料最小化(round6 一)**:`active` 分支**不含** `recTradeId`/`bankTransactionId` —— 金流交易識別碼
 * 絕不下放 authenticated/browser;settleCharge(existingOrderId)本就由 payment_confirmer 的
 * `get_active_charge_attempt` server-side 內部取 rec/bank(§3)。
 *
 * 🔴 本 R2a 只**定義型別**(地基層);消費端 `ISiblingLookup` port + `SupabaseSiblingLookupAdapter` +
 * `preflightReleaseSibling` use-case = R2b(§9/§14 步24)。
 *
 * @see supabase/migrations/20260624120001_m3_3ds_r1a2_find_active_sibling_own.sql
 */
export type SiblingLookupResult =
  | { kind: 'none' }
  | { kind: 'paid'; existingOrderId: string; displayId: string }
  | { kind: 'active'; existingOrderId: string; attemptId: string; displayId: string };

// ── M-3 3DS-2:②-⑥ webhook durable inbox 入口 ─────────────────────────────────────────────────

/**
 * WebhookEventInput:`record_webhook_event` RPC(3DS-0a)落地入參(IWebhookInbox.recordEvent)。
 *
 * 🔴 對齊 0a 白名單欄(`supabase/migrations/20260613120000_m3_3ds_0a_webhook_events.sql`):**只**這些欄、
 * 零 raw 原文(PII 由 webhook route 先算 `rawHash`=raw body 的 sha256 hex〔hash-before-parse〕、不存
 * masked_credit_card_number / card_identifier);`reportedStatus` 不可信(僅稽核、成交權威走 settleCharge
 * Record API)。必填 = `recTradeId`(去重主鍵)/ `orderNumber`(= 我方 orderId、settleCharge 對單)/ `rawHash`;
 * 其餘選填(notify 可能缺)。
 */
export type WebhookEventInput = {
  recTradeId: string;
  orderNumber: string;
  /** raw body 的 sha256 hex(64 字 `^[0-9a-f]{64}$`;鑑識用、非 PII、0a CHECK 把關)。 */
  rawHash: string;
  reportedStatus?: number;
  amount?: number;
  bankTransactionId?: string;
  transactionTimeMillis?: number;
};

// ── M-3 3DS-4:sweeper 原子 lease claim 回傳(claim token = 計數欄、mark RPC 帶回做 token guard)──────

/**
 * DueWebhookEvent:`claim_due_webhook_events` RPC(3DS-4a-1)原子 lease claim 回傳一筆。
 *
 * `attemptCount` = claim 遞增後值(**claim token**);sweeper 呼 settleCharge 後以 `markProcessed`/`markRetry`
 * 帶回 `attemptCount` 做 token guard(事件被另一 cron run 重領 → count 變 → stale mark no-op、回 affected=0)。
 * `orderNumber` = 我方 orderId(settleCharge 對單);`recTradeId` = settleCharge `recTradeIdHint`(master §1 rec 優先序)。
 */
export type DueWebhookEvent = {
  recTradeId: string;
  orderNumber: string;
  attemptCount: number;
};

/**
 * StuckChargeAttempt:`claim_stuck_unsettled_attempts` RPC(3DS-4a-2)原子 lease claim 回傳一筆。
 *
 * `settleCount` = claim 遞增後值(**claim token**);sweeper 呼 settleCharge 後以 `markSettleRetry` 帶回做 token guard。
 * `orderId` = settleCharge 對單(含 charged-unpaid 群1:markCharged 成功但 confirm throw → attempt=charged/order unpaid)。
 */
export type StuckChargeAttempt = {
  attemptId: string;
  orderId: string;
  settleCount: number;
};
