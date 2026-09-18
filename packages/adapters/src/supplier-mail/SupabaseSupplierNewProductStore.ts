import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CatalogSkuMatch,
  HomeBannerSystemDraft,
  ICatalogSkuMatcher,
  ISupplierNewProductStore,
  InboundMailRecord,
} from '@pcm/ports';
import type { Database, Json } from '../supabase/database.types';

/**
 * 讀信紀錄 + 系統草稿的寫入面、料號配對的讀取面(DB 20260916150000 / 20260916170000)。
 *
 * 🔴 寫入只走 `system_supplier_mail_record`(20260916170000):記信 + 建草稿同一個交易、actor 固定 `system:mail-draft`。
 * 🔴 **failed 重跑規則**:`knownMessageIds` 不把 status = 'failed' 的信當成讀過 ⇒ 下一輪再處理;
 *    RPC 遇到 failed 那一列會覆寫(created_at 不動)。上限靠 Gmail 查詢式 `newer_than:3d`(約 3 輪)。
 * ⛔ ~~🔵 生成型別還沒有這兩張表 / 這支 RPC ⇒ 窄的 loose client,回傳逐欄驗。~~
 * 🟢 **2026-09-18:那句已經反了。** 生成型別現在有 `supplier_inbound_emails` / `product_variants`
 *    兩張表,也有 `system_supplier_mail_record` ⇒ **兩個 class 的 constructor 都收
 *    `SupabaseClient<Database>`**,`.rpc()` 的函式名與參數名由 typecheck 守。
 *    (同批把 `Result` / `LooseQuery` / `LooseClient` 三個宣告刪掉 —— 它們已經沒有人引用,
 *     而 eslint 沒開 `no-unused-vars`、tsconfig 沒開 `noUnusedLocals` ⇒ **留著三綠不會叫**,
 *     而下一個人 grep 到 `LooseClient` 會以為這裡還有現成的逃生口可以複用。)
 * 🔴 **而【還沒守住】的那一格照實寫**:`p_record` / `p_draft` 在簽章上是 `Json`
 *    ⇒ **它們【內層】的 snake_case 鍵名(`gmail_message_id`、`title_line1`…)仍然不受 typecheck 管。**
 *    今天守那一層的是 `SupabaseSupplierNewProductStore.test.ts` 與 DB 那側的 jsonb 檢核,不是型別。
 */

function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}

export class SupabaseSupplierNewProductStore implements ISupplierNewProductStore {
  private readonly db: SupabaseClient<Database>;

  constructor(
    client: SupabaseClient<Database>,
    private readonly requestId: () => string = newRequestId,
  ) {
    this.db = client;
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
        // 🔴🔴 **這個 cast 與下面 `matched_variant_ids` 那個【不是同一種】, 分開講(R1 審查訂正)。**
        //    ⛔ ~~原本寫「`extracted` 是 interface, TS 不認 interface 滿足 Json」~~ —— **那個理由是錯的**:
        //       它在 ports 那側是 `Readonly<Record<string, unknown>> | null`(`ISupplierNewProductMail.ts:75`),
        //       不是 interface。
        //    🛑 **真正的原因是【值的型別是 `unknown`】** ⇒ 這個 cast **在型別上並不成立**:
        //       未來有人往 `extracted` 塞 `Date` / `undefined` / `BigInt`, **這裡不會紅**
        //       (BigInt 序列化時 throw、`undefined` 會靜靜掉鍵)。
        //    🔵 **而它不是本次造成的**:改之前 constructor 收 `unknown`, 同樣沒守 ⇒ 不是回歸。
        //       今天唯一的生產者 `packages/use-cases/src/draft-supplier-newproduct-banners.ts`
        //       只塞三個 `string[]`, 而 DB 那欄是 jsonb, 收得下。
        //    ⇒ 🙋 **要真的守住得改 ports 的 `extracted` 型別 —— 那是另一件, 不在本件界線內。**
        extracted: record.extracted as Json,
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
              // 🟢 **這一個 cast 型別上【可證成立】**(與上面那個不同):元素型別就是 `string`,
              //    只是 `readonly string[]` 不滿足 `Json[]`(`Json` 要可變陣列)—— 純變異性摩擦。
              //    🛑 **刻意不用 `[...draft.matchedVariantIds]` 展開** —— 那會是一次 runtime 變更,
              //       而本件的界線是**零行為變更**。送出去的 JSON 兩種寫法一模一樣,
              //       所以選不動 runtime 的那一種。
              matched_variant_ids: draft.matchedVariantIds as Json,
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
  private readonly db: SupabaseClient<Database>;

  constructor(client: SupabaseClient<Database>) {
    this.db = client;
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
