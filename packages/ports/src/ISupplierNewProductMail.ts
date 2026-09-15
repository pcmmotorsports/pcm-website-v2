/**
 * ISupplierNewProductMail —「每天讀廠商新品信 → 首頁大圖草稿」那一條線的 port(PRD 2026-09-15 §4、§12)。
 *
 * 🔴 四個介面各自可換:測試用假的 Gmail / 假的 AI / 假的 DB,真的在 `packages/adapters/src/supplier-mail/`。
 * 🔴 **不存信件全文**(Sean Q8 甲):`InboundMailMessage` 的內文只在記憶體裡用,落表的只有 `InboundMailRecord`。
 * 🔴 AI 只寫字(眉標 / 標題 / 副標 / 按鈕字);**連結與圖一律由程式決定**,AI 輸出只當草稿、畫面純文字渲染。
 */

/** 一封信(Gmail 讀回來、已解碼)。 */
export interface InboundMailMessage {
  readonly id: string;
  readonly threadId: string | null;
  /** 原始 From 標頭,例 `Akrapovic <news@akrapovic.com>`。 */
  readonly from: string;
  readonly subject: string | null;
  /** ISO。 */
  readonly receivedAt: string;
  /** `Authentication-Results` 標頭(可能多條);Gmail 收信時已經算好 SPF / DKIM / DMARC。 */
  readonly authenticationResults: readonly string[];
  readonly textBody: string | null;
  readonly htmlBody: string | null;
}

export interface IInboundMailReader {
  /** 依查詢式列出信件 id(最新的在前);權杖失效 / API 掛 ⇒ throw(整輪停)。 */
  listMessageIds(input: { query: string; max: number }): Promise<readonly string[]>;
  getMessage(id: string): Promise<InboundMailMessage>;
}

export interface BannerCopyInput {
  readonly subject: string | null;
  /** 純文字前段(呼叫端已截到 2,000 字)。 */
  readonly textExcerpt: string;
  readonly productTitles: readonly string[];
  readonly brandSlugs: readonly string[];
}

export interface BannerCopy {
  readonly eyebrow: string | null;
  readonly titleLine1: string;
  readonly titleLine2: string | null;
  readonly subtitle: string | null;
  readonly ctaLabel: string | null;
}

export interface IBannerCopywriter {
  draft(input: BannerCopyInput): Promise<BannerCopy>;
}

export interface CatalogSkuMatch {
  readonly variantId: string;
  readonly sku: string;
  readonly productTitle: string;
  readonly brandSlug: string;
}

export interface ICatalogSkuMatcher {
  /** 只回【上架中】且品牌在 brandSlugs 裡的料號。 */
  match(input: { skus: readonly string[]; brandSlugs: readonly string[] }): Promise<readonly CatalogSkuMatch[]>;
}

/** 同 DB `supplier_inbound_emails_status_check`(20260916150000)。 */
export type InboundMailStatus = 'drafted' | 'no_products' | 'skipped_sender' | 'skipped_auth' | 'failed';

export interface InboundMailRecord {
  readonly gmailMessageId: string;
  readonly gmailThreadId: string | null;
  /** 小寫寄件信箱。 */
  readonly sender: string;
  readonly subject: string | null;
  readonly receivedAt: string;
  readonly authPassed: boolean;
  readonly status: InboundMailStatus;
  /** 抽出來的料號 / 圖網址;**不含信件內文**。 */
  readonly extracted: Readonly<Record<string, unknown>> | null;
  /** 只放分類碼(`^[a-z0-9_]{1,64}$`),不放內容。 */
  readonly errorCode: string | null;
}

export interface HomeBannerSystemDraft {
  readonly eyebrow: string | null;
  readonly titleLine1: string;
  readonly titleLine2: string | null;
  readonly subtitle: string | null;
  readonly ctaLabel: string | null;
  readonly linkPath: string | null;
  readonly imageDesktopUrl: string | null;
  readonly imageKind: 'scene' | 'product';
  readonly matchedVariantIds: readonly string[];
}

export interface ISupplierNewProductStore {
  knownMessageIds(ids: readonly string[]): Promise<ReadonlySet<string>>;
  /**
   * 記一封信;draft 非 null ⇒ 同一個交易建草稿(`source_email_id` 指回這封)。
   * 'duplicate' = 這封已經被另一輪記過(兩輪重疊)⇒ 什麼都沒寫。
   */
  record(record: InboundMailRecord, draft: HomeBannerSystemDraft | null): Promise<'recorded' | 'duplicate'>;
}

/** 寄件者白名單一列(PRD §3.2;先放在 storefront 的 data 檔,DB 表是後面那一片)。 */
export interface SupplierMailSender {
  /** 完整信箱(`news@akrapovic.com`)或整個網域(`@akrapovic.com`);小寫。 */
  readonly sender: string;
  readonly brandSlugs: readonly string[];
  /** not_allowed ⇒ 只出文字草稿、不帶圖。 */
  readonly rightsPolicy: 'allowed' | 'ask_each_time' | 'not_allowed';
  /** 條款網址或「某年某月 email 同意」。 */
  readonly evidence?: string;
}
