import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MemberOrderDetail } from '@pcm/domain';

/**
 * 客人訂單明細列印頁(片 A:路由 + 授權)。
 *
 * 🔴🔴 **本檔最重要的一格,而它刻意【不是】那個直覺的斷言**(主視窗 2026-08-29 指定):
 * ```
 * ✅ 斷言：這一頁呼叫的是 findOrderDetailForCustomer
 * 🛑 而【不是】斷言：它有沒有過濾 customer_user_id
 * ```
 *    📌 **因為後者在有人重寫查詢時【照樣會綠】** —— 只要他也記得加那個過濾。
 *    ⇒ 而重點不是「這一次寫對了」,是**它與既有那條路綁在一起**:
 *      授權由 `SupabaseOrderAdapter.ts:824-825`(⛔ ~~`:815`~~ 那是簽章行)那支的 `.eq('display_id').eq('customer_user_id')`
 *      保證,而**這一頁不得自己重寫一份**。
 *    ⇒ 突變:把那個呼叫換成一個直接查詢 ⇒ 本檔的「它走既有那條路」那格**必須紅**。
 */

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ redirect: (u: string) => redirectMock(u) }));
// 🔴 `Header` / `HomeFooter` 是 client 元件(內含 `useCart` / `useRouter`)⇒ 不 mock 整檔紅,
//    而紅的理由與本檔任何一條斷言無關。形狀照隔壁 `[displayId]/page.test.tsx`。
//    🔴 而假件**不回 `null`, 回一個看得見的標記** —— 回 null 的話「出口在」與「出口不見了」
//       在 DOM 上是同一件事,而查無那一頁的整個重點就是【它有沒有出口】。
vi.mock('@/components/Header', () => ({
  Header: ({ currentPage }: { currentPage?: string }) => (
    <div data-stub='site-header' data-current-page={currentPage} />
  ),
}));
vi.mock('@/components/HomeFooter', () => ({ HomeFooter: () => <div data-stub='site-footer' /> }));

let currentUser: { id: string } | null = { id: 'owner-1' };
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: () =>
    Promise.resolve({ auth: { getUser: () => Promise.resolve({ data: { user: currentUser } }) } }),
}));

// 🔴 這個 spy 就是本檔的量具 —— 它記【這一頁呼叫了誰、帶了什麼】。
//    而假 repo 刻意複製真 adapter 的行為:只認「本人 + 該 displayId」,其餘一律回 `null`
//    (回 `null` 本身就是「不洩存在性」的機制:別人的單與不存在的單,在 caller 眼中同一個值)。
const findSpy = vi.fn(
  async (displayId: string, userId: string): Promise<MemberOrderDetail | null> =>
    displayId === 'A1B2C3' && userId === 'owner-1'
      ? ({ displayId: 'A1B2C3' } as MemberOrderDetail)
      : null,
);
vi.mock('@/lib/auth/composition', () => ({
  getOrderRepo: () => Promise.resolve({ findOrderDetailForCustomer: findSpy }),
}));

import OrderStatementRoute from './page';

async function render(displayId: string) {
  const el = await OrderStatementRoute({ params: Promise.resolve({ displayId }) });
  return renderToStaticMarkup(el);
}

