'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getRequestId } from '../audit/context';
import { authorizeManagerMutation } from '../session/authorize';
import { FX_SETTINGS_PATH, type FxResultCode } from './fx-rate-messages';
import { setFxRateViaRpc } from './fx-rate-repository';
import { isKnownFxCode, parseFxRateInput } from './fx-rate-view';

// fx-rate-actions.ts — 「設定 › 匯率」的唯一 server action。形狀抄 `staff-actions.ts`:
// ① 授權閘(既有 `authorizeManagerMutation`)② 解析 ③ 一發 RPC(寫入 + 管理者閘重查 + 稽核同交易)④ PRG。
// 🔴 `p_actor` 給的是 session 的 actorId,不是表單值。

// 'use server' 檔只能 export async function ⇒ 路徑常數住 fx-rate-messages.ts。

function redirectWith(code: FxResultCode): never {
  redirect(`${FX_SETTINGS_PATH}?r=${code}`);
}

export async function setFxRateAction(formData: FormData): Promise<void> {
  const authorization = await authorizeManagerMutation();
  if (!authorization) redirectWith('denied');

  const code = formData.get('currency_code');
  const rate = parseFxRateInput(formData.get('rate_to_twd'));
  if (!isKnownFxCode(code) || rate === null) redirectWith('invalid');

  const requestId = await getRequestId();
  let outcome;
  try {
    outcome = await setFxRateViaRpc(authorization.actorId, { currencyCode: code, rateToTwd: rate }, requestId);
  } catch (error) {
    const e = error as { code?: unknown; message?: unknown };
    console.error('[admin/settings/fx] 匯率寫入失敗', {
      request_id: requestId,
      code: typeof e.code === 'string' ? e.code : undefined,
      message: String(e.message ?? '').slice(0, 200),
    });
    redirectWith('error');
  }
  if (outcome.kind === 'denied') redirectWith('denied');

  revalidatePath(FX_SETTINGS_PATH);
  redirectWith('saved');
}
