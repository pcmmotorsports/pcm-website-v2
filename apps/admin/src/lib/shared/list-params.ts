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

// ─────────────── 商品分頁片(2026-08-19,plan = docs/specs/2026-08-19-admin-products-pagination-plan.md)

/**
 * 這一頁**少給了幾列**(`null` = 這一頁是完整的)。
 *
 * 🔴🔴 **本函式存在的理由 = 分頁準則 1 的替代品,而它比準則 1 強。**
 *
 * 準則 1(`docs/patterns/pagination-loop-review.md` §1)要求「頁大小嚴格小於 `db-max-rows`」,
 * 而**那個上限是 Supabase Dashboard 上點一下就能改的專案設定** —— 同段逐字:
 * 「**餘裕是【設定給的】,不是程式保證的** … 而**不會有任何東西紅**:檔沒改、測試沒紅、`grep` 數不變」。
 * ⇒ 任何寫死那個數字的守門,都會在它被改小的那天**安靜地失效**。
 *
 * **本函式不問上限是多少。** 它問的是:
 *
 *     這一頁【應該】有幾列?  expected = min(pageSize, max(0, total - offset))
 *     它【實際】有幾列?      shownCount
 *     差多少?               missing = expected - shownCount
 *
 * 🔴 **這個減法成立的前提只有一個,而它成立**:`count: 'exact'` 的 `total` 與這一頁的列
 *    **來自同一次 PostgREST 請求**(`content-range` 與 body 同一個 response)
 *    ⇒ 兩個數字必定是同一時刻的快照 ⇒ **沒有 TOCTOU**、不受「翻頁期間有人寫」影響。
 *    (若哪天改成「先查 count、再查列」兩發,本函式立刻失去效力 —— **改的人請一起改這段。**)
 *
 * ⇒ 它抓得到的不只是伺服器上限:**任何原因造成的截斷**(上限、proxy、PostgREST 版本差異)
 *   都會讓 `missing > 0`。
 *
 * 🔴 **兩個方向是【兩種病】,所以帶 `kind` 分開**(2026-08-19 審查 nit-4):
 *    · `kind: 'short'`(`missing > 0`)= 這一頁少給了列 ⇒ **調小每頁筆數會好轉**。
 *    · `kind: 'inconsistent'`(`missing < 0`)= 列比 `total` 允許的還多 ⇒ **總數本身不可信**,
 *      調小筆數**沒有幫助**。已知一條路徑會走到這裡:`product-repository.ts` 的
 *      `total: count ?? 0` —— `count` 若為 `null` 會被寫成 0,而列還在
 *      ⇒ 舊版會印「多了 200 筆」,那是**誤報**(不是多了,是總數沒回來)。
 *    ⚠️ 審的人**構造不出** `count:'exact'` 回 `null` 的實際情境 ⇒ 那條路徑**未證實可達**。
 *      仍然分開,理由是:**這道守門的價值就是「它會叫」,而一個會誤叫的警報沒有人會理它。**
 *
 * ⚠️ **它證不了的**:翻頁期間集合被寫(plan §3 病 C)。那是跨請求的問題,單發請求看不到。
 */
export type PageTruncation = {
  /** `short` = 這一頁少給了列;`inconsistent` = 總數與列數互相矛盾(見上方說明) */
  readonly kind: 'short' | 'inconsistent';
  /** 正 = 少給了幾列;負 = 列比 `total` 允許的還多 */
  readonly missing: number;
  readonly expected: number;
  readonly shownCount: number;
  readonly offset: number;
  readonly total: number;
};

export function detectPageTruncation(
  total: number,
  page: number,
  pageSize: number,
  shownCount: number,
): PageTruncation | null {
  const offset = (page - 1) * pageSize;
  const expected = Math.min(pageSize, Math.max(0, total - offset));
  const missing = expected - shownCount;
  if (missing === 0) return null;
  return {
    kind: missing > 0 ? 'short' : 'inconsistent',
    missing,
    expected,
    shownCount,
    offset,
    total,
  };
}

/**
 * 分頁列要顯示哪幾個頁碼:一段**連續**、**必含 `current`**、長度至多 `size` 的頁碼窗。
 *
 * Sean 的規格逐字畫的是 `1.2.3.4.5[]6.7.8.9.10> >>` ⇒ **十個頁碼、輸入框在中間**。
 * ⇒ 窗會**滑動**(不是「前 5 後 5」):在第 87 頁時給 82–91,而不是給 1–5 再 88–92。
 *   照「前 5 後 5」寫的話,**第 1 頁只會出現 6 個頁碼** —— 與他畫的形狀不同。
 *
 * 邊界:`totalPages <= size` ⇒ 全部列出;`current` 靠近兩端 ⇒ 窗貼邊(長度仍是 size)。
 */
export function pageWindow(current: number, totalPages: number, size = 10): readonly number[] {
  const span = Math.min(size, Math.max(1, totalPages));
  // 讓 current 盡量落在窗的中間,再把窗推回 [1, totalPages] 之內。
  // 🔴 **最外層那個 `Math.max(1, …)` 不是多餘的**:`totalPages = 0` 時
  //    右界 `totalPages - span + 1` 會算成 **0** ⇒ 少了它會回傳 `[0]`,而 `?page=0` 不是合法頁。
  //    (這一格是被 `pageWindow(1, 0)` 那條測試當場抓出來的,不是預先想到的。)
  const start = Math.max(
    1,
    Math.min(Math.max(1, current - Math.floor((span - 1) / 2)), totalPages - span + 1),
  );
  return Array.from({ length: span }, (_, i) => start + i);
}
