// @pcm/ports — 抽象介面, M-0-04 5 個 ports
//
// 對齊 ADR-0003 §3.3 — 介面字面只出現 domain 命名、不允許 Medusa wire 字串 leak。

export type * from './IProductRepository';
export type * from './ICustomerRepository';
export type * from './IAddressRepository';
export type * from './IVehicleRepository';
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
export type * from './IEmailSender';
// 🔴 `Q-C9-b` 前置(2026-08-18):出貨通知信的寄送時讀取 port。
// **目前零 production 呼叫端** —— 組裝那一行(`composition.ts:55`)刻意沒接,理由見該檔檔頭。
export type * from './IShippedEmailContext';

// Contract test framework 不從 main entry re-export(M-1-03-prep-audit S1 修正):
// - tree-shaking 樂觀假設不可信、main entry re-export 會把 vitest 拉進 production bundle
// - adapter test 端必走 subpath:`import { runProductRepositoryContract } from '@pcm/ports/contract'`
// - 對應 package.json `exports` field `./contract` 子路徑、Bundler moduleResolution 生效
// - 規範:`docs/lessons-learned.md` §12-1
// - audit 來源:`docs/reviews/M-1-03-prep-audit-2026-05-05.md` F1 / F19(雙視角 Critical)
