import { test, expect } from '@playwright/test';

/**
 * 購物車 e2e —— 守「網路抖一下,客人整車商品消失」(`docs/launch-todo.md` I 節第 1 列)。
 *
 * 🔴 **它守兩件事,而第二件才是那一列的災難形狀**:
 *   ① 撈不到時客人看到「**你的東西還在,我現在讀不到**」而不是「購物車是空的」
 *      (`CartView.tsx:122` 逐字:`empty`「你沒有東西」/ `error`「你的東西還在」;
 *       分岔本身在 `:124`)
 *   ② 🔴 **那一刻角標仍然數得出件數** —— `useResolvedCart.tsx:123-127` 逐字警告:
 *      「若把移除搬到 effect 外層…**一次網路抖動就會清光客人整車**」。
 *      ⇒ 只驗①的話,那個回歸【照樣印錯誤標題】而這支全綠。②是它唯一抓得到的地方。
 *
 * 🔴 **失敗是這支測試【自己造的】,不是撿環境的** ——
 *   `resolveCartLines` 是 server action(`useResolvedCart.tsx:26` import 自 `@/app/cart/actions`)
 *   ⇒ 它 POST 到當前頁網址 ⇒ 攔掉那一發 POST 就是「網路抖一下」。
 *   ⚠️ **第一版不是這樣寫的**:第一版靠「工作樹沒有 `.env.local` ⇒ supabase client 拋錯」。
 *      R1 打死它 —— 那個條件**每棵樹不一樣**(主樹有 `.env.local`),而且
 *      **「今天為什麼綠」變成一個沒有人知道答案的問題**。
 *      📌 **一個撿來的世界與一個造出來的世界,都印同一個綠。**
 *
 * 🔴🔴 **而【改成自己造】之後我做了區分實驗,結果要寫下來,不要藏**:
 *   把 `route.abort()` 換成 `route.fallback()`(= 我什麼都不中斷)⇒ **兩格照樣全綠**。
 *   ⇒ **在一棵沒有 `.env.local` 的樹上,我的攔截【不是】造成那個綠的原因** ——
 *     這棵樹有第二個成因(supabase client 拿不到 key 而拋),而兩個成因都通向 `resolveFailed`。
 *   ⇒ 誠實的講法是**三句**,不是兩句(🔴 **R2 改**:我第一版寫兩句,而我把「充分」那半
 *     升成了 ✅ —— **它與被我誠實標成 ❌ 的「必要」那半,是同一個證不出來的東西**):
 *     ① ✅ **`error` 這一格對這支斷言承重** = 已證(突變:把它拿掉 ⇒ 測試 1 紅、負對照仍綠)
 *     ② ✅ **我的攔截確實發生過** = 已證(計數器;突變 route glob ⇒ 那一行紅而其餘三行綠)
 *     ③ ❌ **我的攔截是不是那個失敗的成因(充分 / 必要兩邊)= 皆未證**,
 *        而且**在這棵樹上兩邊都證不出來** —— 兩個成因**共線**,計數器只證「攔截發生」,
 *        不證「攔截造成了 `resolveFailed`」。
 *   📌 **① 證的是【被守的那段碼承重】,③ 問的是【誰造成了那個世界】—— 兩個不同的宣稱,**
 *      **而我第一版用①的證據去結案③。**
 *   ⇒ **升級路徑(本片不做)**:在 worktree 補一份可用的 `.env.local`(拿掉第二個成因)再跑一次。
 *
 * ❌ **它【不】守 I 節第 2 列(換人登入前一個人的車還在)** ——
 *    理由是結構的,不是環境的:**本檔從頭到尾沒有任何登入動作**,而那一列需要兩個身分。
 *    ⇒ 板上「會同時抓到本組第 1、2 條」那句,**只有第 1 條成立**。
 *
 * ⚠️ **這支要跑得起來,得在一棵沒有 `.env.local` 的工作樹上** ——
 *    主樹的 env 指向正式庫,`dev-db-guard-gate.ts:46-47` 的 throw 會擋掉 `next dev`(它擋對了;
 *    ~~`:49`~~ 是 `bypassed` 那條**放行**分支,指錯邊 —— R2 抓到)。
 *    ⇒ 「器材已架好」在【檔案存在】那格是真的,在【跑得起來】那格要看你人在哪棵樹。
 */

