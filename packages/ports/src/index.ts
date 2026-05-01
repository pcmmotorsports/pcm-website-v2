// @pcm/ports — 抽象介面, M-0-04 5 個 ports
//
// 對齊 ADR-0003 §3.3 — 介面字面只出現 domain 命名、不允許 Medusa wire 字串 leak。

export type * from './IProductRepository';
export type * from './ICustomerRepository';
export type * from './IOrderRepository';
export type * from './ISheetsAdapter';
export type * from './ITapPayAdapter';
