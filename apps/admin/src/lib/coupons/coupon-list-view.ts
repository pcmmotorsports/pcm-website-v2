/**
 * coupon-list-view — 券列表頁的 URL 解析 + 顯示字面(純函式, 無 next / server 依賴)。
 *
 * 形狀逐支對齊 `apps/admin/src/lib/customers/customer-list-view.ts`(387 行)——
 * 那是本 repo 後台列表頁的家法。**不自創。**
 *
 * 🔴 **本檔是【形狀層】** —— 與 `tier-form.ts:1-3` 同一條紀律:
 *    「純函式核心(可單測、無 `'use server'`/next 依賴);authz 在 action 檔;
 *      本檔只做『URL → 查詢參數』形狀層」。**語意權威在 DB(view + 之後那幾支 RPC)。**
 *
 * ⚠️ **型別定義在本檔, 沒有放進 `packages/domain`** —— 那是刻意的:
 *    `AdminCustomerFilter` 住在 domain 是因為客戶是跨 app 的核心概念;
 *    而券的後台列表**目前只有 admin 用得到** ⇒ 放 domain 是替一個還不存在的消費者提前抽象。
 *    ⇒ 之後顧客站那半要用時再抽, 而**那時抽是一次改名, 現在放是一個猜測**。
 */

import { pickEnum, parsePage } from '@/lib/shared/list-params';

/** 一頁幾張券。對齊 `CUSTOMERS_PAGE_SIZE = 20`。 */
export const COUPONS_PAGE_SIZE = 20;

// ── 篩選:狀態 ───────────────────────────────────────────────────────────
//
// 🔴🔴 **這一軸現在篩的是 `is_active`(行政旗標), 不是「客人現在能不能用」。**
//    spec `2026-08-26-coupon-admin-crud-spec.md` §3-1 逐字寫的就是這三個選項。
//
// ⚠️ **而 Sean 2026-08-29 `Q1 = 甲`(狀態欄顯示【自己算出來的狀態】)之後,
//    這一軸【應該要跟著改】** —— 否則會出現:
//      一張 badge 寫著「已過期」的券, 被篩進「啟用中」⇒ **畫面自己打架。**
// 🛑 **而怎麼改, 卡在 `#963`(那一組原因畫面上長什麼樣, Sean 未拍)。**
//    ⇒ **所以本片【不動這一軸】, 照 spec 的三個選項做完** ——
//      而不是照一個還沒有答案的設計去猜。
//    ⇒ `#963` 答了之後, 這一段與 `coupons-table` 那一欄要**同一片一起改**。

export const STATUS_PARAM = 'status';

/** 網址值白名單。`all` 不進 filter(= 不篩), 留著是為了讓「全部」這顆按鈕有一個 URL。 */
export const STATUS_VALUES = ['all', 'active', 'inactive'] as const;
export type CouponStatusParam = (typeof STATUS_VALUES)[number];

export const STATUS_LABEL: Record<CouponStatusParam, string> = {
  all: '全部',
  active: '啟用中',
  inactive: '已停用',
};

// ── 排序 ────────────────────────────────────────────────────────────────
//
// spec §3-1 逐字:「排序:結束日 · 已用次數(照 customer-list-view 的 SORT_PARAM 白名單紀律)」。

export const SORT_PARAM = 'sort';
export const DIR_PARAM = 'dir';

/** domain 側的排序鍵(camel);網址側是 snake。 */
export const COUPON_SORT_KEYS = ['endsOn', 'usedCount'] as const;
export type CouponSortKey = (typeof COUPON_SORT_KEYS)[number];

/**
 * 網址值 → 排序鍵。
 *
 * 🔴 **網址用 snake、domain 用 camel, 而這裡是唯一的對照表**(逐字照 customers 那支的理由)——
 *    兩邊各自定義一份的話, 改一邊就會出現「網址寫著 `used_count` 而它照結束日排」,
 *    **而畫面看起來完全正常**。
 */
const SORT_URL_TO_KEY: Record<string, CouponSortKey> = {
  ends_on: 'endsOn',
  used_count: 'usedCount',
};
const SORT_KEY_TO_URL: Record<CouponSortKey, string> = {
  endsOn: 'ends_on',
  usedCount: 'used_count',
};

const DIR_ASC = 'asc';
const DIR_DESC = 'desc';

/**
 * 各軸**點下去第一次**的方向。
 *
 * 🔴 兩軸的預設【不同】, 而那不是不一致:
 *    · `used_count` 降冪 —— 員工點「已用次數」想看的是**最會被用的那幾張**
 *    · `ends_on`   升冪 —— 點「結束日」想看的是**快到期的那幾張**
 *    📌 兩軸都給降冪的話, 結束日那一軸第一次點會把「最晚到期」放最前面 ——
 *       而那是最不急的那些。
 * ⚠️ 而 `ends_on` 可為 NULL(不設結束日)⇒ **NULLS LAST 由 repository 那一層處理**, 不在這裡
 *    (與 customers 那支把 `nullsFirst: false` 放在 adapter 同一個分工)。
 */
const DEFAULT_ASCENDING: Record<CouponSortKey, boolean> = {
  endsOn: true,
  usedCount: false,
};

export type CouponSort = { readonly key: CouponSortKey; readonly ascending: boolean };

/** 篩選(value-object;缺 = 不限)。 */
export type CouponFilter = { readonly isActive?: boolean };

