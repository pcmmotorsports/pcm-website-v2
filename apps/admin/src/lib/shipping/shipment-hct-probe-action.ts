'use server';

// shipment-hct-probe-action.ts — 🔴 片 B 臨時:對新竹真打兩發唯讀 QueryEDELNO, 驗證我們的查詢讀得對。
// plan:docs/plans/2026-09-15-hct-carrier-replied-exit-plan.md §3.4(Sean Q3 甲;開開關與真打時間另外問 Sean)。
//
// · 正對照:查 S9FC6P(正式庫已送成功、有貨號)⇒ 期望 found 且貨號 = 我們記的。
// · 負對照:查一個格式合法、shipments 裡確認沒有的箱號 ⇒ 期望 not_found。
// · 零 DB 寫入, 只留稽核 log。管理者限定 + HCT_QUERY_PROBE_ENABLED='true' 才動;查詢本身仍受 HCT_QUERY_ENABLED 管。
// · 🛑 驗完:讀數寫進 hct-client.ts queryEdelno 那段註解與板列, 本檔 + 入口 + repository 的 getHctReferenceState 一起刪。

import { authorizeManagerMutation } from '../session/authorize';
import { toMessage } from './error-message';
import { auditLog } from './shipment-action-audit';
import { getHctReferenceState } from './shipment-repository';
import { queryEdelno, readHctDepsFromEnv } from './hct-client';

export type HctProbeWhich = 'positive' | 'negative';

export type HctProbeResult = {
  ok: boolean;
  which: HctProbeWhich;
  reference: string | null;
  /** 給人看的一句判讀。 */
  verdict: string;
  /** 新竹回來的原樣摘要(kind / 貨號 / 原因),不含帳密。 */
  outcome: string | null;
};

const POSITIVE_REFERENCE = 'S9FC6P';
/** 格式合法(6 碼、字元集內)而很難撞到的候選;用之前逐一確認 shipments 沒有。 */
const NEGATIVE_CANDIDATES = ['ZZZZZZ', 'YYYYYY', 'XXXXXX', 'WWWWWW'];

export async function probeHctQueryAction(args: { which: HctProbeWhich }): Promise<HctProbeResult> {
  const which: HctProbeWhich = args.which === 'negative' ? 'negative' : 'positive';
  const base = { which, reference: null, outcome: null };
  const auth = await authorizeManagerMutation();
  if (auth === null) return { ...base, ok: false, verdict: '只有管理者可以跑這個驗證(或請先選擇操作人員)。' };
  const done = (r: HctProbeResult): HctProbeResult => {
    auditLog('shipment.hct_query_probe', auth, r.ok ? 'ok' : 'fail', {});
    return r;
  };
  auditLog('shipment.hct_query_probe', auth, 'attempt', {});

  if (process.env.HCT_QUERY_PROBE_ENABLED !== 'true') {
    return done({ ...base, ok: false, verdict: '驗證入口沒開(HCT_QUERY_PROBE_ENABLED 不是 true)—— 一發都沒送。' });
  }
  const deps = readHctDepsFromEnv();
  if (deps === null) return done({ ...base, ok: false, verdict: '新竹帳密缺(HCT_API_*)—— 一發都沒送。' });

  try {
    let reference: string;
    let expectedEdelno: string | null = null;
    if (which === 'positive') {
      const state = await getHctReferenceState(POSITIVE_REFERENCE);
      if (state === null || state.hctStatus !== 'submitted' || state.hctRequestId === null) {
        return done({ ...base, ok: false, reference: POSITIVE_REFERENCE, verdict: `正對照前提不成立:${POSITIVE_REFERENCE} 不是已送成功、有貨號的箱 —— 一發都沒送。` });
      }
      reference = POSITIVE_REFERENCE;
      expectedEdelno = state.hctRequestId;
    } else {
      let picked: string | null = null;
      for (const c of NEGATIVE_CANDIDATES) {
        if ((await getHctReferenceState(c)) === null) {
          picked = c;
          break;
        }
      }
      if (picked === null) return done({ ...base, ok: false, verdict: '負對照候選箱號都已經存在 —— 一發都沒送。' });
      reference = picked;
    }

    const q = await queryEdelno(deps, reference);
    // 🔴 R1 F1:片 B 唯一的目的就是看新竹原文 ⇒ 只落 server log(不回瀏覽器、不進 auditLog 白名單)。
    //    回應路徑不帶帳密(帳密只在請求信封);evidence / raw 各截 1000 字。
    console.info('[admin/shipping] shipment.hct_query_probe.raw', {
      sid: auth.sid,
      actor: auth.actorId,
      which,
      reference,
      kind: q.kind,
      reason: q.kind === 'unknown' ? q.reason : undefined,
      evidence: q.kind === 'unknown' ? q.evidence : undefined,
      raw: q.kind === 'found' || q.kind === 'not_found' ? JSON.stringify(q.raw).slice(0, 1000) : undefined,
    });
    const outcome =
      q.kind === 'found'
        ? `found edelno=${q.edelno}`
        : q.kind === 'unknown'
          ? `unknown reason=${q.reason}`
          : q.kind;
    if (q.kind === 'disabled') {
      return done({ ...base, ok: false, reference, outcome, verdict: '新竹查詢沒開(HCT_QUERY_ENABLED 不是 true)—— 一發都沒送。' });
    }
    if (which === 'positive') {
      const pass = q.kind === 'found' && q.edelno === expectedEdelno;
      return done({
        ...base,
        ok: pass,
        reference,
        outcome,
        verdict: pass
          ? `✅ 正對照通過:新竹回的貨號與我們記的相同(${expectedEdelno})。`
          : q.kind === 'found'
            ? `🔴 正對照不符:新竹回 ${q.edelno},我們記的是 ${expectedEdelno} —— 停,回報這一行。`
            : `🔴 正對照不符:期望查到,實際 ${outcome} —— 停,回報這一行。`,
      });
    }
    const pass = q.kind === 'not_found';
    return done({
      ...base,
      ok: pass,
      reference,
      outcome,
      verdict: pass
        ? `✅ 負對照通過:從沒送過的 ${reference} 新竹回查無。(要正對照也通過, 才算查詢驗證過)`
        : `🔴 負對照不符:期望查無,實際 ${outcome} —— 停,回報這一行。`,
    });
  } catch (e) {
    return done({ ...base, ok: false, verdict: `驗證途中出錯:${toMessage(e)} —— 停,回報這一行。` });
  }
}
