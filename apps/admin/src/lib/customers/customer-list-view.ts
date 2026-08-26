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
import {
  pickEnum,
  parsePage,
  buildListHref,
  firstValue,
  type FilterOption,
} from '../shared/list-params';

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
/* ── 生日兩軸(Sean 2026-08-26 `e:丙`「兩個都要」)──────────────────────────── */

/** URL 參數:生日月份 1-12。 */
export const BIRTH_MONTH_PARAM = 'bmonth';
/** URL 參數:年齡下界(含)。 */
export const AGE_MIN_PARAM = 'agemin';
/** URL 參數:年齡上界(含)。 */
export const AGE_MAX_PARAM = 'agemax';

/** 月份白名單(字串,因為 URL 值都是字串;對齊 tier 那一軸的 `pickEnum` 形狀)。 */
export const BIRTH_MONTH_VALUES: readonly string[] = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
];

/** 月份下拉選項。 */
export const BIRTH_MONTH_OPTIONS: FilterOption[] = BIRTH_MONTH_VALUES.map((v) => ({
  value: v,
  label: `${v} 月`,
}));

/**
 * 年齡的合理範圍守門。**超出一律當「沒填」,不擲錯** —— 對齊同檔 tier 與 sort 的立場:
 * 網址被亂改時「看到全部」比「看到錯誤頁」好。
 *
 * 🔴 上界 130 不是隨便挑的:它要**大到不會誤擋真人**、又**小到擋得住手滑打成年份**
 * (例如把 `1990` 打進年齡欄)。而**擋不住的那一種是打 `85` 當年份** —— 那在值域內。
 */
export const AGE_MIN_ALLOWED = 0;
export const AGE_MAX_ALLOWED = 130;

/** 解析一個年齡值;非數字 / 非整數 / 超出值域 ⇒ `undefined`。 */
export function parseAge(raw: string | string[] | undefined): number | undefined {
  const v = firstValue(raw);
  if (v === undefined || v.trim() === '') return undefined;
  // 🔴 先擋形狀再轉數字(`code-reviewer` R1 nit):只認**十進位數字**。
  //    `Number()` 認得 `0x1E`(=30)、`1e2`(=100)、`0b101`、`0o17`、`+30`、`30.` ——
  //    全部落在值域內 ⇒ `?agemin=0x1E` 會被靜靜當成 30 篩,而輸入框回填也顯示 30。
  //    不可利用(值只餵日期運算), 而它是同一道「擋打錯字」守門的洞。
  if (!/^\d+$/.test(v.trim())) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n)) return undefined;
  if (n < AGE_MIN_ALLOWED || n > AGE_MAX_ALLOWED) return undefined;
  return n;
}

/**
 * 年齡區間 → 生日日期區間。**純函式:`today` 由呼叫端明給,本函式不碰時鐘。**
 *
 * 語意:`ageMin` / `ageMax` 都**含**。「30 到 40 歲」= 今天已滿 30、還沒滿 41。
 * ```
 * 最年輕的那一端(= ageMin)⇒ 生日不得晚於  today - ageMin 年        ⇒ birthdayTo
 * 最年長的那一端(= ageMax)⇒ 生日不得早於  today - (ageMax+1) 年 + 1 天 ⇒ birthdayFrom
 * ```
 * 🔴 **用日期界線,不用天數除以 365** —— 除法遇閏年會漂,而 **2/29 出生的人最先出錯**。
 *
 * ⚠️ **2/29 的邊界本身仍然有一個選擇,而 JS 幫我們選了**:
 * `2000-02-29` 減 1 年在 `Date` 會落到 `1999-03-01`(它把 2/29 正規化到 3/1)。
 * ⇒ 也就是「2/29 出生的人在非閏年,算作 3/1 生日」。**那是一個可辯的口徑,不是唯一解**;
 *   寫在這裡是因為**它現在是被選過的,而不是沒人想過的**。
 *
 * @param today `YYYY-MM-DD`(呼叫端負責用 **Asia/Taipei** 算,見 `todayInTaipei`)
 */
