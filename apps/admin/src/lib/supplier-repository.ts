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

// ── 寫入面(S3b-1)────────────────────────────────────────────
// 🔴 唯一寫入路 = `admin_upsert_supplier` owner RPC(`20260801160000`)。
//    `suppliers` 對 service_role **只開 SELECT** ⇒ 這裡不可能寫成 `.from('suppliers').insert()`。
//
// 🔴🔴 為什麼拆成兩支而不是照 RPC 開一支 upsert(plan §3.3、K1-M2):
//    RPC 靠「參數是不是 NULL」分流三種動作 —— 一個改名請求若把 id 弄丟,會**靜默降級成新增**,
//    多一筆**永久刪不掉**的垃圾列(供應商不可刪除)且零錯誤(S2 R3 實測)。
//    根治法是型別層分流(memory `feedback_null-dispatch-rpc-silently-downgrades`):
//      · `createSupplier` 的參數型別裡**沒有 id** ⇒ 物理上餵不進去。
//      · `updateSupplier` 的 `id` 是**必填 string** ⇒ 傳 null / 漏傳 = **編譯錯**,不是 runtime 垃圾列。
//    RPC 本身拆不了(要動 migration),但**呼叫面拆得了**。
//
// 🔴 四層各自的能力界線(不得再說成一句「有預防」;K2 逼出第三層):
//    · 解析器的 uuid 形狀閘 → 擋缺欄位/空字串/非 uuid;**擋不住合法但指向別家的 uuid**
//    · 本層的型別分流       → 擋弄丟 id、擋把 create 當 update 用、擋 spread 帶進 id(`id?: never`);
//                             **擋不住 `as any`**(型別在 runtime 不存在)
//    · 本層的 runtime 閘    → 擋 `as any` 繞過來的 id 與空 patch;擋不住刻意傳錯的合法 id
//    · 回傳碼收斂           → 擋 RPC 漂移;🔴 **收到 CREATED 時垃圾列已經寫進去了 = 偵測不是預防**

/** 新增路徑的業務結果;其餘回傳碼一律視為異常。 */
export type SupplierCreateResult = 'CREATED' | 'DUPLICATE_LABEL';

/** 改名 / 切換啟用路徑的業務結果;`CREATED` 不在此列(見 `SupplierCallerBugError`)。 */
export type SupplierUpdateResult =
  | 'UPDATED'
  | 'NO_CHANGE'
  | 'NOT_FOUND'
  | 'DUPLICATE_LABEL';

/**
 * 呼叫端 bug:改名 / 切換啟用竟然拿到 `CREATED`。
 * 🔴 **這代表 `p_supplier_id` 送成了 NULL,而 RPC 已經新增了一筆刪不掉的供應商。**
 *    action 層必須把它跟一般 DB error 分開處理(顯示「可能多出一筆供應商,請通知維護者」),
 *    **不得當成成功**(plan §6 契約債①、`20260801160000:42`)。
 */
export class SupplierCallerBugError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupplierCallerBugError';
  }
}

interface SupplierRpcAudit {
  readonly note?: string | null;
  readonly actor: string;
  readonly requestId: string;
}

/** RPC 的六個參數只在這裡組一次,兩支包裝共用 ⇒ 參數名打錯不會只錯一邊。 */
function upsertArgs(args: {
  id: string | null;
  label: string | null;
  isActive: boolean | null;
  audit: SupplierRpcAudit;
}) {
  return {
    p_supplier_id: args.id,
    p_label: args.label,
    p_is_active: args.isActive,
    p_note: args.audit.note ?? null,
    p_actor: args.audit.actor,
    p_request_id: args.audit.requestId,
  } as const;
}

/**
 * 新增供應商。稽核由 RPC 同交易寫,本層不碰 `admin_audit_log`。
 * 🔴 `p_is_active` 送 NULL ⇒ RPC 走 `coalesce(p_is_active, true)`(`:214`)= 新供應商預設啟用。
 * 撞名(含與並行 session 撞名)回 `DUPLICATE_LABEL`,那是**業務結果不是例外**。
 */
