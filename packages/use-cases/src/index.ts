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
