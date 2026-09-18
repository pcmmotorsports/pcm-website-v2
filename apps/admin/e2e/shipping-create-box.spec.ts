import { test, expect } from '@playwright/test';
import { mintProbeCookie, probeSql, requireProbe } from './probe';

/**
 * 後台「建箱」動作的 E2E(2026-09-18;Sean 拍甲的第二步)。
 *
 * 🎯 **它補的是上一支明講證不到的那一格**:`shipping-list.spec.ts` 只驗**出貨清單那一頁的渲染**,
 *    **沒有驗建箱動作本身會成功**。這一支按下那顆鈕、然後去 DB 看箱是不是真的長出來。
 *
 * ── 🔴 起點從哪來 ─────────────────────────────────────────────────────────
 *   `scripts/admin-probe/seed-shipment-clean-order.sql` ⇒ 造出 **PCM-2026-9001**
 *   (已付清 + 貨已到 + 沒配過箱)。負對照那張 1007 來自 `seed-shipment-ready.sql`。
 *   🔵 **為什麼不是 1005**(本檔上一版用的那張):1005 是 `partiallyRefunded`、畫面印「還差 22,760」
 *      ⇒ 用它測建箱,會把「尾款未收的行為」混進這支測試的前提裡,而下一個人分不出
 *      這支在測建箱、還是在測一張髒單。乾淨單 2026-09-18 已經種得出來了(Sean 拍乙)。
 *
 * ── 🔴 票要【現簽】,不要讀檔裡那一張 ──────────────────────────────────────
 *   `authorizeAdminMutation()` 三道閘(① session 自驗 ② Origin ③ 具名 actor)回**同一個 null**,
 *   而 `ADMIN_DEV_BYPASS` 只放寬 ②。畫面上那句「請先在右上角選擇操作人員」
 *   ⇒ **三道都長這樣,從它推不出是哪一道。**
 *   🔬 2026-09-18 實測:`up.sh` 寫在 `session-cookie.txt` 的那張票**過期 32 小時**
 *      (票 TTL 15 分鐘,鑽機起於前一天)⇒ 所以這支改叫 `mintProbeCookie()` 現簽,
 *      判別力對照與全部細節寫在 `probe.ts` 那支函式的 docstring,**不在這裡複製第二份**。
 *
 * ── 🛑 寄信:這支【刻意】按「只建箱、先不出貨」──────────────────────────────
 *   彈窗上另一顆是「確認(建箱並標出貨)」,而同一個彈窗自己逐字寫著
 *   「**標了出貨之後,通知客人的信是系統晚一點自己寄的**」⇒ **那一顆才是會寄信的那條路。**
 *   ⇒ 本支只按「只建箱」,**不碰標出貨**。(而鑽機上那條路本來也送不出去 —— 三條正向證明見
 *     `shipping-list.spec.ts` 檔頭;建箱那支另外證過:它的 migration 寄信相關命中 0。)
 *
 * ── ⚠️ 這支會【改變世界】,所以它不是冪等的 ──────────────────────────────
 *   建完箱之後 `remaining` 變 0 ⇒ **第二次整支跑會在第一格就紅**,而那正是「那顆鈕真的做了事」
 *   的證據(第 ④ 格也在同一次跑裡把它量出來)。⇒ 要重跑請先重種,指令在 `RESEED_HINT`。
 *   🛑 **而第一格的失敗訊息會把那段話印出來** —— 否則「還沒種」與「上一次跑掉了」長得一樣。
 *
 * ── 🔴 四格的順序是硬的(不要重排)─────────────────────────────────────────
 *   ① 前提 → ② 負對照【建箱前】→ ③ 建箱 → ④ 負對照【建箱後】
 *   ⚠️ ② 一定要在 ③ **之前**:它的判別力來自「**同一頁、同一個 locator**,9001 找得到出貨入口、
 *      1007 找不到」。跑在 ③ 之後的話 9001 也沒有入口了 ⇒ **兩臂會變成同一個世界**,
 *      而那種對照組印出來的樣子跟真的一模一樣。(`fullyParallel: false` ⇒ 檔內照宣告順序跑。)
 */

const READY_ORDER = 'PCM-2026-9001';
const NOT_READY_ORDER = 'PCM-2026-1007';