type RawSearchParams = Record<string, string | string[] | undefined>;

/**
 * 解析 searchParams → { filter, page, sort }。
 *
 * · 非法 `status` 一律忽略(不篩選)—— 對齊 `pickEnum` 的「非法忽略」語意
 * · `page` 下界 1(`parsePage` 共用)
 * · `sort` 不在白名單 ⇒ `undefined` = **用預設排序(建立時間 DESC), 不是某個軸的預設方向**
 */
export function parseCouponListSearchParams(raw: RawSearchParams): {
  filter: CouponFilter;
  page: number;
  sort: CouponSort | undefined;
  /** 回填篩選列用(含 `all`);與 `filter` 分開 —— 前者是畫面狀態, 後者是查詢條件。 */
  statusParam: CouponStatusParam;
} {
  const status = pickEnum(raw[STATUS_PARAM], STATUS_VALUES) ?? 'all';

  const sortKey = SORT_URL_TO_KEY[String(raw[SORT_PARAM] ?? '')];
  const dirRaw = String(raw[DIR_PARAM] ?? '');
  const sort: CouponSort | undefined =
    sortKey === undefined
      ? undefined
      : {
          key: sortKey,
          // `asc` / `desc` 以外一律當沒指定 ⇒ 落到該軸的預設方向
          ascending:
            dirRaw === DIR_ASC ? true : dirRaw === DIR_DESC ? false : DEFAULT_ASCENDING[sortKey],
        };

  return {
    filter: status === 'all' ? {} : { isActive: status === 'active' },
    page: parsePage(raw.page),
    sort,
    statusParam: status,
  };
}

/** 排序鍵 → 網址值(欄頭連結用)。白名單外回 `undefined` ⇒ 呼叫端不產連結。 */
export function sortKeyToUrl(key: CouponSortKey): string {
  return SORT_KEY_TO_URL[key];
}

/**
 * 欄頭點下去要跳的下一個方向。
 *
 * 🔴 **同一軸再點一次 ⇒ 反向;換一軸 ⇒ 回該軸的預設方向**(不是沿用上一軸的方向)。
 *    沿用的話會出現「我從『已用次數(多→少)』點到『結束日』, 而它給我最晚到期的」。
 */
export function nextSortDir(current: CouponSort | undefined, key: CouponSortKey): string {
  if (current?.key === key) return current.ascending ? DIR_DESC : DIR_ASC;
  return DEFAULT_ASCENDING[key] ? DIR_ASC : DIR_DESC;
}

// ── 顯示字面 ────────────────────────────────────────────────────────────

/**
 * 折抵的顯示。
 *
 * 🔴 **不能一律用金額格式** —— 券有 `fixed` 與 `percent` 兩種,
 *    而 `10%` 用金額格式會被印成 `NT$10`。(關卡2 must-fix, 2026-08-29。)
 */
export function couponDiscountDisplay(type: string, value: number): string {
  return type === 'percent' ? `${value}%` : `NT$ ${value.toLocaleString('en-US')}`;
}

/**
 * 「已用 / 總量」的顯示。
 *
 * 🔴 `max_redemptions` 為 NULL = **不限**, 而它**不得留白** ——
 *    留白在畫面上與【載入失敗】長得一模一樣
 *    (`customers-table.tsx:157-159` 逐字, 本檔照它)。
 */
export function couponUsageDisplay(used: number, max: number | null): string {
  return max === null ? `${used} / 不限` : `${used} / ${max}`;
}

/** 結束日:NULL = 不設 ⇒ 顯示「不限期」, 同樣不得留白。 */
export function couponEndsOnDisplay(endsOn: string | null): string {
  return endsOn === null ? '不限期' : endsOn;
}

/**
 * ⏸️ **佔位:券這一層「擋住的理由」怎麼顯示。**
 *
 * 🛑🛑 **本函式是【刻意做得醜的佔位】, 不是定案。**
 *    一個好看的佔位會被當成定案, 而這一格 **Sean 沒有拍過**(`#963`)。
 *
 * 資料層已經回一組原因(`admin_coupon_list_blocks_v.coupon_level_blocks`,`text[]`,
 * 值域 `disabled` / `expired` / `exhausted`;空陣列 = 券這一層沒有擋住的理由)。
 *
 * ⚠️ **空陣列這裡【故意不寫「可用」】** —— 那超出那個值答得出的範圍:
 *    它答不出 `max_per_account` / `min_spend` / `stacks_with_tier`(要客人 + 購物車才算得出來)。
 *    ⇒ 空陣列顯示什麼字, 同屬 `#963`, Sean 未拍 ⇒ 這裡回 `'—'`。
 *
 * 🔴 **而畫面上那一組長什麼樣(三顆標籤? 「已停用 +2」? hover 看全部?)也在 `#963`** ——
 *    家法:品味題**要給實體版本, 不給文字選項** ⇒ 而現在沒有實體版本可以給他
 *    ⇒ **所以這裡先用頓號串起來, 等 2b-2 有畫面之後由 Design session 產 demo 再問。**
 */
export const BLOCK_LABEL: Record<string, string> = {
  disabled: '已停用',
  expired: '已過期',
  exhausted: '已用完',
};

export function couponBlocksPlaceholder(blocks: readonly string[]): string {
  if (blocks.length === 0) return '—';
  return blocks.map((b) => BLOCK_LABEL[b] ?? b).join('、');
}
