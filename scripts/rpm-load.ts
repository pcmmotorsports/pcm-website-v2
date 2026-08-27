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
 * 依「own key 集合」把 rows 分成數個 uniform 組(#260 保留現值;2026-08-07 取代原 partitionByKeyPresence)。
 *
 * 背景:postgrest-js `.upsert(陣列)` 的 `?columns` 取**全批 key 聯集**(親驗 v2.105.3
 *   `@supabase/postgrest-js/src/PostgrestQueryBuilder.ts:1359-1362`)+ `defaultToNull=true` →
 *   同批混「有此 key」與「省此 key」兩種列時,省 key 列會被寫 **NULL**(非保留現值)。
 *   products.manuals 是 `jsonb NOT NULL DEFAULT '[]'`(20260709120000 migration)⇒ 那不是「寫錯值」,
 *   是 23502、整個 500 列批全敗。
 *
 * 解:同組內每列 key 集合完全相同 ⇒ 該批 `?columns` 恰等於這組的 key ⇒ 省 key 欄不進 ON CONFLICT DO UPDATE
 *   ⇒ 保留現值。
 *
 * 🔴 為何不是原本的「按單一 key 二分」:條件省 key 的欄已達三個(description per-row、manuals/video_url
 *   per-row 來源 null 防清空),二分只治一軸,另兩軸仍混批 → 手工巢狀要 2³=8 批且每新增一欄翻倍。
 *   按 signature 分組是同一件事的一般解,新增條件欄自動涵蓋、不需再改這裡。
 * 🔴 rpm(syncDescription=false + syncInstallResources=false)全批一致省同樣三 key → 只會有一組 →
 *   單批行為與改前 byte 等價。
 * Object.keys:只列 own enumerable key(對齊 getSupplierConfig fail-closed 慣例、不吃原型鏈成員);
 *   排序後 join 讓 key 順序不同但集合相同的列落同一組(`{a,b}` 與 `{b,a}` 的 `?columns` 聯集本就相同)。
 * 分隔符用 \u0000(NUL):欄名不可能含它,避免 `a,b` 與 `a` + `,b` 這類 signature 撞號。
 * 回傳保持**首見順序**、組內保持原順序(upsert 批次順序可預期、方便對帳)。
 */
export function groupByKeySignature<T extends object>(rows: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const sig = Object.keys(r).sort().join('\u0000');
    const g = groups.get(sig);
    if (g) g.push(r);
    else groups.set(sig, [r]);
  }
  return [...groups.values()];
}

/**
 * 跨 apply 停點護欄:目標表還沒有某個新欄時,把該 key 從所有列剝掉、其餘欄照常同步。回傳剝掉的列數。
 *
 * 🔴 為什麼要做成機制而不是寫註解(Fable 對抗審 F2、2026-08-08):
 *   `.github/workflows/rpm-sync.yml:48` 每日 cron 在 default branch(dev)帶 `--confirm-write` 跑
 *   rpm-import,matrix 含 akrapovic(:72)。只要「應用層先 merge、migration 還沒 apply」,
 *   帶新 key 的列就會撞 PGRST204/42703 ⇒ 該 signature 組整組拒寫、job 中斷 ⇒ 該供應商當日停在
 *   「部分群新值、部分群舊值」的混天狀態,而且每天紅到有人 apply 為止。
 *   這正是 memory `feedback_app-layer-must-not-ship-before-migration-apply` 記的 A9h 事故形狀
 *   (08-07 正式站壞約 8 小時、當夜唯一逃逸出審查鏈的一條);**註解與交接檔擋不住 cron,只有 code 擋得住**。
 *   apply 之後探測自然通過、資料自動開始流 —— 不需要有人記得回來翻旗標(旗標會被忘記,探測不會)。
 *
 * 🔴 fail-closed:只有在錯誤確實指向「這個欄不存在」時才剝 key;其他錯誤(連線/權限/逾時)一律 throw,
 *   否則一次網路抖動就會被當成「欄不存在」而靜默丟掉真資料。
 */
export async function stripColumnIfMissing<T extends object>(
  tgt: SupabaseClient,
  table: string,
  rows: T[],
  column: string,
): Promise<number> {
  if (!rows.some((r) => Object.hasOwn(r, column))) return 0; // 沒人要寫這欄 → 不必探測
  const { error } = await tgt.from(table).select(column).limit(1);
  if (!error) return 0;
  // 已知形狀走錯誤碼(PG 42703 / PostgREST PGRST204);訊息比對是備援,**必須同時**命中欄名與
  // 「找不到這個東西」的措辭 —— 只比對欄名太寬,未來某個逾時/權限訊息碰巧含欄名就會被靜默剝掉。
  const missing =
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    (error.message.includes(column) && /does not exist|could not find|unknown column/i.test(error.message));
  if (!missing) {
    throw new Error(`${table}.${column} 欄探測失敗(非「欄不存在」)、拒絕繼續:${error.code ?? ''} ${error.message}`);
  }
  let stripped = 0;
  for (const r of rows) {
    if (Object.hasOwn(r, column)) {
      delete (r as Record<string, unknown>)[column];
      stripped++;
    }
  }
  console.warn(
    `⚠️ ${table}.${column} 欄不存在(migration 尚未 apply)⇒ 本次同步略過該欄 ${stripped} 列、其餘欄照常寫入。` +
      `apply 後本探測自動通過、資料開始流;在那之前前台看不到該欄內容=預期內。`,
  );
  return stripped;
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
