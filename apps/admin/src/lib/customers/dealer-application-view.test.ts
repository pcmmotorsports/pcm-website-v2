import { describe, expect, it } from 'vitest';
import {
  DEALER_APP_STATUS_LABEL,
  parseDealerAppStatusFilter,
  dealerAppListHref,
} from './dealer-application-view';

// B2B 計畫 §9.5 後台「經銷商申請」列表(片 D1)。
describe('經銷商申請列表的顯示規則', () => {
  it('三種狀態的名稱', () => {
    expect(DEALER_APP_STATUS_LABEL).toEqual({ pending: '審核中', approved: '已核准', rejected: '已婉拒' });
  });

  it('預設只看「審核中」;不認得的值也回審核中', () => {
    expect(parseDealerAppStatusFilter(undefined)).toBe('pending');
    expect(parseDealerAppStatusFilter('abc')).toBe('pending');
    expect(parseDealerAppStatusFilter(['approved'])).toBe('approved');
    expect(parseDealerAppStatusFilter('all')).toBe('all');
  });

  it('篩選連結:審核中是預設, 不帶參數', () => {
    expect(dealerAppListHref('pending')).toBe('/customers/dealer-applications');
    expect(dealerAppListHref('rejected')).toBe('/customers/dealer-applications?status=rejected');
  });
});
