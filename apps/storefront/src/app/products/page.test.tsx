// @vitest-environment node
//
// app/products/page.tsx metadata 守門 — W9e-005(2026-08-20)
//
// 🔴 這支測試守不住這次的缺口:2026-08-19 那次「PCM Motorsports → PCM重機零件販售」改名
// commit(2111bff8)在 dev 上是對的(這支測試會綠),而 origin/main(顧客站生產環境綁的分支)
// 當時已經停在改名前 10 小時的 commit、之後再沒合併過 —— 顧客看到舊名字的原因是分支從沒
// 合併,不是字面改錯或漏測。**這支測試通過只證明「dev 上的字面對」,不證明「顧客看到的對」。**
// 詳見 ~/pcm-mailbox/W9e-005-站名落地-plan-20260820.md §0/§5/§6。

import { describe, expect, it, vi } from 'vitest';

// 🔴 必須 mock:本檔只要 `metadata`(靜態 const,不需真的 render),但 import './page' 會連帶
//    載入 `@/lib/products` / `@/lib/supabase/server` / `@/lib/auth/composition` ——
//    三支都 `import 'server-only'`,在 vitest(非 RSC 邊界)載入即 throw(同 brands/page.test.tsx
//    檔頭註解那個坑)。這裡只要它們不炸,不需要真的可用 —— 本測試不呼叫任何一個。
vi.mock('@/lib/products', () => ({
  fetchCatalogPage: vi.fn(),
  fetchCatalogBrandTaxonomy: vi.fn(),
  fetchCategories: vi.fn(),
  fetchVehicleTaxonomy: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock('@/lib/auth/composition', () => ({ getVehicleRepo: vi.fn() }));

const { metadata } = await import('./page');

describe('/products · metadata', () => {
  it('🔴 分頁標題 = 商品目錄 — PCM重機零件販售,不是舊名 PCM Motorsports', () => {
    expect(metadata.title).toBe('商品目錄 — PCM重機零件販售');
    expect(String(metadata.title)).not.toContain('PCM Motorsports');
  });
});