export async function createSupplier(
  args: { label: string; id?: never } & SupplierRpcAudit,
): Promise<SupplierCreateResult> {
  // 🔴 `id?: never` 是 K2 抓到的洞的修法:**只寫「型別裡沒有 id」擋不住 spread** ——
  //    TS 的多餘屬性檢查只作用在**物件字面**上,`createSupplier({ ...renameParsed, ...audit })`
  //    (呼叫端最自然的寫法)零診斷通過,然後靜默送出 p_supplier_id:null = 誤建一筆永久列。
  //    親驗 tsc 5.9.3:沒有 `id?: never` ⇒ spread 那行**全綠**;加上之後 ⇒ TS2345 紅,正常路徑仍綠。
  // 🔴 型別擋不住 `as any` / `as never` ⇒ 再加一道 runtime 閘(K2 抓:型別在 runtime 不存在)。
  if ((args as { id?: unknown }).id !== undefined) {
    throw new SupplierCallerBugError(
      'createSupplier 收到 id —— 新增路徑不接受 id;' +
        '這通常是把改名的解析結果 spread 進新增呼叫,會誤建一筆永久供應商',
    );
  }

  const { data, error } = await createSupabaseServiceClient().rpc(
    'admin_upsert_supplier',
    upsertArgs({ id: null, label: args.label, isActive: null, audit: args }),
  );

  if (error) throw error;
  if (data === 'CREATED' || data === 'DUPLICATE_LABEL') return data;

  // UPDATED / NO_CHANGE / NOT_FOUND / null / 未知字串 —— 新增路徑不可能拿到,一律當腐壞。
  throw new Error(
    `admin_upsert_supplier 新增路徑回傳非預期碼:${JSON.stringify(data)}`,
  );
}

/**
 * 至少要動一個欄位。**兩者皆省略在編譯期就不合法**(R1 抓:原本兩個都 optional
 * ⇒ `updateSupplier({ id, ...audit })` 通得過 tsc,會打到 RPC 的
 * 「沒有要變更的欄位」RAISE〔`20260801160000:245-247`〕,使用者拿到通用 `error`)。
 * 🔴 這是把本檔自己那套「NULL 分流的根治法是型別層分流」的教條**套到自己身上** —— 原本沒套。
 */
type SupplierPatch =
  | { label: string; isActive?: boolean }
  | { label?: string; isActive: boolean };

/**
 * 改名與 / 或切換啟用狀態。省略的欄位 = 該欄不動(RPC 的 NULL 語意)。
 * 🔴 `id` 必填 —— 這是契約債①的型別層防線,不要為了「方便」把它改成 optional。
 */
export async function updateSupplier(
  args: { id: string } & SupplierPatch & SupplierRpcAudit,
): Promise<SupplierUpdateResult> {
  // 🔴 型別聯集擋的是「正常型別的空 patch」;`as any` / `as SupplierPatch` 繞得過去(K2 抓)
  //    ⇒ runtime 再擋一次,把 RPC 的通用 RAISE 換成講得出原因的呼叫端 bug。
  if (args.label === undefined && args.isActive === undefined) {
    throw new SupplierCallerBugError(
      'updateSupplier 收到空 patch(label 與 isActive 都沒給)—— 沒有任何欄位要變更',
    );
  }

  const { data, error } = await createSupabaseServiceClient().rpc(
    'admin_upsert_supplier',
    upsertArgs({
      id: args.id,
      label: args.label ?? null,
      isActive: args.isActive ?? null,
      audit: args,
    }),
  );

  if (error) throw error;

  if (data === 'CREATED') {
    throw new SupplierCallerBugError(
      'admin_upsert_supplier 在改名/停用路徑回傳 CREATED ' +
        '= p_supplier_id 送成了 NULL,已新增一筆多餘的供應商(不可刪除)',
    );
  }

  if (
    data === 'UPDATED' ||
    data === 'NO_CHANGE' ||
    data === 'NOT_FOUND' ||
    data === 'DUPLICATE_LABEL'
  ) {
    return data;
  }

  throw new Error(
    `admin_upsert_supplier 更新路徑回傳非預期碼:${JSON.stringify(data)}`,
  );
}
