import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { lineStatusLabel, lineStatusOf, showsLineChip } from './line-status-view';

describe('lineStatusOf:三態 + 讀不到', () => {
  it('有 id + 有好友時間 ⇒ friend', () => {
    expect(lineStatusOf({ lineUserId: 'U1', lineFriendAt: '2026-09-14T01:00:00Z' })).toEqual({
      kind: 'friend',
      friendAt: '2026-09-14T01:00:00Z',
    });
  });
  it('有 id、沒好友時間 ⇒ login_only', () => {
    expect(lineStatusOf({ lineUserId: 'U1', lineFriendAt: null })).toEqual({ kind: 'login_only' });
  });
  it('沒 id ⇒ none', () => {
    expect(lineStatusOf({ lineUserId: null, lineFriendAt: null })).toEqual({ kind: 'none' });
  });
  it('🔴 讀不到(null / undefined)⇒ unknown,不得退回「沒用 LINE」', () => {
    expect(lineStatusOf(null)).toEqual({ kind: 'unknown' });
    expect(lineStatusOf(undefined)).toEqual({ kind: 'unknown' });
  });
  it('空字串 / 全空白當沒有(DB 可能存空字串)', () => {
    expect(lineStatusOf({ lineUserId: '  ', lineFriendAt: null })).toEqual({ kind: 'none' });
    expect(lineStatusOf({ lineUserId: 'U1', lineFriendAt: '  ' })).toEqual({ kind: 'login_only' });
  });
});

describe('lineStatusLabel', () => {
  it('四態各一句,而「讀不到」要說出它不是「沒綁」', () => {
    expect(lineStatusLabel({ kind: 'friend', friendAt: 'x' }, '09/14')).toBe('已加好友 09/14');
    expect(lineStatusLabel({ kind: 'friend', friendAt: 'x' })).toBe('已加好友');
    expect(lineStatusLabel({ kind: 'login_only' })).toBe('已登入未加好友');
    expect(lineStatusLabel({ kind: 'none' })).toBe('沒用 LINE');
    expect(lineStatusLabel({ kind: 'unknown' })).toContain('不代表他沒綁');
  });
});

describe('showsLineChip:列表只有已加好友才印', () => {
  it.each([
    [{ kind: 'friend', friendAt: 'x' } as const, true],
    [{ kind: 'login_only' } as const, false],
    [{ kind: 'none' } as const, false],
    [{ kind: 'unknown' } as const, false],
  ])('%o ⇒ %s', (s, want) => expect(showsLineChip(s)).toBe(want));
});

// ── 🔴 `line_user_id` 不得離開 server(`20260914040000` 檔頭:那顆 id 不該到瀏覽器)────────────
// 它到 `load-customer-detail.ts` 為止就被換成算好的狀態;元件 props 只吃 `LineStatus`。
// 本格是**字面掃描**:守的是「有人把原始列接回顯示層」那個改動,不是執行期保證。
describe('🔴 LINE 識別碼不進顯示層', () => {
  const read = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

  it('`LineStatus` 的 friend 態只帶時間戳,沒有 id 欄位', () => {
    const src = read('./line-status-view.ts');
    const friend = src.slice(src.indexOf('export type LineStatus'), src.indexOf('/** 讀到的一列'));
    expect(friend).toContain("{ kind: 'friend'; friendAt: string }");
    expect(friend, 'LineStatus 帶上 id ⇒ 那顆識別碼會跟著 props 走').not.toContain('lineUserId');
  });

  /** 剝註解再掃:解釋「那顆 id 不該到這裡」的**註解本身**含那個字面(第一版被自己的註解判紅)。守的是碼。 */
  const codeOf = (rel: string) =>
    read(rel)
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  it('顯示層(customer-detail / customers-table)的【碼】零 `lineUserId` / `line_user_id` 字面', () => {
    for (const rel of ['../../components/customers/customer-detail.tsx', '../../components/customers/customers-table.tsx']) {
      const src = codeOf(rel);
      expect({ [rel]: src.includes('lineUserId') || src.includes('line_user_id') }).toEqual({ [rel]: false });
    }
  });

  it('✅ 負向對照:剝註解沒有把整個檔剝空(不然上一格是恆綠的)', () => {
    expect(codeOf('../../components/customers/customer-detail.tsx')).toContain('lineStatusLabel');
  });

  it('✅ 負向對照:repository 那支【本來就該】出現那個字面(不然上一格是恆綠的)', () => {
    expect(read('./line-status-repository.ts')).toContain('line_user_id');
  });
});
