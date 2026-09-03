// @pcm/use-cases — business logic 編排、跨 domain context 流程
//
// 對應 ADR-0002 §4.1(monorepo 結構)/ §5.3(bug 可追蹤性 — 業務邏輯錯找 use case)。
//
// M-1-14e-1b:會員 use-cases(register / login / logout / update-profile)。
// M-1-14e-2a:地址 CRUD use-cases(add / update / delete / set-default address)。
// M-1-14e-2b:車輛 CRUD use-cases(add / update / delete / set-primary vehicle;鏡像 e-2a、isPrimary)。
// M-1-14e-3:錢包儲值 use-case(depositWallet、mock 記帳、真金流 M-3;單筆 immutable ledger insert、餘額 trigger 同步)。
// 守 boundaries(ADR-0002 §4.2、use-cases ⊥ schemas):use-case 只收已驗證的 domain 型別;
// 表單 @pcm/schemas parse / strip 未知欄 / 取 session userId 在 delivery 層(f1 storefront
// server action、server 端、不信 client)。auth 走 IAuthService(e-1a)、profile 走
// ICustomerRepository、address 走 IAddressRepository、vehicle 走 IVehicleRepository(皆 M-1-14d);concrete adapter 由 f 段 wire-up 注入。

export { registerCustomer } from './register-customer';
export { loginCustomer } from './login-customer';
export { logoutCustomer } from './logout-customer';
export { updateProfile } from './update-profile';

// 忘記密碼片新:寄重設信 / 設定新密碼(薄編排、走 IAuthService、對齊 login/logout use-case 樣式)。
export { requestPasswordReset } from './request-password-reset';
export { resetPassword } from './reset-password';

export { addAddress, type AddressCreateInput } from './add-address';
export { updateAddress, type AddressPatch } from './update-address';
export { deleteAddress } from './delete-address';
export { setDefaultAddress } from './set-default-address';

export { addVehicle, type VehicleCreateInput } from './add-vehicle';
export { updateVehicle, type VehiclePatch } from './update-vehicle';
export { deleteVehicle } from './delete-vehicle';
export { setPrimaryVehicle } from './set-primary-vehicle';

export { depositWallet } from './deposit-wallet';

// M-3-S2-b2:建單 use-case(placeOrder、薄編排、server 權威全在 create_order RPC;
// input/result 型別在 @pcm/domain order/types.ts、本層不 re-export 型別、從 @pcm/domain 取)。
export { placeOrder } from './place-order';

// M-3 階段②-②b:成交編排 use-case(confirmPayment、charge → confirm、孤兒單契約 outcome;
// 型別 ConfirmPaymentInput/Outcome 在 @pcm/domain payment/types.ts、從 @pcm/domain 取)。
export { confirmPayment, type ConfirmPaymentDeps } from './confirm-payment';

// M-3 3DS-5b:3DS charge 啟動半段 use-case(initiatePayment = master plan「confirmPayment.initiate」落地名;
// charge 帶 3DS → 回 redirect payment_url、結算交 settleCharge;3DS-6 才 consume;型別 InitiatePaymentInput/Outcome
// 在 @pcm/domain payment/types.ts、從 @pcm/domain 取)。
export { initiatePayment, type InitiatePaymentDeps } from './initiate-payment';

// M-3 3DS-1b:對帳脊椎 use-case(settleCharge、三路 callback/webhook/sweeper + retry 共呼冪等、
// Record API 唯一權威;master plan v5 §1)。
export { settleCharge, type SettleChargeDeps } from './settle-charge';
// M-4b 請款狀態重讀(backlog #785;新造一條路、不動 settleCharge 的 paid 短路)
export {
  recheckCaptureState,
  type RecheckCaptureStateDeps,
  type RecheckCaptureStateInput,
  type RecheckCaptureStateResult,
} from './recheck-capture-state';

