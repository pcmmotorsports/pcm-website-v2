import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { EMAIL_LOG_COLUMNS, type EmailLogRow } from './email-log-view';

// 🔵 `EMAIL_LOG_COLUMNS` 住在 `email-log-view.ts` 而不是這裡:合約層放語意層, 單一來源,
//    而測試釘得住它(`email-log-view.test.ts:38`)。
//
// 🔴🔴 **2026-09-02 R2 must-fix:上面這個位置是對的, 而我原本寫的【理由是假的】—— 舊字面留著。**
//    ⛔ ~~「本檔第一行是 `import 'server-only'` ⇒ 從測試 import 本檔會直接爆 ⇒ 那道閘裝不上去」~~
//    ⇒ 那一發爆是真的, **而它有解**:`vi.mock('server-only', () => ({}))`。
//    ⇒ 🔴 **本 repo 早就有一大票測試檔在用它** —— 量法(不寫值, 值會漂):
//         `grep -rl "vi.mock('server-only'" apps/admin/src --include="*.test.ts*" | wc -l`
//         最近的同目錄先例 `payment-repository.test.ts:3`。
//       ⛔ ~~原句寫死「123 支」~~ —— R3 nit:**它現在是 124, 而多的那一支就是本片自己的測試檔**
//         ⇒ 📌 **寫下那個數字的同一個 diff, 讓那個數字變成假的。**
//    🛑 **⇒ 而那句假理由的傷害不在它錯, 在它會【叫下一個人不要替這支檔寫測試】** ——
//       一句「這裡測不了」寫在檔頭, 沒有人會回來驗它。
//    📌 **⇒ 我撞到一個錯誤, 就把它寫成一條限制 —— 而我沒有先問「這個錯誤有沒有標準解法」。**

// email-log-repository.ts — 片A:訂單詳情頁「這張單寄過哪幾封信」的**唯讀取數層**。
// 語意全在 `email-log-view.ts`,本檔只負責把列撈出來(同 supplier-repository 的分層)。
//
// 🔴 **為什麼直查表而不是走 RPC**(2026-09-02 唯讀實查):
//    `admin_` 開頭且提到 `email_outbox` 的函式**只有 `admin_requeue_dead_email`(那是寫)**
//    ⇒ 沒有讀的 RPC。而開一支 RPC = 動 schema = 另一片。
//    ⇒ 而後台本來就有直查表的先例(`supplier-repository.ts` / `staff-repository.ts`)。
//    🔵 **而同一張表的先例是 `lib/mail/dead-letter-read.ts`(2026-09-01)** —— 讀它, 不要只讀上面那兩支:
//       它已經解過【PostgREST 比不了兩個欄位 ⇒ `attempts >= max_attempts` 送不進 SQL】那一格
//       (那支 `:68-76`), 而本檔的 `isDead` 判準就是抄它的。
//
// 🔴 **權限那一格是量的, 不是假設的**(2026-09-02 唯讀正式庫 `has_table_privilege`):
//      service_role SELECT email_outbox ⇒ **true**
//      anon ⇒ **false** · authenticated ⇒ **false**
//    ⚠️ 而【本機拋棄式 PG 對 Supabase 預設授權零判別力】(CLAUDE.md 已記)
//       ⇒ 這一格只有問正式庫才算數。
//
// 🔴🔴 **刻意不取的三欄:`recipient_email` / `subject` / `payload`。**
//    這不是漏掉 —— 是規格 §2「不要顯示的」那一節:員工本來就看得到客人資料,
//    而把整封信 dump 到訂單頁是另一件事(範圍外)。
//    ⇒ **下一個人要加欄位之前, 先回去讀那一節, 不要因為「反正撈得到」就加。**
//
// 🛑 **授權誠實話**(同 `payment-repository.ts` 檔頭那段, 照抄它的射程):
//    讀路徑上沒有管理員檢查可以靠 —— 唯一的閘是 `apps/admin/src/proxy.ts` 的
//    全域登入閘, 無角色檢查 ⇒ **任何登入後台的人都讀得到任何一單的寄信紀錄**。
//    這是現況、不是本片造成的, 但本片第一次把它變成畫面上的資料。


/**
 * 撈回來的上限 + 1。
 *
 * 🔴 **為什麼要有它**(R1 nit #9):PostgREST 有 `db-max-rows`, 超過會**靜默截斷**
 *    —— 而截斷的方向是【少一列】, 那正是本片要修的病。
 * 🔵 而這裡**刻意不做**鄰居那套 `truncated` 旗標 + UI 提示:
 *    一張單的通知信現實上是個位數(成立 1 封 + 每次出貨 1 封)⇒ 200 這個數字永遠碰不到;
 *    真的碰到 ⇒ 那不是「單子太大」, 是**有東西壞了** ⇒ 讓它 throw、走 `unreadable` 態
 *    (那一態的文案逐字是「不知道有沒有」)⇒ **fail-closed 比少印一列誠實。**
 */
const EMAIL_LOG_HARD_CAP = 200;

export class EmailLogShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailLogShapeError';
  }
}

// 🔴 `parseRow` 刻意留著, 理由與 payment-repository 逐字同款:
//    生成型別說的是「schema 長這樣」, 不是「這次回來的真的長這樣」。
function str(v: unknown, field: string): string {
  if (typeof v !== 'string') throw new EmailLogShapeError(`email_outbox:${field} 不是字串`);
  return v;
}

function nullableStr(v: unknown, field: string): string | null {
  // 🔴 `null`(欄位在、真的沒值)與 `undefined`(**鍵根本不存在**)是兩件事 ——
  //    後者代表 select 沒撈到那一欄, 而那是 bug 不是資料。
  if (v === null) return null;
  if (v === undefined) throw new EmailLogShapeError(`email_outbox:${field} 鍵不存在(select 漏了?)`);
  return str(v, field);
}

function num(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new EmailLogShapeError(`email_outbox:${field} 不是數字`);
  }
  return v;
}

/**
 * 撈一張單寄過的信。**時間由舊到新**(照事件發生順序讀比較自然)。
 *
 * 🔵 排序在 SQL 做而不是 JS:這一欄是 `created_at`(timestamptz), 排序結果與 collation 無關
 *    ⇒ 不會有 supplier-repository 那個「本機 C locale ≠ 正式站」的問題。
 */
export async function listOrderEmailLog(orderId: string): Promise<EmailLogRow[]> {
  const { data, error } = await createSupabaseServiceClient()
    .from('email_outbox')
    .select(EMAIL_LOG_COLUMNS)
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })
    .limit(EMAIL_LOG_HARD_CAP + 1);

  if (error) throw error;

  const rows = data ?? [];
  if (rows.length > EMAIL_LOG_HARD_CAP) {
    // 🔴 不要在這裡 `.slice()` 然後照樣畫 —— 那就是【少印一列而畫面看起來正常】。
    throw new EmailLogShapeError(
      `email_outbox:單張訂單回了超過 ${EMAIL_LOG_HARD_CAP} 列(order_id=${orderId})—— 這不是正常單, 拒絕顯示`,
    );
  }

  return rows.map((raw): EmailLogRow => {
    const r = raw as Record<string, unknown>;
    return {
      eventType: str(r.event_type, 'event_type'),
      status: str(r.status, 'status'),
      attempts: num(r.attempts, 'attempts'),
      maxAttempts: num(r.max_attempts, 'max_attempts'),
      createdAt: str(r.created_at, 'created_at'),
      sentAt: nullableStr(r.sent_at, 'sent_at'),
    };
  });
}
