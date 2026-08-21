import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ═══ 這支檔在補 codex R1 F7 ═══════════════════════════════════════════════
// 原本的測試只驗 `refundFailure` 的字串組裝 ⇒ **把三個 recordRefundUnknownStateAudit()
// 呼叫全部刪掉、或某個出口帶錯 refundId、或忘記把 `!recorded` 傳進去,測試仍然全綠。**
// 那是一組恆綠格:它證明的東西與它宣稱守住的東西不是同一件。
//
// 🔴 誠實邊界(不要放寬):
//   · 下面的「行為」段用 vi.mock 換掉 repository 邊界 ⇒ 它**不證明真的寫得進 DB**。
//     那一格是**另外**用真的 Postgres 量過的(真函式→真 repository→真 client→真 PG,
//     且回頭去 DB 撈那一列出來看)。這裡補的是 true/false/逾時**三條分支**,
//     不是取代那一發。
//   · 「接線」段是**結構性 oracle**(讀原始碼字面),形狀抄 `refund-wiring.test.tsx:434`。
//     它抓得到「呼叫被刪掉 / 少傳 !recorded / site 打錯」,
//     **抓不到**「參數值語意錯但字面對」。這一格靠人工讀 diff + typecheck。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ACTIONS = readFileSync(path.join(HERE, 'refund-actions.ts'), 'utf8');

// 🔴 codex R2 F1:原本這一段是**全檔計數**,而它有兩個恆綠格 ——
//   ① 把兩個出口的 `site` 對調 ⇒ 三種 site 仍各一次、ID 仍正確 ⇒ 全綠,而分類已經寫錯
//   ② 刪掉 `await` ⇒ `auditOutcome` 變成 Promise,`!== 'written'` **恆真**…
//      不,更糟:它恆為 true ⇒ 每次都掛那句警告;而若寫成 `!recorded` 則恆為 false
//      ⇒ 員工**永遠看不到**稽核失敗。兩種都不會紅。
// ⇒ 改成**逐分支**:用每個出口自己的 logError 字面當 anchor,只在那一段裡斷言。
const BRANCHES = [
  { anchor: "logError('refund unknown-state'", site: 'adapter_threw', tappay: false },
  { anchor: "logError('accepted 後 finalize 失敗'", site: 'finalize_threw_after_accepted', tappay: true },
  { anchor: "logError('refund 回傳非三態", site: 'resolved_status_unrecognized', tappay: false },
] as const;

/**
 * 從 anchor 切到**下一個 anchor**(最後一段切到函式收口)。
 *
 * 🔴 **上一版的上界是「那一段自己的 `return refundFailure(...)` 收尾」,而那是靠【排版】**
 *    (審查線 `-04` RF-2):把某個 `refundFailure(...)` 壓成一行是完全合法的重構,
 *    而它會讓那一段從 14 行漲到 27 行、**吃進下一個分支**。
 *    ⚠️ 當時它仍然會紅 —— 但紅的原因是「下一段剛好有 `tappayRefundId:`」,
 *      **fail-safe 成立的理由是鄰居剛好在那個旗標上不同**,不是因為切段是對的。
 *      而印出來的訊息會說「tappayRefundId 不該出現」⇒ **誤導型的紅**。
 * ⇒ 改用結構性邊界:下一個 anchor / 函式收口。排版怎麼改都不影響。
 */
/**
 * 🔴 **切段用括號配對,不用行距、不用 anchor 距離。**
 *
 * 走過的兩個死路(留著,免得下一個人再走一次):
 *  v1 上界 = 那一段自己的 `return refundFailure(...)` 收尾
 *     ⇒ 靠**排版**:把某個 `refundFailure(...)` 壓成一行是合法重構,那一段會吃進下一個分支
 *       (審查線 `-04` RF-2)。
 *  v2 上界 = 下一個 anchor
 *     ⇒ 靠**鄰居**:兩個 anchor 之間夾著不相干的 code。實測第一段吃進了
 *       `finalizeOrderRefund({ ... tappayRefundId: ... })` ⇒ 那格斷言假紅。
 *  v3 現行:從 `recordRefundUnknownStateAudit({` 起,**數大括號**到它自己收口;
 *     再接著把後面第一個 `refundFailure(` **數小括號**到收口。
 *     ⇒ 段落 = 恰好那兩個語句,排版怎麼改都一樣。
 *
 * ⚠️ 誠實邊界:這個配對器**不解析字串與註解裡的括號**。本片這兩個呼叫裡沒有那種東西
 *    (下面「三段互不重疊」那格會在有人放進去時紅),但它不是一個通用的 TS parser。
 */
const CALL = 'recordRefundUnknownStateAudit({';

/** 從 `from` 起數 `open`/`close`,回傳收口後的位置(exclusive)。 */
function matchPair(src: string, from: number, open: string, close: string): number {
  let depth = 0;
  for (let k = from; k < src.length; k += 1) {
    if (src[k] === open) depth += 1;
    else if (src[k] === close) {
      depth -= 1;
      if (depth === 0) return k + 1;
    }
  }
  return -1;
}

