// @vitest-environment node
//
// #216:運費門檻雙處 hardcode(domain shipping.ts FREE_SHIPPING_THRESHOLD/HOME_SHIPPING_FEE
//   ↔ create_order RPC §7 `CASE WHEN v_subtotal >= 5000 THEN 0 ELSE 100 END`)原無 CI gate、
//   改一處忘另一處會靜默漂移(顯示運費 ≠ 實際成交運費)。本測補對比守門。
//
// 純讀已 commit 的 .sql(非連線 live DB)→ 抓**最新一支定義 create_order 的 migration**的 §7 運費 CASE、
// assert == TS 常數。取「最新」(時戳前綴最大者)= 當前生效定義
// (後者勝:同簽章走 CREATE OR REPLACE;🔴 M-4a B-2 起改參數數量的片走 DROP + CREATE ——
//  PG 不允許用 CREATE OR REPLACE 改參數數量,那會產生 overload 而非取代);故未來運費若調整,
// superseded 舊 migration 保留舊值不誤紅。改運費須同步「TS 常數 + 新 migration」兩處,本 gate 即攔任一處漏改。
//
// 🔴 **anchor = 「定義 create_order」而非「命中運費 CASE regex」**(2026-07-25 codex 關卡2 R3 複驗抓出、
//   Sean 拍 A 當場修):舊版是「由新往舊翻、第一個**命中 CASE regex** 的檔就採用」。實查當時 7 支
//   migration 都定義 create_order 且 7 支都命中 regex ⇒ 一旦最新那支把 CASE 寫成 regex 抓不到的形狀
//   (**RF2a-0/RF2b 正要把運費改成讀凍結欄位/變數**,例如 `v_subtotal >= v_free_threshold`),
//   gate 會**靜默退回已被取代的舊 migration**、永遠綠,而真正生效的運費已漂走 = 假綠。
//   現行語意:最新那支**抓不到 CASE 就直接紅**(附指示訊息),不准回退。
//   ⚠️ 另有 1 支(`20260612150000_m3_s2d_charge_attempts.sql`)只在 DROP/GRANT 提到 create_order、
//   並未定義它 ⇒ anchor regex 必須要求 `CREATE [OR REPLACE] FUNCTION`,不能只比對函式名。

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
// 🔴 anchor:必須是「定義」create_order 的檔(排除只 DROP/GRANT/COMMENT 提到函式名的 migration)
const CREATE_ORDER_DEF = /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.create_order\s*\(/i;

/** 最新一支**定義** create_order 的 migration 檔名(= 當前生效定義);查無回 null。 */
function latestCreateOrderFile(): string | null {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // 檔名時戳前綴升冪 → 由後往前找,第一個「定義」create_order 的即最新生效定義
  for (let i = files.length - 1; i >= 0; i--) {
    if (CREATE_ORDER_DEF.test(readFileSync(join(MIGRATIONS_DIR, files[i]!), 'utf8'))) return files[i]!;
  }
  return null;
}

/**
 * 最新生效 create_order 的 §7 運費兩數。
 * 🔴 **不回退**:最新那支定義檔抓不到運費 CASE 就回 null(→ gate 紅),
 *    絕不改去讀舊 migration(那會產生「對照已作廢定義」的假綠)。
 */
function latestCreateOrderShipping(): { threshold: number; fee: number; file: string } | null {
  const file = latestCreateOrderFile();
  if (!file) return null;
  const m = readFileSync(join(MIGRATIONS_DIR, file), 'utf8').match(SHIPPING_CASE);
  if (!m) return null;
  return { threshold: Number(m[1]), fee: Number(m[2]), file };
}

describe('運費門檻 TS ↔ create_order RPC §7 drift gate(#216)', () => {
  it('gate 已接線:最新 create_order 定義檔存在,且其 §7 運費 CASE 可解析(🔴 抓不到就紅、不回退舊檔)', () => {
    const file = latestCreateOrderFile();
    expect(file, 'supabase/migrations 內找不到任何定義 public.create_order 的 migration').not.toBeNull();

    const sql = latestCreateOrderShipping();
    expect(
      sql,
      `最新 create_order 定義檔「${file}」內解析不到 §7 運費 CASE(regex=${SHIPPING_CASE})。` +
        '🔴 這代表運費算法已改寫形狀(例如 RF2a-0/RF2b 改讀 orders 凍結欄位或用變數)—— ' +
        '請同步改本 gate(更新 SHIPPING_CASE,或改為對照欄位 DEFAULT),' +
        '**不要**讓它退回舊 migration 對照:那會變成「拿已作廢定義對帳」的假綠。',
    ).not.toBeNull();

    // 三方 gate 的對照基準必須就是那支最新定義檔(防未來又被改成回退式搜尋)
    expect(sql!.file).toBe(file);
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
