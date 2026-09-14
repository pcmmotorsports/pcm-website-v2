import { describe, expect, it } from 'vitest';
import { canRefetchHctLabelNow, isHctSubmittedToday } from './hct-submitted-today';

describe('isHctSubmittedToday(台北曆面)', () => {
  // 台北 2026-09-14 23:30 = UTC 15:30
  const now = new Date('2026-09-14T15:30:00Z');
  it('同一天(台北)⇒ true, 即使 UTC 已經是不同天', () => {
    // 台北 09-14 00:30 = UTC 09-13 16:30 ⇒ UTC 曆面是昨天, 台北是今天
    expect(isHctSubmittedToday('2026-09-13T16:30:00Z', now)).toBe(true);
  });
  it('台北昨天 ⇒ false(UTC 曆面反而還是同一天 ⇒ 不指定時區會假綠)', () => {
    // 台北 09-13 23:50 = UTC 09-13 15:50;now 的 UTC 也是 09-13 ⇒ 不帶時區會誤判成同一天
    expect(isHctSubmittedToday('2026-09-13T15:50:00Z', new Date('2026-09-13T16:10:00Z'))).toBe(false);
  });
  it('NULL / 壞字串 ⇒ false(不知道哪天送的就不賭)', () => {
    expect(isHctSubmittedToday(null, now)).toBe(false);
    expect(isHctSubmittedToday('not-a-date', now)).toBe(false);
  });
});

describe('canRefetchHctLabelNow(同一天 + 離午夜還有緩衝)', () => {
  const today = '2026-09-14T02:00:00Z'; // 台北 10:00
  it('台北 23:54 ⇒ true;23:55 ⇒ false(緩衝 5 分鐘)', () => {
    expect(canRefetchHctLabelNow(today, new Date('2026-09-14T15:54:00Z'))).toBe(true);
    expect(canRefetchHctLabelNow(today, new Date('2026-09-14T15:55:00Z'))).toBe(false);
  });
  it('不是同一天 ⇒ false, 不管幾點', () => {
    expect(canRefetchHctLabelNow('2026-09-13T02:00:00Z', new Date('2026-09-14T02:00:00Z'))).toBe(false);
  });
});
