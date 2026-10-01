// newsletter-drafts-macmini.ts — mac mini 每天讀品牌電子報 ⇒ 首頁大圖 + FB / IG 草稿(2026-10-01)
//
// 計畫:~/pcm-mailbox/計畫-電子報草稿-macmini-20261001.md(主視窗批准:service_role 沿用 .env.local、imapflow、
//   配不到商品照現有設計記 no_products、應用程式密碼存鑰匙圈)。
// 流程就是 packages/use-cases/src/draft-supplier-newproduct-banners.ts;本檔只換兩個零件(IMAP 讀信、claude -p 起草)。
//
// 跑法(在網站 repo 根目錄):
//   TSX_TSCONFIG_PATH=apps/storefront/tsconfig.json node --conditions=react-server --import tsx apps/storefront/src/lib/supplier-mail/newsletter-drafts-macmini.ts           ⇐ 乾跑:不寫資料庫
//   TSX_TSCONFIG_PATH=apps/storefront/tsconfig.json node --conditions=react-server --import tsx apps/storefront/src/lib/supplier-mail/newsletter-drafts-macmini.ts --apply   ⇐ 真寫(launchd 用)
//   --conditions=react-server:讓 'server-only' 變成空模組(@pcm/adapters/server 有 import 它)。
//   TSX_TSCONFIG_PATH:讓 tsx 認得 storefront 的 @/ 別名(白名單 @/data/supplier-mail-senders)。
//
// 🔴 預設乾跑。乾跑也會叫 Claude(要看起草結果)、也會讀資料庫判斷「這封處理過沒」, 但不寫任何東西。
// 🔴 只讀 Gmail:資料夾唯讀開、BODY.PEEK(見 ImapMailReader)。
// 🔴 密碼從 macOS 鑰匙圈讀(服務名 pcm-newsletter-imap), 不進檔案、不印出來。
// 結束碼:0 = 正常;4 = 有信處理失敗(launchd 外面的 run_with_alert.sh 會送 AI 收件匣);1 = 整輪失敗(登入失敗等)。

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
// eslint-disable-next-line no-restricted-imports -- 受控例外(鏡像 src/lib/supplier-mail/composition.ts):本檔是 mac mini launchd 跑的 node 程式, 不進 Next build、不進 client bundle;service_role 金鑰讀自 mac mini 的 .env.local
import {
  ClaudeCliBannerCopywriter,
  ImapMailReader,
  SupabaseCatalogSkuMatcher,
  SupabaseSupplierNewProductStore,
  createSupabaseServiceClient,
} from '@pcm/adapters/server';
import type { HomeBannerSystemDraft, ISupplierNewProductStore, InboundMailRecord } from '@pcm/ports';
import { draftSupplierNewProductBanners } from '@pcm/use-cases';
import { SUPPLIER_MAIL_SENDERS } from '@/data/supplier-mail-senders';

const IMAP_USER = process.env.NEWSLETTER_IMAP_USER ?? 'dayun.info@gmail.com';
const MAILBOX = 'PCM新品';
const KEYCHAIN_SERVICE = 'pcm-newsletter-imap';
/** 一輪最多處理幾封(計畫 §5);超過的留到明天, 查詢式重疊 3 天。 */
const MAX_PER_RUN = 10;
/** 一封約 30–90 秒(claude -p);10 封留 30 分鐘。 */
const TIME_BUDGET_MS = 30 * 60 * 1000;

function imapPassword(): string {
  try {
    return execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', IMAP_USER, '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).replace(/\s+/g, ''); // Google 顯示的應用程式密碼是四組四個字母、中間有空白;貼進鑰匙圈時可能連空白一起
  } catch {
    throw new Error(`鑰匙圈裡找不到 ${KEYCHAIN_SERVICE}(帳號 ${IMAP_USER})。請先雙擊「存電子報信箱密碼.command」。`);
  }
}

/** 乾跑用:判斷「處理過沒」照讀資料庫, 記信不寫, 改成印出來給人看。 */
class DryRunStore implements ISupplierNewProductStore {
  constructor(private readonly real: ISupplierNewProductStore) {}
  knownMessageIds(ids: readonly string[]) {
    return this.real.knownMessageIds(ids);
  }
  async record(record: InboundMailRecord, draft: HomeBannerSystemDraft | null) {
    console.log(
      JSON.stringify(
        {
          信: { 寄件者: record.sender, 主旨: record.subject, 收到: record.receivedAt, 驗證通過: record.authPassed, 狀態: record.status, 錯誤: record.errorCode },
          抽到: record.extracted,
          草稿:
            draft === null
              ? null
              : {
                  眉標: draft.eyebrow, 標題一: draft.titleLine1, 標題二: draft.titleLine2, 副標: draft.subtitle, 按鈕: draft.ctaLabel,
                  連結: draft.linkPath, 圖: draft.imageDesktopUrl, 配到變體數: draft.matchedVariantIds.length, FB: draft.fbText ?? null, IG: draft.igText ?? null,
                },
        },
        null,
        2,
      ),
    );
    return 'recorded' as const;
  }
}

async function main(): Promise<number> {
  const apply = process.argv.includes('--apply');
  // 網站 repo 根目錄的 .env.local(NEXT_PUBLIC_SUPABASE_URL、SUPABASE_SECRET_KEY);不印任何值
  process.loadEnvFile(resolve(process.cwd(), '.env.local'));
  // createSupabaseServiceClient 讀 SUPABASE_SERVICE_ROLE_KEY;本機與 mac mini 的 .env.local 只有 SUPABASE_SECRET_KEY
  // (同一把 service 權限的金鑰, 報價單 sync_storefront_fitments.py 也用它寫網站庫)⇒ 沒設才補
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= process.env.SUPABASE_SECRET_KEY;

  const db = createSupabaseServiceClient();
  const realStore = new SupabaseSupplierNewProductStore(db);
  const reader = new ImapMailReader({ user: IMAP_USER, password: imapPassword(), mailbox: MAILBOX });
  try {
    const result = await draftSupplierNewProductBanners({
      reader,
      copywriter: new ClaudeCliBannerCopywriter(),
      matcher: new SupabaseCatalogSkuMatcher(db),
      store: apply ? realStore : new DryRunStore(realStore),
      senders: SUPPLIER_MAIL_SENDERS,
      maxPerRun: MAX_PER_RUN,
      timeBudgetMs: TIME_BUDGET_MS,
    });
    console.log(`[newsletter-drafts] ${apply ? '真寫' : '乾跑'} 一輪完成 ${JSON.stringify(result)}`);
    if (SUPPLIER_MAIL_SENDERS.length === 0) console.log('[newsletter-drafts] 寄件者白名單是空的 ⇒ 每封都會記成 skipped_sender');
    return result.failed > 0 ? 4 : 0;
  } finally {
    await reader.close();
  }
}

// 只在被 node 直接執行時跑;被別的檔 import(測試、誤用)不會連 IMAP、不會 exit
if (process.argv[1]?.endsWith('newsletter-drafts-macmini.ts')) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(`[newsletter-drafts] 整輪失敗:${error instanceof Error ? error.message : 'unknown'}`);
      process.exit(1);
    },
  );
}
