import type { SupabaseClient } from '@supabase/supabase-js';
import type { CategorySummary } from '@pcm/domain';
import type { Database } from '../database.types';
import { findSingle } from './product-query-support';

/**
 * categories 註冊表投射(listCategories 用)。segments 為 jsonb、生成型別給 Json、
 * 由 `as unknown as` narrow(對齊 findSingle JSDoc 的 rich-Json 邊界說明)。
 */
type CategoryRegistryRow = {
  id: string;
  name: string;
  raw_path: string;
  segments: unknown;
  parent_category_id: string | null;
  sort_order: number;
};

/**
 * `categories.raw_path` UNIQUE query 取 leaf node id。
 * 對齊 PRD §3.2 + supabase-schema-design.md §4.3。
 *
 * 注:只取 leaf node id;parent_id_chain 解析屬 save 路徑(對齊 PRD §5.1 末段)、
 * 不在本 helper 範圍。呼叫端:listByCategory / listAllByCategory / save。
 */
export async function resolveCategoryId(
  supabase: SupabaseClient<Database>,
  rawPath: string,
): Promise<string | null> {
  const row = await findSingle<{ id: string }>(
    supabase.from('categories').select('id').eq('raw_path', rawPath).single(),
  );
  return row?.id ?? null;
}

/**
 * 列出全部分類 + 各分類上架商品數(接線 plan C1、對齊 IProductRepository.listCategories contract)。
 *
 * 兩段查詢:
 * 1. `categories` 註冊表全部分類(依 sort_order 遞增;分類數遠低於 PostgREST `db-max-rows`、不分頁)。
 *    🔴 ~~原寫「1000 上限」~~ —— **那個值已過期**(2026-08-18 實測 **2000**,Sean 08-17 調大)。
 *    ⚠️ 這裡刻意**不寫死新值**:它住在 Supabase 面板、隨時會再被改。要當下的值看下方 `#629` 那段的探法。
 * 2. 逐分類走 `products_public` 取 exact count(head:true 零 row 傳輸、以 RLS-enforced
 *    anon/publishable client 實例化時天然只計上架 delisted_at IS NULL〔同既有 read methods〕、
 *    避開 listAllByCategory 需 .range 分頁繞的 `db-max-rows` 上限;🔴 原寫「1000-row」同樣已過期);
 *    只 select 'id'、絕不觸經銷價欄(price_store / price_by_tier / metadata)。
 *
 * 空分類回 productCount = 0(不過濾、消費端決定;對齊 port contract)。
 *
 * @TODO #51 / #247:目錄長大後改 server-side 聚合(view / RPC),避免逐分類 N 次 count 查詢。
 *
 * 🔴 **本查詢【沒有上界】—— 它吃 PostgREST `db-max-rows`**(2026-08-18 A 窗補;
 * backlog **`#629`**;全文 `docs/specs/2026-08-18-storefront-truncation-inventory.md` §4)。
 * 下面那句 `.from('categories').select(…).order(…)` **沒有 `.limit()`、沒有 `.range()`**
 * ⇒ 分類數超過 `db-max-rows`(量測值 **2000**,2026-08-18 凌晨 · 正式站)時,**回傳會被靜默截斷**。
 *
 * 🔴 **為什麼這件事比「少幾筆」嚴重**:消費端 `CategoryGrid.tsx` 印「全站共 N 類」那一行(2026-09-04 實查在 `:272`;**行號會漂, 認那句字面**)拿這個陣列的長度
 * 印出**一句全稱宣稱** ——「**全站共 N 類**」。截斷時那句話會變成**假的,而畫面完全正常**。
 * ✅ **量了(2026-09-04 唯讀連線實查正式站)**:`categories` = **117 列** · 上限 2000 ⇒ **沒被截斷**。
 *    ⛔ ~~原本這裡寫「今天可不可達 = 未量……那是推的,不是事實」~~ —— 那道缺的檢查就是這一發。
 *    🔵 而**「離上限還有 17 倍」比「沒被截斷」有用**:它說得出什麼時候會變成問題。
 *    🔴 探法留著給下一個人:對正式庫 `SELECT count(*) FROM public.categories` 數一次。
 * 留這段是因為**這個依賴原本沒有任何載體**(repo 內零字面可掃、零測試看得到),不是因為今天有問題。
 */
