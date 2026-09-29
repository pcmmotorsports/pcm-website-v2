// 每日 LINE 摘要「商品」一行的資料(Sean 2026-09-29 答 Q1 甲、Q2 甲、Q3 甲)。
// 計畫:~/pcm-mailbox/計畫-每日摘要加新品與變價-20260929.md 第 5 版(Fable R1–R4、Codex R3/R5 審過)。
// · 新上架 = 這一班內 product_variants.created_at 落在範圍裡的規格數。
// · 變價   = 這一班內一般價真的變過的【不同】規格數(product_price_changes, 20260929020000 的 trigger 寫)。
// · 兩者都只算上架中的商品(products.delisted_at IS NULL, Q2 甲:下架不印)。
// · 漲跌最大:每個規格用範圍內第一筆舊價、最後一筆新價算;只有舊價 > 0 且新價不是 NULL 才參加, 門檻 5%。
// · 排序一律照 id(identity 寫入時配號), 不照 changed_at(now() 是交易開始時間, 交錯時會排反;Codex R5)。
// · 跨 09:00 / 21:00 那幾秒開始而晚提交的交易可能少算(Q3 甲接受, 只影響摘要數字)。
// 只讀不寫;讀失敗一律 throw, 由呼叫端當成「讀不到」, 不當成 0。
import { digestWindow } from './member-spend-milestone-read';

const PAGE = 1000;
const HOUR_MS = 60 * 60 * 1000;
/** products 以 id 分批查, 避免 in() 網址過長。 */
const IN_CHUNK = 100;
export const TOP_CHANGE_MIN_PCT = 5;

type Rows<T> = PromiseLike<{ data: T[] | null; error: unknown }>;
type Query<T> = Rows<T> & {
  select(cols: string): Query<T>;
  eq(col: string, v: unknown): Query<T>;
  is(col: string, v: null): Query<T>;
  in(col: string, vs: readonly string[]): Query<T>;
  gte(col: string, v: string): Query<T>;
  lt(col: string, v: string): Query<T>;
  order(col: string): Query<T>;
  range(from: number, to: number): Query<T>;
};
/** 真的 service client 以 unknown 轉進來(同 member-spend-milestone-read 的 SpendReadClient)。 */
export type ProductChangeReadClient = { from<T = Record<string, unknown>>(table: string): Query<T> };

export type PriceChangeRow = {
  id: number;
  variant_id: string;
  product_id: string;
  sku: string;
  old_price: number | null;
  new_price: number | null;
};
type ProductRow = { id: string; title: string | null; delisted_at: string | null };

export type TopPriceChange = { title: string; oldPrice: number; newPrice: number; pct: number };

export type ProductChangeDigest = {
  /** 這一班新增的規格數(上架中的商品)。 */
  newVariants: number;
  /** 這一班一般價變過的不同規格數(上架中的商品)。 */
  changedVariants: number;
  /** 漲跌幅絕對值最大且 ≥ 5% 的那一個;沒有就 null。 */
  top: TopPriceChange | null;
  /** 過去 24 小時沒有任何一列「completed 且 note 不是 degraded」的同步。 */
  noCompletedSync: boolean;
};

async function readAll<T>(make: () => Query<T>, orderBy = 'id'): Promise<T[]> {
  const out: T[] = [];
  for (;;) {
    const { data, error } = await make().order(orderBy).range(out.length, out.length + PAGE - 1);
    if (error) throw error;
    const page = data ?? [];
    if (page.length === 0) return out;
    out.push(...page);
  }
}

/**
 * 純函式:從範圍內的變價列(任意順序)算出不同規格數與漲跌最大的那一個。
 * `listed` = 上架中的商品 id → 品名;不在裡面的(下架或查無)整列不算。
 */
export function summarizePriceChanges(
  rows: readonly PriceChangeRow[],
  listed: ReadonlyMap<string, string | null>,
): { changedVariants: number; top: TopPriceChange | null } {
  const byVariant = new Map<string, { first: PriceChangeRow; last: PriceChangeRow }>();
  for (const r of [...rows].sort((a, b) => a.id - b.id)) {
    if (!listed.has(r.product_id)) continue;
    const cur = byVariant.get(r.variant_id);
    if (cur) cur.last = r;
    else byVariant.set(r.variant_id, { first: r, last: r });
  }
  let top: TopPriceChange | null = null;
  for (const { first, last } of byVariant.values()) {
    const oldPrice = first.old_price;
    const newPrice = last.new_price;
    if (oldPrice === null || oldPrice <= 0 || newPrice === null) continue;
    const pct = Math.round(((newPrice - oldPrice) / oldPrice) * 1000) / 10;
    if (Math.abs(pct) < TOP_CHANGE_MIN_PCT) continue;
    if (top === null || Math.abs(pct) > Math.abs(top.pct)) {
      top = { title: listed.get(first.product_id) ?? first.sku, oldPrice, newPrice, pct };
    }
  }
  return { changedVariants: byVariant.size, top };
}

async function readListedProducts(client: ProductChangeReadClient, ids: readonly string[]) {
  const listed = new Map<string, string | null>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const chunk = unique.slice(i, i + IN_CHUNK);
    const rows = await readAll(() =>
      client.from<ProductRow>('products').select('id, title, delisted_at').in('id', chunk),
    );
    for (const p of rows) if (p.delisted_at === null) listed.set(p.id, p.title);
  }
  return listed;
}

export async function readProductChangeDigest(client: ProductChangeReadClient, now: Date): Promise<ProductChangeDigest> {
  const { since, until } = digestWindow(now);
  const [changes, created, syncRuns] = await Promise.all([
    readAll(() =>
      client
        .from<PriceChangeRow>('product_price_changes')
        .select('id, variant_id, product_id, sku, old_price, new_price')
        .gte('changed_at', since.toISOString())
        .lt('changed_at', until.toISOString()),
    ),
    readAll(() =>
      client
        .from<{ id: string; product_id: string }>('product_variants')
        .select('id, product_id')
        .gte('created_at', since.toISOString())
        .lt('created_at', until.toISOString()),
    ),
    readAll(() =>
      client
        .from<{ id: number; note: string | null }>('supplier_sync_runs')
        .select('id, note')
        .eq('outcome', 'completed')
        .gte('completed_at', new Date(now.getTime() - 24 * HOUR_MS).toISOString()),
    ),
  ]);
  const listed = await readListedProducts(client, [...changes.map((c) => c.product_id), ...created.map((v) => v.product_id)]);
  const { changedVariants, top } = summarizePriceChanges(changes, listed);
  return {
    newVariants: created.filter((v) => listed.has(v.product_id)).length,
    changedVariants,
    top,
    noCompletedSync: !syncRuns.some((r) => r.note !== 'degraded'),
  };
}
