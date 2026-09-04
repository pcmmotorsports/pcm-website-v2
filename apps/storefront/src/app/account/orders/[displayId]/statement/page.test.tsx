import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { toMoneyAmount, type MemberOrderDetail } from '@pcm/domain';

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
// 🔴 `next/font/google` 是**建置期轉換**、不是執行期模組 —— 不 mock 的話整檔紅在
//    `Noto_Sans_TC is not a function`(2026-08-31 片 B 實際撞到),而那個紅與本檔任何斷言無關。
//    🛑 **而這不是把守門關掉**:下面有一格拿這個假值去驗「它有沒有被接到那張紙上」。
//    🔴 假件回一個**看得見的標記**,不回空字串 —— 回空的話「接上了」與「沒接」在 DOM 上是同一件事。
//
// 🔴🔴 **假件的值刻意是一個【世界上只有一個】的哨兵字串,而不是真實產物那一串** ——
//    這一格被推翻過一次,兩邊的理由都寫著,因為它是分工問題不是對錯問題:
//    ⛔ R1(codex):用哨兵 ⇒ 把 production 真正的問題(與 root layout 那條 Google CDN
//       `<link>` 宣告的家族【同名】)抹掉了 ⇒ 我改成寫死真值 `"Noto Sans TC", …Fallback`。
//    ✅ R2(codex):寫死真值 ⇒ **mock 與斷言各自抄了一份同樣的字串** ⇒ Next 哪天改了
//       家族名的產生方式,這兩份會一起維持不變 ⇒ **它會安靜地繼續全綠**。
//    ⇒ 📌 **分工定案**:接線用哨兵(不會漂),**真實產物那一串由
//       `components/print/statement-cascade-browser.test.tsx` 從【編譯產物】裡撈** ——
//       那支不寫死任何期望值,Next 改名它就會紅。
const FONT_SENTINEL = 'PCM-FONT-SENTINEL-8f2a';
vi.mock('next/font/google', () => ({
  Noto_Sans_TC: () => ({ className: 'stub-font', style: { fontFamily: 'PCM-FONT-SENTINEL-8f2a' } }),
}));

let currentUser: { id: string } | null = { id: 'owner-1' };
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: () =>
    Promise.resolve({ auth: { getUser: () => Promise.resolve({ data: { user: currentUser } }) } }),
}));

// 🔴 這個 spy 就是本檔的量具 —— 它記【這一頁呼叫了誰、帶了什麼】。
//    而假 repo 刻意複製真 adapter 的行為:只認「本人 + 該 displayId」,其餘一律回 `null`
//    (回 `null` 本身就是「不洩存在性」的機制:別人的單與不存在的單,在 caller 眼中同一個值)。
// 🔴 **這份 fixture 是【完整的】,不是 `{ displayId } as MemberOrderDetail`。**
//    片 A 時它就是後者,而那個 `as` 讓 TypeScript 閉嘴、讓 10 格全綠 ——
//    直到片 B 真的去讀 `shippingAddress.name` 才炸(`Cannot read properties of undefined`)。
//    📌 **⇒ 一個 `as` 把「這些欄位不存在」變成了一件三綠看不到的事。**
//    ⇒ 欄位形狀對著 `packages/adapters/src/supabase/SupabaseOrderAdapter.test.ts:2746` 那份
//      真 adapter 的回傳期望值抄,**不自己發明欄位**。
// 🔴 走 `toMoneyAmount()` 而不是 `as MoneyAmount` —— `packages/domain/src/shared/types.ts:15`
//    逐字「強制走 toMoneyAmount() helper 集中守門、不允許 `as MoneyAmount` 強轉」。
const twd = (amount: number) => ({ amount: toMoneyAmount(amount), currency: 'TWD' as const });

function orderFixture(over: Partial<MemberOrderDetail> = {}): MemberOrderDetail {
  return {
    id: 'o1',
    displayId: 'A1B2C3',
    createdAt: '2099-04-15T10:00:00Z',
    paymentStatus: 'paid',
    fulfillmentStatus: 'shipped',
    paymentMethod: 'tappay',
    // 🔵 段 3 加欄:這些 fixture 演的是【已付款的刷卡單】⇒ 填 'tappay',
    //   不是「隨便填一個讓它綠」——填的是這個 fixture 本來就在演的那個世界。
    paymentChannel: 'tappay' as const,
    paidAt: '2099-04-18T03:00:00Z',
    shippedAt: null,
    allItemsShipped: false,
    subtotal: twd(12000),
    shippingFee: twd(100),
    discountTotal: twd(0),
    taxTotal: twd(0),
    total: twd(12100),
    shippingMethod: 'home',
    shippingAddress: {
      name: '王小明',
      phone: '0912345678',
      line: '新北市新莊區化成路 736 巷 18 號',
    },
    cancelledAt: null,
    cancelKind: 'none',
    items: [
      {
        id: 'oi1',
        variantSku: 'SKU-1',
        brand: 'CNC RACING',
        title: '下鏈條蓋',
        spec: { color: 'black' },
        imageUrl: null,
        vehicle: null,
        quantity: 2,
        unitPrice: twd(6000),
        lineTotal: twd(12000),
        shipped: false,
      },
    ],
    itemCount: 2,
    itemsTruncated: false,
    ...over,
  };
}

