'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getRequestId } from './audit/context';
import { authorizeManagerMutation } from './session/authorize';
import {
  createStaffViaRpc,
  listStaffRows,
  setStaffActiveViaRpc,
  updateStaffProfileViaRpc,
  type StaffRow,
  type StaffWriteOutcome,
} from './staff-repository';
import {
  parseStaffActiveForm,
  parseStaffCreateForm,
  parseStaffProfileForm,
} from './staff-form';

// E8-A2 員工管理 action。固定 redirect 回單一設定頁,無 return_to / open-redirect 面。
//
// ⚠️ ~~原註解「actor 仍是使用者自行選擇,本片不把它描述成身分驗證」~~ **已作廢兩次**:
//    ① 2026-08-25 B5-a 起 `ADMIN_REQUIRE_REAL_IDENTITY=1` ⇒ actor 來自【簽章過的票】,
//       那顆自選 cookie 一個字都不讀(`session/actor.ts` 第 1 層)。
//    ② ⟦b4-MGR0⟧ 2026-08-28 起,那個 actor 還決定**誰能改權限**。
//
// 🔴 **Q5 = 乙(Sean 2026-08-28 拍板,而他讀過代價)**:三個 staff mutation 同一道管理者閘。
//    代價① 每次管理者離職就生出一顆「休眠管理者」(is_manager=true + is_active=false),
//          而甲(只閘寫入、不閘停用/啟用)會讓任何登入者把它叫醒 ⇒ 所以 setActive 也收進來。
//    代價② 實際效果 = 只有【啟用中的管理者】改得動員工。
//          (2026-08-28 量:正式庫 is_manager AND is_active = 1,後台 2 人在用 ⇒ Sean 判可接受)
//    🔴 上面那兩個數字【綁 2026-08-28 那個時點】,標籤跟著它們走 ——
//       第三個員工進來那天它們會零訊號地變假,而機制句(代價①②本身)不會。
//    哪天這一格開始卡人,回來看這裡,不要重新發明。
//
// 🔴 **而這道閘【不等於那個洞已經關閉】**:它住在應用層,`service_role` 仍有 `is_manager`
//    的欄級 UPDATE 權 ⇒ **我們自己寫的下一支腳本仍然繞得過**。那是 Sean 讀過代價後
//    選擇不鎖(Q15 = 甲),不是技術上做不到。完整說明在 `staff.ts` 的 `isActiveManager`。

const SETTINGS_PATH = '/settings/staff';

// sean 是既有、不可改名的穩定 seed 與老闆救援身分;DB 又未授予 DELETE。
// 在不新增 migration 的前提下,以永不允許停用 sean 取代非原子「最後一人」快照檢查。
const BREAK_GLASS_STAFF_ID = 'sean';

type ResultCode =
  | 'saved'
  | 'audit_failed'
  | 'notfound'
  | 'invalid'
  | 'denied'
  | 'error';

function redirectWith(code: ResultCode): never {
  redirect(`${SETTINGS_PATH}?r=${code}`);
}

function logDatabaseError(
  message: string,
  requestId: string,
  error: unknown,
): void {
  const summary = error as { code?: unknown; message?: unknown };
  console.error(message, {
    request_id: requestId,
    code: typeof summary.code === 'string' ? summary.code : undefined,
    message: String(summary.message ?? '').slice(0, 200),
  });
}

/**
 * ⟦b4-MGR0-RPC⟧ **稽核不在這裡了** —— 它跟著寫入進了 RPC 的同一筆交易
 * (migration `20260912050000`, Sean 2026-09-12 Q2 甲「沒稽核就不算改成功」)。
 *
 * ⛔ ~~`recordStaffAudit()` + `finishMutation(auditRecorded)`~~ 已刪:那是舊的兩段式
 *    ——「DB 已成功後 audit 不可回滾」那句話**在本檔不再成立**,因為現在它回滾得了。
 * 🔴 ⇒ `audit_failed` 這個結果碼**本檔不再產生**(下面 `ResultCode` 留著它,
 *    因為 `staff-result-messages.ts` 那張表與它的測試仍在;刪它要動三個無關檔案,
 *    而那張表多一句用不到的話不傷人)。📌 **它不再出現【不是】因為稽核不會失敗,
 *    而是因為稽核失敗時整筆一起不見** ⇒ 員工看到的是 `error`,名單也沒有被改。
 */
function finishMutation(): never {
  revalidatePath(SETTINGS_PATH);
  redirectWith('saved');
}

