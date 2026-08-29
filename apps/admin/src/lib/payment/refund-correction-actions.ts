'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { authorizeAdminMutation } from '../session/authorize';
import { parseCorrectionForm } from './refund-correction-form';
import {
  CORRECTION_P2B44_MARKERS,
  CorrectionCallerBugError,
  CorrectionRejectedError,
  correctRefundVerdict,
} from './refund-correction-repository';
import {
  CORRECTION_EXCEPTIONS_PATH,
  type CorrectionActionState,
  type CorrectionResultCode,
} from './refund-correction-state';

// refund-correction-actions.ts — `#890` 片2c:更正判定的 server action。
//
// plan:`docs/specs/2026-08-29-890-manual-verdict-correction-ui-plan.md` §1c #5(v4)。
//
// 🔴🔴 **授權閘絕對第一,連讀一個欄位都在它之後**(plan §1d #11;形狀逐字抄
//    `refund-actions.ts:106-111` 那個「用 `get()` 會爆的地雷 FormData」釘住的短路)。
//    ⇒ 未授權者送一張爛表單,拿到的必須是 **denied** 而不是 invalid。
//    📌 兩者的差別不是文案:**invalid 會告訴他「哪裡填錯了」** ——
//      那等於對一個沒有權限的人描述這張表單的形狀。
//
// 🔴 **`actor` 只能來自授權層**(同上)。DB 只驗 `actor` 的**格式**
//    (`20260814190000:81` 的 `^[a-z0-9_]{1,64}$`)—— **它驗不了身分**。
//    ⇒ 表單裡就算塞了別人的 actor,寫進稽核的仍是授權層那一個。
//
// 🔴 **23505 換 token 重試一次**(plan §1f「v4 折 A6」;RPC 檔頭 `:309-313` 的義務):
//    · 上限**寫死 1** —— 撞第二次代表那不是碰撞、是別的東西,**讓它紅出來**。
//    · 而它與 `DUPLICATE_REQUEST` **處置相反**:
//      前者靜靜換一把重送(員工不必知道);後者要告訴他「這筆已經處理過」。

function fail(code: CorrectionResultCode): CorrectionActionState {
  return { ok: false, code };
}

/**
 * SQLSTATE → 結果碼。
 * 🔴 **`correction_stale` 與 `correction_bug` 絕對不能共用一句話**(見 state 檔那段規格):
 *    前者員工有下一步(重看一次現況),後者他沒有(再按幾次都一樣)。
 */
function toResultCode(sqlstate: string, message: string): CorrectionResultCode {
  switch (sqlstate) {
    case 'P2B44':
      // ⛔ ~~原本三個 CONSTRAINT 一律回 stale~~ **作廢(codex 2026-08-29 must-fix 3)**:
      //    `target_not_manual_failed` 叫員工「重看一次現況」是**錯的建議** —— 那一列根本不是
      //    人工判定失敗的列,他重看一百次也一樣,而畫面會讓他以為是時序問題。
      //    (`request_id_reused` 已在 repository 那一層被收成 REQUEST_ID_COLLISION,到不了這裡。)
      return message.includes(CORRECTION_P2B44_MARKERS.targetNotManualFailed)
        ? 'correction_not_applicable'
        : 'correction_stale';
    case 'P2B42':
    case '23514':
      return 'correction_invalid';
    case 'P8C03':
      return 'correction_not_applicable';
    // P2B43(row_count / row_count_audit)與 P8C01(isolation)都是「不該發生」的縱深斷言
    // ⇒ 它們不是員工填錯,是我們這一側出事了。
    default:
      return 'correction_bug';
  }
}

export async function correctVerdictAction(
  _prev: CorrectionActionState,
  formData: FormData,
): Promise<CorrectionActionState> {
  // ① 授權閘。🔴 絕對第一 —— 連讀一個欄位都在它之後。
  const authorization = await authorizeAdminMutation();
  if (!authorization) return fail('correction_denied');

  // ② 解析。前端的檢查不得比 DB 寬(見 refund-correction-form.ts 檔頭)。
  const parsed = parseCorrectionForm(formData);
  if (!parsed.ok) return fail('correction_invalid');

  const base = {
    refundId: parsed.refundId,
    expectedCorrectionId: parsed.expectedCorrectionId,
    // 🔴 表單那一欄不存在,而就算存在也不會被讀 —— actor 只有這一個來源。
    actor: authorization.actorId,
    reason: parsed.reason,
    correctedTo: parsed.correctedTo,
  };

  let outcome;
  try {
    outcome = await correctRefundVerdict({ ...base, requestId: parsed.requestToken });
    if (outcome.result === 'REQUEST_ID_COLLISION') {
      // 🔴 換一把新 token 重送 **一次**。第二次撞 ⇒ 不再重試,讓它成為一個看得見的結果。
      outcome = await correctRefundVerdict({ ...base, requestId: crypto.randomUUID() });
      if (outcome.result === 'REQUEST_ID_COLLISION') return fail('correction_bug');
    }
  } catch (error) {
    if (error instanceof CorrectionRejectedError)
      return fail(toResultCode(error.sqlstate, error.message));
    // 🔴 協定漂移是**我們的 bug** ⇒ 不得叫員工重試。
    if (error instanceof CorrectionCallerBugError) return fail('correction_bug');
    // 🔴 其餘(平台故障 / 網路)也不宣稱任何一種業務結果 —— 但它與 bug 是不同的碼。
    console.error('[admin/payment/refund-correction] 未預期錯誤', error);
    return fail('correction_bug');
  }

  revalidatePath(CORRECTION_EXCEPTIONS_PATH);

  const code: CorrectionResultCode =
    outcome.result === 'DUPLICATE_REQUEST' ? 'correction_duplicate' : 'correction_done';

  console.info('[admin/payment/refund-correction] corrected', {
    refund_id: parsed.refundId,
    result: outcome.result,
    corrected_to: parsed.correctedTo,
    actor: authorization.actorId,
  });

  // 🔴 成功才 PRG;而它在 try 之外 —— `redirect()` 是靠 throw 實作的,包在 try 裡會被自己吃掉。
  redirect(`${CORRECTION_EXCEPTIONS_PATH}?r=${code}`);
}