/** 照 `shipment-candidates.ts:294-295` 那條同一個算式算 remaining。 */
function remainingOf(displayId: string): number {
  return Number(
    probeSql(`
      SELECT coalesce(sum(greatest(0,
        coalesce(s.instock_quantity, 0)
        - coalesce((SELECT sum(si.shipped_quantity) FROM public.shipment_items si
                    JOIN public.shipments sh ON sh.id = si.shipment_id
                    WHERE si.order_item_id = oi.id AND sh.deleted_at IS NULL), 0))), 0)
      FROM public.orders o
      JOIN public.order_items oi ON oi.order_id = o.id
      LEFT JOIN public.order_item_quantity_summary s ON s.order_item_id = oi.id
      WHERE o.display_id = '${displayId}'`),
  );
}

function boxCountOf(displayId: string): number {
  return Number(
    probeSql(`
      SELECT count(DISTINCT sh.id) FROM public.shipments sh
      JOIN public.shipment_items si ON si.shipment_id = sh.id
      JOIN public.order_items oi ON oi.id = si.order_item_id
      JOIN public.orders o ON o.id = oi.order_id
      WHERE o.display_id = '${displayId}' AND sh.deleted_at IS NULL`),
  );
}

/**
 * 重跑前怎麼把起點放回去。
 *
 * 🔴 **不是「刪掉那一箱」** —— 2026-09-18 實測撞到兩道守門,兩道都是對的:
 *    ① `pcm_b2_shipment_items_append_only`:包裹內容入箱後不可改不可刪
 *       (Sean 2026-08-05 `Q-a=C`:「裝箱打錯的補救 = 整箱作廢重開」)
 *    ② `shipments_void_pair`:`deleted_at` 與 `void_reason` 必須成對,而理由不得空白
 *    ⇒ ✅ 正解就是產品本來的補救動作:**把那一箱作廢**。作廢之後 `remaining` 自己回來,
 *      到貨明細與採購列**都不用重種**(它們沒被動過)。
 */
const RESEED_HINT =
  '⇒ 這支會改變世界(建完箱 remaining 就變 0)。重跑前把那一箱【作廢】即可(不必重種):' +
  "psql -h 127.0.0.1 -p $ADMIN_PROBE_PG -U postgres -c \"UPDATE public.shipments sh SET deleted_at=now(), void_reason='probe reseed' " +
  'WHERE sh.deleted_at IS NULL AND EXISTS (SELECT 1 FROM public.shipment_items si JOIN public.order_items oi ON oi.id=si.order_item_id ' +
  "JOIN public.orders o ON o.id=oi.order_id WHERE si.shipment_id=sh.id AND o.display_id='PCM-2026-9001')\" 。" +
  '起點單本身來自 scripts/admin-probe/seed-shipment-clean-order.sql(負對照那張 1007 來自 seed-shipment-ready.sql)。';

/** 那一張單在清單頁上的列。 */
function rowOf(page: import('@playwright/test').Page, displayId: string) {
  return page.getByRole('main').locator('tbody', { hasText: displayId }).first();
}

/**
 * 這張單有幾封**待寄的出貨信**。
 *
 * 🔴🔴 **這是「標出貨」那一步唯一安全的證據, 而它安全的理由是【架構上的】不是【設定上的】**
 *    (2026-09-19 窗A 實測 + 主視窗獨立複核):
 *    · 按鈕那一端(admin)**只發一句 RPC** `admin_mark_shipment_shipped`,零寄信 import。
 *    · 真的會寄的是**另一個 process**:`apps/storefront/src/app/api/cron/email-sweep`
 *      ⇒ 而這台機器上**一個 storefront 都沒有在跑**(lsof 實測:3011/3021 都是 admin)。
 *    · 那個庫**物理上打不出 HTTP**:沒有 `pg_net` / `http` 擴充、`cron.job` 0 筆。
 *      ⚪ 判別力對照:同一把尺讀 `prosrc` 找 `email` ⇒ **29 支命中**(分母 264)
 *      ⇒ 📌 這個庫**知道**有信要寄, 而它**沒有任何一條出得去的路**。
 *    · 🔵 唯一提到 `net.` 的那 1 支是稽核函式 `pcm_net_exposure_probe`
 *      (用 `to_regclass('net.'||t)` 問「net 那兩張表在不在」, 只讀 `pg_catalog`, **不打 HTTP**)。
 *      🛑 **這一格不要寫成 0** —— 我第一版用窄尺(`net\.http`)量到 0, 主視窗用寬尺(`net\.`)量到 1。
 *      兩個讀數都對, 而**窄尺會漏掉用字串接起來的呼叫**。一個看起來乾淨的 0 會讓下一個人不去開檔看。
 *
 * 🛑 **這張 view 有 `notification_email` / `customer_email` 兩欄(PII)—— 只准數, 不准印。**
 */
