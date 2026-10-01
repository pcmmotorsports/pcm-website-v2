// 每日自動新品草稿的組裝(2026-10-01, 計畫 ~/pcm-mailbox/計畫-每日自動新品草稿-20261001.md)。
import 'server-only';
// eslint-disable-next-line no-restricted-imports -- 受控例外(鏡像 supplier-mail/composition.ts):composition root 注入每日新品草稿的 server-only adapter;SupabaseNewProductSource / SupabaseNewProductDraftStore 持 service_role client(system_new_product_draft 只給 service_role),皆 server-only 不進 client bundle;route 只 import 本檔 factory。
import { SupabaseNewProductDraftStore, SupabaseNewProductSource, createSupabaseServiceClient } from '@pcm/adapters/server';
import type { DraftNewProductPostsDeps } from '@pcm/use-cases';

export function getNewProductDraftDeps(siteUrl: string): DraftNewProductPostsDeps {
  const db = createSupabaseServiceClient();
  return {
    source: new SupabaseNewProductSource(db),
    store: new SupabaseNewProductDraftStore(db),
    siteUrl,
  };
}
