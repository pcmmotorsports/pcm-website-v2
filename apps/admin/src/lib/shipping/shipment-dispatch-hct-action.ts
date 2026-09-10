'use server';

// shipment-dispatch-hct-action.ts — 叫車那一個 server action(⟦ship-DISPATCHORDER⟧ 片四)。
//
// 🔴🔴 **順序是承重的, 而它是 codex R1 打出來的**:
// ```
// ① claim(DB 佔位)  ⇒ ② 叫車(HTTP)  ⇒ ③ record(補記)  ⇒ ④ 標出貨(寄信在它下游)
// ```
//    掛在①之前 ⇒ 什麼都沒發生 ✅
//    掛在①②之間、或②之後③之前 ⇒ **佔位在而補記空** ⇒ 那顆鈕按不下去, 要人看一眼 ✅
//    掛在③之後④之前 ⇒ 有派遣紀錄而沒標出貨 ⇒ 一樣按不下去, 要人看一眼 ✅
// ⇒ 🎯 **每一種掛法留下的都是【可補】的那一邊** —— 而不可補的那一邊是「多叫一台車」。
//
// 🛑 **①失敗就【絕不】往下打** —— 那個例外的意思是「這一箱不准送」, 不是「重試看看」。
// 🛑 **③失敗【不得】吞掉** —— 車已經叫了, 而紀錄沒寫下來就是「現實與紀錄各說各話」。
//    ⇒ 回一個明確要人處理的結果, 而**不繼續標出貨**(標了會寄信, 而我們不確定發生了什麼)。
//
// 🛑 **稽核那一層記得住什麼, 寫在這裡, 因為它比你以為的少**:
//    `shipment-action-audit` 只收三種結果(`attempt` / `ok` / `fail`)與五個具名鍵,
//    ⇒ 📌 **`edelno`、被拒的原因、`unknown` 的 reason 都【進不去稽核】** ——
//      它們只到員工的畫面上。要事後追一發叫車發生了什麼, 今天查得到的只有
//      「誰在什麼時候按過、成功還失敗」。
//    ⚠️ 而我**刻意不去加寬那支共用的稽核型別** —— 那是別人的東西, 而加寬它會影響七個呼叫端。
//      ⇒ 這一格記在這裡, 需要的時候再開一片。
//
// 🔵 一次一箱。**不做批次** —— 正式庫今天總共四箱, 而批次的部分成功處理
//    (`planFromDispatch` 已經寫好而且驗過)在畫面上一次都用不到。
//    📌 `ponytail:` 一箱一發 HTTP;要多選批次時把 `dispatchOrder` 的陣列參數餵滿即可,
//      client 那一層本來就收 20 箱。

import { revalidatePath } from 'next/cache';
import { authorizeAdminMutation } from '../session/authorize';
import { toMessage } from './error-message';
import { auditLog, NO_ACTOR_MESSAGE } from './shipment-action-audit';
import {
  claimHctDispatch,
  getDispatchShipment,
  recordHctDispatch,
} from './shipment-repository';
import { markShipmentShipped } from './shipment-repository';
import { dispatchOrder, hctDispatchGateOpen } from './hct-client';
import { dispatchButton, planFromDispatch } from './hct-dispatch-flow';

export type DispatchActionResult =
  | { ok: true; kind: 'dispatched'; edelno: string }
  /** 🔵 閘關著 / env 缺 ⇒ 一發 HTTP 都沒打, 而**佔位也沒寫**。 */
  | { ok: false; kind: 'disabled'; message: string }
  /** 🔴 新竹明白地拒絕了 ⇒ 那一箱原封不動。 */
  | { ok: false; kind: 'rejected'; message: string }
  /**
   * 🛑 **不確定** —— 佔位已經寫下去了, 而我們不知道車叫到沒。
   *    ⇒ 那顆鈕從此按不下去, **要人去看一眼**。這是刻意的。
   */
  | { ok: false; kind: 'needs_human'; message: string }
  | { ok: false; kind: 'error'; message: string };

/** 🔴 與 `readHctDeps` 同一套 fail-closed —— 空字串也算缺(一顆貼歪的 env 常常是空白)。 */
function readDeps(): { fetchImpl: typeof fetch; endpoint: string; account: string; password: string } | null {
  const endpoint = (process.env.HCT_API_ENDPOINT ?? '').trim();
  const account = (process.env.HCT_API_ACCOUNT ?? '').trim();
  const password = (process.env.HCT_API_PASSWORD ?? '').trim();
  if (endpoint === '' || account === '' || password === '') return null;
  return { fetchImpl: fetch, endpoint, account, password };
}

/**
 * 派遣者。Sean 給的字:「派達有限公司」。
 * 🛑 **它是 V15 §8 的必要欄位且不可為空白** ⇒ 沒設就當作沒開通, **不送一個空的出去**。
 * ⚠️ 而**這六個中文字本身沒有被驗過** —— 第一箱驗到的是收件人姓名與地址那兩欄的中文,
 *    而 `emark` 是另一個欄位:同一個信封、同一套跳脫, 而**它自己沒有走過那條路**。
 *    ⇒ 📌 第一發要有人看著它回什麼。
 */
function readEmark(): string {
  return (process.env.HCT_DISPATCH_EMARK ?? '').trim();
}