/** 三個稽核呼叫,各自切出「呼叫 + 緊接著那個 refundFailure」。 */
function auditCallBlocks(): ReadonlyArray<{ site: string; src: string; at: number }> {
  const out: { site: string; src: string; at: number }[] = [];
  let cursor = 0;
  for (;;) {
    const at = ACTIONS.indexOf(CALL, cursor);
    if (at === -1) break;
    const braceFrom = ACTIONS.indexOf('{', at);
    const callEnd = matchPair(ACTIONS, braceFrom, '{', '}');
    expect(callEnd, `第 ${out.length + 1} 個稽核呼叫的大括號沒有收口`).toBeGreaterThan(-1);
    const failAt = ACTIONS.indexOf('refundFailure(', callEnd);
    expect(failAt, '稽核呼叫後面找不到 refundFailure(').toBeGreaterThan(-1);
    const failEnd = matchPair(ACTIONS, ACTIONS.indexOf('(', failAt), '(', ')');
    expect(failEnd, 'refundFailure 的小括號沒有收口').toBeGreaterThan(-1);
    const src = ACTIONS.slice(at, failEnd);
    const site = /site: '([a-z_]+)'/.exec(src)?.[1] ?? '(找不到 site)';
    out.push({ site, src, at });
    cursor = failEnd;
  }
  return out;
}

/** 這個呼叫住在哪一個分支裡 = 它前面最靠近的那個 anchor。 */
function branchOf(at: number): string {
  let best = { site: '(找不到分支)', pos: -1 };
  for (const b of BRANCHES) {
    const pos = ACTIONS.indexOf(b.anchor);
    if (pos !== -1 && pos < at && pos > best.pos) best = { site: b.site, pos };
  }
  return best.site;
}