// M-3 3DS-4b-2:sweeper 兜底 use-case(sweepSettlements、週期 cron〔3DS-4c〕掃 inbox+stuck 兩來源 →
// settleCharge 共呼、每輪前置守衛 expire×2+flag、per-order 去重、有界並發、單筆 fail-closed;plan §5.2)。
export {
  sweepSettlements,
  type SweepSettlementsDeps,
  type SweepSettlementsOptions,
  type SweepSettlementsResult,
} from './sweep-settlements';

// M-3 3DS 乙路 R2b-2:立即重刷 preflight use-case(preflightReleaseSibling、§2.3 狀態機;
// siblingLookup → settle → release/hold/proceed;R3 chargePaymentAction placeOrder 前呼。
// Input/Outcome 型別在 @pcm/domain payment/types.ts、從 @pcm/domain 取)。
export {
  preflightReleaseSibling,
  type PreflightReleaseSiblingDeps,
} from './preflight-release-sibling';

// M-3 3DS 乙路 B1b:12h 孤兒專用再確認 use-case(reconfirmExpiredOrphans、claim_expired_pending_attempts〔B1a〕
// → 複用 settleCharge 收斂;繞 sweeper ceiling/manual、自有 throttle 分軌、不呼 markSettleRetry;canonical §8)。
export {
  reconfirmExpiredOrphans,
  type ReconfirmExpiredOrphansDeps,
  type ReconfirmExpiredOrphansOptions,
  type ReconfirmExpiredOrphansResult,
} from './reconfirm-expired-orphans';

// M-3 #250 雙扣 anomaly 主動告警 use-case(checkAnomalyAlerts、週期 cron〔anomaly-alert〕讀零 PII 計數 →
// 任一門檻踩 → 對所有已設定管道〔LINE/Email〕推播固定格式告警;pull→push、fail-closed、無去重持續提醒)。
export {
  checkAnomalyAlerts,
  buildAnomalyAlertMessage,
  type CheckAnomalyAlertsDeps,
  type CheckAnomalyAlertsOptions,
  type CheckAnomalyAlertsResult,
} from './check-anomaly-alerts';

// M-4a Email 片 E2a-b:逐碼退避政策(§⑨ 三列+plan v3.3 §5 兜底列的唯一 TS 實作落點;E2a sweeper
// 與 E3 after() 皆須經此算 next_retry_at,不得內聯退避數字)。
export {
  computeEmailBackoff,
  LEASE_RECLAIM_RETRY_DELAY_MS,
  type EmailBackoffRandom,
} from './email-backoff';

// M-4a Email 片 E2a-b:outbox sweeper use-case(sweepEmailOutbox、週期觸發〔E2a-c route → E2b pg_cron〕
// → ①lease 回收〔§⑩ 落 failed+lease_reclaimed〕②claimDue ③逐封順序寄送→markSent/markFailed〔email-backoff 退避〕;
// 零告警〔Q13=A、五訊號全歸 E2a-2〕、counts-only 零 PII、單封 fail-closed、at-least-once)。
export {
  sweepEmailOutbox,
  type SweepEmailOutboxDeps,
  type SweepEmailOutboxOptions,
  type SweepEmailOutboxResult,
} from './sweep-email-outbox';

// 🔴 M-4a B-5(Sean `Q-G4-1`=甲 掃描式):把「已付款但還沒排過 order_created」的單排進 outbox。
// 掛在 email-sweep route 的最前面、sweepEmailOutbox 之前、且用**自己的 deps**(不要 Resend;plan §3.1)。
// **本片一封信都不會寄** —— 那是設計好的落點(PRD §6 gate #1),不是缺陷。
export {
  enqueueOrderCreatedEmails,
  type EnqueueOrderCreatedEmailsDeps,
  type EnqueueOrderCreatedEmailsOptions,
  type EnqueueOrderCreatedEmailsResult,
} from './enqueue-order-created-emails';

// 未付款被【員工】取消的通知信(Sean 2026-09-03 拍甲;逾時那批不在射程內 —— 題 2 未拍板)。
export {
  enqueueOrderUnpaidCancelledEmails,
  type EnqueueOrderUnpaidCancelledEmailsDeps,
  type EnqueueOrderUnpaidCancelledEmailsOptions,
  type EnqueueOrderUnpaidCancelledEmailsResult,
} from './enqueue-order-unpaid-cancelled-emails';

