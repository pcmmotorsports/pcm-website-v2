'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getRequestId } from './audit/context';
import { authorizeAdminMutation } from './session/authorize';
import {
  SupplierCallerBugError,
  createSupplier,
  updateSupplier,
  type SupplierCreateResult,
  type SupplierUpdateResult,
} from './supplier-repository';
import {
  boundSupplierQuery,
  parseSupplierActiveForm,
  parseSupplierCreateForm,
  parseSupplierRenameForm,
} from './supplier-form';
import type { SupplierResultCode } from './supplier-result-messages';

// M-4b E10 S3b-2 供應商設定頁 server action。形狀對齊 `staff-actions.ts`(已上線樣板):
//   ①authorizeAdminMutation 授權閘 → ②純解析器 → ③repository → ④PRG redirect。
//
// 🔴 **本片沒有一行稽核 code** —— `admin_upsert_supplier` 在**同一個交易**裡寫 `admin_audit_log`
//    (`20260801160000:227` / `:284`)。因此本檔**不存在** staff 那種 `audit_failed` 狀態,
//    也不存在「主資料寫成功但稽核寫失敗」的窗口。不要照著 staff 補一個 audit 呼叫回來。
//
// 🔴 **actor 不是經過驗證的身分**(`session/actor.ts:6-7`):它是使用者自選的 cookie。
//    稽核列會有一個非空的 actor 字串,但那是**自陳**的。真身分驗證屬 E8-B。

/**
 * 🔴 redirect 目標是**寫死的站內常數**:沒有 `return_to` / `next` 之類的參數面
 *    ⇒ 本檔不存在 open-redirect 面(plan §3.7 第①條,釘成測試而不是靠「照抄 staff 應該沒問題」)。
 */
const SETTINGS_PATH = '/settings/suppliers';

/**
 * `?r=` 一律是查表用的碼、`?q=` 一律是**過濾字串**。
 * 🔴 兩者都**不得**被頁面直接渲染成文字(plan §3.5 / §3.7 第③條)——
 *    `q` 在這裡經 `encodeURIComponent` 編碼,頁面端只拿它當過濾條件。
 */
function redirectWith(code: SupplierResultCode, locate?: string): never {
  const suffix = locate === undefined ? '' : `&q=${encodeURIComponent(locate)}`;
  redirect(`${SETTINGS_PATH}?r=${code}${suffix}`);
}

function logDatabaseError(
  message: string,
  requestId: string,
  error: unknown,
): void {
  // 🔴 `?? {}` 不是防禦性冗餘(codex K2 R2 抓):`Promise.reject(null)` / `reject(undefined)`
  //    是合法的 —— 沒有它,這一行讀 `.code` 會自己拋 TypeError,而那個 TypeError 會
  //    **穿過** action 的 catch(它已經在 catch 裡了)⇒ 使用者拿到 500 而不是 `r=error`。
  const summary = (error ?? {}) as { code?: unknown; message?: unknown };
  console.error(message, {
    request_id: requestId,
    code: typeof summary.code === 'string' ? summary.code : undefined,
    message: String(summary.message ?? '').slice(0, 200),
  });
}

/**
 * 寫入失敗分流。🔴 **本片的重點,不要圖省事收斂成一個 `error`**:
 *
 * | 來源 | 資料狀態 | 員工該做的下一步 |
 * |---|---|---|
 * | `SupplierCallerBugError` 來自 `createSupplier` 的 runtime id 閘 | **沒寫進去**(RPC 零呼叫) | 停手、通知維護者 |
 * | 同上,來自 `updateSupplier` 的空 patch 閘 | **沒寫進去**(RPC 零呼叫) | 停手、通知維護者 |
 * | 同上,來自 `updateSupplier` 收到 `CREATED` | 🔴 **已經多了一筆刪不掉的供應商** | 停手、通知維護者 |
 * | 其餘(DB error) | 沒寫進去(RPC 是單一交易) | 稍後再試 |
 * | 回應途中斷線 / 逾時 | 🔴 **不知道** —— 交易可能已 commit | 稍後再試(重按是安全的:改名/切換冪等;新增會撞 DUPLICATE_LABEL) |
 *
 * 🔴 **三者經由本檔的三個 action 都不可達**(誠實補充,免得這張表被讀成三條活路徑):
 *   create 傳的是物件字面、型別擋掉 id;三個解析器各自強制自己那個欄位 ⇒ 產不出空 patch;
 *   `CREATED` 要 RPC 漂移才會出現。它們是**偵測層**,不是預期會走到的分支。
 * ⇒ 三種 bug 來源只有第三種真的寫了東西,但**三種都不該叫他「再試一次」** ——
 *   通用訊息會讓他再按一次,而再按一次在第三種情況下可能再多一筆永久列。
 * 🔴 **「其餘 = 沒寫進去」不可讀成絕對**(codex K2 抓):RPC 已 commit 但回應在路上斷掉時,
 *   員工看到的是 `error` 而資料其實**已經變了**。這不是本層修得掉的(沒有 outbox / 冪等鍵),
 *   誠實的講法是:重按對改名與切換是安全的(同值會回 `NO_CHANGE`),對新增則會撞
 *   `DUPLICATE_LABEL` ⇒ 三條路都不會因為重按而多出第二筆。
 *   文案用「**可能**已多出一筆」涵蓋三者(`supplier-result-messages.ts`)。
 */
