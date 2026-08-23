// @vitest-environment node
//
// app/layout.tsx metadata 守門 — W9e-005(2026-08-20)
//
// 🔴 這支測試守不住這次的缺口:2026-08-19 那次「PCM Motorsports → PCM重機零件販售」改名
// commit(2111bff8)在 dev 上是對的(這支測試會綠),而 origin/main(顧客站生產環境綁的分支)
// 當時已經停在改名前 10 小時的 commit、之後再沒合併過 —— 顧客看到舊名字的原因是分支從沒
// 合併,不是字面改錯或漏測。**這支測試通過只證明「dev 上的字面對」,不證明「顧客看到的對」。**
// 詳見 ~/pcm-mailbox/W9e-005-站名落地-plan-20260820.md §0/§5/§6。

import { describe, expect, it, vi } from 'vitest';

// 🔴 本檔只讀 `metadata`,而 `import('./layout')` 會把整支 layout 拉進來 ——
//   2026-08-23 A1 之後 layout 多了 `@/lib/supabase/server`(內含 `next/headers`),
//   在 vitest 的 node 環境會炸「This module cannot be imported from a Client Component module」。
//   ⇒ 把它擋在門口。**這不是在跳過檢查** —— 這支測試從頭到尾就只驗字面 metadata,
//     而 server client 的行為由真瀏覽器序列與 CartContext.test.tsx 那幾格顧。
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => {
    throw new Error('layout.test 不驗 auth:本檔只讀 metadata');
  },
}));

const { metadata } = await import('./layout');

describe('RootLayout · metadata', () => {
  it('🔴 站名 = PCM重機零件販售,不是舊名 PCM Motorsports', () => {
    expect(String(metadata.title)).toContain('PCM重機零件販售');
    expect(String(metadata.title)).not.toContain('PCM Motorsports');
    expect(metadata.openGraph?.siteName).toBe('PCM重機零件販售');
  });
});
