/**
 * coupon-list-view 的守門。
 *
 * 🔴 **每一格都演兩個世界** —— 一個「該這樣」配一個「不該那樣」;
 *    只有正向的那半, 證不出這支在判別什麼(本 repo 反覆記過的那族)。
 */
import { describe, expect, it } from 'vitest';

import {
  COUPONS_PAGE_SIZE,
  STATUS_VALUES,
  couponBlocksPlaceholder,
  couponDiscountDisplay,
  couponEndsOnDisplay,
  couponUsageDisplay,
  nextSortDir,
  parseCouponListSearchParams,
  sortKeyToUrl,
} from './coupon-list-view';

describe('parseCouponListSearchParams — 篩選', () => {
  it('沒帶 status ⇒ 不篩（filter 空），而畫面狀態是 all', () => {
    const r = parseCouponListSearchParams({});
    expect(r.filter).toEqual({});
    expect(r.statusParam).toBe('all');
  });

  it('active / inactive ⇒ 各自篩到 isActive 的兩個值', () => {
    expect(parseCouponListSearchParams({ status: 'active' }).filter).toEqual({ isActive: true });
    expect(parseCouponListSearchParams({ status: 'inactive' }).filter).toEqual({ isActive: false });
  });

  it('🔴 非法 status ⇒ 忽略（不篩），不是回零筆', () => {
    // 回零筆的話，畫面上「這個條件沒有券」與「你打錯字了」長得一樣。
    const r = parseCouponListSearchParams({ status: 'zzz-not-a-status' });
    expect(r.filter).toEqual({});
    expect(r.statusParam).toBe('all');
  });

  it('白名單就是那三個值（負對照：現造一個不在裡面）', () => {
    expect([...STATUS_VALUES]).toEqual(['all', 'active', 'inactive']);
    expect((STATUS_VALUES as readonly string[]).includes('zzzfake')).toBe(false);
  });
});

describe('parseCouponListSearchParams — 排序白名單', () => {
  it('白名單內的兩軸 ⇒ 解析得到', () => {
    expect(parseCouponListSearchParams({ sort: 'ends_on' }).sort?.key).toBe('endsOn');
    expect(parseCouponListSearchParams({ sort: 'used_count' }).sort?.key).toBe('usedCount');
  });

  it('🔴 白名單外 ⇒ undefined（= 用預設排序），不是硬塞一個軸', () => {
    expect(parseCouponListSearchParams({ sort: 'code' }).sort).toBeUndefined();
    expect(parseCouponListSearchParams({ sort: 'created_at; drop table' }).sort).toBeUndefined();
  });

  it('🔴 兩軸的預設方向【不同】—— 而那正是這一格存在的理由', () => {
    // 結束日：快到期的先看 ⇒ 升冪
    expect(parseCouponListSearchParams({ sort: 'ends_on' }).sort?.ascending).toBe(true);
    // 已用次數：最會被用的先看 ⇒ 降冪
    expect(parseCouponListSearchParams({ sort: 'used_count' }).sort?.ascending).toBe(false);
  });

  it('dir 明給 ⇒ 蓋掉預設；dir 亂給 ⇒ 落回該軸預設（不是落回某個固定值）', () => {
    expect(parseCouponListSearchParams({ sort: 'ends_on', dir: 'desc' }).sort?.ascending).toBe(false);
    expect(parseCouponListSearchParams({ sort: 'used_count', dir: 'asc' }).sort?.ascending).toBe(true);
    expect(parseCouponListSearchParams({ sort: 'ends_on', dir: 'zzz' }).sort?.ascending).toBe(true);
    expect(parseCouponListSearchParams({ sort: 'used_count', dir: 'zzz' }).sort?.ascending).toBe(false);
  });

  it('sortKeyToUrl 與解析是同一張表的兩個方向（改一邊就會對不起來）', () => {
    expect(sortKeyToUrl('endsOn')).toBe('ends_on');
    expect(sortKeyToUrl('usedCount')).toBe('used_count');
    expect(parseCouponListSearchParams({ sort: sortKeyToUrl('endsOn') }).sort?.key).toBe('endsOn');
  });
});

