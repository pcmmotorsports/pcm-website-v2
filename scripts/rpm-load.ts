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
 * 同 resolveId、但查無回 null(不 throw)。
 * 用於 per-group 分類解析:16 大類 P0-B 才 seed,seed 前解析不到 → 回 null 讓 dry-run 續跑、不整條 abort
 *   (plan §2.3「對不上、無 live 風險」)。真查詢錯誤(非 0 列)仍 throw、不吞。
 * 🔴 呼叫端須自行處置 null:P0-A-3 乾跑僅保證不 crash;逐群「未對上分類」彙整報告 + 試點寫入前的
 *   null-category 硬 gate = P0-A-4 / 試點寫入片(backlog #261;products.category_id NOT NULL、null 進 upsert 整批 23502)。
 * 用 maybeSingle():0 列回 {data:null,error:null}、不像 single() 把「查無」當錯誤;categories.raw_path UNIQUE 排除多列。
 */
export async function resolveIdOrNull(
  tgt: SupabaseClient,
  table: string,
  col: string,
  val: string,
): Promise<string | null> {
  const { data, error } = await tgt.from(table).select('id').eq(col, val).maybeSingle();
  if (error) throw new Error(`${table}.${col}='${val}' 查詢失敗:${error.message}`);
  return data ? (data as { id: string }).id : null;
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
