import 'server-only';
// eslint-disable-next-line no-restricted-imports -- 受控例外(鏡像 email/composition.ts、payment/composition.ts):composition root 注入每日讀信起草的 server-only adapter;SupabaseSupplierNewProductStore / SupabaseCatalogSkuMatcher 持 service_role client、GmailApiReader 持 Gmail refresh token、AnthropicBannerCopywriter 持 API key,皆 server-only 不進 client bundle;route 只 import 本檔 factory。
import {
  AnthropicBannerCopywriter,
  GmailApiReader,
  SupabaseCatalogSkuMatcher,
  SupabaseSupplierNewProductStore,
  createSupabaseServiceClient,
} from '@pcm/adapters/server';
import type { DraftSupplierNewProductBannersDeps } from '@pcm/use-cases';
import { SUPPLIER_MAIL_SENDERS } from '@/data/supplier-mail-senders';

// composition.ts — 每日讀信起草那條線的依賴組裝。route 只在旗標開、env 齊的時候才呼叫這支。

export interface SupplierMailEnv {
  readonly gmailClientId: string;
  readonly gmailClientSecret: string;
  readonly gmailRefreshToken: string;
  readonly anthropicApiKey: string;
}

export function getSupplierNewProductDraftDeps(env: SupplierMailEnv): DraftSupplierNewProductBannersDeps {
  const db = createSupabaseServiceClient();
  return {
    reader: new GmailApiReader({ clientId: env.gmailClientId, clientSecret: env.gmailClientSecret, refreshToken: env.gmailRefreshToken }),
    copywriter: new AnthropicBannerCopywriter({ apiKey: env.anthropicApiKey }),
    matcher: new SupabaseCatalogSkuMatcher(db),
    store: new SupabaseSupplierNewProductStore(db),
    senders: SUPPLIER_MAIL_SENDERS,
  };
}