function classifyWriteFailure(
  message: string,
  requestId: string,
  error: unknown,
): 'bug' | 'error' {
  if (error instanceof SupplierCallerBugError) {
    console.error(`${message} —— 呼叫端契約違反`, {
      request_id: requestId,
      message: error.message.slice(0, 200),
    });
    return 'bug';
  }
  logDatabaseError(message, requestId, error);
  return 'error';
}

/**
 * 分流 + **重取清單**,然後把碼交給呼叫端 redirect。
 *
 * 🔴 **失敗路徑也要 `revalidatePath`**:`bug` 的其中一支(改名/停用收到 `CREATED`)代表
 *    RPC **已經寫進去一筆**刪不掉的供應商 —— 不重取的話員工看不到那筆多出來的列,
 *    而訊息又剛好叫他「通知維護者」⇒ 維護者來看時畫面上什麼都沒有。
 *    其餘幾支沒有寫入,重取只是無害的多餘動作(頁面本來就 force-dynamic)。
 */
function failureCode(
  message: string,
  requestId: string,
  error: unknown,
): 'bug' | 'error' {
  const code = classifyWriteFailure(message, requestId, error);
  revalidatePath(SETTINGS_PATH);
  return code;
}

/** 撞名時要讓清單定位到哪一列。`null`(理論上不可達)⇒ 不帶 `q`,退回通用訊息。 */
function locateQuery(label: string): string | undefined {
  return boundSupplierQuery(label) ?? undefined;
}

/**
 * `DUPLICATE_LABEL` **不在這裡處理** —— 兩條更新路徑對它的正確反應不同
 * (改名 ⇒ 定位到那一家;切換啟用 ⇒ 理論上不可達的漂移),
 * 所以把它排除在外、逼每個呼叫端自己決定,而不是給一個看似通用的預設。
 */
function updateResultCode(
  result: Exclude<SupplierUpdateResult, 'DUPLICATE_LABEL'>,
): 'saved' | 'nochange' | 'notfound' {
  switch (result) {
    case 'UPDATED':
      return 'saved';
    case 'NO_CHANGE':
      return 'nochange';
    case 'NOT_FOUND':
      return 'notfound';
  }
}

export async function createSupplierAction(formData: FormData): Promise<void> {
  // ① 授權閘。
  const authorization = await authorizeAdminMutation();
  if (!authorization) redirectWith('denied');

  // ② 解析。
  const parsed = parseSupplierCreateForm(formData);
  if (!parsed.ok) redirectWith('invalid');

  const requestId = await getRequestId();
  // 🔴 log **不記 label 全文**(K1-n5)—— 供應商名稱是營運資料,長度足以除錯。
  console.info('[admin/settings/suppliers] supplier.create.attempt', {
    request_id: requestId,
    sid: authorization.sid,
    actor: authorization.actorId,
    label_length: [...parsed.label].length,
  });

  // ③ 寫入。
  let result: SupplierCreateResult;
  try {
    result = await createSupplier({
      label: parsed.label,
      actor: authorization.actorId,
      requestId,
    });
  } catch (error) {
    redirectWith(
      failureCode(
        '[admin/settings/suppliers] 供應商新增失敗',
        requestId,
        error,
      ),
    );
  }

  // ④ PRG redirect。RPC 已執行 ⇒ 先讓頁面重取,撞名時清單才定位得到那一列
  //    (那一列可能是**別的 session 剛建的**,不重取就看不到 = Q2=A 的定位落空)。
  revalidatePath(SETTINGS_PATH);
  if (result === 'DUPLICATE_LABEL') {
    // 🔴 Sean Q2=A:只定位 + 標記,**系統不代按「啟用」**。這裡不呼叫任何 update。
    redirectWith('duplicate', locateQuery(parsed.label));
  }
  redirectWith('created');
}