// 🔴 M-4b E4-a(2026-08-22):出貨線的同款掃描式 enqueue。**一列 = 一個 (箱, 單) 配對 = 一封信**
// (Sean 2026-08-17「一箱兩單就兩封」)。
// ⛔ ~~**片1 刻意【不】把它掛上任何 route** —— sweeper 對 order_shipped 目前仍 fail-closed throw,
//    掛上去會讓列排進佇列、每輪 throw、燒 attempts 進死信、然後每天告警。**模板與掛 route 是同一片(片3)。**~~
// ✅ **2026-08-30 片3b:模板落地了,兩件同一片做完** ⇒ 上面那個順序風險已經消失,
//    而**那句話留著是刻意的**:它講的順序仍然是對的(先模板、後接線),下一條線照樣適用。
// 🔴 **而閘沒有消失,只是換了位置** —— 而它是**兩道**,不是一道:
//    ```
//    ① 排信那一半：env 沒設 ⇒ resolveShippedEmailCutoff 回 not-configured ⇒ 一列都不排
//    ② 寄信那一半：sweepEmailOutbox 的必填 allowOrderShipped ⇒ false 就不寄
//    ```
//    🔴🔴 **只寫 ① 是一句被擊破過的話**(codex 2026-08-30 R1 must-fix 1):
//    env 只擋得住【還沒排進去的】,而 outbox 裡**已經有**的 `order_shipped` 列,
//    sweeper 每五分鐘照樣把它們寄出去 —— 而那正是「設了、看到不對、把 env 拿掉」之後的世界。
//    ⇒ 📌 **把 ② 刪掉,上面 ① 那句話【讀起來照樣成立】** ⇒ 所以兩道都要寫在這裡,
//      否則下一個人會以為那個旗標是多餘的。
export {
  enqueueOrderShippedEmails,
  type EnqueueOrderShippedEmailsDeps,
  type EnqueueOrderShippedEmailsOptions,
  type EnqueueOrderShippedEmailsResult,
} from './enqueue-order-shipped-emails';

// 🔴 M-4b E4 片3b(2026-08-30):`SHIPPED_EMAIL_CUTOFF` 的解析(純函式、零 I/O)。
// ⚠️ 它**不是**開關本身 —— 開關是那顆 env 有沒有被設。本函式只負責「設了之後怎麼讀」,
//    而它刻意沒有「沒設就用預設起點」那條路(見該檔:那是這條線最貴的失敗模式)。
export {
  resolveShippedEmailCutoff,
  type ShippedEmailCutoff,
} from './shipped-email-cutoff';

// 🔴 訊號 4(2026-08-31,線出貨):`B4_DEPLOY_CUTOFF` 的解析。
// ⚠️ **它是【搬移】不是新寫的** —— 原本只住在 `email-sweep/route.ts` 裡,
//    而訊號 4 的告警端要讀同一顆 env。各寫一份 ⇒ 兩個消費者兩套驗證
//    ⇒ 同一天在 `SHIPPED_EMAIL_CUTOFF` 上量到過那個病(寄信端擋下、告警端照數)。
export { readDeployCutoff, type DeployCutoffRead } from './deploy-cutoff';
export {
  readOrderCreatedStuckMinutes,
  type StuckMinutesRead,
} from './order-created-stuck-minutes';

// 🔴 M-4a E2a-2(W3-G 拆出,2026-08-20):寄送前 ineligible gate,擋「排進佇列後、真正寄出前
// 才被取消」的窗口。獨立 cron route,跑在 sweepEmailOutbox 之前但**不掛進**它的 route ——
// 歸屬邊界見 sweep-email-outbox.test.ts:53 的預設 mock(reject,證明 E2a-b 不呼叫此路徑)。
export {
  applyOrderIneligibleGate,
  type ApplyOrderIneligibleGateDeps,
  type ApplyOrderIneligibleGateOptions,
  type ApplyOrderIneligibleGateResult,
} from './apply-order-ineligible-gate';