/**
 * RPC 的四種結果 → 結果碼。**`ok` 以外一律不往下走。**
 *
 * 🔴 `denied` 來自 RPC 的管理者閘 —— 那是**寫入同一筆交易裡**重查的那一次:
 *    `authorizeManagerMutation()`(本檔 ①)過了之後,那個人可能已經被停用。
 *    ⇒ 📌 **兩道閘都要, 而它們守的不是同一刻。**
 */
function redirectForFailedOutcome(
  outcome: Exclude<StaffWriteOutcome, { kind: 'ok' }>,
  context: { actorId: string; requestId: string; targetId: string },
): never {
  switch (outcome.kind) {
    case 'denied':
      // 🔴 **這一行是訊號, 不是除錯用的** (Fable 2026-09-12 審 consider-2):
      //    走到這裡代表 app 那道閘(①)剛剛放行, 而 DB 那道閘(同一筆交易裡重查)拒了
      //    ⇒ 兩個可能:**那個人在這中間被停用了**, 或 app 與 DB 對「誰是管理者」的判定漂掉了。
      //    ⇒ 📌 沒有這一行的話, 值班那一端看到的只有使用者畫面上一個 `?r=denied`。
      console.warn('[admin/settings/staff] RPC 拒絕:app 閘已放行而 DB 閘拒', {
        request_id: context.requestId,
        actor: context.actorId,
        target_id: context.targetId,
      });
      redirectWith('denied');
    case 'duplicate':
      redirectWith('invalid');
    case 'not_found':
      redirectWith('notfound');
  }
}

export async function createStaffAction(formData: FormData): Promise<void> {
  // ① 授權閘。
  const authorization = await authorizeManagerMutation();
  if (!authorization) redirectWith('denied');

  // ② 解析。
  const parsed = parseStaffCreateForm(formData);
  if (!parsed.ok) redirectWith('invalid');

  const requestId = await getRequestId();
  console.info('[admin/settings/staff] staff.create.attempt', {
    request_id: requestId,
    sid: authorization.sid,
    actor: authorization.actorId,
    target_id: parsed.input.id,
  });

  // ③ 寫入 + 管理者閘重查 + 稽核 —— **一發 RPC, 同一筆交易**。
  //    🔴 `p_actor` 給的是 `authorization.actorId`, **不是表單值** ⇒ 表單改不動它。
  //    ⚠️ 而「簽章過的票」這個強度**只在 `ADMIN_REQUIRE_REAL_IDENTITY=1` 之下成立**
  //       (本檔頂部那段與 `session/authorize.ts` 都這樣限定)—— Fable 審 nit-1:
  //       我原本寫成無條件的, 那是把一個有前提的保證說成了沒前提的。
  let outcome: StaffWriteOutcome;
  try {
    outcome = await createStaffViaRpc(
      authorization.actorId,
      {
        id: parsed.input.id,
        label: parsed.input.label,
        is_manager: parsed.input.isManager,
      },
      requestId,
    );
  } catch (error) {
    logDatabaseError(
      '[admin/settings/staff] 員工新增失敗',
      requestId,
      error,
    );
    redirectWith('error');
  }
  if (outcome.kind !== 'ok') {
    redirectForFailedOutcome(outcome, {
      actorId: authorization.actorId,
      requestId,
      targetId: parsed.input.id,
    });
  }

  // ④ PRG redirect。稽核已在 ③ 那一筆交易裡 ⇒ 這裡沒有第二段可以失敗。
  finishMutation();
}

