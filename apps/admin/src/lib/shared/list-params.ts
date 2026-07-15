// list-params.ts — 後台列表通用純工具(searchParams 解析 + 分頁數學 + 連結建構)。
//
// 訂單 / 客戶等多個 admin 列表頁共用(DRY 單一來源);純函式、無 server-only / DB / @/ → 可單測。

/** 下拉篩選選項(value + 顯示 label);列表 filter bar 共用。 */
export type FilterOption = { value: string; label: string };

/** 取單一字串(searchParams 值可能是 string[];取首個)。 */
export function firstValue(raw: string | string[] | undefined): string | undefined {
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

/** 若 value 在白名單內回該值(narrow 成 enum);否則 undefined(非法忽略、不篩選)。 */
export function pickEnum<T extends string>(
  raw: string | string[] | undefined,
  allowed: readonly T[],
): T | undefined {
  const v = firstValue(raw);
  return v !== undefined && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

/** 取全部值(searchParams 多值 param → string[];缺 → 空陣列)。 */
export function allValues(raw: string | string[] | undefined): string[] {
  if (raw === undefined) return [];
  return Array.isArray(raw) ? raw : [raw];
}

/**
 * 多勾選版白名單守門(D-1b):逐值收白名單命中者、去重、保序;
 * 全非法 / 缺 → undefined(= 不篩,對齊 pickEnum「非法忽略」語意)。
 */
export function pickEnumMulti<T extends string>(
  raw: string | string[] | undefined,
  allowed: readonly T[],
): T[] | undefined {
  const picked: T[] = [];
  for (const v of allValues(raw)) {
    if ((allowed as readonly string[]).includes(v) && !picked.includes(v as T)) {
      picked.push(v as T);
    }
  }
  return picked.length > 0 ? picked : undefined;
}

/** page 解析:正整數、預設 1、下界 1(非法 / 缺 → 1)。 */
export function parsePage(raw: string | string[] | undefined): number {
  const v = firstValue(raw);
  if (v === undefined) return 1;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) return 1;
  return n;
}

export type PaginationView = {
  totalPages: number;
  /** 目前頁 clamp 到 [1, totalPages](顯示「第 X／Y 頁」用) */
  currentPage: number;
  hasPrev: boolean;
  hasNext: boolean;
  /** 本頁第一筆的 1-indexed 序(本頁無列 → 0) */
  rangeStart: number;
  /** 本頁最後一筆的 1-indexed 序(本頁無列 → 0) */
  rangeEnd: number;
};

/**
 * 依 total / 目前頁 / 每頁筆數 / **本頁實際回傳筆數** 算分頁狀態(page 已下界 1)。
 *
 * 🔴 range 由「真實 offset + shownCount」推導(非 clamp 頁的理論範圍)→ footer 顯示永遠與表格一致:
 * URL 竄改成超界頁(如 page=999)時本頁 shownCount=0 → rangeStart/End=0(不謊報「第 21–37 筆」);
 * hasPrev/hasNext 用未 clamp 的 page 判(超界頁 hasNext=false、hasPrev=true 可退回)。total 0 → totalPages 1、range 0。
 */
export function computePagination(
  total: number,
  page: number,
  pageSize: number,
  shownCount: number = 0,
): PaginationView {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const offset = (page - 1) * pageSize;
  const rangeStart = shownCount === 0 ? 0 : offset + 1;
  const rangeEnd = shownCount === 0 ? 0 : offset + shownCount;
  return {
    totalPages,
    currentPage: Math.min(page, totalPages),
    hasPrev: page > 1,
    hasNext: page < totalPages,
    rangeStart,
    rangeEnd,
  };
}

/**
 * 建列表連結 `${path}?...`:只帶有值的鍵(空 / undefined 略)、page=1 省略(乾淨 URL);entries 順序決定 query 順序。
 * 多勾選軸(D-1b)傳 string[] → 同鍵重複 param(`?k=a&k=b`;空陣列略)。
 * (各列表頁傳自己的篩選 entries + page;分頁 prev/next 保留篩選。)
 */
export function buildListHref(
  path: string,
  entries: readonly (readonly [string, string | readonly string[] | undefined])[],
  page: number,
  pageParam: string = 'page',
): string {
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    if (Array.isArray(value)) {
      for (const v of value) if (v) params.append(key, v);
    } else if (value) {
      params.set(key, value as string);
    }
  }
  if (page > 1) params.set(pageParam, String(page));
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}
