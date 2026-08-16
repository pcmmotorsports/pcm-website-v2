// customer-list-view.ts — 後台客戶列表「顯示層」純工具(M-4a 客戶管理第一片)。
//
// 客戶專屬:tier 白名單守門 / tier 標籤 / 註冊日期格式化。通用分頁 / param 解析 / 連結建構走 ../shared/list-params。
// 無 server-only / DB / @/;型別 import 自 @pcm/domain(抹除)→ 可單測。

import type { AdminCustomerFilter, MemberTier } from '@pcm/domain';
import { isSyntheticEmailDomain } from '@pcm/schemas';
import { pickEnum, parsePage, buildListHref, type FilterOption } from '../shared/list-params';

/**
 * LINE 用戶沒有真 Email 時,後台 Email 欄的替代字面。
 *
 * 🔴 **逐字沿用 storefront 既有字面、不新造詞**:
 * `apps/storefront/src/components/account/tabs/ProfileTab.tsx:137` 的 `placeholder`
 * (該處 `Q2-1=b` business override)。兩邊講的是同一件事,兩份字面必漂。
 */
export const LINE_NO_EMAIL_LABEL = 'LINE 帳號登入,無 Email';

/**
 * 後台顯示客戶 Email —— **LINE 合成位址不顯示原字串**(Sean 2026-08-16 拍板乙)。
 *
 * 🔴 **為什麼**:LINE 登入時我們自己造一個 `line_{sub}@line.pcmmotorsports.local` 當帳號
 * (`apps/storefront/src/lib/auth/line-admin.ts` 的 `lineSyntheticEmail`),而 trigger 把它**原樣**寫進
 * `customers.email`(`supabase/migrations/20260523034911_init_customers_and_subtables.sql:281-283`
 * 逐字 `VALUES (NEW.id, NEW.email, …)`)⇒ **那幾位客戶的 Email 欄一直在顯示一串內部識別碼**,
 * 對員工零價值,而且它是全表最寬的一欄(64 字元)。
 * ⚠️ storefront 早就藏了(`app/account/page.tsx:58` 逐字「不可顯 UI、避免後端身分識別洩漏」),
 * **admin 側則從來沒有人做過這個決定** —— 本函式就是那個決定。
 *
 * 🔴 **真 Email 拿不到,而且不是「拿錯地方」**:LINE 有給的話會落在
 * `auth.users.raw_user_meta_data.line_email`,**但正式庫 2026-08-16 實查 6 個 key、0 個有值**
 * (LINE 只在 scope 核准 + 用戶同意時才給 —— `apps/storefront/src/lib/auth/line.ts:104` 型別逐字 `string | null`)
 * ⇒ **現在沒有東西可以填**;補投影管線也填不出值,要改得先回頭問 LINE 授權範圍。
 *
 * 🔴 **判斷式共用、不抄第四份**:`isSyntheticEmailDomain` 來自 `@pcm/schemas`,
 * 它的 docstring 逐字寫著 export 的理由就是「**不得再抄第三份**」——
 * 網域字面現在已有三處(`lib/auth/line.ts` / `lib/auth/field-validation.ts` / `packages/schemas`),
 * **admin 不再加第四處**。
 *
 * 🔴 **簽章吃 `string | null`,而 `null` 原樣回傳、不轉成替代字面** ——
 * 兩個呼叫端的 nullability **不一樣**:客戶側 `AdminCustomerSummary.email` 是 `string`
 * (`packages/domain/src/identity/types.ts:56`),而訂單側 `AdminOrderDetail.customer.email`
 * 是 **`string | null`**(`packages/domain/src/order/types.ts:1048`)。
 * ⚠️ **`null` 的意思是「這單沒有客人 email」,不是「這是 LINE 用戶」** —— 兩者必須分得開,
 * 回 `null` 讓呼叫端的 `<Field>` 照既有慣例顯示 `—`。
 * 📎 **我第一版寫死 `string` ⇒ `null.slice()` 當場炸掉 21 格頁級測試**;
 * 那族測試的 fixture 預設就是 `customer: { email: null }` ⇒ **是它擋下來的,不是我先想到的。**
 */
export function customerEmailDisplay(email: string | null): string | null {
  if (email === null) return null;
  return isSyntheticEmailDomain(email) ? LINE_NO_EMAIL_LABEL : email;
}

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
