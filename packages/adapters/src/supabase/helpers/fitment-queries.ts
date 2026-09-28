import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveEnd, type FitmentSpec } from '@pcm/domain';
import type { Database } from '../database.types';
import type { SupabaseProductRow } from '../mappers/product';
import { fetchAllPaginated } from './product-query-support';

/**
 * fitment 反查查詢 helpers(R2a 推薦引擎「以車查商品」+ 通用款;鐵則 6 拆檔:
 * SupabaseProductAdapter 逾 400 行、對齊既有 category-queries.ts / product-query-support.ts 抽法)。
 *
 * @see docs/specs/2026-07-08-recommendation-engine-related-products-plan.md §4
 * @see packages/adapters/src/supabase/helpers/fitment.ts matchFitmentYear(語意來源)
 */

/**
 * 年份範圍重疊 PostgREST `.or()` filter 字串(對齊 helpers/fitment.ts matchFitmentYear)。
 *
 * spec 無 yearStart → null(不限年份、對齊 matchFitmentYear 早退 true);否則
 * `[year_start, resolveEnd(year_start,year_end)]` 與 `[specStart, specEnd]` 重疊
 * + `year_start IS NULL`(商品端無年份=通吃)。specEnd=Infinity(開放式 spec)省 lte 段。
 */
export function buildFitmentYearFilter(spec: FitmentSpec): string | null {
  if (spec.yearStart === undefined) return null;
  const specStart = spec.yearStart;
  const specEnd = resolveEnd(spec.yearStart, spec.yearEnd);
  const endGteStart = `or(year_end.is.null,year_end.gte.${specStart})`;
  const overlap =
    specEnd === Infinity
      ? endGteStart
      : `and(year_start.lte.${specEnd},${endGteStart})`;
  return `year_start.is.null,${overlap}`;
}

/**
 * 依 fitment spec 反查商品(對齊 IProductRepository.listByFitment)。
 *
 * 🔴🔴 **2026-09-28 又改回兩步**(見函式下方那段):一步寫法在正式站常撞 3 秒上限(57014)、推薦區空白。
 *    下面 08-17 那段是【一步寫法當時的理由】,留著當歷史;它列的三個病,新的兩步寫法逐條處理了。
 *
 * ⛔ ~~**2026-08-17 由「兩步」改為「一步 `!inner` join」**~~ —— 舊寫法是
 * ①`product_fitments` 撈 `product_id` ②`products_public.in('id', ids)`。
 * 換掉的理由不是風格,是**舊形狀有三個病而新形狀讓它們不存在**:
 *
 * 1. **兩步都會被 `max-rows` 靜默截斷**,而且是**串聯**的:步①被夾過的 id 餵給步②,
 *    步②**查得到它拿到的每一個 id** ⇒ 看起來完全正常 ⇒ **只修步②等於沒修**。
 *    (實測:`BMW / S 1000 RR` 1,423 列 fitment = 724 個商品 ⇒ 步①實得 1,000 列 ⇒ 只剩 490 個。)
 * 2. **`.in('id', ids)` 的 URL 長度**:每個 uuid 約 37 字元,724 個 ⇒ 約 27KB,
 *    超過常見 8KB header 上限 ⇒ 舊形狀**結構上無法**把熱門車型撈完(這正是 stopgap `#51` 記的風險)。
 * 3. 兩次 round trip。
 *
 * 新形狀:**頂層是商品、fitment 當 filter**。
 * ⇒ 回來的天生 distinct(不必去重)、沒有 `.in()`(URL 限制消失)、一次往返;
 * ⇒ 而且 `content-range` 給的總數是**商品數**(724)不是 fitment 列數(1,423)。
 * **實測**(anon 側 production、2026-08-17):`…&limit=600` ⇒ `content-range: 0-599/724`、
 * 回傳 600 筆 distinct 600;帶年份 filter(2020)⇒ 總數收斂為 327。
 *
 * R2a 由舊 jsonb `.contains` @> + client cross-check 改走正規化索引的語意不變:
 * 正規化一列一相容 → 結構性消掉舊版跨車型 false-positive。
 */