describe('客人的訂單明細列印頁 —— 授權走既有那條路,而不是自己查', () => {
  beforeEach(() => {
    currentUser = { id: 'owner-1' };
    findSpy.mockReset();
    findSpy.mockImplementation(async (displayId: string, userId: string) =>
      displayId === 'A1B2C3' && userId === 'owner-1'
        ? ({ displayId: 'A1B2C3' } as MemberOrderDetail)
        : null,
    );
    redirectMock.mockClear();
  });

  it('🔴🔴 它呼叫的是 findOrderDetailForCustomer,而且帶著登入者的 id', async () => {
    await render('A1B2C3');
    // 🛑 這一格不驗「有沒有過濾 customer_user_id」—— 見檔頭。
    expect(findSpy).toHaveBeenCalledTimes(1);
    expect(findSpy).toHaveBeenCalledWith('A1B2C3', 'owner-1');
  });

  it('✅ 正對照:是本人的單 ⇒ 印得出單號(否則下面每一格都可能是恆真)', async () => {
    const html = await render('A1B2C3');
    expect(html).toContain('A1B2C3');
    expect(html).toContain('訂單明細');
  });

  it('🔴🔴 別人的單 與 不存在的單 ⇒ 兩份 HTML【逐字相等】(不洩存在性)', async () => {
    // 🔴 **這一格原本寫成兩個 `toContain('查無此訂單')`** —— 而那個標題寫「同一個畫面」,
    //    斷言卻只驗「都含那四個字」⇒ **有人把它分流成兩個 branch 時它不會紅**
    //    (code-reviewer 2026-08-29:「標題比斷言寬」)。改成整份比對,零成本。
    currentUser = { id: 'someone-else' };
    const someoneElses = await render('A1B2C3');
    currentUser = { id: 'owner-1' };
    const doesNotExist = await render('ZZZZZZ');
    expect(someoneElses).toBe(doesNotExist);
    expect(someoneElses).toContain('查無此訂單');
    // 🔴 而拍板字面要在:那句模糊是【資安性質】的,不是文案。
    expect(someoneElses).toContain('您所有的訂單都在訂單記錄裡');
    // 🔴 **兩份都要跑迴圈** —— R2:`someoneElses` 是用 'A1B2C3' 渲染的,
    //    'ZZZZZZ' 從未進過那一發的作用域 ⇒ 那個成員【永遠過】,讀起來像查了兩個世界。
    for (const html of [someoneElses, doesNotExist])
      for (const leak of ['A1B2C3', 'ZZZZZZ']) expect(html).not.toContain(leak);
  });

  it('🔴 查無那一頁【要有出口】—— 桌機沒有頁首就是走不回商店', async () => {
    // 隔壁 `page.test.tsx` 那一格逐字:「查無畫面沒有頁首 ⇒ 那才是最需要出口的一頁」。
    // ⚠️ 而只靠 MobileTabBar 是假的:它 <1080px 才在 ⇒ 手機有、桌機沒有。
    currentUser = { id: 'someone-else' };
    const html = await render('A1B2C3');
    expect(html).toContain('data-stub="site-header"');
    expect(html).toContain('data-stub="site-footer"');
  });

  it('🔴 而成功那條路【刻意不加】頁首頁尾 —— 它是列印版面', async () => {
    // 🔴 **兩個都要驗** —— R2 2026-08-29:標題寫「頁首頁尾」而斷言只有 header
    //    ⇒ 在成功那條路加 `<HomeFooter />` 這一格【照樣會綠】。同一個病換一格復發。
    const html = await render('A1B2C3');
    expect(html).not.toContain('data-stub="site-header"');
    expect(html).not.toContain('data-stub="site-footer"');
  });

  it('🔴 網址帶 `%` 不得炸掉 —— 而它要【原樣】送進 repo,不再解碼一次', async () => {
    // 本頁直接用 `await params`(不再解一次),刻意不再 `decodeURIComponent`:
    // 再解一次會讓裸 `%` 拋 URIError ⇒ **繞過查無畫面、直接 500**。
    // 🔴 而那條立場原本【一格都沒有在守】(code-reviewer 2026-08-29)。
    await expect(render('100%')).resolves.toBeTruthy();
    expect(findSpy).toHaveBeenCalledWith('100%', 'owner-1');
  });

  it('🔴 未登入 ⇒ redirect,而 next 要導回【這一頁】不是訂單詳情頁', async () => {
    currentUser = null;
    await expect(render('A1B2C3')).rejects.toThrow(/REDIRECT:/);
    const url = redirectMock.mock.calls[0]?.[0] ?? '';
    expect(url).toContain('/login?next=');
    // ⚠️ 少了 `/statement` 那一段,客人登入後會被丟回訂單頁而不是他按的那一頁。
    expect(decodeURIComponent(url)).toContain('/account/orders/A1B2C3/statement');
  });

  it('🔴 未登入時【不得】去查訂單 —— 順序錯了就是先查再擋', async () => {
    currentUser = null;
    await expect(render('A1B2C3')).rejects.toThrow(/REDIRECT:/);
    expect(findSpy).not.toHaveBeenCalled();
  });

  it('🔴 讀取拋錯 ⇒ 退化成「查無」而不是 500', async () => {
    findSpy.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const html = await render('A1B2C3');
    expect(html).toContain('查無此訂單');
  });

  it('⚠️ 標題只用固定字 —— 單號不得進 <title>(分頁/歷史/分享預覽都不受登入保護)', async () => {
    const { metadata } = await import('./page');
    expect(metadata.title).toBe('訂單明細 | PCM MOTOR PARTS');
    expect(String(metadata.title)).not.toContain('A1B2C3');
  });
});
