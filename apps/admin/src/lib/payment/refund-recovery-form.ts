// refund-recovery-form.ts — M-3 A7c RW4:恢復流程兩張表單的純解析器(無 IO;refund-form 慣例)。
//
// 🔴 鏡像範圍(不說滿):只做「形狀」——
//    · refund_id / token 的 UUID 形狀、resolution allowlist、DR 碼鏡像 RPC `^\S{1,64}$`
//      (`20260803150000:660`)、確認碼 4 位英數(Q2=A 人因閘;server 端比對在 action)。
//    · 互斥鏡像(fail-closed 拒矛盾表單,不猜員工要哪種):
//      mark_failed 帶 DR 碼=矛盾(RPC「manual_failed 不得帶 tappay_refund_id」);
//      recover_confirmed 帶確認碼=矛盾(該表單沒有這欄,出現=表單狀態壞掉)。
//
// ⚠️ DR 碼長度:JS `\S{1,64}` 數 UTF-16 units、PG 數字元 —— 真 DR 碼是 ASCII(probe 實測
//    `DR20260803gvcV5i` 形),分岔僅在 astral 字元、且 JS 這邊更嚴=fail-closed 方向。

import { isUuid } from '../orders/note-action-state';
import {
  RECOVERY_CONFIRM_FIELD,
  RECOVERY_DR_CODE_FIELD,
  RECOVERY_REFUND_ID_FIELD,
  RECOVERY_REQUEST_TOKEN_FIELD,
  RECOVERY_RESOLUTION_FIELD,
} from './refund-recovery-state';
import { RECOVERY_RESOLUTIONS, type RecoveryResolution } from './refund-judgment';
import { isRefundRequestToken } from './refund-action-state';
import type { FormLike } from './refund-form';

const DR_CODE_RE = /^\S{1,64}$/;
/** 確認碼=訂單號末 4 碼(refund-form.ts CONFIRM_RE 同形;新 6 碼制為數字、字母留餘裕)。 */
const CONFIRM_RE = /^[0-9A-Za-z]{4}$/;

function readString(form: FormLike, field: string): string | null {
  const raw = form.get(field);
  return typeof raw === 'string' ? raw : null;
}

export type RecoveryJudgeParse = { ok: true; refundId: string } | { ok: false };

/** 判定表單:只有 refund_id(唯讀動作、無 token)。 */
export function parseRecoveryJudgeForm(form: FormLike): RecoveryJudgeParse {
  const refundId = readString(form, RECOVERY_REFUND_ID_FIELD);
  if (refundId === null || !isUuid(refundId)) return { ok: false };
  return { ok: true, refundId };
}

export type RecoveryResolveParse =
  | ({ ok: true; refundId: string; requestToken: string } & (
      | { resolution: 'mark_failed'; drCode: null; confirmCode: string }
      | { resolution: 'recover_confirmed'; drCode: string; confirmCode: null }
    ))
  | { ok: false };

/** 結案表單。DR 碼先 trim(貼上尾隨空白是常態;RPC 的 `\S` 也容不下空白)。 */
export function parseRecoveryResolveForm(form: FormLike): RecoveryResolveParse {
  const refundId = readString(form, RECOVERY_REFUND_ID_FIELD);
  if (refundId === null || !isUuid(refundId)) return { ok: false };

  const requestToken = readString(form, RECOVERY_REQUEST_TOKEN_FIELD);
  if (requestToken === null || !isRefundRequestToken(requestToken)) return { ok: false };

  const resolutionRaw = readString(form, RECOVERY_RESOLUTION_FIELD);
  if (
    resolutionRaw === null ||
    !(RECOVERY_RESOLUTIONS as readonly string[]).includes(resolutionRaw)
  ) {
    return { ok: false };
  }
  const resolution = resolutionRaw as RecoveryResolution;

  const drCodeRaw = readString(form, RECOVERY_DR_CODE_FIELD);
  const drCode = drCodeRaw === null ? '' : drCodeRaw.trim();
  const confirmRaw = readString(form, RECOVERY_CONFIRM_FIELD);
  const confirmCode = confirmRaw === null ? '' : confirmRaw.trim();

  if (resolution === 'mark_failed') {
    // 互斥鏡像(檔頭):標記失敗帶 DR 碼=矛盾表單。
    if (drCode !== '') return { ok: false };
    if (!CONFIRM_RE.test(confirmCode)) return { ok: false };
    return { ok: true, refundId, requestToken, resolution: 'mark_failed', drCode: null, confirmCode };
  }
  // 互斥鏡像:恢復表單沒有確認碼欄,出現=矛盾。
  if (confirmCode !== '') return { ok: false };
  if (!DR_CODE_RE.test(drCode)) return { ok: false };
  return { ok: true, refundId, requestToken, resolution: 'recover_confirmed', drCode, confirmCode: null };
}
