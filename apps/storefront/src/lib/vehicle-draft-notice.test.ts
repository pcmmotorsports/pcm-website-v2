// @vitest-environment node
//
// vehicle-draft-notice.test.ts — 三出口共用文案的純函式測試(Sean 2026-08-07 Q22=A)。

import { describe, expect, it } from 'vitest';
import { formatSkippedDraftNotice, type VehicleDraftTexts } from '@/lib/vehicle-draft-notice';

describe('formatSkippedDraftNotice', () => {
  it('零草稿回 null', () => {
    expect(formatSkippedDraftNotice({})).toBeNull();
  });

  it('只有車型', () => {
    expect(formatSkippedDraftNotice({ model: 'MT-0' })).toBe('「MT-0」沒有對應到車型，已略過');
  });

  it('車型 + 年份,順序照 brand→model→year 不是物件鍵序', () => {
    // 刻意把鍵序顛倒(year 寫在 model 前面),證明輸出順序不是抄物件鍵序。
    const drafts: VehicleDraftTexts = { year: '202', model: 'MT-0' };
    expect(formatSkippedDraftNotice(drafts)).toBe(
      '「MT-0」沒有對應到車型、「202」沒有對應到年份，已略過',
    );
  });

  it('全空白字串視同沒有草稿', () => {
    expect(formatSkippedDraftNotice({ brand: '   ' })).toBeNull();
  });

  it('前後空白會被 trim', () => {
    expect(formatSkippedDraftNotice({ model: ' MT-0 ' })).toBe(
      '「MT-0」沒有對應到車型，已略過',
    );
  });
});
