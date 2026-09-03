// @pcm/ports — 抽象介面, M-0-04 5 個 ports
//
// 對齊 ADR-0003 §3.3 — 介面字面只出現 domain 命名、不允許 Medusa wire 字串 leak。

export type * from './IProductRepository';
export type * from './ICustomerRepository';
export type * from './IAddressRepository';
export type * from './IVehicleRepository';
export type * from './IFavoritesRepository';
export type * from './IWalletRepository';
export type * from './IAuthService';
export type * from './IOrderRepository';
// M-4b E10 A9w4c(後半收尾):`IOrderStatusOptionsRepository` 整支 port 已移除 —— 唯一方法
// `listOrderStatusOptions` 在 A11a-1 列表重建後零 production 呼叫端,讀取鏈同片退場。
// 🔴 DB 端 order_status_options 表仍在;service_role 的**寫**權由 A9v `20260807120000` 撤除
// (SELECT 保留),apply 後生效
//    ⇒ 這裡是「應用層拿不到這張表的讀取介面」,不等於「資料庫讀不到」。
export type * from './ISheetsAdapter';
export type * from './ITapPayAdapter';
export type * from './IPaymentConfirmer';
export type * from './IChargeAttemptStore';
export type * from './ISiblingLookup';
export type * from './IReleaseSibling';
export type * from './IWebhookInbox';
export type * from './IPollSettleThrottle';
// M-3 #250 雙扣 anomaly 主動告警:聚合讀 + 推播 port
export type * from './IAnomalyAlertReader';
export type * from './IAlertNotifier';
// M-4a Email 通知片 E1b:交易信 outbox 狀態機 + 寄送 port(與告警 IAlertNotifier 刻意拆港:
// 收件者逐封不同、失敗回結構化錯誤碼不 throw、outbox 需錯誤碼落表退避)。
export type * from './IEmailOutbox';
export type * from './IUnpaidCancelledOrderScanner';
// 🔴 **值 export 要單獨一行** —— 本檔其餘都是 `export type *`(port 檔本來就只有型別)。
//    而 `SUPPRESS_WHEN_ORDER_INELIGIBLE` 是**執行期要讀的表**, 不是型別
//    ⇒ 走 `export type *` 會在使用端當場紅(實測 TS1362)。
export { SUPPRESS_WHEN_ORDER_INELIGIBLE } from './IEmailOutbox';
export type * from './IEmailSender';
// 🔴 `Q-C9-b` 前置(2026-08-18):出貨通知信的寄送時讀取 port。
// ~~**目前零 production 呼叫端** —— 組裝那一行刻意沒接~~
// **2026-08-22(M-4b E4-b)起要分三層講**(合成一句就會有一句不成立):
//   ① 有實作 ✅ `SupabaseShippedEmailContextAdapter`
//   ② 有注入 ✅ `storefront/lib/email/composition.ts` → `Deps.shippedContext`(選用欄)
//   ③ ⛔ ~~🔴 **沒有人呼叫它** —— `sweepEmailOutbox` 只解構 `{ outbox, sender }`,現況 = 建構後閒置~~
//      🔵 **2026-09-03 訂正:已被呼叫**(`sweep-email-outbox.ts:938`)—— 詳見該 port 檔頭。
// ⚠️ ⇒ **一封都不寄**:`buildEmailText` 對 `order_shipped` 仍然 fail-closed throw。
//    真正呼叫本 port 的是模板那一片(片3)。詳見該 port 檔頭。
export type * from './IShippedEmailContext';
// 🔴 M-4b(2026-08-24,Sean 拍板信裡要顯示金額之後):付款信的同款寄送時讀取 port。
// 🔴 ~~今天三層全是「沒有」:零 adapter / 零注入 / 零呼叫端~~ **2026-08-24 codex M6:①已假**
// ⛔ ~~現況 = **有 adapter(已從 adapters/src/server.ts 匯出)/ 零注入 / 零呼叫端** ⇒ 仍不是一條通路。~~
// 🔴🔴 **2026-09-03 訂正:三層【全部接上】了 ⇒ 「仍不是一條通路」為假。**
//    有注入 `composition.ts:155` · 有呼叫 `sweep-email-outbox.ts:781` —— 詳見該 port 檔頭。
// 🎯 **而這一格最該記的是它自己下一行那句**:逐字「這裡不重抄數字;抄兩份 = 兩份各自過期」——
//    **而上面那一行就是抄的那一份, 而它過期了。** ⇒ 📌 一條「不要抄」的紀律, 被寫在它自己違反的那一行旁邊。
//    ⇒ ⇒ **所以本次訂正【不重抄數字】, 只留指標與「已為假」四個字。**
// ⚠️ 數法與完整三層寫在該 port 檔頭;**這裡不重抄數字**(抄兩份 = 兩份各自過期)。
// ⚠️ 這一行**不會**讓任何客人收到不一樣的信;接上它的是模板那一片(合併 plan 的 S4)。
export type * from './IPaidEmailContext';
// 🔴 M-4a B-5(掃描式 enqueue,Sean `Q-G4-1`=甲):「已付款但還沒排過 order_created」的窄讀 port。
// 它回 PII(兩個 email 欄)⇒ 實作 server-only + service_role;呼叫端只准把值交給 outbox.enqueue。
export type * from './IPaidOrderScanner';
// 🔴 M-4b E4-a(2026-08-22):出貨線的同款窄讀 port。**一列 = 一個 (箱, 單) 配對 = 一封信**
// —— 一箱可含多張訂單,Sean 2026-08-17 拍板「一箱兩單就寄兩封」。同樣回 PII、同樣的紀律。
export type * from './IShippedOrderScanner';
// 🔴 M-4a E2a-2(W3-G 拆出,2026-08-20):寄送前 ineligible gate 的窄讀 port —— 擋「排進佇列後、
// 真正寄出前才被取消」的窗口(掃描器 SupabasePaidOrderScannerAdapter 只擋掃描當下已取消的)。
export type * from './IIneligibleOrderEmailScanner';

// Contract test framework 不從 main entry re-export(M-1-03-prep-audit S1 修正):
// - tree-shaking 樂觀假設不可信、main entry re-export 會把 vitest 拉進 production bundle
// - adapter test 端必走 subpath:`import { runProductRepositoryContract } from '@pcm/ports/contract'`
// - 對應 package.json `exports` field `./contract` 子路徑、Bundler moduleResolution 生效
// - 規範:`docs/lessons-learned.md` §12-1
// - audit 來源:`docs/reviews/M-1-03-prep-audit-2026-05-05.md` F1 / F19(雙視角 Critical)
