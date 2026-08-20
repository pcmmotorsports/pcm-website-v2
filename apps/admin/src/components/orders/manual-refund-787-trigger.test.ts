import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MANUAL_REFUND_ENTRY_BLOCKED_BY_787 } from './manual-refund-entry-gate';

/**
 * manual-refund-787-trigger.test.ts — #787 硬閘的解除觸發器(機制,不是提醒)。
 *
 * 🔴 主視窗 2026-08-20 裁定的理由,逐字:「註解不會在『條件成立了』的那一刻說話」——
 * `manual-refund-entry-gate.ts` 裡那段函式註解只在有人「主動去讀」時才有用,而
 * `manual-refund-caller-gate.test.ts` 自己的檔頭已經示範過同一個病的解法:
 * 「backlog 不會在有人加第一個呼叫端的那一刻說話。這一格會。」
 *
 * ⇒ 本檔做同一件事,對象換成沖銷 RPC(`admin_void_manual_refund`)這一半:
 * 一旦 `supabase/migrations` 這個【檔案系統目錄】出現這個字面,而
 * `MANUAL_REFUND_ENTRY_BLOCKED_BY_787` 還沒被改成 `false`,這一格必須紅。
 *
 * 🔴🔴 **判準只有一句話,量得比它聽起來的還窄**(主視窗 2026-08-20 裁定,W1 實測踩過一次):
 * 「檔在磁碟上」≠「進了版控」≠「上了 dev」≠「已 apply」—— 本檔的 `grep` 只量得到第一件,
 * 分不出未追蹤(`git status` 的 `??`)、已 commit 但還沒 push、已上 dev、或已 apply 到正式庫。
 * ⇒ **這是刻意的、不是缺陷**:一道提早紅的閘,比一道只在「已 apply」那一刻才紅的閘,
 * 更早叫住準備動手的人(2026-08-20 實測案例:它在那支 migration 還是 `??` 未追蹤時就抓到了)。
 * ⇒ **但訊息不能比量測更肯定**——下面每一句「已落地」都要讀成「檔案系統上看得到這個字面」,
 * 真要確認進度到哪一步,自己跑 `git status` / `git log dev -- <路徑>` / `supabase/APPLIED.tsv`。
 *
 * ⚠️ **它守不到的**(同族誠實邊界):只掃字面(有人用字串拼接繞過去掃不到)、
 * 不驗沖銷 RPC 是不是真的「可呼叫」(那是 EXECUTE GRANT 的事,本檔只看 migration 檔存不存在)。
 */

const REPO = resolve(__dirname, '../../../../..');
const NEEDLE = 'admin_void_manual_refund';

function migrationHasVoidRpc(): boolean {
  try {
    const out = execFileSync('grep', ['-rlF', NEEDLE, 'supabase/migrations'], {
      cwd: REPO,
      encoding: 'utf8',
    });
    return out.trim().length > 0;
  } catch {
    // grep 零命中與「目錄不存在」在本機同碼(同族 caller-gate.test.ts 已實測記錄的環境限制)
    // ⇒ 兩者都回 false;若是目錄真的不見了,下面 [1] 那格會用真實現況自己說話。
    return false;
  }
}

/**
 * 純邏輯:給定「沖銷 RPC 是否已落地」與「硬閘是否仍鎖著」,回傳這格該不該紅。
 * 拆成純函式是為了讓 [2] 能在不動任何檔案的情況下,對著一個假的「已落地」狀態驗證
 * 斷言真的會失敗——同族 caller-gate.test.ts 的自檢精神(量具要能表演給自己看)。
 */
function evaluateTrigger(voidRpcFileSeen: boolean, stillBlocked: boolean): { ok: boolean; reason: string } {
  if (voidRpcFileSeen && stillBlocked) {
    return {
      ok: false,
      reason:
        '在 supabase/migrations/ 的檔案系統上看到 admin_void_manual_refund 這個字面,但 ' +
        'MANUAL_REFUND_ENTRY_BLOCKED_BY_787 還是 true —— 該去查這支 migration 進度了:\n' +
        '⚠️ 本檢查分不出【未追蹤 / 已 commit / 已進 dev / 已 apply】,先自己跑 ' +
        'git status / git log dev -- <路徑> / supabase/APPLIED.tsv 確認到哪一步,\n' +
        '確認「service_role 已 EXECUTE 到」之後才動手:\n' +
        '① 把 manual-refund-entry-gate.ts 的 MANUAL_REFUND_ENTRY_BLOCKED_BY_787 改成 false' +
        '(連同它上面那段函式註解一起刪)\n' +
        '② 到 manual-refund-caller-gate.test.ts 的 CALLER_ALLOWLIST 登記本片檔案 + why',
    };
  }
  return { ok: true, reason: '' };
}

describe('#787 沖銷 RPC 落地觸發器', () => {
  it('[1] 現在:檔案系統上還看不到沖銷 RPC 的 migration → 綠(量到的,不是假設)', () => {
    const seen = migrationHasVoidRpc();
    expect(
      seen,
      'admin_void_manual_refund 已經出現在 supabase/migrations/ 的檔案系統上——' +
        '去查這支 migration 目前是未追蹤/已commit/已上dev/已apply 的哪一步',
    ).toBe(false);
    expect(evaluateTrigger(seen, MANUAL_REFUND_ENTRY_BLOCKED_BY_787).ok).toBe(true);
  });

  it('[2] 🔴 反面驗證:餵一個假的「已落地」狀態,確認這格真的會紅(不是死斷言)', () => {
    const faked = evaluateTrigger(true, MANUAL_REFUND_ENTRY_BLOCKED_BY_787);
    expect(faked.ok).toBe(false);
    expect(faked.reason).toContain('CALLER_ALLOWLIST');
  });

  it('[3] 正向對照:硬閘一旦解除(false)+ RPC 已落地 → 不再紅', () => {
    expect(evaluateTrigger(true, false).ok).toBe(true);
  });
});
