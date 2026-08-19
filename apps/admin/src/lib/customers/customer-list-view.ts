// customer-list-view.ts — 後台客戶列表「顯示層」純工具(M-4a 客戶管理第一片)。
//
// 客戶專屬:tier 白名單守門 / tier 標籤 / 註冊日期格式化。通用分頁 / param 解析 / 連結建構走 ../shared/list-params。
// 無 server-only / DB / @/;型別 import 自 @pcm/domain(抹除)→ 可單測。

import type {
  AdminCustomerFilter,
  AdminCustomerSort,
  AdminCustomerSortKey,
  MemberTier,
} from '@pcm/domain';
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

// ─────────────── 排序(2026-08-19;plan 已批,主視窗裁「這不是決策題」)───────────────

/** 網址上的排序參數名。**值走白名單,不是裸字串**(同 `tier` 那一軸的紀律)。 */
export const SORT_PARAM = 'sort';
export const DIR_PARAM = 'dir';

/**
 * 網址值 → domain 的排序鍵。
 *
 * 🔴 **網址用 snake、domain 用 camel,而這裡是唯一的對照表** ——
 *    兩邊各自定義一份的話,改一邊就會出現「網址寫著 last_order 而它照 created_at 排」,
 *    **而畫面看起來完全正常**。
 */
const SORT_URL_TO_KEY: Record<string, AdminCustomerSortKey> = {
  spend: 'spend',
  orders: 'orders',
  last_order: 'lastOrder',
};
const SORT_KEY_TO_URL: Record<AdminCustomerSortKey, string> = {
  spend: 'spend',
  orders: 'orders',
  lastOrder: 'last_order',
};

/** `asc` / `desc` 以外一律當沒指定 ⇒ 落到該軸的預設方向。 */
const DIR_ASC = 'asc';
const DIR_DESC = 'desc';

/**
 * 各軸**點下去第一次**的方向。
 *
 * 🔴 三軸都預設**降冪**,而那不是偷懶:員工點「消費金額」想看的是**最會買的那幾位**,
 *    點「最後下單」想看的是**最近有動靜的**。**升冪是第二次點才要的東西。**
 * ⚠️ 而「最後下單」降冪正是 NULL 那個坑會發作的方向 ——
 *    處理在 `SupabaseCustomerAdapter`(`nullsFirst: false`),不在這裡。
 */
const DEFAULT_ASCENDING = false;

type RawSearchParams = Record<string, string | string[] | undefined>;

/**
 * 解析 searchParams → { filter(tier 白名單守門), page }。
 * 非法 tier 一律忽略(不篩選);page 下界 1(parsePage 共用)。
 */
export function parseCustomerListSearchParams(raw: RawSearchParams): {
  filter: AdminCustomerFilter;
  page: number;
  /** `undefined` = 沒指定 ⇒ 用預設排序(`created_at DESC`),**不是**某個軸的預設方向。 */
  sort: AdminCustomerSort | undefined;
} {
  return {
    filter: { tier: pickEnum(raw[TIER_PARAM], TIER_VALUES) },
    page: parsePage(raw.page),
    sort: parseCustomerSort(raw[SORT_PARAM], raw[DIR_PARAM]),
  };
}

/**
 * 排序參數解析。**認不得的值一律回 `undefined`(= 用預設排序),不擲錯**
 * —— 對齊同檔 `tier` 那一軸的立場:網址被亂改時「看到預設」比「看到錯誤頁」好。
 */
export function parseCustomerSort(
  rawSort: string | string[] | undefined,
  rawDir: string | string[] | undefined,
): AdminCustomerSort | undefined {
  // 🔴 `string[]` = 同名參數送了兩份 ⇒ 一律當沒指定。
  //    (不取第一個:那會讓 `?sort=spend&sort=orders` 靜靜地只套一個,而網址說了兩件事。)
  if (typeof rawSort !== 'string') return undefined;
  const key = SORT_URL_TO_KEY[rawSort];
  if (key === undefined) return undefined;
  const dir = typeof rawDir === 'string' ? rawDir : undefined;
  return {
    key,
    ascending: dir === DIR_ASC ? true : dir === DIR_DESC ? false : DEFAULT_ASCENDING,
  };
}

/**
 * 某一欄的欄頭連結要指去哪:**已經在這一軸 ⇒ 反向;不在 ⇒ 用該軸的預設方向。**
 * 🔴 回傳的 href **一律 page=1**(邊界⑤):排序換了而還停在第 3 頁,
 *    看到的是「新排序的第 3 頁」,而員工以為那是前段。
 */
export function buildCustomerSortHref(
  filter: AdminCustomerFilter,
  current: AdminCustomerSort | undefined,
  key: AdminCustomerSortKey,
): string {
  const ascending = current?.key === key ? !current.ascending : DEFAULT_ASCENDING;
  return buildCustomerListHref(filter, 1, { key, ascending });
}

/**
 * 建 `/customers?...` 連結(分頁 / 篩選 / 排序保留;page=1 省略);走共用 `buildListHref`。
 *
 * 🔴🔴 **這支永遠不得帶上關鍵字,而那不是「小心」是【守門】**(`#525`):
 *    客戶搜尋詞是**姓名 / Email / 電話** ⇒ 它走 httpOnly cookie、**刻意不進 URL**
 *    (`keyword-search-action.ts`、`customer-keyword-cookie.ts`)。
 *    而排序參數進 URL **會誘使下一個人順手把搜尋詞也帶上** ——
 *    訂單頁那些 builder 正是那樣寫的 ⇒ **他不是會不小心,他是會照既有做法做。**
 *    ⇒ 一格測試斷言本函式的輸出**永遠不含**那個欄位名;負對照 = 硬塞進去要紅。
 * 📌 而它不必帶也不會掉:cookie 是瀏覽器自己送的,換頁 / 換排序都還在。
 */
export function buildCustomerListHref(
  filter: AdminCustomerFilter,
  page: number,
  sort?: AdminCustomerSort,
): string {
  return buildListHref(
    '/customers',
    [
      [TIER_PARAM, filter.tier],
      [SORT_PARAM, sort === undefined ? undefined : SORT_KEY_TO_URL[sort.key]],
      // 🔴 方向**明寫**、不省略 —— 省略的話「降冪」與「沒指定」在網址上長得一樣,
      //    而它們今天恰好同義。哪天預設方向改了,那條網址會靜靜地變成另一個意思。
      [DIR_PARAM, sort === undefined ? undefined : sort.ascending ? DIR_ASC : DIR_DESC],
    ],
    page,
  );
}

/**
 * formatCustomerDate:ISO timestamptz → `YYYY-MM-DD`(en-CA locale + Asia/Taipei 時區、避 UTC off-by-one)。
 * 對齊訂單側 formatOrderDate 慣例;日期格式化是 1 行、各 view 自持、不強共用。
 */
export function formatCustomerDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
}