function pendingShippedEmailsOf(displayId: string): number {
  return Number(
    probeSql(`SELECT count(*) FROM public.pcm_shipped_email_pending WHERE display_id = '${displayId}'`),
  );
}

/** 那一張單最新那一箱的「出貨了沒 / 單號是什麼」。 */
function latestShipmentOf(displayId: string): { shipped: boolean; tracking: string; reference: string } {
  const raw = probeSql(`
    SELECT coalesce(sh.shipped_at::text, '') || '|' || coalesce(sh.tracking_number, '') || '|' || sh.shipment_reference
    FROM public.shipments sh
    JOIN public.shipment_items si ON si.shipment_id = sh.id
    JOIN public.order_items oi ON oi.id = si.order_item_id
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.display_id = '${displayId}' AND sh.deleted_at IS NULL
    GROUP BY sh.id, sh.shipped_at, sh.tracking_number, sh.shipment_reference
    ORDER BY max(sh.created_at) DESC LIMIT 1`);
  const [shippedAt, tracking, reference] = raw.split('|');
  return { shipped: (shippedAt ?? '') !== '', tracking: tracking ?? '', reference: reference ?? '' };
}

/** 🔬 給「標出貨」那一步用的假單號。不是真的新竹號碼, 而這台鑽機不會把它送去任何地方。 */
const PROBE_TRACKING = '9990001112';