export async function queryProductsByFitment(
  supabase: SupabaseClient<Database>,
  spec: FitmentSpec,
  productSelect: string,
  poolLimit: number,
): Promise<SupabaseProductRow[]> {
  const ids = await fitmentProductIdsInHandleOrder(supabase, spec, poolLimit);
  if (ids.length === 0) return [];
  return fetchProductsByIdsWithFitmentRecheck(supabase, spec, productSelect, ids);
}

// ── 2026-09-28 改回兩步(計畫 ~/pcm-mailbox/計畫-商品頁推薦查詢逾時-20260928.md 第 5.1 版,Sean 選甲)──
// 一步寫法(products_public + product_fitments!inner,上限 800)在正式站常撞 3 秒上限(57014),推薦區空白;
// 從車款表出發(走 ix_pf_lookup)第一步 0.3–0.7 秒,四組車款與舊寫法逐筆相同、順序相同(計畫 §2-4)。
// 08-17 換成一步的三個理由,這一版逐條處理:
//   ① max-rows 截斷:第一步用 .range() 每頁 1,000 列,「收到 < 每頁」才算讀完,20 頁讀不完就丟錯(不回部分結果);
//      第二步每批 id 數遠低於 max-rows。
//   ② 網址長度:第二步依【實際送出的網址長度】分批,每批 ≤ 6,000 bytes。
//   ③ 兩次往返:接受(兩步合計仍遠快於一步)。

/** 第一步每頁列數 = PostgREST 預設 db-max-rows(不能用 .limit(5000) 假設一次拿得完,計畫 R1 必修 1)。 */
export const FITMENT_STEP1_PAGE_SIZE = 1000;
/** 第一步最多讀幾頁;讀到這裡還沒讀完 ⇒ 丟錯。 */
export const FITMENT_STEP1_MAX_PAGES = 20;
/** 第二步每批網址長度上限(bytes)。postgrest-js 自己的 8,000 只加錯誤提示、不擋 ⇒ 這是唯一的防線。 */
export const FITMENT_STEP2_URL_BUDGET = 6000;
/** 第二步同時送出幾批。 */
export const FITMENT_STEP2_CONCURRENCY = 4;

/**
 * 第一步:從車款表拿「依商品 handle(資料庫定序)排好」的商品 id,去重到 poolLimit 個就停。
 * 🔴 排序一定留在資料庫:定序是 en_US.UTF-8,上架商品有 963 個 handle 含 [a-z0-9-] 以外的字元,
 *    JavaScript 重排會和舊寫法不同(計畫 R1 必修 3)。第二步用 Map 對位,不重新比較字串。
 * 🔴 不重用 fetchAllPaginated(product-query-support.ts):它撞頁數上限只 warn、回部分結果,
 *    也不會在拿到 poolLimit 個 id 時提早停。不要換回去。
 * 限制(計畫 R3 nit):id 主鍵補排序只保證資料不變時分頁穩定;兩頁之間剛好有車款列新增或刪除,offset 會移動,
 *   可能漏掉或重複一件商品(重複會去重,漏掉的補不回來)。車款由每日同步寫入、第一步約 0.3 秒,機率低,影響只限推薦內容。
 */
async function fitmentProductIdsInHandleOrder(
  supabase: SupabaseClient<Database>,
  spec: FitmentSpec,
  poolLimit: number,
): Promise<string[]> {
  const yearFilter = buildFitmentYearFilter(spec);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < FITMENT_STEP1_MAX_PAGES; page += 1) {
    const from = page * FITMENT_STEP1_PAGE_SIZE;
    let q = supabase
      .from('product_fitments')
      // 內嵌安全 view(只選 handle):security_invoker ⇒ 底層 products 的 RLS(delisted_at IS NULL)照樣套用
      .select('product_id, id, products_public!inner(handle)')
      .eq('moto_brand', spec.motoBrand)
      .eq('model_code', spec.modelCode);
    if (yearFilter !== null) q = q.or(yearFilter);
    const { data, error } = await q
      .order('products_public(handle)', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + FITMENT_STEP1_PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as { product_id: string }[];
    for (const r of rows) {
      if (seen.has(r.product_id)) continue;
      seen.add(r.product_id);
      ids.push(r.product_id);
      if (ids.length >= poolLimit) return ids;
    }
    if (rows.length < FITMENT_STEP1_PAGE_SIZE) return ids;
  }
  throw new Error(
    `[queryProductsByFitment] 第一步讀了 ${FITMENT_STEP1_MAX_PAGES} 頁(${FITMENT_STEP1_MAX_PAGES * FITMENT_STEP1_PAGE_SIZE} 列)還沒讀完,不回部分推薦池`,
  );
}

