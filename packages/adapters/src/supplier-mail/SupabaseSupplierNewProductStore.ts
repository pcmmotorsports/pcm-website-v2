import type {
  CatalogSkuMatch,
  HomeBannerSystemDraft,
  ICatalogSkuMatcher,
  ISupplierNewProductStore,
  InboundMailRecord,
} from '@pcm/ports';

/**
 * 讀信紀錄 + 系統草稿的寫入面、料號配對的讀取面(DB 20260916150000 / 20260916170000)。
 *
 * 🔴 寫入只走 `system_supplier_mail_record`(20260916170000):記信 + 建草稿同一個交易、actor 固定 `system:mail-draft`。
 * 🔴 **failed 重跑規則**:`knownMessageIds` 不把 status = 'failed' 的信當成讀過 ⇒ 下一輪再處理;
 *    RPC 遇到 failed 那一列會覆寫(created_at 不動)。上限靠 Gmail 查詢式 `newer_than:3d`(約 3 輪)。
 * 🔵 生成型別還沒有這兩張表 / 這支 RPC ⇒ 窄的 loose client,回傳逐欄驗。
 */

type Result = { data: unknown; error: unknown };
interface LooseQuery extends PromiseLike<Result> {
  select(columns: string): LooseQuery;
  in(column: string, values: readonly string[]): LooseQuery;
}
/**
 * 🔴 **2026-09-18:這是「拆 15 個 RPC 逃生口」那一批裡【唯一沒拆的一個】,理由寫在這裡。**
 *
 * 其他 14 個的逃生口都住在**這支檔自己**(一個 `as unknown as`、一個 `as never`)⇒ 拆掉只影響這支檔。
 * 🛑 **而這一個住在 constructor 的簽章上**:`constructor(client: unknown, …)` ——
 *    要拆得把它改成 `SupabaseClient<Database>`,那會**同時改掉這個 class 的公開契約**,
 *    每一個 `new SupabaseSupplierNewProductStore(...)` 的呼叫端都要跟著看一遍。
 * ⇒ 📌 **那是「改介面」不是「補型別」** —— 與本批「零行為變更」的界線不同,所以不順手做。
 * ⇒ 🙋 要做的話是獨立一件,要 Sean 批(碰 `packages/adapters` 的公開介面,鐵則 8)。
 *
 * ⚠️ **在那之前照實說**:`system_supplier_mail_record` 這支 RPC 的**函式名與參數名今天仍然沒有型別守門**。
 *    今天守著它的是 `SupabaseSupplierNewProductStore.test.ts` 與 DB 那側的簽章,**不是 typecheck**。
 */
interface LooseClient {
  from(table: string): LooseQuery;
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<Result>;
}

function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}

export class SupabaseSupplierNewProductStore implements ISupplierNewProductStore {
  private readonly db: LooseClient;

  constructor(client: unknown, private readonly requestId: () => string = newRequestId) {
    this.db = client as LooseClient;
  }

  async knownMessageIds(ids: readonly string[]): Promise<ReadonlySet<string>> {
    if (ids.length === 0) return new Set();
    const { data, error } = await this.db
      .from('supplier_inbound_emails')
      .select('gmail_message_id, status')
      .in('gmail_message_id', ids);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('supplier_inbound_emails 回傳不是陣列');
    const known = new Set<string>();
    for (const raw of data) {
      const r = raw as { gmail_message_id?: unknown; status?: unknown };
      // failed 的不算讀過 ⇒ 下一輪重跑
      if (typeof r.gmail_message_id === 'string' && r.status !== 'failed') known.add(r.gmail_message_id);
    }
    return known;
  }

  async record(record: InboundMailRecord, draft: HomeBannerSystemDraft | null): Promise<'recorded' | 'duplicate'> {
    const { data, error } = await this.db.rpc('system_supplier_mail_record', {
      p_record: {
        gmail_message_id: record.gmailMessageId,
        gmail_thread_id: record.gmailThreadId,
        sender: record.sender,
        subject: record.subject,
        received_at: record.receivedAt,
        auth_passed: record.authPassed,
        status: record.status,
        extracted: record.extracted,
        error_code: record.errorCode,
      },
      p_draft:
        draft === null
          ? null
          : {
              eyebrow: draft.eyebrow,
              title_line1: draft.titleLine1,
              title_line2: draft.titleLine2,
              subtitle: draft.subtitle,
              cta_label: draft.ctaLabel,
              link_path: draft.linkPath,
              image_desktop_url: draft.imageDesktopUrl,
              image_kind: draft.imageKind,
              matched_variant_ids: draft.matchedVariantIds,
            },
      p_request_id: this.requestId(),
    });
    if (error) throw error;
    if (data === 'recorded' || data === 'duplicate') return data;
    throw new Error('system_supplier_mail_record 回傳碼不對');
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
