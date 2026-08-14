import {
  toInsertRow,
  type AuditLogInserter,
  type AuditLogReader,
  type AuditLogRepository,
  type AuditLogSelector,
} from './repository';
import type { AdminAuditLogRow, AuditContext, AuditEntry } from './types';

/**
 * Supabase(service_role / sb_secret_ 金鑰)稽核 repository。
 *
 * 走注入的窄 AuditLogInserter → 不直接綁 @supabase/supabase-js。真 client 由資料存取 slice
 * 以 `@pcm/adapters/server` createSupabaseServiceClient() 適配後注入,例:
 *   const inserter: AuditLogInserter = {
 *     insert: (row) => client.from('admin_audit_log').insert(row),  // 🔴 禁鏈 .select()(理由見下)
 *   };
 *   new SupabaseAuditLogRepository(inserter);
 *
 * 🔴 REQUIRED-2:INSERT 必須 return=minimal(不鏈 .select()、不回讀 id / created_at)。
 *    本類只依賴 { error } 形狀 → 天然符合。
 * 🔴 **理由在 D0(`20260815020000`)之後換了、規定沒變** —— 逐字見 `lib/audit/repository.ts`
 *    的 REQUIRED-2 段(**這個 GRANT 有到期日 ⇒ 要讓依賴它的東西數得出來**)。
 *    ⚠️ 原字面寫「service_role 無 SELECT」—— **apply 之後那句是假的**(它會有 SELECT)。
 */
export class SupabaseAuditLogRepository implements AuditLogRepository {
  constructor(private readonly inserter: AuditLogInserter) {}

  async record(entry: AuditEntry, context: AuditContext): Promise<void> {
    const { error } = await this.inserter.insert(toInsertRow(entry, context));
    if (error) {
      // 🔴 只帶 message、不把 DB error 原文往上冒到瀏覽器(Fable Q2 殘餘:CHECK violation detail 可能回顯 row 值)。
      throw new Error(`admin_audit_log 寫入失敗:${error.message}`);
    }
  }
}

/**
 * Supabase 稽核 **讀取** repository(`#27` D1a-2)。
 *
 * 🔴 **這條路在 `20260815020000` apply 之前跑起來會 `42501 permission denied`** ——
 *   建表時 service_role **只有 INSERT**(`20260712210000:85` REVOKE ALL / `:89` 只補 INSERT)。
 *   ⚠️ **型別層完全看不到這件事**:`admin_audit_log` 早就在 `database.types.ts` 裡
 *   ⇒ **三綠會全過、build 會過、單測會過,而正式站點進去是錯誤頁。**
 *   ⇒ 兩道防線各管各的:**`AUDIT_UI_ENABLED` 旗標**擋「路徑到得了」、
 *      **呼叫端的錯誤態**(plan 驗收 8)擋「旗標開了但 apply 出問題」。**兩道都要,不是二選一。**
 *
 * 🔴 **錯誤一律往上丟、不吞成空陣列** —— 吞掉的話畫面會顯示「目前沒有任何紀錄」,
 *   而真相是「讀不到」。**那正是驗收 8 要防的空清單假象**(鏡像 `customer-detail.tsx` 的 `loadFailed` 慣例)。
 */
export class SupabaseAuditLogReader implements AuditLogReader {
  constructor(private readonly selector: AuditLogSelector) {}

  async listRecent(limit: number): Promise<AdminAuditLogRow[]> {
    // 🔴 上限自己驗 = **信任邊界的輸入驗證**,理由不依賴 PostgREST 會怎麼回:
    //    `limit` 由呼叫端(頁面層)給,而本類的契約是「最近 N 筆」——
    //    **`N` 不是正整數時,這個契約本身沒有意義**,不必等下游告訴我們。
    // ⚠️ **原註解寫「送進 PostgREST 的症狀是回了奇怪的筆數、不是報錯」——那句已刪**(E 窗 R1 F2):
    //    它以**事實語氣**寫死、是整條理由的承重點,**而我沒有量過**;
    //    而且它被用來一句話涵蓋 `0 / -1 / 1.5 / NaN` 四個值 —— 而**那四個是不是同一種症狀,我沒量過**
    //    (前一版這裡寫「不會是同一種症狀」,那又是一句我沒量過的事實語氣句 —— E 窗確認輪 nit,已改)。
    //    **守門本身站得住,不需要那句撐。**
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error(`admin_audit_log 讀取上限必須是正整數,收到 ${String(limit)}`);
    }
    const { data, error } = await this.selector.select(limit);
    if (error) {
      // 只帶 message,不把 DB error 原文往上冒到瀏覽器(同 record() 的理由)。
      throw new Error(`admin_audit_log 讀取失敗:${error.message}`);
    }
    return data ?? [];
  }
}
