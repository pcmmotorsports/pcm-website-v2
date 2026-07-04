// rpm-load.test.ts — #260 partitionByKeyPresence(保留現值:省 key 列不被混批寫 NULL)
//
// 背景:postgrest-js `.upsert(陣列)` 的 `?columns` 取全批 key 聯集 + defaultToNull=true →
//   同批混「有 description / 省 description key」→ 省 key 列被寫 NULL(非保留現值)。
//   partitionByKeyPresence 把兩者分兩 uniform 批,呼叫端各自 upsert → 省 key 落「該批 columns 不含此 key」批 → 保留現值。

import { describe, it, expect } from 'vitest';
import { partitionByKeyPresence } from './rpm-load';

describe('#260 partitionByKeyPresence(description key-signature 分批)', () => {
  it('混批 → 分「有 key」與「省 key」兩組(依原順序)', () => {
    const rows = [
      { external_id: 'A', description: 'x' },
      { external_id: 'B' }, // 省 key
      { external_id: 'C', description: 'y' },
    ];
    const { withKey, withoutKey } = partitionByKeyPresence(rows, 'description');
    expect(withKey.map((r) => r.external_id)).toEqual(['A', 'C']);
    expect(withoutKey.map((r) => r.external_id)).toEqual(['B']);
  });

  it('🔴 rpm 情境:全批省 description → withKey 空(現行單批 byte 等價)', () => {
    const rpm = [{ external_id: 'R1' }, { external_id: 'R2' }];
    const { withKey, withoutKey } = partitionByKeyPresence(rpm, 'description');
    expect(withKey).toEqual([]);
    expect(withoutKey).toHaveLength(2);
  });

  it('全批有 description → withoutKey 空', () => {
    const { withKey, withoutKey } = partitionByKeyPresence([{ description: 'a' }, { description: 'b' }], 'description');
    expect(withKey).toHaveLength(2);
    expect(withoutKey).toEqual([]);
  });

  it('顯式帶 undefined ≠ 省 key(Object.hasOwn 語意:key 存在即算「有」)', () => {
    // transform 是「省 key」而非「帶 undefined」;此測釘死 hasOwn 語意、防未來改成帶 undefined 靜默破功
    const { withKey, withoutKey } = partitionByKeyPresence([{ description: undefined }, {}], 'description');
    expect(withKey).toHaveLength(1); // 顯式 undefined key 算存在
    expect(withoutKey).toHaveLength(1); // 真省 key
  });

  it('不吃原型鏈成員(Object.hasOwn、非 `in`)', () => {
    const row = Object.create({ description: 'inherited' }) as { description?: string };
    const { withKey, withoutKey } = partitionByKeyPresence([row], 'description');
    expect(withKey).toEqual([]); // 繼承的 description 不算 own key
    expect(withoutKey).toHaveLength(1);
  });
});
