'use server';

// shipment-hct-query-action.ts — 卡在「送出結果未知」的箱:向新竹查詢貨號(只查不送)。
// plan:docs/plans/2026-09-15-hct-carrier-replied-exit-plan.md 片 A(Sean 2026-09-15 Q1 甲)。
//
// 🔴 為什麼不讓員工按「送新竹」就好(它對 unknown 本來就先查,hct-submit-flow.ts decideSubmit):
//    ① 那條路被 HCT_SUBMIT_ENABLED 擋在查詢之前 ⇒ 為了止血關掉送單, 卡住的箱就連問都問不到;
//    ② 鈕上寫「要真的叫新竹來收貨才按」, 跟卡住提示的「不要重送」相反, 沒有人會去按。
//    ⇒ 這裡只查不送:只看 HCT_QUERY_ENABLED(queryEdelno 內建), 絕不呼叫送單。
// 🔴 查到貨號的寫法與「送新竹」的 recovered 分支同一句(shipment-submit-hct-action.ts `case 'recovered'`;沒抽函式, 就是那 1 次呼叫):
//    recordHctSubmit(submitted, 貨號, 新竹回的原文)。unknown ⇒ submitted 是資料庫允許的補記, 不是重送。
// 🔴 QueryEDELNO 還沒對新竹真打過(hct-client.ts queryEdelno 那段註解)⇒ 「查無」一律帶上「查詢還沒驗證過」。
// 🔴 乙型查無的出口 = Sean 2026-09-15 Q2 甲:「這一箱作廢, 重新開一箱, 再送新竹叫一次車」(不給放回草稿)。
//    作廢 RPC 不看 hct_status(20260808100000 admin_void_shipment)⇒ 卡在 unknown 的箱作廢得掉。
// 🔴 查到之後【沒有標籤圖】:QueryEDELNO 回包只有 success / edelno / epino / ErrMsg ⇒ 同一天走「重新取得標籤」;
//    隔天救回的箱沒有 UI 拿得到標籤(hct_submitted_at 留原本那天)⇒ Sean 2026-09-15:「我們本地重新做一張就好…或者可以取消更好」
//    ⇒ 主路 = 作廢這箱、重開一箱再送;舊新竹單請新竹取消是【可選】(新竹沒有取消 API, 只能打電話)(R1 F1)。

import { revalidatePath } from 'next/cache';
import { authorizeAdminMutation } from '../session/authorize';
import { toMessage } from './error-message';
import { auditLog, NO_ACTOR_MESSAGE } from './shipment-action-audit';
import { getHctShipment, recordHctSubmit } from './shipment-repository';
import { queryEdelno, readHctDepsFromEnv } from './hct-client';
import { classifyHctUnknown } from './hct-unknown-kind';

export type HctQueryActionResult =
  | { ok: true; kind: 'found'; edelno: string }
  | { ok: false; kind: 'not_found' | 'unknown' | 'disabled' | 'refused' | 'needs_human'; message: string };

const UNVERIFIED = '(查詢還沒對新竹驗證過, 這個「查無」不能當成新竹沒收到的證據)';

export async function queryHctUnknownAction(args: { shipmentId: string }): Promise<HctQueryActionResult> {
  const auth = await authorizeAdminMutation();
  if (auth === null) return { ok: false, kind: 'needs_human', message: NO_ACTOR_MESSAGE };
  auditLog('shipment.hct_query_unknown', auth, 'attempt', { shipment_id: args.shipmentId });
  const fail = (r: Extract<HctQueryActionResult, { ok: false }>): HctQueryActionResult => {
    auditLog('shipment.hct_query_unknown', auth, 'fail', { shipment_id: args.shipmentId });
    return r;
  };

  const deps = readHctDepsFromEnv();
  if (deps === null) {
    return fail({ ok: false, kind: 'disabled', message: '新竹未開通(缺 HCT_API_ENDPOINT / HCT_API_ACCOUNT / HCT_API_PASSWORD 其中之一)' });
  }

  let row: Awaited<ReturnType<typeof getHctShipment>>;
  try {
    row = await getHctShipment(args.shipmentId);
  } catch (e) {
    return fail({ ok: false, kind: 'needs_human', message: `讀不到這一箱:${toMessage(e)} —— 不要重送。` });
  }
  if (row === null) return fail({ ok: false, kind: 'needs_human', message: '找不到這一箱' });
  if (row.voidedAt !== null) return fail({ ok: false, kind: 'refused', message: '這一箱已作廢,不查。' });
  if (row.hctStatus !== 'unknown') {
    return fail({
      ok: false,
      kind: 'refused',
      message: `這一箱目前是 ${row.hctStatus},不是「送出結果未知」,不用查。請重新整理畫面。`,
    });
  }

  let q: Awaited<ReturnType<typeof queryEdelno>>;
  try {
    q = await queryEdelno(deps, row.shipmentReference);
  } catch (e) {
    q = { kind: 'unknown', reason: `query_threw:${toMessage(e)}` };
  }

  if (q.kind === 'disabled') {
    return fail({ ok: false, kind: 'disabled', message: '新竹查詢還沒開通(HCT_QUERY_ENABLED 未設為 true, 或這是本機開發環境)—— 一發都沒送出去。' });
  }
  if (q.kind === 'found') {
    try {
      await recordHctSubmit({ shipmentReference: row.shipmentReference, status: 'submitted', requestId: q.edelno, raw: q.raw });
    } catch (e) {
      // 兩人同時按:第二人的補記撞「已經是 submitted」⇒ 重讀一次, 已被記成同一個貨號就當成查到(R1 F4)。
      const again = await getHctShipment(args.shipmentId).catch(() => null);
      if (again !== null && again.hctStatus === 'submitted' && again.hctRequestId === q.edelno) {
        auditLog('shipment.hct_query_unknown', auth, 'ok', { shipment_id: args.shipmentId });
        return { ok: true, kind: 'found', edelno: q.edelno };
      }
      return fail({
        ok: false,
        kind: 'needs_human',
        message: `新竹【有】這張單(貨號 ${q.edelno}),但記進資料庫失敗了:${toMessage(e)} —— 不要重送,請回報這行字。`,
      });
    }
    revalidatePath('/orders');
    auditLog('shipment.hct_query_unknown', auth, 'ok', { shipment_id: args.shipmentId });
    return { ok: true, kind: 'found', edelno: q.edelno };
  }
  if (q.kind === 'not_found') {
    const carrierReplied = classifyHctUnknown(row.hctRawResponse) === 'carrier-replied';
    return fail({
      ok: false,
      kind: 'not_found',
      message: carrierReplied
        ? `新竹查無這張單,但新竹當時【回過話】⇒ 不自動處理、不放回草稿。請先打電話給新竹確認:新竹確認沒有這張單 ⇒ 把這一箱作廢(舊箱留紀錄),重新開一箱再送新竹。${UNVERIFIED}`
        : `新竹查無這張單。請照 runbook 打電話向新竹確認後,再決定要不要「放回草稿」。${UNVERIFIED}`,
    });
  }
  return fail({
    ok: false,
    kind: 'unknown',
    message: `這次查詢沒有拿到答案(${q.reason})—— 不要重送,稍後再查。`,
  });
}