/**
 * 第二步:用 id 撈完整欄位,【重新套上車款條件】(計畫 R1 必修 4、R3 必修 M1:這一條一定要留)。
 * 第一步到第二步之間有商品下架或改了車款 ⇒ 第二步把它排掉,只會少、不會多。
 * 少回一律接受(PostgREST 對「被 RLS 或車款條件濾掉」不回任何訊號);多出不在清單的 id ⇒ 丟錯。
 * 任一批 error 或 reject ⇒ 整批丟錯,不回部分推薦池(計畫 R1 必修 5)。
 */
async function fetchProductsByIdsWithFitmentRecheck(
  supabase: SupabaseClient<Database>,
  spec: FitmentSpec,
  productSelect: string,
  ids: readonly string[],
): Promise<SupabaseProductRow[]> {
  const yearFilter = buildFitmentYearFilter(spec);
  const select = `${productSelect}, product_fitments!inner(moto_brand)`;
  const batches = splitIdsByUrlLength(restBaseUrl(supabase), select, spec, yearFilter, ids);

  const byId = new Map<string, SupabaseProductRow>();
  const wanted = new Set(ids);
  for (let i = 0; i < batches.length; i += FITMENT_STEP2_CONCURRENCY) {
    const wave = batches.slice(i, i + FITMENT_STEP2_CONCURRENCY);
    const results = await Promise.all(
      wave.map(async (batch) => {
        let q = supabase
          .from('products_public')
          .select(select)
          .in('id', batch)
          .eq('product_fitments.moto_brand', spec.motoBrand)
          .eq('product_fitments.model_code', spec.modelCode);
        if (yearFilter !== null) q = q.or(yearFilter, { referencedTable: 'product_fitments' });
        const { data, error } = await q;
        if (error) throw error;
        return (data ?? []) as unknown as SupabaseProductRow[];
      }),
    );
    for (const rows of results) {
      for (const row of rows) {
        if (!wanted.has(row.id)) {
          throw new Error(`[queryProductsByFitment] 第二步回了第一步清單以外的商品 ${row.id},不回部分推薦池`);
        }
        byId.set(row.id, row);
      }
    }
  }
  // 依第一步的順序排好(Map 對位,順序完全由資料庫決定)
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}

/**
 * PostgREST 的 REST 位址(算網址長度用)。SupabaseClient 的 `rest` 在型別上是 protected,執行期是一般屬性;
 * 讀不到就用保守的長度估計(一般 Supabase 位址遠短於 200 字元)。
 */
function restBaseUrl(supabase: SupabaseClient<Database>): string {
  const url = (supabase as unknown as { rest?: { url?: unknown } }).rest?.url;
  return typeof url === 'string' && url !== '' ? url : `https://${'x'.repeat(200)}/rest/v1`;
}

/**
 * 第二步那一批實際會送出的網址(照 postgrest-js 2.105 的組法:select 去掉引號外空白、.in() 先去重、
 * URLSearchParams 編碼),只拿來算長度。測試會攔下實際送出的網址比對兩者相同。
 */
