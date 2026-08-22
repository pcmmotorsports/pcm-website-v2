import { describe, expect, it } from 'vitest';
import {
  MANUAL_REFUND_VOID_REASON_MAX,
  manualRefundVoidFailure,
  parseManualRefundVoidForm,
  shouldShowVoidFailure,
  type ManualRefundVoidActionState,
  type ManualRefundVoidFailedState,
} from './manual-refund-void-action-state';

/**
 * 🔴 **先斷言「它真的失敗了」,再看內容**(codex R1 must-fix ④,2026-08-22)。
 *   原本每格寫 `if (s.status === 'failed') expect(...)` —— 而函式若改成回 `idle`,
 *   那個 `if` 不成立、**整段斷言被跳過,而測試印綠**。
 *   ⇒ 判別句:**斷言若包在 `if` 裡,那個 `if` 本身要先被斷言。**
 */
function asFailed(s: ManualRefundVoidActionState): ManualRefundVoidFailedState {
  expect(s.status, '預期是 failed,實得 idle ⇒ 下面的斷言一格都沒跑到').toBe('failed');
  if (s.status !== 'failed') throw new Error('unreachable(上面那格已經紅了)');
  return s;
}

// manual-refund-void-action-state.test.ts — M-4b E10 片 D3-c。
//
// 🔴 本檔測的是**純形狀**。業務判定的單一真相在 `admin_void_manual_refund`,
//    它的【行為】驗證住在 `scripts/d3b-void-probe.sh`(拋棄式 PG),不在這裡。
//    ⇒ 這裡全綠**不代表**作廢功能可用;那要 GRANT 被 apply(見 manual-refund-entry-gate.ts 條件③)。

