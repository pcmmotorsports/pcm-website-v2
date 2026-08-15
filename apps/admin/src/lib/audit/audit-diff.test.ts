import { describe, expect, it } from 'vitest';

import { diffAuditPayload } from './audit-diff';

// audit-diff.test.ts — `#27` D1c-2b。
//
// 🔴 **第一格是本檔的主守門**:「沒變的欄不出現」。
//   拿掉那道過濾 ⇒ 展開檢視會把整列資料攤出來,而那正是主視窗那句要防的:
//   **「多餘的東西會讓真正要看的被淹掉」。**

describe('diffAuditPayload — 只回真的變了的欄', () => {
  it('🔴 相同的欄不出現(本檔主守門)', () => {
    const changes = diffAuditPayload(
      { payment_status: 'paid', note: '同一句話' },
      { payment_status: 'refunded', note: '同一句話' },
    );
    expect(changes).toEqual([{ key: 'payment_status', from: 'paid', to: 'refunded' }]);
  });

  it('🔴 兩邊完全相同 ⇒ 空陣列(正向對照:證明上一格不是「永遠只回一筆」)', () => {
    expect(diffAuditPayload({ a: 1, b: 2 }, { a: 1, b: 2 })).toEqual([]);
  });

  it('只有 after(新增)⇒ from = null', () => {
    // 真實來源:`staff-actions.ts:126` 新增員工時 `before` 整個不存在、`after` 是整列。
    expect(diffAuditPayload(null, { id: 'amy', label: '小美' })).toEqual([
      { key: 'id', from: null, to: 'amy' },
      { key: 'label', from: null, to: '小美' },
    ]);
  });

  it('只有 before(刪除)⇒ to = null', () => {
    expect(diffAuditPayload({ id: 'amy' }, null)).toEqual([{ key: 'id', from: 'amy', to: null }]);
  });

  it('欄位存在但值是 null ⇒ 與「欄位不存在」顯示相同(刻意的混同,見檔頭)', () => {
    // 真實來源:`20260804180000:253` 的 `cancelled_at` 明寫 NULL → 後來變成時間。
    expect(diffAuditPayload({ cancelled_at: null }, { cancelled_at: '2026-08-15T01:00:00Z' })).toEqual([
      { key: 'cancelled_at', from: null, to: '2026-08-15T01:00:00Z' },
    ]);
  });

  it('🔴 巢狀物件 ⇒ 一列,不遞迴展開(展開會把真正要看的淹掉)', () => {
    const changes = diffAuditPayload({ addr: { city: '台北' } }, { addr: { city: '新竹' } });
    expect(changes).toHaveLength(1);
    expect(changes[0]?.key).toBe('addr');
    expect(changes[0]?.to).toBe('{"city":"新竹"}');
  });

  it('巢狀物件內容相同 ⇒ 不算變動(比的是值不是參考)', () => {
    // 沒有這一格,把 `sameValue` 改成 `a === b` 也會綠 —— 物件永遠不相等 ⇒ 每一欄都被當成變動。
    expect(diffAuditPayload({ addr: { city: '台北' } }, { addr: { city: '台北' } })).toEqual([]);
  });
});

describe('diffAuditPayload — 非物件輸入不得爆(fail-safe)', () => {
  // 🔴 這一族的存在理由:`before`/`after` 是自由 jsonb,型別擋不住陣列與純量。
  //   **repo 內我沒找到這種寫入端,但「我沒找到」不等於「不存在」。**
  it.each([
    ['兩邊都 null', null, null, []],
    ['兩邊都 undefined', undefined, undefined, []],
    ['純量相同', 5, 5, []],
  ])('%s ⇒ 空陣列', (_name, before, after, expected) => {
    expect(diffAuditPayload(before, after)).toEqual(expected);
  });

  it('純量不同 ⇒ 標成 (整筆),不靜靜顯示成沒有變動', () => {
    expect(diffAuditPayload(5, 6)).toEqual([{ key: '(整筆)', from: '5', to: '6' }]);
  });

  it('陣列 ⇒ 當一個值比,不爆', () => {
    expect(diffAuditPayload([1, 2], [1, 3])).toEqual([
      { key: '(整筆)', from: '[1,2]', to: '[1,3]' },
    ]);
  });

  it('一邊物件、一邊純量 ⇒ 純量側視為沒有任何欄位(顯示成整列被改動,比整個吃掉誠實)', () => {
    expect(diffAuditPayload('壞資料', { a: 1 })).toEqual([{ key: 'a', from: null, to: '1' }]);
  });
});

describe('diffAuditPayload — 欄序穩定', () => {
  it('鍵依字母排序(同一筆紀錄每次打開順序都一樣)', () => {
    // 沒有排序的話,順序跟著 JSON 鍵序走 ⇒ 兩筆內容相同的紀錄可能長得不一樣,
    // 而員工會以為那代表什麼。
    expect(diffAuditPayload({}, { b: 1, a: 1 }).map((c) => c.key)).toEqual(['a', 'b']);
  });
});
