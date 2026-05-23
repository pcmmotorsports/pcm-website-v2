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
export type * from './ISheetsAdapter';
export type * from './ITapPayAdapter';

// Contract test framework 不從 main entry re-export(M-1-03-prep-audit S1 修正):
// - tree-shaking 樂觀假設不可信、main entry re-export 會把 vitest 拉進 production bundle
// - adapter test 端必走 subpath:`import { runProductRepositoryContract } from '@pcm/ports/contract'`
// - 對應 package.json `exports` field `./contract` 子路徑、Bundler moduleResolution 生效
// - 規範:`docs/lessons-learned.md` §12-1
// - audit 來源:`docs/reviews/M-1-03-prep-audit-2026-05-05.md` F1 / F19(雙視角 Critical)
