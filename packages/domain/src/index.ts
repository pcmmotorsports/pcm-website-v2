// @pcm/domain — 9 個 bounded contexts 純邏輯, M-0-04 type stub 階段
//
// re-export 順序對齊依賴關係:shared(無依賴)→ catalog → identity → order → sync → payment

export type * from './shared/types';
export type * from './catalog/types';
export type * from './identity/types';
export type * from './order/types';
export type * from './sync/types';
export type * from './payment/types';

// 本 slice M-1-02 Q1=A1 拍板加(補 runtime helper re-export):
// 對齊 ADR-0004 Q4=A3 brand type 集中守門精神、跨 package 也須走 toMoneyAmount()
// Q2=A3「維持 export type * 現狀」精神不變、本行是補充 runtime export、非改既有 type export
// 教訓:M-0-10b Q4=A3 拍板字面遺漏跨 package runtime helper 可見性、M-1-02 撞 typecheck fail
// 補完規則寫進 ADR-0003 §3.1.1「runtime helper 跨 package re-export 規則」
export { toMoneyAmount } from './shared/types';