export async function updateStaffProfileAction(
  formData: FormData,
): Promise<void> {
  // ① 授權閘。
  const authorization = await authorizeManagerMutation();
  if (!authorization) redirectWith('denied');

  // ② 解析。
  const parsed = parseStaffProfileForm(formData);
  if (!parsed.ok) redirectWith('invalid');

  // 🔴 原子 break-glass:sean 的管理者身分不得被拿掉 ——
  //    拿掉 = 沒有人能再設定管理者(這道閘會把自己鎖死)。
  //    形狀與同檔 BREAK_GLASS_STAFF_ID / setStaffActiveAction 那條「永不允許停用 sean」相同,
  //    不是新發明;而它守的是【另一個欄位】,所以兩條都要。
  if (parsed.id === BREAK_GLASS_STAFF_ID && !parsed.profile.isManager) {
    redirectWith('invalid');
  }

  const requestId = await getRequestId();
  console.info('[admin/settings/staff] staff.profile.update.attempt', {
    request_id: requestId,
    sid: authorization.sid,
    actor: authorization.actorId,
    target_id: parsed.id,
  });

  // ③ 寫入 + 管理者閘重查 + 稽核 —— **一發 RPC, 同一筆交易**。
  //    ⛔ ~~前置 `listStaffRows()` 撈全表找 `before`~~ **已刪** —— 兩個理由:
  //    ① `before` 現在由 RPC 在**鎖住那一列之後**自己讀 ⇒ 它讀到的才是真的改之前那一刻;
  //       舊路那個 `before` 是**還沒鎖就讀的快照**, 寫下去之間可能已經變了。
  //    ② 「那個人不存在」舊路靠快照判, 現在 RPC 回 `not_found`。
  //    🔵 ⇒ 少一發全表查詢, 而判斷反而更準。
  //    🔴 RPC 的 SET 只含 label / is_manager ⇒ 舊 profile 表單仍不能讓 is_active 自行復活。
  let outcome: StaffWriteOutcome;
  try {
    outcome = await updateStaffProfileViaRpc(
      authorization.actorId,
      parsed.id,
      {
        label: parsed.profile.label,
        is_manager: parsed.profile.isManager,
      },
      requestId,
    );
  } catch (error) {
    logDatabaseError(
      '[admin/settings/staff] 員工資料更新失敗',
      requestId,
      error,
    );
    redirectWith('error');
  }
  if (outcome.kind !== 'ok') {
    redirectForFailedOutcome(outcome, {
      actorId: authorization.actorId,
      requestId,
      targetId: parsed.id,
    });
  }

  // ④ PRG redirect。
  finishMutation();
}

export async function setStaffActiveAction(
  formData: FormData,
): Promise<void> {
  // ① 授權閘。
  const authorization = await authorizeManagerMutation();
  if (!authorization) redirectWith('denied');

  // ② 解析。
  const parsed = parseStaffActiveForm(formData);
  if (!parsed.ok) redirectWith('invalid');

  const requestId = await getRequestId();
  console.info('[admin/settings/staff] staff.active.set.attempt', {
    request_id: requestId,
    sid: authorization.sid,
    actor: authorization.actorId,
    target_id: parsed.id,
    is_active: parsed.isActive,
  });

  // 🔴 原子 break-glass:不依賴名單快照,任何請求都不得停用 sean。
  if (parsed.id === BREAK_GLASS_STAFF_ID && !parsed.isActive) {
    redirectWith('invalid');
  }

  let rows: StaffRow[];
  try {
    rows = await listStaffRows();
  } catch (error) {
    logDatabaseError(
      '[admin/settings/staff] 員工狀態更新前置讀取失敗',
      requestId,
      error,
    );
    redirectWith('error');
  }

  const before = rows.find((row) => row.id === parsed.id);
  if (!before) redirectWith('notfound');

  const isDeactivating = before.is_active && !parsed.isActive;

  // 🔴 縱深守門:不得停用最後一個啟用中的員工。
  if (
    isDeactivating &&
    rows.filter((row) => row.is_active).length <= 1
  ) {
    redirectWith('invalid');
  }

  // 🔴 縱深守門:當前 actor 不得停用自己。
  if (parsed.id === authorization.actorId && !parsed.isActive) {
    redirectWith('invalid');
  }

  // ③ 寫入 + 管理者閘重查 + 稽核 —— **一發 RPC, 同一筆交易**。
  //    🔴 RPC 的 SET 只含 is_active ⇒ 不覆蓋顯示名或管理者權限。
  //    🔴 稽核的 action 名(`reactivate` / `deactivate`)由 RPC 依 `p_is_active` 自己選,
  //       **不是本檔傳過去的** ⇒ 名單被改成什麼, 紀錄上就寫什麼, 兩者不可能對不上。
  let outcome: StaffWriteOutcome;
  try {
    outcome = await setStaffActiveViaRpc(
      authorization.actorId,
      parsed.id,
      parsed.isActive,
      requestId,
    );
  } catch (error) {
    logDatabaseError(
      '[admin/settings/staff] 員工狀態更新失敗',
      requestId,
      error,
    );
    redirectWith('error');
  }
  if (outcome.kind !== 'ok') {
    redirectForFailedOutcome(outcome, {
      actorId: authorization.actorId,
      requestId,
      targetId: parsed.id,
    });
  }

  // ④ PRG redirect。
  finishMutation();
}
