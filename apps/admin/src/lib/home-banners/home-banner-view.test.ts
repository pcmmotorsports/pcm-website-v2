import { describe, expect, it } from 'vitest';
import {
  bannerState,
  currentLive,
  filterByTab,
  formatBannerTime,
  gapUntil,
  isoToTaipeiLocal,
  parseTab,
  tabCounts,
  taipeiLocalToIso,
  type HomeBannerRow,
} from './home-banner-view';

const NOW = new Date('2026-09-16T04:00:00Z'); // 台北 12:00

function row(over: Partial<HomeBannerRow>): HomeBannerRow {
  return {
    id: 'x', status: 'draft', eyebrow: null, titleLine1: 't', titleLine2: null, subtitle: null, ctaLabel: null,
    linkPath: '/brands/a', imageDesktopUrl: 'https://x/a.jpg', imageMobileUrl: null, imageKind: 'scene',
    rightsConfirmed: false, rightsNote: null, startsAt: null, endsAt: null, createdBy: 's', updatedBy: 's',
    publishedBy: null, archivedAt: null, updatedAt: '2026-09-16T00:00:00.123456+00:00', ...over,
  };
}

const live = row({ id: 'live', status: 'published', startsAt: '2026-09-10T00:00:00+08:00', endsAt: '2026-09-24T00:00:00+08:00' });
const sched = row({ id: 'sched', status: 'published', startsAt: '2026-09-20T00:00:00+08:00', endsAt: '2026-10-04T00:00:00+08:00' });
const ended = row({ id: 'ended', status: 'published', startsAt: '2026-09-01T00:00:00+08:00', endsAt: '2026-09-05T00:00:00+08:00' });
const draft = row({ id: 'draft' });
const archived = row({ id: 'arch', status: 'archived' });

describe('bannerState / 分頁', () => {
  it('published 依時間拆成 已發布 / 已排程 / 已到期', () => {
    expect(bannerState(live, NOW)).toBe('live');
    expect(bannerState(sched, NOW)).toBe('scheduled');
    expect(bannerState(ended, NOW)).toBe('ended');
    expect(bannerState(draft, NOW)).toBe('draft');
    expect(bannerState(archived, NOW)).toBe('archived');
  });

  it('分頁計數:到期的算進已封存', () => {
    expect(tabCounts([live, sched, ended, draft, archived], NOW)).toEqual({ draft: 1, published: 1, scheduled: 1, archived: 2 });
    expect(filterByTab([live, sched, ended, draft, archived], 'archived', NOW).map((r) => r.id)).toEqual(['ended', 'arch']);
    expect(filterByTab([live, draft], 'all', NOW)).toHaveLength(2);
  });

  it('首頁目前掛的 = 在時間內的那張', () => {
    expect(currentLive([sched, ended, live], NOW)?.id).toBe('live');
    expect(currentLive([sched, ended], NOW)).toBeNull();
  });

  it('網址亂帶 view ⇒ 草稿分頁', () => {
    expect(parseTab('scheduled')).toBe('scheduled');
    expect(parseTab('__proto__')).toBe('draft');
    expect(parseTab(undefined)).toBe('draft');
  });
});

describe('gapUntil(主視窗 09-16 裁乙:下架早於現在那張 ⇒ 提示)', () => {
  it('新圖下架早於現在那張 ⇒ 回現在那張的下架時間', () => {
    expect(gapUntil(live, { id: 'draft', startsAt: '2026-09-18T00:00:00+08:00', endsAt: '2026-09-20T00:00:00+08:00' }, NOW)).toBe(live.endsAt);
  });

  it('下架沒填 ⇒ 預設 14 天,比現在那張晚 ⇒ 不提示', () => {
    expect(gapUntil(live, { id: 'draft', startsAt: null, endsAt: null }, NOW)).toBeNull();
  });

  it('沒有現在那張、或編的就是現在那張 ⇒ 不提示', () => {
    expect(gapUntil(null, { id: 'draft', startsAt: null, endsAt: '2026-09-17T00:00:00+08:00' }, NOW)).toBeNull();
    expect(gapUntil(live, { id: 'live', startsAt: null, endsAt: '2026-09-17T00:00:00+08:00' }, NOW)).toBeNull();
  });
});

describe('台北時間轉換', () => {
  it('datetime-local ⇔ ISO', () => {
    expect(taipeiLocalToIso('2026-09-16T08:30')).toBe('2026-09-16T08:30:00+08:00');
    expect(isoToTaipeiLocal('2026-09-16T00:30:00Z')).toBe('2026-09-16T08:30');
    expect(taipeiLocalToIso('2026-02-31T08:00')).toBeNull();
    expect(taipeiLocalToIso('2026-09-16 08:30')).toBeNull();
  });

  it('短格式', () => {
    expect(formatBannerTime('2026-09-23T16:00:00Z')).toBe('9/24 00:00');
  });
});
