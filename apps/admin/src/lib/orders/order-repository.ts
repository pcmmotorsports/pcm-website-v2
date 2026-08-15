import 'server-only';
import { SupabaseOrderAdapter } from '@pcm/adapters';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { SupabaseAuditLogReader, SupabaseAuditLogRepository } from '../audit/supabase-repository';
import type { AuditLogInserter, AuditLogReader, AuditLogSelector } from '../audit/repository';
import type { AdminAuditLogRow } from '../audit/types';

/**
 * 後台訂單 repo 建構(M-4a 訂單線第一片;server-only、絕不入 client bundle)。
 *
 * admin 走 **service_role**(`createSupabaseServiceClient`、sb_secret_ 從 env)讀 orders —— orders 表對
 * service_role 已於 migration 20260611120000「admin 唯讀」保留 SELECT、且表本身無經銷成本欄(§經銷隔離天生守);
 * BYPASSRLS 繞 own-policy 屬預期(admin 看全客人單)。
 *
 * 🔴 server-only:本檔頂層 `import 'server-only'` + createSupabaseServiceClient 亦 server-only,client component
 * import 即編譯期報錯;service_role 金鑰只在 server runtime 讀、不進 client bundle / git。
 * 🔴 只暴露唯讀摘要:回傳 SupabaseOrderAdapter 實例,呼叫端(server component)用 `listOrderSummariesForAdmin`
 * (訂單列表)、`findAdminOrderDetail`(明細)、`listSummariesByCustomer`(客戶明細-b 訂單歷史;
 * ⚠️ 沿用 #249 隱含濾 unpaid、揭示見 backlog #278)——皆具名白名單投影、零成本欄。
 * 建單 / 付款相關方法不在後台路徑使用。
 *
 * (未在 vitest 覆蓋:本檔 import server-only〔node/測試環境會 throw〕;純 wiring、行為由 adapter 單測 + 頁面實測驗。)
 */
export function getAdminOrderRepository(): SupabaseOrderAdapter {
  return new SupabaseOrderAdapter(createSupabaseServiceClient());
}

// M-4b E10 A9w4c(後半收尾):`getAdminOrderStatusOptionsRepository` 已移除 —— A11a-1 列表重建後
// 零呼叫端,連同 port / adapter / 其測試整條讀取鏈同片退場(A11a plan §3.1 裁定)。
// 🔴 DB 端 order_status_options 的 service_role **寫**權由 A9v `20260807120000` 撤除
//    (INSERT + 五個欄級 UPDATE;**SELECT 刻意保留**),apply 後生效。

/**
 * 稽核 log repo(M-4a M0-S2 → D-3b 首個真呼叫端;admin 寫入動作寫 admin_audit_log)。
 *
 * 🔴 REQUIRED-2:insert **禁鏈 `.select()`**(return=minimal、不回讀 id/created_at)。
 *   本 inserter 只取 { error } 形狀、天然符合。
 *  🔴 **理由在 D0(`20260815020000`)之後換了、規定沒變** —— 逐字見 `lib/audit/repository.ts`
 *      的 REQUIRED-2 段(**這個 GRANT 有到期日 ⇒ 要讓依賴它的東西數得出來**)。
 *      ⚠️ 原字面寫「service_role 無 SELECT」—— **apply 之後那句是假的**(它會有 SELECT)。
 * 🔴 server-only:createSupabaseServiceClient 亦 server-only,client component import 即編譯期報錯。
 */
export function getAdminAuditLogRepository(): SupabaseAuditLogRepository {
  const client = createSupabaseServiceClient();
  const inserter: AuditLogInserter = {
    insert: async (row) => {
      // AdminAuditLogInsert.before/after=unknown ↔ 生成 Database Json:runtime 皆 Json 相容(null 或可序列化快照);
      // before/after 是唯一型別落差,於 supabase-js 邊界從 client 推導 insert 參數型別 cast
      // (admin app 無 Database 在手、不為此擴 @pcm/adapters barrel public API)。
      const q = client.from('admin_audit_log');
      const { error } = await q.insert(row as Parameters<typeof q.insert>[0]);
      return { error: error ? { message: error.message } : null };
    },
  };
  return new SupabaseAuditLogRepository(inserter);
}