test.describe('後台建箱動作(鑽機)', () => {
  test.beforeEach(async ({ context }) => {
    requireProbe();
    // 🔴 現簽一張票 —— 讀檔裡那一張會拿到死票,理由見 `probe.ts` 的 `mintProbeCookie`。
    const { name, value } = mintProbeCookie();
    // 🔴 用 `url` 而不是 `domain`/`path` —— Playwright 對 localhost 那種無點網域,
    //    `domain` 這條路會靜靜不生效(cookie 加得進去、而請求不帶它)。
    await context.addCookies([
      { name, value, url: process.env.E2E_ADMIN_BASE_URL ?? 'http://localhost:3011' },
    ]);
  });

  test('① 前提:起點種子在不在 —— 這一格紅, 底下每一格都不算數', () => {
    expect(remainingOf(READY_ORDER), `${READY_ORDER} 不是可建箱狀態。${RESEED_HINT}`).toBeGreaterThan(0);
    // 🔵 負對照那張單也要對:它必須是【貨還沒到】, 不是「什麼都沒種」
    expect(remainingOf(NOT_READY_ORDER), `${NOT_READY_ORDER} 應該是不可建箱(貨還沒到)`).toBe(0);
  });

  test('② 🔵 負對照【建箱前】:1007 那列沒有出貨入口, 而同一頁同一把尺在 9001 那列找得到', async ({ page }) => {
    // 🛑 先用 DB 證明「1007 沒有東西可以裝箱」(remaining=0), 再看畫面 ——
    //   否則「鈕不在」與「這一頁根本沒渲染」長得一模一樣。
    //
    // ⚠️ **而「remaining=0」不是列表那顆鈕的【直接】原因, 不要讀寬了**(2026-09-18 ④ 紅了才查出來):
    //    列表那一欄看的是**貨品軸**(`ORDER_NEXT_STEP_LABEL`), 不是 `remaining`。
    //    1007 在這台鑽機上是【還沒跟供應商下訂】⇒ 軸是 `none` ⇒ 下一步印「跟供應商下訂」。
    //    remaining=0 與 `none` 在這張單上是**同一件事的兩種量法**(貨沒到 ⇒ 兩邊都成立),
    //    而**不是**「remaining=0 所以鈕消失」那條因果。
    //    ⇒ 📌 所以下面**兩樣都要量**:1007 沒有出貨入口、而且它印得出自己真正的下一步。
    //
    // 🔴 **它為什麼不是「已下訂未到貨」**(本檔上一版的註解寫錯了, 而它紅了才被發現):
    //    `scripts/admin-probe/seed-shipment-ready.sql` 在這台鑽機上**跑不完** ——
    //    2026-09-18 實跑:`order_item_procurement_order_item_id_fkey` 違反,
    //    它寫死的 `order_item_id=61748060-…` 在現在這個庫裡**不存在**(庫是 09-17 從別的 dump 重建的)。
    //    ⇒ 那支種子要另外修(已回報, 不在這一片), 而 1007 今天的實際狀態就是 `none`。
    expect(remainingOf(NOT_READY_ORDER), '這張單應該是不可建箱, 否則這個負對照沒有意義').toBe(0);
    expect(remainingOf(READY_ORDER), `這一格要在建箱【之前】跑。${RESEED_HINT}`).toBeGreaterThan(0);

    await page.goto('/orders');
    const main = page.getByRole('main');
    // 🔵 正面證據:那一頁【有】渲染, 而且兩張單都看得到 ⇒ 排除「頁面是空的」那種假通過
    await expect(main.getByText(NOT_READY_ORDER).first()).toBeVisible();
    await expect(main.getByText(READY_ORDER).first()).toBeVisible();

    // 🔴🔴 **判別力**:同一頁、同一個 locator 的兩臂 —— 少了下面這一格,
    //    「remaining=0 所以沒入口」與「這把尺根本找不到任何出貨入口」長得一模一樣。
    await expect(
      rowOf(page, READY_ORDER).getByRole('link', { name: '出貨', exact: true }),
      '可建箱那張單也找不到出貨入口 ⇒ 這把尺量不到東西, 下面那格的 0 不算數',
    ).toHaveCount(1);
    await expect(
      rowOf(page, NOT_READY_ORDER).getByRole('link', { name: '出貨', exact: true }),
      '已下訂未到貨那張單不該有出貨入口',
    ).toHaveCount(0);
    // 🔵 而它**不是一格空白** —— 它印的是自己真正的下一步, 那才是「這一列是活的」的證據。
    await expect(
      rowOf(page, NOT_READY_ORDER).getByRole('link', { name: '跟供應商下訂', exact: true }),
      '貨還沒到那張單要印得出自己真正的下一步(跟供應商下訂)',
    ).toHaveCount(1);
  });

  // 🔬 **這一格燒過**(2026-09-18):把票的密鑰換成錯的(`ADMIN_PROBE_SECRET=wrong-…`)重跑
  //    ⇒ 本格紅在「建箱之後 DB 裡沒有多一箱」、④ 跟著紅;而 ①② 照樣綠(它們是唯讀的)。
  //    📌 ⇒ 這支的綠**真的綁在那張票上**,不是碰巧綠的。
  test('③ 按下「只建箱、先不出貨」⇒ 箱真的長出來, 而且 remaining 跟著變 0', async ({ page }) => {
    const before = { boxes: boxCountOf(READY_ORDER), remaining: remainingOf(READY_ORDER) };
    expect(before.remaining, `起點不對。${RESEED_HINT}`).toBeGreaterThan(0);

    await page.goto('/orders');
    // 那一列的動作是一個 link(不是 button), 點下去會開彈窗。
    await rowOf(page, READY_ORDER).getByRole('link', { name: '出貨', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(READY_ORDER).first()).toBeVisible();

    // 🛑 只按「只建箱」—— 另一顆「確認(建箱並標出貨)」才是會寄信的那條路。
    await dialog.getByRole('button', { name: '只建箱、先不出貨' }).click();

    // 🔴 等到【DB 真的多一箱】才算數 —— 不看畫面上的提示字。
    //   畫面可以印「成功」而資料沒落地, 那正是這一支存在的理由。
    await expect
      .poll(() => boxCountOf(READY_ORDER), { timeout: 20_000, message: '建箱之後 DB 裡沒有多一箱' })
      .toBe(before.boxes + 1);

    // 箱號 / 品項 / 數量三樣都要對得上
    const detail = probeSql(`
      SELECT sh.shipment_reference || '|' || count(si.id) || '|' || coalesce(sum(si.shipped_quantity),0)
      FROM public.shipments sh
      JOIN public.shipment_items si ON si.shipment_id = sh.id
      JOIN public.order_items oi ON oi.id = si.order_item_id
      JOIN public.orders o ON o.id = oi.order_id
      WHERE o.display_id = '${READY_ORDER}' AND sh.deleted_at IS NULL
      GROUP BY sh.id, sh.shipment_reference ORDER BY max(sh.created_at) DESC LIMIT 1`);
    const [ref, items, qty] = detail.split('|');
    expect(ref, '箱號是空的').toBeTruthy();
    expect(Number(items), '這一箱沒有任何品項').toBeGreaterThan(0);
    expect(Number(qty), `這一箱的數量應該等於建箱前的 remaining(${before.remaining})`).toBe(before.remaining);

    // 🔴 **世界要真的變了** —— 建完之後同一張單不該再可建箱。
    //   🛑 這一格若不成立, 代表上面那些斷言是在對一個不會變的世界說話。
    expect(remainingOf(READY_ORDER), '建完箱之後 remaining 沒有變 ⇒ 那顆鈕其實沒做事').toBe(0);
  });

  test('④ 🔵 負對照【建箱後】:同一張單再按一次出貨 ⇒ 建不了箱了', async ({ page }) => {
    // 📌 這一格就是派工單說的「連跑兩次, 第二次應該不可建箱」——
    //   它把「第二次」放進同一次跑裡, 所以不必靠人記得跑第二遍。
    //
    // 🔴🔴 **我第一版把這一格寫錯了, 而它紅了才講出來**(2026-09-18 實測):
    //    原本斷言「列表上那個出貨入口會消失」⇒ **紅**,量到的是 `1`。
    //    真因:列表那一欄看的是**貨品軸**(`order-status-axes.ts` `ORDER_NEXT_STEP_LABEL`),
    //    而**貨品軸不看 `remaining`** —— 箱建了而**沒標出貨**, 那張單仍然是 `instock`
    //    ⇒ 下一步照樣印「出貨」。📌 **那不是 bug, 是這一欄本來就只講貨到哪了。**
    //    ⇒ ✅ 「不可建箱」要在**彈窗裡**量:可建箱的品項是 0 ⇒ 那顆建箱鈕不存在。
    expect(remainingOf(READY_ORDER), '③ 跑完 remaining 應該已經是 0').toBe(0);
    expect(boxCountOf(READY_ORDER), '③ 跑完應該至少有一箱').toBeGreaterThan(0);

    await page.goto('/orders');
    await rowOf(page, READY_ORDER).getByRole('link', { name: '出貨', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // 🔴🔴 **判別力**:同一個 locator 在 ③ 那一格【找得到並且按得下去】——
    //    所以這裡的 0 是「真的沒有了」, 不是「這把尺從來就量不到」。
    await expect(
      dialog.getByRole('button', { name: '只建箱、先不出貨' }),
      '品項都已經裝進箱了, 不該還能再建一箱',
    ).toHaveCount(0);
    // 🔵 而且要**講得出原因** —— 空白的彈窗與「都已裝進其他箱子」長得不一樣。
    await expect(
      dialog.getByTestId('next-step-shipment-error'),
      '彈窗要說明為什麼建不了箱, 不是一片空白',
    ).toBeVisible();
  });

  // ══ 出貨動線往下走一格:建完箱之後的「標出貨」(2026-09-19;主視窗裁甲)═════════════
  //
  // 🛑 **這一步在正式站上會寄信給客人**(彈窗自己逐字:「標了出貨之後, 通知客人的信是系統晚一點自己寄的」)。
  //    ⇒ 在這台鑽機上安全的理由**不是「我小心」, 是架構上寄不出去** —— 逐條證據寫在
  //      `pendingShippedEmailsOf` 的 docstring, **不在這裡複製第二份**。
  // 🛑 **按之前要當場再量一次 `lsof -nP -iTCP -sTCP:LISTEN | grep node`** ——
  //    那五道證據裡**只有這一格會在你按之前改變**(有人起了 storefront ⇒ 就有人會來撿那封信)。
  //    ⇒ 📌 這是人要做的事, 測試檢查不到它;寫在這裡是為了下一個人跑之前會看到。
  // 🛑 **跑完要把那一箱作廢**, 讓待寄佇列回到 0 —— 不要留一筆待寄的在那裡等某個之後被起來的 process 撿走。
  //    (主視窗 2026-09-19 加的條件:上面那些證據證的是「現在沒有人會撿」, **證不到「等一下也沒有」**。)
  //    指令逐字在 `RESEED_HINT`。

  test('⑤ 🔵 負對照【標出貨前】:待寄佇列是 0, 而且沒勾「新竹已經收走」時那顆鈕按不下去', async ({ page }) => {
    expect(pendingShippedEmailsOf(READY_ORDER), '還沒標出貨, 不該有待寄的出貨信').toBe(0);
    expect(latestShipmentOf(READY_ORDER).shipped, '③ 按的是「只建箱」, 這一箱不該已經是出貨狀態').toBe(false);

    await page.goto('/orders');
    await rowOf(page, READY_ORDER).getByRole('link', { name: '出貨', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '填單號並標記出貨' }).click();

    const markButton = dialog.getByRole('button', { name: '標記出貨', exact: true });
    // 🔴 單號填了、而【沒勾】那一格 ⇒ 仍然按不下去。這一格分開量, 才知道擋住的是哪一道。
    await dialog.getByRole('textbox', { name: /貨運單號/ }).fill(PROBE_TRACKING);
    await expect(markButton, '沒勾「新竹已經把貨收走了」就不該按得下去').toBeDisabled();
    // 🔵 而且要**講得出是哪一道擋的** —— 一顆灰掉而不說話的鈕, 員工只會一直按。
    await expect(dialog.getByText('新竹已經把貨收走了', { exact: false }).first()).toBeVisible();

    // 🔴🔴 **判別力正臂**:同一顆鈕, 勾了之後就**按得下去** ——
    //    少了這一格, 上面那個 `toBeDisabled` 與「這顆鈕永遠是灰的」長得一模一樣。
    await dialog.getByRole('checkbox', { name: /新竹已經把貨收走了/ }).check();
    await expect(markButton, '勾了之後這顆鈕就該活過來').toBeEnabled();

    // 🛑 這一格【不按】—— 按是 ⑥ 的事。這裡只證「那道閘會擋、而且擋得掉也放得開」。
    expect(pendingShippedEmailsOf(READY_ORDER), '只是把鈕點亮, 不該產生任何待寄信').toBe(0);
  });

  test('⑥ 按下「標記出貨」⇒ 那一箱真的變成已出貨, 單號對得上, 而待寄佇列 0→1', async ({ page }) => {
    const before = {
      pending: pendingShippedEmailsOf(READY_ORDER),
      shipped: latestShipmentOf(READY_ORDER).shipped,
    };
    expect(before.pending, `起點不對:待寄佇列應該是 0。${RESEED_HINT}`).toBe(0);
    expect(before.shipped, '起點不對:這一箱不該已經出貨').toBe(false);

    await page.goto('/orders');
    await rowOf(page, READY_ORDER).getByRole('link', { name: '出貨', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '填單號並標記出貨' }).click();
    await dialog.getByRole('textbox', { name: /貨運單號/ }).fill(PROBE_TRACKING);
    await dialog.getByRole('checkbox', { name: /新竹已經把貨收走了/ }).check();
    await dialog.getByRole('button', { name: '標記出貨', exact: true }).click();

    // 🔴 等到【DB 真的翻了】才算數 —— 不看畫面上的提示字。
    await expect
      .poll(() => latestShipmentOf(READY_ORDER).shipped, {
        timeout: 20_000,
        message: '按了標記出貨, 而 DB 裡那一箱的 shipped_at 還是空的',
      })
      .toBe(true);

    // 單號要**原樣**落地 —— 這個值會原封進出貨信的「追蹤碼:」那一行(`shipment-dialog.tsx:495` 逐字)。
    expect(latestShipmentOf(READY_ORDER).tracking, '單號沒有原樣落地').toBe(PROBE_TRACKING);

    // 🔴🔴 **世界要真的變了**:待寄佇列 0→1。
    //    📌 這一格就是「客人會收到信」那件事在**這台機器上唯一量得到的形狀** ——
    //      而真正寄出去的是另一個 process, 那個 process 在這裡不存在(見 docstring)。
    await expect
      .poll(() => pendingShippedEmailsOf(READY_ORDER), {
        timeout: 20_000,
        message: '標出貨之後, 待寄的出貨信沒有長出來 ⇒ 那一步沒有真的走完',
      })
      .toBe(1);
  });

  test('⑦ 🔵 負對照【標出貨後】:那一列的下一步變成「完成」, 出貨入口整個消失', async ({ page }) => {
    // 🔴🔴 **我第一版的 ⑦ 又寫錯了, 而它又是紅了才講出來**(2026-09-19, 今晚第二次同一種錯):
    //    原本是「再開一次出貨彈窗, 看那顆『填單號並標記出貨』不見了」⇒ 紅在 `locator.click` timeout,
    //    因為**那一列的出貨入口本身就不見了, 根本點不開彈窗**。
    //    真因就是 ④ 那一格教過我的同一件事:那一欄看的是**貨品軸** ——
    //    整張單都出貨了 ⇒ 軸變 `shipped` ⇒ `orderNextStep` 回 `{kind:'done'}` ⇒ 印**灰字「完成」不是鈕**。
    //    ⇒ 📌 **④ 學到的東西我在 ⑦ 沒有套上去。** 一個教訓只寫在註解裡, 不會自動套用到下一格。
    //    🔴 **而第二版又紅了一次, 紅在同一條軸上**:這一列**整個從預設清單消失**了 ——
    //    預設篩選是「未完成」(`order-toolbar-view.ts` 的 `open` chip = `none/ordered/instock`),
    //    出完貨的單落在 `shipped` ⇒ **它不在預設那一頁上**, 所以連「完成」兩個字都找不到。
    //    ⇒ 📌 **「這一列沒有出貨入口」與「這一列根本不在這一頁」長得一模一樣** —— 所以下面兩段都要。
    expect(latestShipmentOf(READY_ORDER).shipped, '⑥ 跑完這一箱應該已經是已出貨').toBe(true);

    // ── 第 1 段:預設(未完成)那一頁 —— 它應該**整列不見**
    await page.goto('/orders');
    const main = page.getByRole('main');
    // 🔴🔴 **判別力正臂**:同一頁、同一把尺看得到 1007 ⇒ 排除「這一頁是空的 / 沒渲染」那種假通過。
    await expect(main.getByText(NOT_READY_ORDER).first(), '這一頁要有渲染, 否則下面的 0 不算數').toBeVisible();
    await expect(
      main.getByText(READY_ORDER),
      '出完貨的單不該留在預設的「未完成」清單裡',
    ).toHaveCount(0);

    // ── 第 2 段:切到「已完成」—— 它要在那裡, 而下一步是【完成】不是【出貨】
    //    🛑 少了這一段, 上面那個 0 與「這張單被刪掉了」長得一樣。
    // 🔴 用 `data-chip` 不用文字:那顆 chip 的可及名稱是「已完成 <件數>」(標籤後面接一個數字),
    //    `{ name: '已完成', exact: true }` 對不上 —— 我第三版就是紅在這裡(`locator.click` timeout)。
    await page.locator('[data-chip="shipped"]').click();
    await expect(main.getByText(READY_ORDER).first(), '切到「已完成」就該看得到這張單').toBeVisible();
    const row = rowOf(page, READY_ORDER);
    await expect(
      row.getByRole('link', { name: '出貨', exact: true }),
      '整張單都出貨了, 這一列不該還有出貨入口',
    ).toHaveCount(0);
    // 🔵 而且**不是一格空白** —— 空白是「已取消 / 已退款」的樣子, 出完貨要印「完成」。
    //    (`order-status-axes.ts` 的 `orderNextStep`:`goodsAxis === null` 才回 `{kind:'none'}`。)
    await expect(row.getByText('完成', { exact: true }).first(), '出完貨那一列要印「完成」').toBeVisible();

    // 🔵 而且**不要多寄一封** —— 待寄佇列維持 1, 不是 2。
    expect(pendingShippedEmailsOf(READY_ORDER), '重新看一次列表不該多生一封待寄信').toBe(1);
  });
});
