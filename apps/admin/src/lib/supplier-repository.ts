import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

// M-4b E10 S3a:供應商主檔讀模型。對齊 staff-repository 的分層 ——
// 本層只負責「把列撈出來」,啟用篩選與排序一律在 supplier.ts 做。
// 🔴 分層不是風格潔癖,是驗收 14/15 的前提:
//   ① 篩選若寫成 SQL 的 .eq('is_active', true),查詢層測試是 mock 的
//      ⇒ 只能斷言「有呼叫 eq」= 文字層斷言,證不到「停用的真的不會出現」。
//      放在 JS 才能餵混合列進去、看它有沒有被篩掉 = 真的行為測試。
//   ② S3b 的契約債(plan §6)要「顯示已停用的同名候選 + 一鍵重新啟用」
//      ⇒ 停用的列本來就得撈回來,SQL 先篩掉會讓 S3b 得再查一次。

export interface SupplierRow {
  readonly id: string;
  readonly label: string;
  readonly is_active: boolean;
}

const SUPPLIER_COLUMNS = 'id, label, is_active' as const;

/**
 * 讀取 suppliers 原始列(含已停用)。啟用篩選與排序由 supplier.ts 統一處理。
 * 🔴 刻意不下 ORDER BY:排序在 JS 用釘死的 zh-TW 規則做(Sean 2026-08-01 拍板 B)——
 *    DB 排序結果取決於連線 collation,本機 C locale ≠ 正式站 en_US.UTF-8。
 */
export async function listSupplierRows(): Promise<SupplierRow[]> {
  const { data, error } = await createSupabaseServiceClient()
    .from('suppliers')
    .select(SUPPLIER_COLUMNS);

  if (error) throw error;
  return data ?? [];
}
