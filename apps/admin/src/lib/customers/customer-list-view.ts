// customer-list-view.ts — 後台客戶列表「顯示層」純工具(M-4a 客戶管理第一片)。
//
// 客戶專屬:tier 白名單守門 / tier 標籤 / 註冊日期格式化。通用分頁 / param 解析 / 連結建構走 ../shared/list-params。
// 無 server-only / DB / @/;型別 import 自 @pcm/domain(抹除)→ 可單測。

import type { AdminCustomerFilter, MemberTier } from '@pcm/domain';
import { pickEnum, parsePage, buildListHref, type FilterOption } from '../shared/list-params';

/** 每頁筆數(server 端 .range 分頁)。 */
export const CUSTOMERS_PAGE_SIZE = 20;

/** 查詢字串鍵名。 */
export const TIER_PARAM = 'tier';

/** 值域(對齊 domain MemberTier + DB member_tier enum;解析白名單守門)。 */
export const TIER_VALUES: readonly MemberTier[] = ['general', 'store', 'premiumStore'];

/**
 * 會員等級中文標籤 —— 沿用 design 真權威(storefront TierBadge.tsx L27-31、design TierComponents L31):
 * general '一般會員' / store '店家會員' / premiumStore 'PREMIUM STORE'。**非自創業務詞**。
 * 🔴 tier 是會員等級「標籤」、admin 需知經銷身分;**非價格**(經銷價不在 customers 表、不經此片)。
 */
export const TIER_LABEL: Record<MemberTier, string> = {
  general: '一般會員',
  store: '店家會員',
  premiumStore: 'PREMIUM STORE',
};

export const TIER_OPTIONS: FilterOption[] = TIER_VALUES.map((v) => ({
  value: v,
  label: TIER_LABEL[v],
}));

type RawSearchParams = Record<string, string | string[] | undefined>;

/**
 * 解析 searchParams → { filter(tier 白名單守門), page }。
 * 非法 tier 一律忽略(不篩選);page 下界 1(parsePage 共用)。
 */
export function parseCustomerListSearchParams(raw: RawSearchParams): {
  filter: AdminCustomerFilter;
  page: number;
} {
  return {
    filter: { tier: pickEnum(raw[TIER_PARAM], TIER_VALUES) },
    page: parsePage(raw.page),
  };
}

/** 建 `/customers?...` 連結(分頁 / 篩選保留;page=1 省略);走共用 buildListHref。 */
export function buildCustomerListHref(filter: AdminCustomerFilter, page: number): string {
  return buildListHref('/customers', [[TIER_PARAM, filter.tier]], page);
}

/**
 * formatCustomerDate:ISO timestamptz → `YYYY-MM-DD`(en-CA locale + Asia/Taipei 時區、避 UTC off-by-one)。
 * 對齊訂單側 formatOrderDate 慣例;日期格式化是 1 行、各 view 自持、不強共用。
 */
export function formatCustomerDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
}