/**
 * 稽核 log **讀取** repo(`#27` D1a-2;`/settings/audit` 唯一的資料來源)。
 *
 * 🔴 **投影是具名白名單,不用 `select('*')`** —— `*` 會在有人加欄時**自動把新欄帶進畫面**,
 *   而這張表的 `before`/`after` 建表 `:26-28` 逐字「可合法含經銷價 / 成本 / PII」。
 * 🔴 **`before`/`after` 仍在投影裡**(展開檢視要用),但**列表層不得顯示**(plan 驗收 6/9)。
 * 🔴 **`created_at` DESC + `id` 次鍵**:只給 created_at 的話,同一毫秒的多筆在分頁時順序未定義
 *   ⇒ 跨頁重複/漏列(形狀同 `SupabaseOrderAdapter` 那條「次鍵防同秒單分頁跨頁重複/漏單」)。
 * 🔴 server-only:同本檔其他 getter,client component import 即編譯期報錯。
 */
// 🔴 **回傳型別是介面 `AuditLogReader`,不是具象類別**(E 窗 R1 F4)。
// 回具象類別時,那個介面**全 repo 只出現在 `implements` 子句、零消費者** ⇒ 它是裝飾不是約束。
//
// 🔴 **差別今天就量得到**(E 窗 2026-08-15 確認輪推翻我的前一版註解):
//   ```ts
//   const probe: SupabaseAuditLogReader = getAdminAuditLogReader();
//   現行(回介面)  ⇒ 🔴 TS2741: Property 'selector' is missing in type 'AuditLogReader'
//   改回具象類別   ⇒ 綠
//   ```
//   機制:`supabase-repository.ts` 的 `constructor(private readonly selector: …)` —— **`private` 讓類別名義化**,
//   介面對它**不可指派**。⇒ 回介面**今天就擋掉了**「把它當具象類別用」這條路。
//   🔴 **而且那不是發明的用法**:本檔姊妹 getter(`getAdminOrderRepository` / `getAdminAuditLogRepository`)
//   **本來就回具象類別** ⇒ **回具象是這個檔的既有慣例**,下一個人照慣例改回去是完全可能的。
//   ⇒ **負測釘在 `lib/audit/reader-type.test.ts`**(`@ts-expect-error`),改回具象類別那格會紅。
//
// ⚠️ **我前一版在這裡寫「今天沒有可觀察的差別,我量過 / 我構造不出探針 / 零成本的預防不是已生效的守門」——
//    三句都是錯的,已刪。** 錯因不是「差別不存在」,是**我的探針設計錯**(我去存取一個介面沒有的成員,
//    而那個成員在具象類別上也不存在 ⇒ 兩邊都失敗、自然分不出來)。
//    🔴 **我在信裡守住了「我沒量到 ≠ 沒有差別」這個分界,卻在這裡寫成「沒有差別」** ——
//    **在對的地方說對了,在會被下一個人讀到的地方寫錯了。訊息不是載體。**
export function getAdminAuditLogReader(): AuditLogReader {
  const client = createSupabaseServiceClient();
  const selector: AuditLogSelector = {
    select: async (limit) => {
      const { data, error } = await client
        .from('admin_audit_log')
        .select('id, actor, action, target, before, after, reason, request_id, source_app, created_at')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        // ⚠️ **已知缺口(不是已守)**:`id` 次鍵**零測試覆蓋**(E 窗 R1 F3)。
        //   F1 修完之後,型別能守住**投影**那半邊(少一欄就 TS2322),
        //   但**排序次鍵那半邊要整合測試才驗得到** —— 那是真的多一階,不是十幾行。
        //   ⇒ 已立案 **`#508`**(主視窗 2026-08-15 發號)。🔴 只寫「另立案」會蒸發,所以號寫在這裡。
        .limit(limit);
      return {
        // 🔴 **這裡刻意沒有 `as AdminAuditLogRow[]`**(E 窗 R1 F1,實測三發):
        //   ① 投影拿掉 `actor` 而 cast 留著 ⇒ **typecheck 綠 + 測試 15 passed,完全無訊號**
        //   ② 只刪 cast ⇒ typecheck 仍綠 ⇒ **那個 cast 根本不需要**
        //   ③ 刪 cast + 拿掉 `actor` ⇒ **紅 `TS2322: Property 'actor' is missing`**
        //   ⇒ 上面那條具名投影白名單的**唯一自動偵測就是型別**,而 cast 會把它整個拆掉。
        //   ⚠️ **不是行為缺陷,是守門被自己拆掉,而拆它的東西是多餘的。**
        data: data ?? null,
        error: error ? { message: error.message } : null,
      };
    },
  };
  return new SupabaseAuditLogReader(selector);
}