export function birthdayRangeForAges(
  ageMin: number | undefined,
  ageMax: number | undefined,
  today: string,
): { birthdayFrom?: string; birthdayTo?: string } {
  const out: { birthdayFrom?: string; birthdayTo?: string } = {};
  if (ageMin !== undefined) out.birthdayTo = shiftYmd(today, -ageMin, 0);
  if (ageMax !== undefined) out.birthdayFrom = shiftYmd(today, -(ageMax + 1), 1);
  return out;
}

/** `YYYY-MM-DD` 位移 n 年 + d 天,回 `YYYY-MM-DD`。走 UTC 建構,避開本機時區。 */
function shiftYmd(ymd: string, years: number, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  // 🔴 `Date.UTC` 不是裝飾:用 `new Date('2026-08-26')` 之外的建構法會吃進本機時區,
  //    而伺服器與開發機的時區不同 ⇒ 邊界那一天會差一天,而畫面看起來完全正常。
  const t = new Date(Date.UTC(y + years, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/**
 * 今天(Asia/Taipei)的 `YYYY-MM-DD`。
 *
 * 🔴 **只有呼叫端該用它,純函式不該用** —— 它是本檔唯一碰時鐘的地方,
 * 而它存在的理由是:伺服器跑 UTC ⇒ 台灣時間每天 0-8 點,`new Date()` 還在昨天
 * ⇒ 年齡邊界會差一天,而**那一天不會有任何東西紅**。
 */
export function todayInTaipei(now: Date = new Date()): string {
  // ⚠️ **預設參數等於把時鐘留在函式裡**,而同檔 `parseCustomerListSearchParams` 才剛主張
  //    「明給不預設」(`code-reviewer` R1 指出這個形狀不一致)。
  //    🔴 這裡**刻意保留預設值**, 理由是分工不同:**本函式的職責就是「去拿時鐘」** ——
  //    它是那條線的終點, 不是中途站。而純函式收 `today` 是為了讓**中途站不碰時鐘**。
  //    ⇒ 判別句:**一支函式如果名字裡就有「今天」, 它可以有預設;
  //      而一支名字裡沒有時間的函式收到了時間, 那個時間必須是別人給的。**
  // en-CA 給的就是 YYYY-MM-DD(對齊同檔 formatCustomerDate 的既有做法,不新造輪子)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(now);
}

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
export function parseCustomerListSearchParams(
  raw: RawSearchParams,
  /**
   * 今天(`YYYY-MM-DD`,**呼叫端用 `todayInTaipei()` 算**)。
   * 🔴 **明給不預設** —— 給了預設值就等於把時鐘偷渡進純函式, 而那會讓這支變成
   *    「每天跑出不同結果」的東西, 測試也只能跟著寫成「今天」。
   */
  today: string,
): {
  filter: AdminCustomerFilter;
  page: number;
  /** `undefined` = 沒指定 ⇒ 用預設排序(`created_at DESC`),**不是**某個軸的預設方向。 */
  sort: AdminCustomerSort | undefined;
  /** 年齡輸入框的回填值 + 「你打反了」的訊號。 */
  ageInputs: { min?: number; max?: number; swapped: boolean };
} {
  const bm = pickEnum(raw[BIRTH_MONTH_PARAM], BIRTH_MONTH_VALUES);
  const ageMin = parseAge(raw[AGE_MIN_PARAM]);
  const ageMax = parseAge(raw[AGE_MAX_PARAM]);
  // 🔴 上下界寫反(min > max)⇒ **當作沒填, 不是回零筆** ——
  //    回零筆的話畫面上「這個條件沒有人」與「你打反了」長得一樣。
  const swapped = ageMin !== undefined && ageMax !== undefined && ageMin > ageMax;
  const range = swapped
    ? {}
    : birthdayRangeForAges(ageMin, ageMax, today);
  return {
    filter: {
      tier: pickEnum(raw[TIER_PARAM], TIER_VALUES),
      ...(bm === undefined ? {} : { birthMonth: Number(bm) }),
      // 🔴 年齡與日期【一起】設定, 而且只在這裡設定 —— 見 `AdminCustomerFilter.ageMin` 的 docstring。
      //    打反時兩者都不設 ⇒ 網址與查詢一起變成「不限」, 不會一半篩一半不篩。
      ...(swapped || ageMin === undefined ? {} : { ageMin }),
      ...(swapped || ageMax === undefined ? {} : { ageMax }),
      ...range,
    },
    page: parsePage(raw.page),
    sort: parseCustomerSort(raw[SORT_PARAM], raw[DIR_PARAM]),
    /** 原樣回傳給 UI 回填輸入框用(filter 裡存的是換算後的日期, 填不回輸入框)。 */
    // 🔴 打反時**保留使用者打的字**(`code-reviewer` R1 nit):
    //    上一版把兩格清空, 而警告文字叫他「下限比上限大」——
    //    **他低頭一看兩格都是空的** ⇒ 那句話指不到任何東西。
    ageInputs: { min: ageMin, max: ageMax, swapped },
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
/**
 * 🔴🔴 **篩選表單(GET)要原封帶過去的鍵** —— `#743`。
 *
 * **病灶**:`customer-filter-bar.tsx` 是 `<form method='get'>`,而 **GET 表單只送出自己的欄位**。
 * 那張表單原本**只有一個** `tier` ⇒ 員工照「花費」排好序、再改一次會員等級
 * ⇒ **`sort` / `dir` 從網址上消失**。
 *
 * 🔴 **而它不會被回報成 bug**:排序沒了,而欄頭箭頭**也跟著沒了**(箭頭是從網址推的)
 * ⇒ 畫面**自洽** —— 看起來就像「我本來就沒有排序」。
 * ⇒ 員工不會說「排序壞了」,他會**重排一次**。然後下次再重排一次。
 * **沒有人會抱怨,而每個人每天多做一個動作。**
 *
 * 🔴 **為什麼放在本檔而不是在表單裡自己拼**:`SORT_KEY_TO_URL` / `DIR_ASC` / `DIR_DESC`
 *    是 `buildCustomerListHref` 用的**同一份**對照。在表單裡重拼一次 = 這一頁上出現
 *    **第三份鍵清單**,而那正是這個病的產生機制(訂單頁那條 10 天內復發三次:
 *    `#347-3c-1` 08-10 / `#484a` 08-14 / `#742` 08-20)。
 * ⚠️ **本支只解「值怎麼算」那一半**;「表單有沒有把它們渲染出來」那一半靠
 *    `customer-list-view.test.ts` 的鍵集合對照(表單欄位 ∪ 本支的鍵 = builder 的鍵 − `page`)。
 */
export function customerSortHiddenFields(
  sort: AdminCustomerSort | undefined,
): Readonly<Record<string, string>> {
  if (sort === undefined) return {};
  return {
    [SORT_PARAM]: SORT_KEY_TO_URL[sort.key],
    [DIR_PARAM]: sort.ascending ? DIR_ASC : DIR_DESC,
  };
}

export function buildCustomerListHref(
  filter: AdminCustomerFilter,
  page: number,
  sort?: AdminCustomerSort,
): string {
  return buildListHref(
    '/customers',
    [
      [TIER_PARAM, filter.tier],
      // 🔴 生日兩軸也要原封帶過去 —— 少了它們, 翻頁就會把篩選丟掉,
      //    而畫面看起來完全正常(同 `#743` 排序那一格的病)。
      [BIRTH_MONTH_PARAM, filter.birthMonth === undefined ? undefined : String(filter.birthMonth)],
      // ⚠️ 網址帶的是**年齡**不是換算後的日期 —— 日期是衍生值,
      //    而把衍生值放進網址 ⇒ 那條網址明天會篩到不同的人(今天在變)。
      // 🔴 **年齡從 `filter` 讀, 不從額外參數讀**(R1 must-fix):
      //    上一版走第 4 個 optional 參數 ⇒ **三個呼叫點全部忘了傳** ⇒ 翻頁把年齡丟掉。
      //    ⇒ 掛在 filter 上之後, **沒有東西可以忘**。
      [AGE_MIN_PARAM, filter.ageMin === undefined ? undefined : String(filter.ageMin)],
      [AGE_MAX_PARAM, filter.ageMax === undefined ? undefined : String(filter.ageMax)],
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