export function fitmentStep2Url(
  baseUrl: string,
  select: string,
  spec: FitmentSpec,
  yearFilter: string | null,
  ids: readonly string[],
): string {
  let quoted = false;
  const cleanedSelect = select
    .split('')
    .map((c) => {
      if (/\s/.test(c) && !quoted) return '';
      if (c === '"') quoted = !quoted;
      return c;
    })
    .join('');
  const url = new URL(`${baseUrl}/products_public`);
  url.searchParams.set('select', cleanedSelect);
  url.searchParams.append('id', `in.(${Array.from(new Set(ids)).map((v) => (/[,()]/.test(v) ? `"${v}"` : v)).join(',')})`);
  url.searchParams.append('product_fitments.moto_brand', `eq.${spec.motoBrand}`);
  url.searchParams.append('product_fitments.model_code', `eq.${spec.modelCode}`);
  if (yearFilter !== null) url.searchParams.append('product_fitments.or', `(${yearFilter})`);
  return url.toString();
}

function splitIdsByUrlLength(
  baseUrl: string,
  select: string,
  spec: FitmentSpec,
  yearFilter: string | null,
  ids: readonly string[],
): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  for (const id of ids) {
    const next = [...current, id];
    if (current.length > 0 && fitmentStep2Url(baseUrl, select, spec, yearFilter, next).length > FITMENT_STEP2_URL_BUDGET) {
      batches.push(current);
      current = [id];
    } else {
      current = next;
    }
  }
  if (current.length > 0) batches.push(current);
  for (const b of batches) {
    if (fitmentStep2Url(baseUrl, select, spec, yearFilter, b).length > FITMENT_STEP2_URL_BUDGET) {
      throw new Error('[queryProductsByFitment] 單一 id 的網址就超過長度上限(車款名稱過長?)');
    }
  }
  return batches;
}

/**
 * 通用款商品(fitments 空陣列 = 設計上不綁車型、對齊 IProductRepository.listGeneral)。
 *
 * `products_public` + RLS(只回上架、經銷價物理排除);jsonb 等值 `fitments = '[]'`(乾淨、
 * 不觸 array_length abort)。**fitments 非空但元素全髒者不算通用**——Sean 2026-07-08 逐筆判斷
 * 該 9 筆 gbracing(Honda 品牌/車型空白)實為 HONDA MOTO3 賽車專用 + 替換件、非萬用,故排除;
 * 此語意取代 plan §4 原「NOT EXISTS product_fitments」表述(兩者皆滿足 codex #6 免 abort/dead-predicate)。
 * 🔴 PostgREST jsonb 空陣列等值待 R3 整合實測(SQL 層已驗 `fitments = '[]'` → 631 筆)。
 */
/**
 * S1 變體補足(2026-07-12):以下兩查詢原本用**文件化窄 cast** 收斂為最小結構型別。
 * ✅ **2026-08-11 #415:兩處都已拆**,改回具名呼叫、由生成型別把關(逐處理由見各自註解)。
 */

/**
 * ~~RPC search_products_by_vehicle 的最小呼叫面 `VehicleRpcClient`~~
 * 🔴 **2026-08-11 已拆(backlog #415)**:改回具名 `.rpc()`,函式名與參數名由生成型別把關。
 * 同批在 `database.types.ts` 補了第 ⑨ 組手動校正(`p_model` / `p_year` 的 `| null`)——
 * 不補就只能把顯式 `null` 改成 `undefined`,那會改變送出去的 payload,不是型別整理。
 */

/**
 * 以車查商品 —— 走 DB RPC `search_products_by_vehicle`(S1 變體補足、車款篩選下推 DB)。
 *
 * RPC = `product_fitments`(direct、trigger 即時)∪ `product_fitments_effective`(報價單母款
 * 家族樹展開、每日同步)去重 → 繼承件(如掛母款 MT-09 的通用件)也命中子款(MT-09 SP)搜尋。
 * 回傳 jsonb 形狀 = SupabaseProductRow 公開欄(RPC 內 jsonb_build_object 逐欄白名單、無經銷價)。
 *
 * 🔴 分頁必要(codex#2):PostgREST 對 SETOF RPC 套 Max Rows=1000,品牌-only(model=null)
 *   命中可破千被**靜默截斷** → 以 `.range()` 分頁迴圈撈全(RPC 端 ORDER BY p.id 穩定序)。
 * 年份語意(F5、adversarial):`year_end IS NULL` 當開放式(≥year_start)——與推薦引擎
 *   `matchFitmentYear` 一致;client 舊 matchesVehicle 的「yearEnd undefined=單年」語意退場,
 *   1.3% 缺迄年 direct fitment 由「單年」變「開放式」(Sean 拍 codex#1=A、對齊兩引擎)。
 */