describe('nextSortDir — 換軸不沿用上一軸的方向', () => {
  it('同一軸再點 ⇒ 反向', () => {
    expect(nextSortDir({ key: 'endsOn', ascending: true }, 'endsOn')).toBe('desc');
    expect(nextSortDir({ key: 'endsOn', ascending: false }, 'endsOn')).toBe('asc');
  });

  it('🔴 換一軸 ⇒ 回【那一軸的】預設，不是沿用', () => {
    // 從「已用次數(多→少)」點到「結束日」⇒ 要給快到期的，不是最晚到期的
    expect(nextSortDir({ key: 'usedCount', ascending: false }, 'endsOn')).toBe('asc');
    expect(nextSortDir({ key: 'endsOn', ascending: true }, 'usedCount')).toBe('desc');
  });

  it('沒有目前排序 ⇒ 也是該軸預設', () => {
    expect(nextSortDir(undefined, 'endsOn')).toBe('asc');
    expect(nextSortDir(undefined, 'usedCount')).toBe('desc');
  });
});

describe('page', () => {
  it('缺 / 非法 / 下界 ⇒ 1；合法 ⇒ 原值', () => {
    expect(parseCouponListSearchParams({}).page).toBe(1);
    expect(parseCouponListSearchParams({ page: '0' }).page).toBe(1);
    expect(parseCouponListSearchParams({ page: '-3' }).page).toBe(1);
    expect(parseCouponListSearchParams({ page: 'zzz' }).page).toBe(1);
    expect(parseCouponListSearchParams({ page: '4' }).page).toBe(4);
  });

  it('一頁 20 張（與 customers 同值）', () => {
    expect(COUPONS_PAGE_SIZE).toBe(20);
  });
});

describe('顯示字面 — 兩種折抵不能共用一個格式', () => {
  it('🔴 percent 不得被印成金額（關卡2 must-fix 的那一格）', () => {
    expect(couponDiscountDisplay('percent', 10)).toBe('10%');
    expect(couponDiscountDisplay('percent', 10)).not.toContain('NT$');
  });

  it('fixed 印金額，帶千分位', () => {
    expect(couponDiscountDisplay('fixed', 1500)).toBe('NT$ 1,500');
  });
});

describe('NULL 一律不留白 — 留白與載入失敗長得一樣', () => {
  it('總量 NULL ⇒「不限」，不是空字串', () => {
    expect(couponUsageDisplay(3, null)).toBe('3 / 不限');
    expect(couponUsageDisplay(3, null)).not.toBe('3 / ');
  });

  it('總量有值 ⇒ N / M', () => {
    expect(couponUsageDisplay(3, 10)).toBe('3 / 10');
  });

  it('結束日 NULL ⇒「不限期」，不是空字串', () => {
    expect(couponEndsOnDisplay(null)).toBe('不限期');
    expect(couponEndsOnDisplay(null)).not.toBe('');
    expect(couponEndsOnDisplay('2026-09-30')).toBe('2026-09-30');
  });
});

describe('⏸️ 擋住的理由 —— 這是佔位，不是定案（#963）', () => {
  it('一組原因 ⇒ 頓號串起來（而那正是「醜得看得出來是佔位」的形狀）', () => {
    expect(couponBlocksPlaceholder(['disabled', 'expired'])).toBe('已停用、已過期');
    expect(couponBlocksPlaceholder(['exhausted'])).toBe('已用完');
  });

  it('🔴 空陣列【不得】顯示「可用」—— 那超出資料答得出的範圍', () => {
    // 它答不出 max_per_account / min_spend / stacks_with_tier（要客人 + 購物車）
    const s = couponBlocksPlaceholder([]);
    expect(s).toBe('—');
    expect(s).not.toContain('可用');
  });

  it('未知的原因值 ⇒ 原樣印出來，不是吞掉', () => {
    // 吞掉的話，DB 加了第四種原因時畫面會少一格而不會有東西紅
    expect(couponBlocksPlaceholder(['zzz_new_reason'])).toBe('zzz_new_reason');
  });
});