describe('parseManualRefundVoidForm — 形狀', () => {
  it('正常 → ok,理由已 trim', () => {
    const r = parseManualRefundVoidForm({ refundId: 'mr-1', reason: '  金額打錯了  ' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.reason).toBe('金額打錯了');
      expect(r.refundId).toBe('mr-1');
    }
  });

  it('缺 refundId → 不 ok(不知道要作廢哪一列)', () => {
    expect(parseManualRefundVoidForm({ refundId: null, reason: '有理由' }).ok).toBe(false);
    expect(parseManualRefundVoidForm({ refundId: '', reason: '有理由' }).ok).toBe(false);
  });

  it('理由空白 → 不 ok', () => {
    expect(parseManualRefundVoidForm({ refundId: 'mr-1', reason: null }).ok).toBe(false);
    expect(parseManualRefundVoidForm({ refundId: 'mr-1', reason: '   ' }).ok).toBe(false);
  });

  // 🔴 這一格**留著,而它的意義變了**(2026-08-22 突變測試改寫,見被測檔的註解):
  //    它原本宣稱在驗一條額外的正規式,而那條正規式是死的(`.trim()` 已經涵蓋 U+00A0/U+3000)。
  //    ⇒ 現在它驗的是**那個涵蓋關係本身** —— 哪天有人把 `.trim()` 換成別的寫法
  //      (例如某個只砍半形空格的 util),這一格會紅。
  // 🔴 字面一律用 \u 逃脫:寫【看不見的字元本體】在 diff 與審查上完全看不出來。
  it('🔴 全形空格 / NBSP / tab 只有這些 → 不 ok(驗 .trim() 真的涵蓋這些字元)', () => {
    expect(parseManualRefundVoidForm({ refundId: 'mr-1', reason: '\u3000\u3000' }).ok).toBe(false);
    expect(parseManualRefundVoidForm({ refundId: 'mr-1', reason: '\u00A0\u00A0' }).ok).toBe(false);
    expect(parseManualRefundVoidForm({ refundId: 'mr-1', reason: '\t\n' }).ok).toBe(false);
    // 反向對照:夾在全形空格裡的一個真字要通過 —— 少了它,上面三格在「一律回 false」時也綠。
    const r = parseManualRefundVoidForm({ refundId: 'mr-1', reason: '\u3000中\u3000' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.reason).toBe('中');
  });

  it(`理由 ${MANUAL_REFUND_VOID_REASON_MAX} 字 → ok;多一個字 → 不 ok`, () => {
    const at = 'あ'.repeat(MANUAL_REFUND_VOID_REASON_MAX);
    expect(parseManualRefundVoidForm({ refundId: 'mr-1', reason: at }).ok).toBe(true);
    expect(parseManualRefundVoidForm({ refundId: 'mr-1', reason: at + 'あ' }).ok).toBe(false);
  });

  // 🔴 用 [...reason].length 不用 .length:emoji 在 UTF-16 是 2 個 code unit。
  // ⚠️ **而畫面上打不到 200 個 emoji**(codex R1 nit):`<input maxLength>` 數的是 code unit
  //    ⇒ 瀏覽器約 100 個就到上限。**兩邊不一致,而方向是瀏覽器比較嚴** ⇒ fail-closed。
  //    本格證的是**這支 parser 的字數規則**,不是「員工真的打得進 200 個 emoji」。
  it('🔴 parser 把 emoji 算一個字(不是兩個)—— 突變成 .length 會讓這格紅', () => {
    const emoji = '🙂'.repeat(MANUAL_REFUND_VOID_REASON_MAX);
    expect([...emoji].length).toBe(MANUAL_REFUND_VOID_REASON_MAX);
    expect(emoji.length).toBe(MANUAL_REFUND_VOID_REASON_MAX * 2); // 這一行說明為什麼不能用 .length
    expect(parseManualRefundVoidForm({ refundId: 'mr-1', reason: emoji }).ok).toBe(true);
  });
});

describe('manualRefundVoidFailure — 訊息來源', () => {
  it('🔴 rejected 顯示 RPC 原文(D3-b 每句 RAISE 都是寫給員工看的)', () => {
    const s = manualRefundVoidFailure('rejected', '理由', 'mr-1', '這筆退款已於 X 由「Y」作廢');
    expect(asFailed(s).message).toBe('這筆退款已於 X 由「Y」作廢');
  });

  it('rejected 但沒拿到 RPC 原文 → 用罐頭備援(不顯示空字串)', () => {
    expect(asFailed(manualRefundVoidFailure('rejected', '理由', 'mr-1')).message).toContain('重新整理');
  });

  it('🔴 非 rejected 的碼【不會】被 rpcMessage 蓋掉(反向對照)', () => {
    const s = asFailed(manualRefundVoidFailure('bug', '理由', 'mr-1', '不該出現的 RPC 原文'));
    expect(s.message).not.toContain('不該出現的 RPC 原文');
  });

  // 🔴 作廢**沒有冪等鍵** ⇒ error 的文案不能照抄登記那半的「用同一張表單重試」。
  it('🔴 error 要叫人先重新整理看現況,而不是「用同一張表單重送」', () => {
    const s = asFailed(manualRefundVoidFailure('error', '理由', 'mr-1'));
    expect(s.message).toContain('重新整理');
    expect(s.message).not.toContain('同一張表單');
  });

  it('每一列的失敗都帶得回 refundId(同一張表上有很多列,錯誤不能貼錯列)', () => {
    expect(asFailed(manualRefundVoidFailure('invalid', '理由', 'mr-9')).refundId).toBe('mr-9');
  });
});

describe('shouldShowVoidFailure — 哪一列該看到這個錯(codex R1 must-fix ②)', () => {
  it('🔴 授權失敗(refundId 為空)→ 這一列必須看得到(否則員工按了完全沒反應)', () => {
    const denied = manualRefundVoidFailure('denied', '', '');
    expect(shouldShowVoidFailure(denied, 'mr-1')).toBe(true);
    expect(shouldShowVoidFailure(denied, 'mr-2')).toBe(true);
  });

  it('同一列的失敗 → 顯示', () => {
    expect(shouldShowVoidFailure(manualRefundVoidFailure('invalid', 'x', 'mr-1'), 'mr-1')).toBe(true);
  });

  // 🔴 反向對照:少了這格,上面兩格在「一律回 true」的實作下照樣綠。
  it('🔴 別列的失敗 → 不顯示', () => {
    expect(shouldShowVoidFailure(manualRefundVoidFailure('invalid', 'x', 'mr-9'), 'mr-1')).toBe(false);
  });

  it('🔴 idle → 不顯示', () => {
    expect(shouldShowVoidFailure({ status: 'idle' }, 'mr-1')).toBe(false);
  });
});