export async function listCategories(
  supabase: SupabaseClient<Database>,
): Promise<CategorySummary[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, raw_path, segments, parent_category_id, sort_order')
    .order('sort_order', { ascending: true })
    // 🔴🔴 **第二個鍵是【唯一鍵】, 而它不是裝飾** —— 沒有它, `sort_order` 並列那些列的
    //    回傳順序**沒有任何保證**(Postgres 不承諾穩定排序)。
    // 🔬 正式站唯讀實查 2026-09-04:117 個分類**只有 30 個相異 `sort_order`**
    //    ⇒ **87 列與別人共用一個號**(號 10 一個就有 19 列)⇒ 那不是邊角, 是大多數。
    // 🔬 而**並列今天是照什麼排的?沒有人寫下來**:同一句加上 `, id` 之後回傳順序**變了**
    //    (md5 `e6ffd58b…` ⇒ `2b92b35c…`)⇒ 📌 **⇒ 那證明並列不是照 id 排, 是照別的東西。**
    // 🔵 而**兩種計畫下(`enable_seqscan` on/off)今天的順序相同** ——
    //    ⇒ 🛑 **所以不要說「它會變」。要說的是「沒有東西保證它不變」。**
    //    ⇒ ⇒ 🎯 而這一行買的不是「排對」, 是【**每次都一樣**】。
    // 🔴 而下游吃這個順序的地方**不只側欄**:`parseSearchFacets` 的 `allCats.find(...)`
    //    是「第一個中的贏」⇒ 客人打一個詞落到哪個分類, 取決於這裡。
    //    而**有三組同名分類**(`維修零件` ×3 · `水管束環` ×2 · `防爆水管組` ×2)
    //    ⇒ 🛑 選錯時**畫面上看不出來**, 因為膠囊上的字一模一樣。
    // ⚠️ **副作用量過了 —— 而射程只到【今天觀察到的那個改前順序】**:
    //    🛑 而「改前順序沒有保證」正是這一行存在的理由 ⇒ 📌 **「零變動」不能讀成「任何時候都零變動」。**
    //    改前 vs 改後, 客人看得到的順序**零變動**
    //    (頂層 31 個 ⇒ 0 列移位 · 有貨的子分類 84 個 ⇒ 0 列移位;而**扁平清單** 117 列裡
    //    有 81 列移位 —— 📌 **那份扁平順序不是被渲染的那一份**)。
    .order('id', { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as unknown as CategoryRegistryRow[];
  return Promise.all(
    rows.map(async (row): Promise<CategorySummary> => ({
      id: row.id,
      name: row.name,
      path: {
        raw: row.raw_path,
        // jsonb segments 退化:非陣列 → [];陣列含非 string 元素 → 濾除(守 CategoryPath.segments 契約)
        segments: Array.isArray(row.segments)
          ? row.segments.filter((s): s is string => typeof s === 'string')
          : [],
      },
      parentId: row.parent_category_id,
      sortOrder: row.sort_order,
      productCount: await countLiveProductsByCategory(supabase, row.id),
    })),
  );
}

/**
 * 單一分類的上架商品 exact count(listCategories 用)。
 * 走 products_public + head:true(零 row 傳輸)、RLS-enforced client 下只計 delisted_at IS NULL;
 * 只 select 'id'、不觸經銷價欄。
 */
async function countLiveProductsByCategory(
  supabase: SupabaseClient<Database>,
  categoryId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('products_public')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', categoryId);
  if (error) throw error;
  return count ?? 0;
}