export async function queryProductsByVehicle(
  supabase: SupabaseClient<Database>,
  motoBrand: string,
  modelCode?: string,
  year?: number,
): Promise<SupabaseProductRow[]> {
  const rows = await fetchAllPaginated(
    (from, to) =>
      supabase
        .rpc('search_products_by_vehicle', {
          p_brand: motoBrand,
          p_model: modelCode ?? null,
          p_year: year ?? null,
        })
        .range(from, to),
    `queryProductsByVehicle(${motoBrand} ${modelCode ?? ''} ${year ?? ''})`,
  );
  return rows as SupabaseProductRow[];
}

/**
 * ~~effective 表 inherited 列的最小讀取面 `EffectiveFitmentsClient`~~
 * 🔴 **2026-08-11 已拆(backlog #415)**:`product_fitments_effective` 重 gen 後就在生成型別裡
 * (數法=`grep -n "^      product_fitments_effective: {" packages/adapters/src/supabase/database.types.ts`,落筆當下 `:2069`),窄介面留著只會讓 typecheck 對這條讀取路失效。
 * ⇒ 改回具名 `.from(...).select(...)`,表名、欄名、回傳列形狀全部由生成型別把關
 *   (原本那個手寫介面把 `year_start` 之類的型別再宣告一次,是第二份會漂的真相)。
 */

/**
 * 查單一商品的「車系相容(推導)」fitment(PDP 兩層顯示、Sean Q4=A)。
 *
 * 讀 `product_fitments_effective` 的 inherited 列(anon SELECT + RLS 濾下架);direct 列不讀
 * (products.fitments 原始值即 direct、provenance 不動)。單商品 inherited 列個位數~數十
 * (Y016=6),單次查詢即可、不分頁。
 * 年份映射:year_start NULL → 無年份;year_end NULL(有 year_start)→ 開放式(domain yearEnd: null)。
 */
export async function queryInheritedFitments(
  supabase: SupabaseClient<Database>,
  productId: string,
): Promise<FitmentSpec[]> {
  const { data, error } = await supabase
    .from('product_fitments_effective')
    .select('moto_brand, model_code, year_start, year_end')
    .eq('product_id', productId)
    .eq('match_source', 'inherited');
  if (error) {
    throw error;
  }
  return (data ?? []).map((row) => ({
    motoBrand: row.moto_brand,
    modelCode: row.model_code,
    ...(row.year_start != null ? { yearStart: row.year_start } : {}),
    // year_end NULL 且有 year_start = 開放式(domain null);兩者皆 NULL = 無年份(省略)
    ...(row.year_start != null ? { yearEnd: row.year_end } : {}),
    matchSource: 'inherited' as const,
  }));
}

export async function queryGeneralProducts(
  supabase: SupabaseClient<Database>,
  productSelect: string,
  poolLimit: number,
): Promise<SupabaseProductRow[]> {
  // 🔴 通用款是這一族裡母體最大的一支:實測 **3,995** 筆(2026-08-17 anon 側 production)
  //    ⇒ 舊寫法靜默停在 1,000、少 2,995,而它是推薦引擎「湊不滿時的最後補位」
  //    ⇒ 少掉的那些**永遠輪不到**,且畫面上看不出任何異常。
  const { data, error } = await supabase
    .from('products_public')
    .select(productSelect)
    .eq('fitments', '[]')
    .order('handle', { ascending: true })
    .limit(poolLimit);
  if (error) {
    throw error;
  }
  return (data ?? []) as unknown as SupabaseProductRow[];
}
