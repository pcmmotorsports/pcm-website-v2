// @vitest-environment node
//
// #216:運費門檻雙處 hardcode(domain shipping.ts FREE_SHIPPING_THRESHOLD/HOME_SHIPPING_FEE
//   ↔ create_order RPC §7 `CASE WHEN v_subtotal >= 5000 THEN 0 ELSE 100 END`)原無 CI gate、
//   改一處忘另一處會靜默漂移(顯示運費 ≠ 實際成交運費)。本測補對比守門。
//
// 純讀已 commit 的 .sql(非連線 live DB)→ 抓「最新」含運費 CASE 的 create_order migration 的 §7、
// assert == TS 常數。取「最新」(時戳前綴最大、含運費 CASE 的 migration)= 當前生效定義
// (create_order 走 CREATE OR REPLACE、後者勝);故未來運費若調整,superseded 舊 migration 保留舊值
// 不誤紅。改運費須同步「TS 常數 + 新 CREATE OR REPLACE migration」兩處,本 gate 即攔任一處漏改。

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FREE_SHIPPING_THRESHOLD, HOME_SHIPPING_FEE } from './shipping';

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
});