const STORAGE_KEY = 'pcm-cart-mock-v2'; // `CartContext.tsx:56`
const ERROR_HEADING = '暫時讀不到你的購物車'; // `CartView.tsx:272`
const EMPTY_HEADING = '購物車是空的'; // `CartView.tsx:293`
const BADGE = '.pcm-cart-dot'; // `Header.tsx:213`

type Page = import('@playwright/test').Page;

/** 車裡放東西(形狀照 `readStorage()` 的解析:`productId` 非空字串 + `qty`)。 */
async function seedCart(page: Page, items: unknown[]) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key as string, value as string),
    [STORAGE_KEY, JSON.stringify(items)] as const,
  );
}

/**
 * 「網路抖一下」= 攔掉 server action 那一發 POST(GET 頁面本身照過)。
 *
 * 🔴 **回傳一個計數器,而測試【必須】斷言它非零** —— 理由是量到的:
 *   `resolveCartLines` 若哪天從 server action 換成別的傳輸(REST / 不同路徑),
 *   這個 `page.route` 就**不再匹配**,而測試會**繼續綠**(見上方那段誠實邊界)。
 *   ⇒ 斷言計數器 = 讓「我的手根本沒碰到它」這件事**會紅**。
 *
 * ⚠️ **它量的是「`/cart` 上【任何一發】POST 被攔」,不是「`resolveCartLines` 那一發」**(R2 nit)——
 *    今天成立,因為 `app/cart/actions.ts` 只 export 這一支 action(分母 = 1)。
 *    哪天 cart 頁多一支 server action ⇒ **傳輸真的換走了而計數器仍 >0** ⇒ 這一格變恆真。
 *    要收緊就比 `next-action` header;本片不收,而**把射程寫在這裡**。
 */
async function breakResolve(page: Page) {
  const hits = { aborted: 0 };
  await page.route('**/cart', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    hits.aborted += 1;
    return route.abort('failed');
  });
  return hits;
}

test('🔴 車裡有東西而讀不到 ⇒ 看到「讀不到」不是「空的」, 而且角標還數得出來', async ({ page }) => {
  await seedCart(page, [
    { productId: 'e2e-probe-a', qty: 2 },
    { productId: 'e2e-probe-b', qty: 1 },
  ]);
  const hits = await breakResolve(page);
  await page.goto('/cart');

  await expect(page.getByRole('heading', { name: ERROR_HEADING })).toBeVisible();
  // 這一行是那條 bug 本身:失敗被吞成 empty 的話,上面那行與這行一起紅
  await expect(page.getByText(EMPTY_HEADING)).toHaveCount(0);
  // 🔴 而這一行才抓得到「整車消失」:資料被清掉的回歸照樣印錯誤標題,只有角標會掉
  await expect(page.locator(BADGE).first()).toHaveText('3');
  // 🔴 而這一行守的是【我的手有沒有碰到它】—— 傳輸方式一換,上面三行會繼續綠而這行紅
  expect(hits.aborted, 'server action 的 POST 沒有被攔到 ⇒ 這一發的失敗不是本測試造的').toBeGreaterThan(0);
});

test('🔴 負對照:同樣攔掉那一發, 而車是空的 ⇒ 看到「空的」不得看到「讀不到」', async ({ page }) => {
  await seedCart(page, []);
  // 🔴 **註冊一模一樣,而【觸發不一樣】**(R2 抓到,我第一版寫成「差別只剩 localStorage」):
  //   `useResolvedCart.tsx:98-101` 空車直接 return、**根本不呼叫 `resolveCartLines`**
  //   ⇒ 這一發的 route **從未 fire** ⇒ 所以這支【刻意不斷言計數器】(斷 `>0` 會恆假)。
  await breakResolve(page);
  await page.goto('/cart');

  await expect(page.getByRole('heading', { name: EMPTY_HEADING })).toBeVisible();
  // 沒有這一格,一支「永遠印讀不到」的實作會讓上面那支全綠
  await expect(page.getByText(ERROR_HEADING)).toHaveCount(0);
  // 空車不該有角標(`Header.tsx:213` 是 `totalQty > 0 &&`)
  await expect(page.locator(BADGE)).toHaveCount(0);
});
