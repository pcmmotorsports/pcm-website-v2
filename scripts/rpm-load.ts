/**
 * rpm-load — RPM Carbon 匯入:目標寫入段(S2 從 rpm-import.ts 拆出、純 refactor、邏輯逐字搬移行為不變)
 *
 * 目標(寫):pcm-website-v2 `bmpnplmnldofgaohnaok`
 *   resolveId(讀 brand/category id)+ 分批冪等 upsert(onConflict)。
 *
 * S2(2026-06-02):rpm-import.ts 原 415 行破鐵則 6、拆 fetch / transform / load 三段;本檔=load 段。
 *   平鋪 scripts/ root(被 tsconfig.scripts.json + eslint scripts/*.ts 覆蓋)。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ── constants ──
const BATCH_SIZE = 500;

export async function resolveId(
  tgt: SupabaseClient,
  table: string,
  col: string,
  val: string,
): Promise<string> {
  const { data, error } = await tgt.from(table).select('id').eq(col, val).single();
  if (error || !data) throw new Error(`${table}.${col}='${val}' 不存在(16b-1 seed 未跑?):${error?.message}`);
  return (data as { id: string }).id;
}

/**
 * 分批 upsert(冪等 onConflict)。給 `select` 則每批 `.select(select)` 累積回傳 rows
 * (用於 products 收 id↔external_id 對照、免事後大 `.in(933 值)` 超 GET URL 上限)。
 */
export async function upsertBatched(
  tgt: SupabaseClient,
  table: string,
  rows: object[],
  onConflict: string,
  select?: string,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const base = tgt.from(table).upsert(batch, { onConflict });
    if (select) {
      const { data, error } = await base.select(select);
      if (error) throw new Error(`upsert ${table} batch@${i}: ${error.message}`);
      // supabase-js 動態 select(string)回 GenericStringError[]、無法靜態推型 → 雙 cast escape hatch
      out.push(...((data ?? []) as unknown as Record<string, unknown>[]));
    } else {
      const { error } = await base;
      if (error) throw new Error(`upsert ${table} batch@${i}: ${error.message}`);
    }
    console.log(`  ${table}: upserted ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
  }
  return out;
}
