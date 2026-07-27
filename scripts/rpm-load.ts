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
import type { VariantRow } from './rpm-transform';

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
 * 按某 key「是否存在於物件」把 rows 分兩組(#260、Sean 拍 ①「保留現值」)。
 * 背景:postgrest-js `.upsert(陣列)` 的 `?columns` 取**全批 key 聯集** + `defaultToNull=true` →
 *   同批混「有此 key」與「省此 key」兩種列時,省 key 列會被寫 **NULL**(非保留現值)。
 * 解:呼叫端把 productRows 依 description key 是否存在分兩組、各自成 uniform 批 upsert →
 *   「省 key」列落在「該批 columns 不含此 key」的批 → ON CONFLICT DO UPDATE 不覆寫該欄 → 保留現值。
 * 🔴 rpm(syncDescription=false)全批一致省 description → withKey 空 → 現行單批行為 byte 等價。
 * Object.hasOwn:只認 own key(對齊 getSupplierConfig fail-closed 慣例、不吃原型鏈成員)。
 */
export function partitionByKeyPresence<T extends object>(
  rows: T[],
  key: string,
): { withKey: T[]; withoutKey: T[] } {
  const withKey: T[] = [];
  const withoutKey: T[] = [];
  for (const r of rows) (Object.hasOwn(r, key) ? withKey : withoutKey).push(r);
  return { withKey, withoutKey };
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

/**
 * 有 spec transition hazard 的單一商品群，交給 DB RPC 在同一 transaction 內完成：
 * 鎖定 → sentinel 騰位 → 孤兒刪除 → 完整 desired upsert → 終態 assert。
 * product_id 不由 Node 傳入；DB 端用 supplier_slug + external_id 重新解析並鎖定。
 */
export async function syncVariantGroupAtomic(
  tgt: SupabaseClient,
  supplierSlug: string,
  externalId: string,
  variants: VariantRow[],
  orphanSkus: string[],
): Promise<number> {
  const payload = variants.map(({ supplier_slug, ...variant }) => {
    if (supplier_slug !== supplierSlug) {
      throw new Error(
        `syncVariantGroupAtomic ${externalId}:variant supplier_slug=${supplier_slug} 與 scope ${supplierSlug} 不符`,
      );
    }
    return variant;
  });
  const { data, error } = await tgt.rpc('sync_product_variant_group', {
    p_supplier_slug: supplierSlug,
    p_external_id: externalId,
    p_variants: payload,
    p_orphan_skus: orphanSkus,
  });
  if (error) throw new Error(`syncVariantGroupAtomic ${externalId}: ${error.message}`);
  if (data !== variants.length) {
    throw new Error(
      `syncVariantGroupAtomic ${externalId}:RPC 回傳 ${String(data)}、預期 ${variants.length}，拒絕當成功`,
    );
  }
  return data;
}

export interface AtomicVariantGroup {
  externalId: string;
  variants: VariantRow[];
  orphanSkus: string[];
}

/**
 * hazard 群必須完整排除現有的「先刪 orphan、再 bulk upsert」兩條非交易路徑，
 * 改由單一 RPC 同生共死。一般群維持既有批次行為，避免把整家同步擴成大交易。
 */
export function splitVariantSyncWork(
  variantsByExternalId: Map<string, VariantRow[]>,
  orphans: { sku: string; externalId: string }[],
  hazardExternalIds: Set<string>,
): {
  regularVariants: VariantRow[];
  regularOrphanSkus: string[];
  atomicGroups: AtomicVariantGroup[];
} {
  for (const externalId of hazardExternalIds) {
    if (!variantsByExternalId.has(externalId)) {
      throw new Error(`splitVariantSyncWork:hazard 群 ${externalId} 不在本次完整 source`);
    }
  }
  for (const orphan of orphans) {
    if (!variantsByExternalId.has(orphan.externalId)) {
      throw new Error(`splitVariantSyncWork:orphan ${orphan.sku} 的群 ${orphan.externalId} 不在本次完整 source`);
    }
  }

  const orphanSkusByExternalId = new Map<string, string[]>();
  for (const orphan of orphans) {
    const list = orphanSkusByExternalId.get(orphan.externalId);
    if (list) list.push(orphan.sku);
    else orphanSkusByExternalId.set(orphan.externalId, [orphan.sku]);
  }

  const regularVariants: VariantRow[] = [];
  const atomicGroups: AtomicVariantGroup[] = [];
  for (const [externalId, variants] of variantsByExternalId) {
    if (hazardExternalIds.has(externalId)) {
      atomicGroups.push({
        externalId,
        variants,
        orphanSkus: orphanSkusByExternalId.get(externalId) ?? [],
      });
    } else {
      regularVariants.push(...variants);
    }
  }

  return {
    regularVariants,
    regularOrphanSkus: orphans
      .filter((orphan) => !hazardExternalIds.has(orphan.externalId))
      .map((orphan) => orphan.sku),
    atomicGroups,
  };
}
