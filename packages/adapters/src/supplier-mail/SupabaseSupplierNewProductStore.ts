import type {
  CatalogSkuMatch,
  HomeBannerSystemDraft,
  ICatalogSkuMatcher,
  ISupplierNewProductStore,
  InboundMailRecord,
} from '@pcm/ports';

/**
 * 讀信紀錄 + 系統草稿的寫入面、料號配對的讀取面(DB 20260916150000)。
 *
 * 🔴🔴 **草稿那一半還沒接上,而那是刻意的**:`admin_home_banner_save_draft` 要在職員工當 actor,
 *    系統(`system:mail-draft`)進不去;PRD §3.1 說系統起草要另開一支 RPC,而且要跟記信【同一個交易】
 *    (記了信而草稿沒建 ⇒ 下一輪去重跳過 ⇒ 那封永遠沒草稿)。
 *    ⇒ 那支 RPC 是 migration(鐵則 8)⇒ 下一片。在那之前 draft 非 null 一律 throw `draft_sink_not_wired`,
 *      use-case 會把那封記成 failed —— 看得見,不會假裝成功。旗標預設關,正式站不會跑到這裡。
 * 🔵 生成型別還沒有這兩張表 ⇒ 窄的 loose client,回傳逐欄驗。
 */

type Result = { data: unknown; error: unknown };
interface LooseQuery extends PromiseLike<Result> {
  select(columns: string): LooseQuery;
  in(column: string, values: readonly string[]): LooseQuery;
  insert(row: Record<string, unknown>): LooseQuery;
}
interface LooseClient {
  from(table: string): LooseQuery;
}

export class DraftSinkNotWiredError extends Error {
  readonly code = 'draft_sink_not_wired';
  constructor() {
    super('系統草稿的 RPC 還沒建(下一片 migration)⇒ 這封記 failed');
    this.name = 'DraftSinkNotWiredError';
  }
}

export class SupabaseSupplierNewProductStore implements ISupplierNewProductStore {
  private readonly db: LooseClient;

  constructor(client: unknown) {
    this.db = client as LooseClient;
  }

  async knownMessageIds(ids: readonly string[]): Promise<ReadonlySet<string>> {
    if (ids.length === 0) return new Set();
    const { data, error } = await this.db.from('supplier_inbound_emails').select('gmail_message_id').in('gmail_message_id', ids);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('supplier_inbound_emails 回傳不是陣列');
    return new Set(data.map((r) => (r as { gmail_message_id?: unknown }).gmail_message_id).filter((v): v is string => typeof v === 'string'));
  }

  async record(record: InboundMailRecord, draft: HomeBannerSystemDraft | null): Promise<'recorded' | 'duplicate'> {
    if (draft !== null) throw new DraftSinkNotWiredError();
    const { error } = await this.db.from('supplier_inbound_emails').insert({
      gmail_message_id: record.gmailMessageId,
      gmail_thread_id: record.gmailThreadId,
      sender: record.sender,
      subject: record.subject,
      received_at: record.receivedAt,
      auth_passed: record.authPassed,
      status: record.status,
      extracted: record.extracted,
      error_code: record.errorCode,
    });
    if (error) {
      if ((error as { code?: unknown }).code === '23505') return 'duplicate';
      throw error;
    }
    return 'recorded';
  }
}

/** 料號 ∈ product_variants.sku,且商品上架中、品牌在寄件者對應的品牌裡。 */
export class SupabaseCatalogSkuMatcher implements ICatalogSkuMatcher {
  private readonly db: LooseClient;

  constructor(client: unknown) {
    this.db = client as LooseClient;
  }

  async match(input: { skus: readonly string[]; brandSlugs: readonly string[] }): Promise<readonly CatalogSkuMatch[]> {
    if (input.skus.length === 0 || input.brandSlugs.length === 0) return [];
    const { data, error } = await this.db
      .from('product_variants')
      .select('id, sku, products!inner(title, delisted_at, brands!inner(slug))')
      .in('sku', input.skus);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('product_variants 回傳不是陣列');
    const out: CatalogSkuMatch[] = [];
    for (const raw of data) {
      const r = raw as { id?: unknown; sku?: unknown; products?: { title?: unknown; delisted_at?: unknown; brands?: { slug?: unknown } } };
      const slug = r.products?.brands?.slug;
      if (typeof r.id !== 'string' || typeof r.sku !== 'string' || typeof slug !== 'string') continue;
      if (r.products?.delisted_at != null || !input.brandSlugs.includes(slug)) continue;
      out.push({ variantId: r.id, sku: r.sku, productTitle: typeof r.products?.title === 'string' ? r.products.title : r.sku, brandSlug: slug });
    }
    return out;
  }
}