describe('🔴 接線(逐呼叫 oracle):三個出口各自要對', () => {
  it('unknown_state 出口恰三處,稽核呼叫也恰三處', () => {
    expect((ACTIONS.match(/refundFailure\(\s*'unknown_state'/g) ?? []).length).toBe(3);
    expect(auditCallBlocks().length).toBe(3);
  });

  it('🔴 每個稽核呼叫的 site,要等於它【住的那個分支】應有的 site', () => {
    const blocks = auditCallBlocks();
    expect(blocks.length).toBe(3);
    for (const b of blocks) {
      expect(b.site, `這個呼叫住在 ${branchOf(b.at)} 分支裡,卻寫 site: '${b.site}'`).toBe(
        branchOf(b.at),
      );
    }
    // 三個 site 各用一次,不重不漏。
    expect(new Set(blocks.map((b) => b.site)).size).toBe(3);
  });

  it('🔴 每個呼叫都要有 await,而且旗標走三態(少了 await 判斷會恆為同一邊)', () => {
    for (const b of auditCallBlocks()) {
      const lead = ACTIONS.slice(Math.max(0, b.at - 60), b.at);
      expect(lead, `${b.site} 這個呼叫沒有 await`).toContain('await ');
      expect(lead).toContain('const auditOutcome =');
      expect(b.src, `${b.site} 的旗標不是三態判斷`).toContain(
        "auditUnconfirmed: auditOutcome !== 'written'",
      );
    }
  });

  it('三個 ID 的來源都要對', () => {
    for (const b of auditCallBlocks()) {
      expect(b.src, `${b.site} 少了 orderId 或用錯來源`).toContain('orderId: parsed.orderId');
      expect(b.src).toContain('refundId: initiated.refundId');
      expect(b.src).toContain('bankRefundId: initiated.bankRefundId');
    }
  });

  it('🔴 tappayRefundId 只出現在錢已受理那一格', () => {
    const withTappay = auditCallBlocks().filter((b) => b.src.includes('tappayRefundId:'));
    expect(withTappay.length).toBe(1);
    expect(withTappay[0]!.site).toBe('finalize_threw_after_accepted');
  });

  it('🔴 三段互不重疊,且每段恰含 1 個 site: / 1 個 refundFailure(', () => {
    const blocks = auditCallBlocks();
    for (const b of blocks) {
      expect((b.src.match(/site: '/g) ?? []).length, `${b.site} 這一段吃到別段了`).toBe(1);
      expect((b.src.match(/refundFailure\(/g) ?? []).length).toBe(1);
      // 配對器不解析字串/註解裡的括號 ⇒ 有人放進去時這一格會先紅。
      expect(b.src).not.toMatch(/\/\/.*[{}()]/);
    }
    for (let i = 1; i < blocks.length; i += 1) {
      expect(blocks[i]!.at, '兩個呼叫的切段重疊了').toBeGreaterThan(
        blocks[i - 1]!.at + blocks[i - 1]!.src.length - 1,
      );
    }
  });

  it('🔴 合約漂移那格不得先 String() 那個值(F2 回歸閘)', () => {
    expect(ACTIONS).not.toMatch(/const resolvedStatus = String\(/);
    const drift = auditCallBlocks().find((b) => b.site === 'resolved_status_unrecognized');
    expect(drift?.src).toContain('resolvedStatusValue,');
  });
});

// ── 行為:true / false / 逾時 三條分支 ──────────────────────────────────
const recordMock = vi.fn();
vi.mock('../orders/order-repository', () => ({
  getAdminAuditLogRepository: () => ({ record: recordMock }),
}));

const BASE = {
  site: 'adapter_threw' as const,
  orderId: 'o-1',
  refundId: 'r-1',
  bankRefundId: 'b-1',
  actor: 'tester',
  requestId: 'req-1',
};

afterEach(() => {
  recordMock.mockReset();
  vi.useRealTimers();
});

describe('recordRefundUnknownStateAudit — 三條分支', () => {
  it('寫成 ⇒ true,而且送出去的那一列形狀正確', async () => {
    const { recordRefundUnknownStateAudit } = await import('./refund-unknown-state-audit');
    recordMock.mockResolvedValueOnce(undefined);
    const ok = await recordRefundUnknownStateAudit({
      ...BASE,
      error: new Error('sk_live_SHOULD_NOT_APPEAR'),
    });
    expect(ok).toBe('written');
    const [entry, ctx] = recordMock.mock.calls[0]!;
    expect(entry.action).toBe('order_refund.unknown_state');
    expect(entry.target).toBe('order:o-1');
    expect(entry.reason).toBeUndefined();
    expect(entry.after).toMatchObject({
      site: 'adapter_threw',
      order_id: 'o-1',
      refund_row_id: 'r-1',
      bank_refund_id: 'b-1',
      tappay_refund_id: null,
      error_class: 'error_unclassified',
      resolved_status_type: null,
      resolved_status_length: null,
    });
    // 🔴 整列不得含任何外部字串。
    expect(JSON.stringify(entry)).not.toContain('sk_live');
    expect(ctx).toEqual({ actor: 'tester', requestId: 'req-1', sourceApp: 'admin' });
  });

  it('reject ⇒ false,且不 throw', async () => {
    const { recordRefundUnknownStateAudit } = await import('./refund-unknown-state-audit');
    recordMock.mockRejectedValueOnce(new Error('DB 掛了'));
    await expect(recordRefundUnknownStateAudit({ ...BASE, error: null })).resolves.toBe('failed');
  });

  it('🔴 F3:兩個 threw 出口即使 error 是 undefined,也要分類成 other、不是 null', async () => {
    const { recordRefundUnknownStateAudit } = await import('./refund-unknown-state-audit');
    recordMock.mockResolvedValueOnce(undefined);
    await recordRefundUnknownStateAudit({ ...BASE, error: undefined });
    expect(recordMock.mock.calls[0]![0].after.error_class).toBe('other');
  });

  it('🔴 F1/F8:合約漂移那格只留型別與長度,原字面不進去', async () => {
    const { recordRefundUnknownStateAudit } = await import('./refund-unknown-state-audit');
    recordMock.mockResolvedValueOnce(undefined);
    await recordRefundUnknownStateAudit({
      ...BASE,
      site: 'resolved_status_unrecognized',
      resolvedStatusValue: 'LEAK_ME_PLEASE',
    });
    const after = recordMock.mock.calls[0]![0].after;
    expect(after.resolved_status_type).toBe('string');
    expect(after.resolved_status_length).toBe(14);
    expect(after.error_class, '這個出口沒有 error ⇒ 必須是 null').toBeNull();
    expect(JSON.stringify(after)).not.toContain('LEAK_ME');
  });

  it('🔴 F5:record 永遠不 settle ⇒ 逾時當沒寫成,不得把主流程掛住', async () => {
    vi.useFakeTimers();
    const { recordRefundUnknownStateAudit, REFUND_AUDIT_WRITE_TIMEOUT_MS } = await import(
      './refund-unknown-state-audit'
    );
    recordMock.mockReturnValueOnce(new Promise(() => {})); // 永不 settle
    const p = recordRefundUnknownStateAudit({ ...BASE, error: new Error('x') });
    await vi.advanceTimersByTimeAsync(REFUND_AUDIT_WRITE_TIMEOUT_MS + 10);
    await expect(p).resolves.toBe('timeout');
  });
});

describe('withAuditTimeout — 純邏輯', () => {
  it('工作先完成 ⇒ ok:true 帶值', async () => {
    const { withAuditTimeout } = await import('./refund-unknown-state-audit');
    await expect(withAuditTimeout(Promise.resolve('done'), 1000)).resolves.toEqual({
      ok: true,
      value: 'done',
    });
  });

  it('逾時先到 ⇒ ok:false kind timeout', async () => {
    vi.useFakeTimers();
    const { withAuditTimeout } = await import('./refund-unknown-state-audit');
    const p = withAuditTimeout(new Promise(() => {}), 500);
    await vi.advanceTimersByTimeAsync(600);
    await expect(p).resolves.toEqual({ ok: false, kind: 'timeout' });
  });
});
