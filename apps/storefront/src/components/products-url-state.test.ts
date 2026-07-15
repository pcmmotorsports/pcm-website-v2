// products-url-state 純函式單測 — V-1a:parseCategoryFromUrl #212 兩層還原缺口修復。
// (hooks 半邊由 dev 實跑+既有頁面測覆蓋;本檔只測 parse 純函式、node env 免 jsdom。)

import { describe, it, expect } from 'vitest';
import { parseCategoryFromUrl } from './products-url-state';

const CATS = [
  { id: 'ride', name: '操控部品', children: [{ id: 'ride-step', name: '腳踏後移與傳動' }] },
  { id: 'carbon', name: '碳纖維', children: [] },
];

const sp = (v: string | null) => ({ get: () => v });

describe('parseCategoryFromUrl — #212 兩層(V-1a)', () => {
  it('單層大類名/防禦性 id → 只還原大類', () => {
    expect(parseCategoryFromUrl(sp('操控部品'), CATS)).toEqual({ mainId: 'ride', main: '操控部品' });
    expect(parseCategoryFromUrl(sp('ride'), CATS)).toEqual({ mainId: 'ride', main: '操控部品' });
  });

  it('兩層「大類 · 子類」→ 還原大類+子類(修:選子類回程分類整個丟)', () => {
    expect(parseCategoryFromUrl(sp('操控部品 · 腳踏後移與傳動'), CATS)).toEqual({
      mainId: 'ride',
      main: '操控部品',
      subId: 'ride-step',
      sub: '腳踏後移與傳動',
    });
  });

  it('子類查無 → 保守只還原大類;大類查無 → null fail-safe', () => {
    expect(parseCategoryFromUrl(sp('操控部品 · 不存在的子類'), CATS)).toEqual({
      mainId: 'ride',
      main: '操控部品',
    });
    expect(parseCategoryFromUrl(sp('不存在 · 腳踏後移與傳動'), CATS)).toBeNull();
    expect(parseCategoryFromUrl(sp('不存在'), CATS)).toBeNull();
  });

  it('大類名本身含分隔符 → 全字串 exact match 優先(病態防護)', () => {
    const weird = [{ id: 'w', name: '甲 · 乙', children: [] }];
    expect(parseCategoryFromUrl(sp('甲 · 乙'), weird)).toEqual({ mainId: 'w', main: '甲 · 乙' });
  });

  it('缺 param → null;children 缺欄(單層舊清單)不炸', () => {
    expect(parseCategoryFromUrl(sp(null), CATS)).toBeNull();
    expect(
      parseCategoryFromUrl(sp('碳纖維 · 任意'), [{ id: 'carbon', name: '碳纖維' }]),
    ).toEqual({ mainId: 'carbon', main: '碳纖維' });
  });
});