export async function renameSupplierAction(formData: FormData): Promise<void> {
  // ① 授權閘。
  const authorization = await authorizeAdminMutation();
  if (!authorization) redirectWith('denied');

  // ② 解析。
  const parsed = parseSupplierRenameForm(formData);
  if (!parsed.ok) redirectWith('invalid');

  const requestId = await getRequestId();
  console.info('[admin/settings/suppliers] supplier.rename.attempt', {
    request_id: requestId,
    sid: authorization.sid,
    actor: authorization.actorId,
    target_id: parsed.id,
    label_length: [...parsed.label].length,
  });

  // ③ 寫入。🔴 Sean 2026-08-02 拍板 Q3=C:改名**不填原因** ⇒ 不送 note ⇒ RPC 收到 `p_note: null`。
  //    這是「零改動」的落地方式,不要順手加一個備註欄位(那會連帶要補 note 的鏡像驗證規則)。
  let result: SupplierUpdateResult;
  try {
    result = await updateSupplier({
      id: parsed.id,
      label: parsed.label,
      actor: authorization.actorId,
      requestId,
    });
  } catch (error) {
    redirectWith(
      failureCode(
        '[admin/settings/suppliers] 供應商改名失敗',
        requestId,
        error,
      ),
    );
  }

  // ④ PRG redirect。
  revalidatePath(SETTINGS_PATH);
  if (result === 'DUPLICATE_LABEL') {
    // 🔴 **改名撞名用自己的碼,不能沿用新增那則**(Fable R4 must-fix 2):
    //    ①那則的字面是「沒有**新增**」,在改名路徑上是錯的
    //    ②`?q=` 帶的是**新名字** ⇒ 清單篩到的是「佔用那個名字的別家」,
    //      而**被改名的那一家仍叫舊名字、會從畫面上消失**
    //      ⇒ 員工看到自己打的名字躺在表格裡,會讀成「改名成功了」。
    //    定位本身仍有價值(看得到是誰佔用),但文案必須講清楚那不是你要改的那一家。
    redirectWith('duplicate_rename', locateQuery(parsed.label));
  }
  redirectWith(updateResultCode(result));
}

export async function setSupplierActiveAction(
  formData: FormData,
): Promise<void> {
  // ① 授權閘。
  const authorization = await authorizeAdminMutation();
  if (!authorization) redirectWith('denied');

  // ② 解析。
  const parsed = parseSupplierActiveForm(formData);
  if (!parsed.ok) redirectWith('invalid');

  const requestId = await getRequestId();
  console.info('[admin/settings/suppliers] supplier.active.set.attempt', {
    request_id: requestId,
    sid: authorization.sid,
    actor: authorization.actorId,
    target_id: parsed.id,
    is_active: parsed.isActive,
  });

  // ③ 寫入。
  let result: SupplierUpdateResult;
  try {
    result = await updateSupplier({
      id: parsed.id,
      isActive: parsed.isActive,
      actor: authorization.actorId,
      requestId,
    });
  } catch (error) {
    redirectWith(
      failureCode(
        '[admin/settings/suppliers] 供應商啟用狀態更新失敗',
        requestId,
        error,
      ),
    );
  }

  // ④ PRG redirect。
  revalidatePath(SETTINGS_PATH);
  if (result === 'DUPLICATE_LABEL') {
    // 🔴 本路徑**理論上不可達**,但理由不是「檢查沒執行」——
    //    RPC 沒有顯式的唯一性檢查,它是 UPDATE 撞上 `suppliers_label_unique` 之後 catch
    //    `unique_violation`(`20260801160000:275-283`),而那個 UPDATE **每次都寫** label
    //    ⇒ 約束一直在被評估。不可達的真理由是:切換啟用時 label **值不變**,
    //    產不出新的衝突鍵(`suppliers_label_unique` 是 `UNIQUE (label)` 普通表約束、
    //    非 partial、非 case-insensitive;`20260801140000:45` 實查)。
    //    🔴 **這條前提哪天會失效**:若該約束被改成 partial(例如 `WHERE is_active`),
    //    停用→啟用就真的可能撞名 ⇒ 本分支映射成 `error` 要重新判斷,不能沿用。
    //    真的收到 = RPC 行為與本層的理解不符。**刻意不映射成 `duplicate`**:
    //    那句文案會叫員工去看「哪一家名稱重複」,而他根本沒有改名字 = 把人指向錯的方向。
    //    改用通用 `error` + 一則講得出原因的 log(漂移要留得下痕跡,不要靜默吞掉)。
    console.error(
      '[admin/settings/suppliers] 啟用狀態切換收到 DUPLICATE_LABEL(未送 p_label,理論上不可達)',
      { request_id: requestId, target_id: parsed.id },
    );
    redirectWith('error');
  }
  redirectWith(updateResultCode(result));
}
