import type { AdminAuditLogInsert, AdminAuditLogRow, AuditContext, AuditEntry } from './types';

/** 稽核 log 寫入埠(append-only;呼叫端只 record、不讀不改)。 */
export interface AuditLogRepository {
  record(entry: AuditEntry, context: AuditContext): Promise<void>;
}

/**
 * 窄結構埠:只描述「把一列 append 進 admin_audit_log」所需的能力。
 * 讓 SupabaseAuditLogRepository 不直接綁 @supabase/supabase-js
 * (真 client 於資料存取 slice 以 `@pcm/adapters/server` createSupabaseServiceClient() 適配後注入)。
 *
 * 🔴 REQUIRED-2:insert 回傳**只含 error、無 data**(return=minimal);
 *    實作端 supabase-js `.insert(row)` **禁鏈 `.select()`**。
 *
 * 🔴 **這條規定留著,但理由已經換掉(D0 `20260815020000` 之後)**:
 * 原理由是「service_role 沒有 SELECT 權,鏈了會 42501」—— **apply 之後那個理由不再成立**。
 * ⚠️ 也**不是**「不回讀 = append-only 的手癖防線」:append-only 是「**不能改、不能刪**」,**讀不在裡面**,
 *    用站不住的理由撐一條規定,下一個人一戳就破。
 * ✅ **真正的理由 = 這個 GRANT 有到期日**(見 `20260815020000` 檔頭「外部前提 1」):
 *    規定留著 ⇒ 這個 SELECT 權限**只有一個消費者**(`#27` 檢視頁),要收回時關掉一頁就好;
 *    規定拿掉 ⇒ **每一條 audit insert 路徑**都可能開始回讀,要收回等於全面回歸。
 *    (路徑數 = **18 個 migration 檔含稽核 INSERT**(量法 `grep -rl "INSERT INTO public.admin_audit_log" supabase/migrations/ | wc -l` ⇒ 18) + **app 層 1 個真正的呼叫點**(`staff-actions.ts:61`;量法 `grep -rn 'getAdminAuditLogRepository()' apps/admin/src` ⇒ 4 命中,逐一開檔後只有 `:61` 是真呼叫,其餘 2 處是註解、1 處是 getter 定義本身)。
 *     ⚠️ **原字面寫「18 支 RPC」——那是檔數冒充支數,已更正**;
 *     🔴 **「有幾支函式真的寫稽核」= **23 支函式的函式體含稽核 INSERT**(2026-08-15 量,**三種量法互證**:E 窗①以 `CREATE FUNCTION` 切段計數 ②收集 `(檔, 函式名)` 配對去重;C 窗③獨立以 regex 切段 + 逐段判斷。三者皆得 **23**;前提檢查「稽核 INSERT 出現在函式外」⇒ **零命中**。⚠️ **共同限度**:三種都靠「`CREATE FUNCTION` 之間即函式邊界」,**巢狀定義會誤判**——未遇到、也未特別構造)
 *        🔴 **而「三法互證」互證到的是「實作沒寫錯」,不是「那個假設成立」** —— 三種都用**同一個切段假設**(`CREATE FUNCTION` 之間即函式邊界),**同源的方法不會互相抵消共同限度**。⇒ 若那個假設不成立,**三個會一起錯**。。**
 *        ⚠️ **前一版寫「沒有可信值,不要填」——那句是假的,已更正**:
 *        「**我沒量**」是關於我自己的宣稱(真);「**沒有可信值**」是關於世界的宣稱(**假**)。
 *        🔴 同一個分界我在 D1a-2 分清楚過(**我沒量到 ≠ 沒有差別**),**在同一支檔上又滑掉一次**。
 *        (順帶:先前 31 vs 28 的分歧已解 —— **我那條不錨行首,把 3 行 SQL 註解算進去了**;28 才對。))
 *    **開一道有到期日的權限時,要讓依賴它的東西數得出來。**
 */
export interface AuditLogInserter {
  insert(row: AdminAuditLogInsert): Promise<{ error: { message: string } | null }>;
}

/** entry + context → INSERT 列(各實作共用;id / created_at 交 DB default)。 */
export function toInsertRow(entry: AuditEntry, context: AuditContext): AdminAuditLogInsert {
  return {
    actor: context.actor,
    action: entry.action,
    target: entry.target ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ?? null,
    request_id: context.requestId,
    source_app: context.sourceApp,
  };
}

/**
 * 稽核 log **讀取**埠(`#27` D1a-2)。
 *
 * 🔴 **為什麼另開一個埠、不加在 `AuditLogRepository` 上**:
 *   寫入端的消費者遍布 **18 個含稽核 INSERT 的 migration 檔** 與 **app 層那 1 個呼叫點**
 *   (`staff-actions.ts:61`;量法見本檔上方 REQUIRED-2 段。⚠️ **原字面「18 支 RPC」是檔數冒充支數,已更正**),
 *   它們**只該 record、不該讀**
 *   (`AuditLogRepository` 的檔頭逐字:「呼叫端只 record、不讀不改」)。
 *   把 `list` 併進去等於讓每個寫入端在型別上都拿到讀取能力 —— 而**這個 SELECT 權限有到期日**
 *   (`20260815020000` 檔頭「外部前提 1」),**消費者要數得出來**。
 *
 * ⚠️ **考慮過但沒採用的更簡形狀**:`lib/staff-repository.ts` 直接 `import 'server-only'` + 服務端 client、
 *   不走埠。那支能那樣做是因為它**沒有**「同一個模組裡寫入端要保持不綁 supabase-js」的限制;
 *   本模組有(`supabase-repository.ts` 檔頭寫明注入理由)⇒ **同模組內兩套形狀比多一個介面更貴。**
 */
export interface AuditLogReader {
  /** 最近 N 筆,`created_at` DESC。上限由呼叫端給,adapter 不自訂預設。 */
  listRecent(limit: number): Promise<AdminAuditLogRow[]>;
}

/**
 * 窄結構埠:只描述「從 admin_audit_log 讀最近 N 筆」所需的能力(對稱 `AuditLogInserter`)。
 * 🔴 **`limit` 沒有預設值是刻意的** —— 預設值會讓「這頁一次抓幾筆」這個決定藏在最底層,
 *   而那是頁面層的決定(plan 驗收 1 的 N)。
 */
export interface AuditLogSelector {
  select(limit: number): Promise<{ data: AdminAuditLogRow[] | null; error: { message: string } | null }>;
}