export async function dispatchShipmentAction(args: {
  shipmentId: string;
}): Promise<DispatchActionResult> {
  const auth = await authorizeAdminMutation();
  if (auth === null) return { ok: false, kind: 'error', message: NO_ACTOR_MESSAGE };
  auditLog('shipment.hct_dispatch', auth, 'attempt', { shipment_id: args.shipmentId });

  try {
    // 🔴 **閘與 env 在讀任何東西之前判** —— 關著的時候這條路連佔位都不寫。
    //    📌 那正是 `hctSubmitGateOpen` 那一格的教訓:閘在函式裡面, 而佔位在函式外面。
    const deps = readDeps();
    const emark = readEmark();
    if (!hctDispatchGateOpen() || deps === null || emark === '') {
      auditLog('shipment.hct_dispatch', auth, 'fail', { shipment_id: args.shipmentId });
      return {
        ok: false,
        kind: 'disabled',
        message:
          !hctDispatchGateOpen()
            ? '叫車還沒開通(HCT_DISPATCH_ENABLED)—— 一發請求都沒送出去。'
            : emark === ''
              ? '派遣者(HCT_DISPATCH_EMARK)沒設 —— 它是新竹的必要欄位而且不可為空白, 所以不送。'
              : '新竹連線設定不完整 —— 一發請求都沒送出去。',
      };
    }

    const row = await getDispatchShipment(args.shipmentId);
    if (row === null) {
      return { ok: false, kind: 'error', message: '查無這一箱' };
    }
    // 🔴 畫面那道判準在這裡**再問一次** —— 畫面可能是幾分鐘前算的。
    //    🛑 而它**仍然不是安全網**:真正擋得住的是 `admin_claim_hct_dispatch` 那句原子 UPDATE。
    const btn = dispatchButton(row, new Date());
    if (!btn.show || !btn.enabled) {
      const why = btn.show && !btn.enabled ? btn.why : '這一箱不能叫車';
      auditLog('shipment.hct_dispatch', auth, 'fail', { shipment_id: args.shipmentId });
      return { ok: false, kind: 'rejected', message: why };
    }
    const edelno = row.hctRequestId ?? '';

    // ── ① 佔位。丟例外 = 這一箱不准送 ⇒ 不往下打。
    await claimHctDispatch({ shipmentReference: row.shipmentReference, edelno });

    // ── ② 叫車。
    const out = await dispatchOrder(deps, [{ epino: row.shipmentReference, edelno }], emark);
    const plan = planFromDispatch(out);

    if (plan.kind === 'disabled') {
      // 🛑 走到這裡代表閘在我們判過【之後】被關掉 —— 佔位已經寫了, 而 HTTP 沒送。
      //    ⇒ 那一箱從此按不下去, 而它其實什麼都沒發生 ⇒ 說清楚, 讓人去解。
      return {
        ok: false,
        kind: 'needs_human',
        message: '叫車開關在送出前被關掉了 —— 這一箱沒有送出去, 而佔位已經寫下, 請人清一次。',
      };
    }
    if (plan.kind === 'all_unknown') {
      auditLog('shipment.hct_dispatch', auth, 'fail', { shipment_id: args.shipmentId });
      return {
        ok: false,
        kind: 'needs_human',
        message: `新竹的回答我們看不懂(${plan.reason})—— 🛑 這【不代表車沒叫到】。這一箱先不標出貨, 請人確認。`,
      };
    }

    const only = plan.rows[0];
    if (only === undefined) {
      return { ok: false, kind: 'needs_human', message: '新竹回了一個空的清單 —— 請人確認。' };
    }
    if (only.action === 'leave_alone') {
      auditLog('shipment.hct_dispatch', auth, 'fail', { shipment_id: args.shipmentId });
      // 🔵 被拒絕的箱**佔位仍然在** —— 那是刻意的:我們已經對新竹送出過一發,
      //    而「送出過而被拒」與「沒送過」不是同一件事。要再送要有人看一眼。
      return { ok: false, kind: 'rejected', message: `新竹拒絕了這一箱:${only.message}` };
    }
    if (only.action === 'needs_human') {
      auditLog('shipment.hct_dispatch', auth, 'fail', { shipment_id: args.shipmentId });
      return {
        ok: false,
        kind: 'needs_human',
        message: `新竹回的那一列我們認不出來(${only.reason})—— 車可能已經叫到了, 請人確認。`,
      };
    }

    // ── ③ 補記。🔴 這一發失敗**不得吞掉** —— 車已經叫了。
    await recordHctDispatch({ shipmentReference: row.shipmentReference, edelno: only.edelno });

    // ── ④ 標出貨(寄信在它下游)。
    await markShipmentShipped({
      idempotencyKey: `dispatch:${args.shipmentId}`,
      shipmentId: args.shipmentId,
      trackingNumber: only.edelno,
    });
    revalidatePath('/shipments');
    auditLog('shipment.hct_dispatch', auth, 'ok', {
      shipment_id: args.shipmentId,
      has_tracking_number: true,
    });
    return { ok: true, kind: 'dispatched', edelno: only.edelno };
  } catch (e) {
    auditLog('shipment.hct_dispatch', auth, 'fail', { shipment_id: args.shipmentId });
    return { ok: false, kind: 'error', message: toMessage(e) };
  }
}