let orderOverride: Partial<MemberOrderDetail> = {};

const findSpy = vi.fn(
  async (displayId: string, userId: string): Promise<MemberOrderDetail | null> =>
    displayId === 'A1B2C3' && userId === 'owner-1'
      ? orderFixture({ displayId: 'A1B2C3', ...orderOverride })
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
    orderOverride = {};
    findSpy.mockReset();
    findSpy.mockImplementation(async (displayId: string, userId: string) =>
      displayId === 'A1B2C3' && userId === 'owner-1'
        ? orderFixture({ displayId: 'A1B2C3', ...orderOverride })
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

  // 片 B(2026-08-31):自 host 的中文字型有沒有真的被接到那張紙上。
  //
  // 🛑🛑 **這一格證得了什麼、證不了什麼 —— 這一段比斷言本身重要**(codex R1 must-fix 要求寫明):
  //    ✅ 證得了:route 把 `next/font` 回的家族名串到了 `.pd-sheet` 的 `--font-statement` 上。
  //    🔴 **證不了本片真正的承諾**:「伺服器產 PDF 時,字是我們自己 host 的那份畫的」。
  //       理由有三,每一條都是這支檔結構上做不到的:
  //         ① 贏家由 CSS 層疊決定,而 DOM 字串裡看不到層疊
  //         ② 這裡沒有載入 root layout 那條 Google CDN `<link>` ⇒ **同名衝突根本沒被製造出來**
  //         ③ 這裡沒有真的瀏覽器去解析 `@font-face` 與 unicode-range
  //    ✅ ①③ 已由 `components/print/statement-cascade-browser.test.tsx` 那一節接手(真 chromium
  //       + 編譯產物 CSS + 兩個世界),而它的期望值從產物撈、不寫死。
  //    🔴 ② **仍然沒有人在跑** —— 那要起真 server + 攔網路,是**片 C** 的驗收條件:
  //       用 CDP `CSS.getPlatformFontsForNode` 比【擋 Google 前 / 後】兩個世界的字型來源。
  //       2026-08-31 手動量過一次(自家 0/Google 17 ⇒ 自家 15/Google 0),**而那一發沒有被自動化。**
  it('片 B:字型家族名有接到 .pd-sheet 的 --font-statement 上(只證接線,不證誰贏)', async () => {
    const html = await render('A1B2C3');
    // 🔴 哨兵直接比,不必處理跳脫 —— 它裡面沒有引號。
    //    (而「React 有沒有跳脫這個自訂屬性的值」那一格是真的驗過的:上一版用含雙引號的真值,
    //     比原字串 ⇒ 紅,輸出裡是 `&quot;` ⇒ 值進不了屬性邊界。那是 codex R1 問的注入面。)
    expect(html).toContain(`--font-statement:${FONT_SENTINEL}`);
    // 負對照:那張紙的 class 字面一個都沒動(`statement-doc-classes.test.ts` 只掃字面的 class 屬性)
    expect(html).toContain('class="print-sheet pd-sheet stmt-page"');
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

  // ══════════════════════════════════════════════════════════════════════
  // 片 B(版面)—— Sean 2026-08-30 `Q-容差 = 甲`「客人下載的明細 = 後台那張,一模一樣」
  // ══════════════════════════════════════════════════════════════════════

  it('🔴 紙上有【收件三格】與【金額四格】—— 這是他親口要的內容,不是版面偏好', async () => {
    const html = await render('A1B2C3');
    for (const must of ['王小明', '0912345678', '新北市新莊區化成路 736 巷 18 號']) {
      expect(html, `收件資訊少了 ${must}`).toContain(must);
    }
    for (const must of ['小計', '運費', '訂單金額', '12,100']) {
      expect(html, `金額區少了 ${must}`).toContain(must);
    }
    // 品項那一列的三個數字都要在(數量 / 單價 / 小計)
    expect(html).toContain('SKU-1');
    expect(html).toContain('下鏈條蓋');
    expect(html).toContain('6,000');
    expect(html).toContain('12,000');
  });

  it('🔴🔴 紙上【不得】洩營運內部數量 —— 那是「一模一樣」少掉的那一欄', async () => {
    const html = await render('A1B2C3');
    // 🔴 這一格守的是 `SupabaseOrderAdapter.ts:420-421` 那條紅線:
    //    「客人看得到『已向上游訂了幾件』等於看得到採購節奏。」
    //    上游那道守門守的是**投影字面**;這一格守的是**紙上**。兩層不可互相抵。
    for (const leak of ['未到貨', '數量資料尚未就緒', 'quantity_summary', '應揀', '揀貨', '供應商']) {
      expect(html, `紙上出現了不該有的 ${leak}`).not.toContain(leak);
    }
    // 🔴 **負對照**:證明上面那六條不是因為 HTML 是空的才全過。
    expect(html).toContain('品項明細');
    expect(html).toContain('料號');
  });

  it('🔴 紙上不得有那兩句被拍掉的東西(Sean 2026-08-30 傍晚)', async () => {
    // 🔴 **為什麼要有這一格**(code-reviewer 抓):後台同一片**補了反向格**
    //    (`apps/admin/src/app/print/orders/[id]/picking/page.test.tsx:274` contbar `toBeNull`、
    //     `:283` `not.toContain('本訂單全部品項')`), 而顧客站這一側**零格**。
    //    ⇒ 有人把它們加回 `statement-doc.tsx` ⇒ **三綠全綠、checksum 全綠、沒有東西紅**,
    //      而那是 Sean 剛拍的板。
    // 📌 **⇒ 而 checksum 那道守門【看不到這一格】** —— 它比的是三個共用檔,
    //    版面元件是兩份各自寫的。**今天改的正是元件, 而它沒紅。**
    const html = await render('A1B2C3');
    expect(html, '「本訂單全部品項」那句小字回來了 —— 那是 Sean 拍掉的').not.toContain(
      '本訂單全部品項',
    );
    expect(html, '續頁抬頭那一列回來了 —— 那是 Sean 拍掉的').not.toContain('pd-contbar');
    expect(html, '「續頁欄名重複」那六個字回來了').not.toContain('續頁欄名重複');
    // 🔴 **正對照**:證明上面三個 0 不是因為 render 失敗或 HTML 是空的。
    //    而它們刻意挑【留下來的那半】—— `品項明細` 這個標題與 `pd-colhead` 那一列都還在。
    expect(html).toContain('品項明細');
    expect(html).toContain('pd-colhead');
  });

  it('🔴 紙上【不印付款資訊】—— Sean 2026-08-30 拍【乙】,這是拍板不是漏做', async () => {
    // 🔴 **為什麼要有這一格, 而不是只寫一句註解**(機制優先律):
    //    `MemberOrderDetail` **有** `paymentStatus`/`paymentMethod`/`paidAt` 三欄
    //    (`packages/domain/src/order/types.ts:1712-1730`), 而紙上一個都沒有
    //    ⇒ **下一個人看到的形狀長得就像沒做完** ⇒ 他會「順手補上」。
    //    ⇒ 註解攔不住他(他不會先讀檔頭), 而這一格會當場紅並告訴他那是一板。
    const html = await render('A1B2C3');
    for (const leak of ['付款方式', '付款完成', '已付款', '尚未付款', 'tappay']) {
      expect(
        html,
        `紙上出現了「${leak}」—— 而 Sean 2026-08-30 拍【乙】= 不印付款資訊。` +
          '要加回來需要新的拍板,不是順手補。',
      ).not.toContain(leak);
    }
    // 🔴 **正對照**:證明上面五條不是因為 HTML 是空的、或 render 失敗才全過。
    //    (今天量到的那個 0 若沒有它, 與「這把尺根本沒讀到東西」印同一個結果。)
    expect(html).toContain('訂單明細');
    expect(html).toContain('A1B2C3');
    // 🔴 **而金額【要在】** —— 拍掉的是「付了沒」, 不是「多少錢」。兩者不要一起弄丟。
    expect(html).toContain('12,100');
  });

  it('🔴 已取消的單:**照印**(那是他的記錄),而取消這件事要印在紙上', async () => {
    // 🔴 `cancelKind` 只有三值(`OrderCancelKind = 'none' | 'expired' | 'cancelled'`,
    //    `packages/domain/src/order/order-cancel-reason.ts:48`)。
    //    ⛔ ~~我第一版寫 `'full' as never`~~ —— **那是一個 domain 造不出來的值**,
    //       而 `as never` 正是讓它過 typecheck 的東西(R1 must-fix)。
    //       今天沒有人讀 `cancelKind` 所以行為不變,**而它會教下一個人一個不存在的狀態**。
    orderOverride = { cancelledAt: '2099-04-20T02:30:00Z', cancelKind: 'cancelled' };
    const html = await render('A1B2C3');
    // 🛑 後台那張對已取消是**整幅阻印**,理由是「員工會照著去倉庫揀一批不該出的貨」——
    //    那是一個**實體動作**的守門,而客人這一側沒有那個動作。
    //    ⇒ 照抄過來會變成「你自己的訂單記錄不給你看」。
    expect(html, '品項表被整幅擋掉了 ⇒ 客人拿不到自己的記錄').toContain('SKU-1');
    expect(html).toContain('data-slot="statement-cancelled"');
    expect(html).toContain('取消');
    // 日期要是**台北時間**:UTC 02:30 ⇒ 台北 10:30(+8)
    expect(html, '取消時間沒有換成台北時間').toContain('2099-04-20 10:30');
  });

  it('🔴 讀不到任何品項 ⇒ 印一句話,**不印一張只有表頭的空表格**', async () => {
    orderOverride = { items: [], itemCount: 0 };
    const html = await render('A1B2C3');
    expect(html).toContain('data-slot="statement-no-items"');
    // 空表格看起來像「這張單沒有東西」,而它其實可能是資料讀取出問題 ⇒ 表頭不得在
    expect(html, '印了一張空表格').not.toContain('料號');
    // 🔴 **而聯絡方式與金額表【仍然要在】**(R1 nit):它們原本住在「有品項」那一支
    //    ⇒ 讀不到品項時整塊消失 ⇒ **一句「請與客服聯絡」旁邊沒有客服**,
    //      而那正是最需要它的那一張紙。
    expect(html, '讀不到品項時連客服 QR 都不見了').toContain('加入官方 LINE 帳號');
    expect(html, '讀不到品項時金額表也不見了').toContain('訂單金額');
  });

  it('🔴 清單沒載完 ⇒ 表【自己】要說它沒有結尾,不是只在表尾講一句', async () => {
    orderOverride = { itemsTruncated: true };
    const html = await render('A1B2C3');
    expect(html).toContain('data-slot="statement-truncated-band"');
    // 佔位列的 `? ? ? ?` —— 上游只給布林,印任何具體數字就是編的
    expect(html).toContain('? ? ? ?');
    expect(html).toContain('清單沒載完');
  });

  it('🔴 折扣是 0 ⇒ 不印那一列(印 0 會讓客人以為我們算了一筆折扣給他)', async () => {
    const zero = await render('A1B2C3');
    expect(zero).not.toContain('折扣');
    // 🔴 翻面 —— 沒有這一半,上面那條在「折扣列永遠不印」時也會綠
    orderOverride = { discountTotal: twd(500) };
    const some = await render('A1B2C3');
    expect(some).toContain('折扣');
    expect(some, '負號要用 ASCII 的 -,不是 U+2212').toContain('-500');
    expect(some).not.toContain('\u2212');
  });

  it('🔴 列印鈕在,而它包在 `.stmt-actions` 裡(紙上不准有它 —— 那一格靠 CSS)', async () => {
    const html = await render('A1B2C3');
    expect(html).toContain('data-slot="statement-print-button"');
    // ⚠️ 這一格**證不了它在紙上不見** —— `@media print{.stmt-actions{display:none}}`
    //    只有真的按下列印才看得到 ⇒ 那一格留給肉眼驗。這裡只證它有被那個容器包住。
    // ⛔ ~~`/class="stmt-actions"[^]*?data-slot="statement-print-button"/`~~
    //    🔴 **那個 `[^]*?` 跨得過 `</div>`** ⇒ 它證的是【先後】不是【包住】
    //       ⇒ 把鈕搬到 `.stmt-actions` 外面它照樣綠,而「紙上藏鈕」已經壞了(R3 抓)。
    //    ✅ 改成斷言**相鄰字面** —— 中間不准有任何東西。
    expect(html).toContain('class="stmt-actions"><button');
  });

  it('⚠️ 標題只用固定字 —— 單號不得進 <title>(分頁/歷史/分享預覽都不受登入保護)', async () => {
    const { metadata } = await import('./page');
    expect(metadata.title).toBe('訂單明細 | PCM MOTOR PARTS');
    expect(String(metadata.title)).not.toContain('A1B2C3');
  });
});
