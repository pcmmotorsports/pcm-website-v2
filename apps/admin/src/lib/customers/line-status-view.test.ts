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
