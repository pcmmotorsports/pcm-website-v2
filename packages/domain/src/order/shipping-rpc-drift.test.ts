// @vitest-environment node
//
// #216:運費門檻雙處 hardcode(domain shipping.ts FREE_SHIPPING_THRESHOLD/HOME_SHIPPING_FEE
//   ↔ create_order RPC §7 `CASE WHEN v_subtotal >= 5000 THEN 0 ELSE 100 END`)原無 CI gate、
//   改一處忘另一處會靜默漂移(顯示運費 ≠ 實際成交運費)。本測補對比守門。
//
// 純讀已 commit 的 .sql(非連線 live DB)→ 抓「最新」含運費 CASE 的 create_order migration 的 §7、
// assert == TS 常數。取「最新」(時戳前綴最大、含運費 CASE 的 migration)= 當前生效定義
// (後者勝:同簽章走 CREATE OR REPLACE;🔴 M-4a B-2 起改參數數量的片走 DROP + CREATE ——
//  PG 不允許用 CREATE OR REPLACE 改參數數量,那會產生 overload 而非取代);故未來運費若調整,
// superseded 舊 migration 保留舊值不誤紅。改運費須同步「TS 常數 + 新 migration」兩處,本 gate 即攔任一處漏改。

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { calculateShippingFee, FREE_SHIPPING_THRESHOLD, HOME_SHIPPING_FEE } from './shipping';
import { toMoneyAmount } from '../shared/types';

// packages/domain/src/order/ → repo root 上 4 層 → supabase/migrations
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../supabase/migrations');
// §7 運費 CASE:`v_subtotal >= <門檻> THEN 0 ELSE <未滿運費> END`
const SHIPPING_CASE = /v_subtotal\s*>=\s*(\d+)\s*THEN\s*0\s*ELSE\s*(\d+)\s*END/;

function latestCreateOrderShipping(): { threshold: number; fee: number; file: string } | null {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // 檔名時戳前綴升冪 → 由後往前找,第一個含 CASE 的為最新生效定義
  for (let i = files.length - 1; i >= 0; i--) {
    const m = readFileSync(join(MIGRATIONS_DIR, files[i]!), 'utf8').match(SHIPPING_CASE);
    if (m) return { threshold: Number(m[1]), fee: Number(m[2]), file: files[i]! };
  }
  return null;
}

describe('運費門檻 TS ↔ create_order RPC §7 drift gate(#216)', () => {
  it('migrations 內存在運費 CASE(gate 已接線、防 regex 漂走變空測)', () => {
    expect(latestCreateOrderShipping()).not.toBeNull();
  });

  it('最新 create_order migration §7 門檻 == domain FREE_SHIPPING_THRESHOLD', () => {
    const sql = latestCreateOrderShipping();
    expect(sql?.threshold).toBe(FREE_SHIPPING_THRESHOLD);
  });

  it('最新 create_order migration §7 未滿運費 == domain HOME_SHIPPING_FEE', () => {
    const sql = latestCreateOrderShipping();
    expect(sql?.fee).toBe(HOME_SHIPPING_FEE);
  });

  // ── RF1 擴充:gate 由「TS 常數 ↔ SQL」兩方擴為「TS 常數 ↔ 預設規則 ↔ SQL」三方 ──
  //
  // 🔴 為何必須加(codex 關卡1 R2-F1):RF1 給 calculateShippingFee 加了選填第三參數 `rule`,
  //   預設值為模組私有的 DEFAULT_SHIPPING_RULE。若該預設值另寫字面數字而非由常數衍生,
  //   它可獨立漂走 —— 而「兩參呼叫 vs 三參傳 DEFAULT」的等價測試會**同源假綠**
  //   (兩邊都吃同一個錯的 default → 永遠相等),兩方 gate 也抓不到,但 storefront 顯示的運費已變。
  // 🔴 v6(codex 關卡2 R2 must-fix):DEFAULT_SHIPPING_RULE 已改為**模組私有、完全不 export**
  //   (防 RF5 寫 fallback)→ 本 gate 改以**行為**驗證預設值,不直接斷言物件欄位。
  const twd = (n: number) => ({ amount: toMoneyAmount(n), currency: 'TWD' as const });

  it('預設規則的免運門檻(行為驗證)== FREE_SHIPPING_THRESHOLD', () => {
    expect(calculateShippingFee(twd(FREE_SHIPPING_THRESHOLD), 'home').amount).toBe(0);
    expect(calculateShippingFee(twd(FREE_SHIPPING_THRESHOLD - 1), 'home').amount).toBe(HOME_SHIPPING_FEE);
  });

  it('預設規則的未滿運費(行為驗證)== HOME_SHIPPING_FEE', () => {
    expect(calculateShippingFee(twd(0), 'home').amount).toBe(HOME_SHIPPING_FEE);
  });

  it('預設規則 == 最新 create_order migration §7 兩數(三方一致、行為驗證)', () => {
    const sql = latestCreateOrderShipping();
    expect(calculateShippingFee(twd(sql!.threshold), 'home').amount).toBe(0);
    expect(calculateShippingFee(twd(sql!.threshold - 1), 'home').amount).toBe(sql!.fee);
  });
});
