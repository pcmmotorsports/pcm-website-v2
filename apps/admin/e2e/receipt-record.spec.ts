import { test, expect } from '@playwright/test';
import { mintProbeCookie, probeSql, requireProbe } from './probe';

/**
 * 後台「到貨登記」的 E2E(2026-09-19;主視窗派工 —— 動線再往前一格)。
 *
 * 🎯 動線是「收單 → 收款 → 建單 / **訂貨 / 到貨** → 出貨」。
 *    收款一格、出貨三格都有 e2e 了,而**到貨這一格在此之前沒有人驗過**。
 *
 * ── 🔬 到貨會不會寄信:不會 ────────────────────────────────────────────────
 *   · `lib/orders/receipt-actions.ts` 提到 email / mail 的次數 = **0**
 *   · RPC `admin_record_item_receipt` 提到 email / mail / notification 的次數 = **0**
 *   · `order_item_procurement` / `order_item_procurement_receipts` 上的 trigger
 *     碰 `email_outbox` 的 = **0 支**
 *   ⚪ 判別力:同一把尺在別處找得到東西 —— 全庫唯一會 `INSERT INTO public.email_outbox`
 *     的資料庫函式是 `record_manual_cancel_notice`(見 `payment-record.spec.ts` 檔頭)⇒ 尺會動。
 *   🛑 **射程與 `payment-record` 那支相同**:量的是**資料庫這一側的同步路徑**,
 *     不是 cron 那一側。那一段的完整說明在 `payment-record.spec.ts` 的檔頭,**不複製第二份**。
 *
 * ── 🔴 起點:PCM-2026-1007(已下訂、貨還沒到)────────────────────────────────
 *   來自 `scripts/admin-probe/seed-shipment-ready.sql`。
 *   🔵 **那支種子 2026-09-19 才修好** —— 在此之前它整支跑不完(寫死的 `order_item_id`
 *     在 09-17 重建的庫裡不存在)⇒ 1007 一直停在「還沒下訂」。
 *     📌 **一張單的狀態被一支壞掉的種子決定, 而種子壞掉時沒有東西會叫。**
 *
 * ── 🔴🔴 三支測試共用 1007, 而這一支【會動到別支看的那一軸】────────────────
 *   · `payment-record.spec.ts` 動**收款軸** ⇒ 與本支無關(兩軸互不影響)
 *   · `shipping-create-box.spec.ts` 的 ② 看 1007 的**貨品軸**:它期望 1007 印「到貨登記」
 *     ⇒ 🔴 **而本支登記完到貨就會把它變成「出貨」** —— 那正是本支在驗的那件事。
 *   ⇒ ✅ 所以本支的最後一格 ⑤ **把到貨撤銷回去**, 讓 1007 回到「已下訂未到貨」。
 *     🛑 **⑤ 不是收尾, 它是承重的**:少了它, 出貨那支會紅, 而訊息會把人指向出貨入口,
 *       真因在**這一支動過那張單**。(那正是我 2026-09-19 盤點時列出來的跨檔陷阱形狀。)
 *     ⚪ 而 ⑤ 同時是一格真的覆蓋:撤銷是產品自己的路(Sean 走查逐字問過「到貨登記無法取消」),
 *       在此之前也沒有人驗過。
 *   ⚠️ **③ 紅掉時 ⑤ 不會跑** ⇒ 那時 1007 會留在「已到貨」而出貨那支跟著紅。
 *     那是 fail-closed 的方向(紅了會知道), 而**復原要手動**:指令在 `RESEED_HINT`。
 */

const TARGET_ORDER = 'PCM-2026-1007';

function receivedTotalOf(displayId: string): number {
  return Number(
    probeSql(`
      SELECT coalesce(sum(r.quantity), 0)
      FROM public.order_item_procurement_receipts r
      JOIN public.order_item_procurement pr ON pr.id = r.procurement_id
      JOIN public.order_items oi ON oi.id = pr.order_item_id
      JOIN public.orders o ON o.id = oi.order_id
      WHERE o.display_id = '${displayId}'`),
    // 🔵 **沒有 `deleted_at` 可以過濾** —— 這張表沒有那一欄(實測欄位:id / procurement_id /
    //    quantity / received_at / received_by / note / created_at / surplus_quantity)。
    //    ⇒ 撤銷是**真的把那一列刪掉**(`admin_delete_item_receipt`), 不是軟刪。
    //    🛑 我第一版照著出貨那邊的習慣寫了 `r.deleted_at IS NULL` ⇒ psql 當場報錯,
    //      而錯訊只說「Command failed」⇒ 看起來像鑽機掛了。
  );
}

/** 那張單的「已到貨量」總和 —— 由 A4a trigger 從到貨明細推導,**不是**直接寫進去的。 */
function instockTotalOf(displayId: string): number {
  return Number(
    probeSql(`
      SELECT coalesce(sum(s.instock_quantity), 0)
      FROM public.orders o
      JOIN public.order_items oi ON oi.order_id = o.id
      LEFT JOIN public.order_item_quantity_summary s ON s.order_item_id = oi.id
      WHERE o.display_id = '${displayId}'`),
  );
}

/** 那張單訂了幾件(到貨要對得上這個數)。 */
function orderedTotalOf(displayId: string): number {
  return Number(
    probeSql(`
      SELECT coalesce(sum(oi.quantity), 0) FROM public.orders o
      JOIN public.order_items oi ON oi.order_id = o.id
      WHERE o.display_id = '${displayId}'`),
  );
}

function emailOutboxRows(): number {
  return Number(probeSql('SELECT count(*) FROM public.email_outbox'));
}

const RESEED_HINT =
  '⇒ 這支會改變世界。⑤ 沒跑到的話要手動把到貨撤銷回去:' +
  'psql -h 127.0.0.1 -p $ADMIN_PROBE_PG -U postgres -f scripts/admin-probe/seed-shipment-ready.sql 之前, ' +
  "先 DELETE FROM public.order_item_procurement_receipts WHERE received_by IN ('probe_seed','probe_staff') " +
  "AND procurement_id IN (SELECT pr.id FROM public.order_item_procurement pr JOIN public.order_items oi ON oi.id=pr.order_item_id JOIN public.orders o ON o.id=oi.order_id WHERE o.display_id='PCM-2026-1007');";

function rowOf(page: import('@playwright/test').Page, displayId: string) {
  return page.getByRole('main').locator('tbody', { hasText: displayId }).first();
}

test.describe('後台到貨登記(鑽機)', () => {
  test.beforeEach(async ({ context }) => {
    requireProbe();
    const { name, value } = mintProbeCookie();
    await context.addCookies([
      { name, value, url: process.env.E2E_ADMIN_BASE_URL ?? 'http://localhost:3011' },
    ]);
  });

  test('① 前提:1007 已下訂而貨還沒到 —— 這一格紅, 底下每一格都不算數', () => {
    expect(orderedTotalOf(TARGET_ORDER), `${TARGET_ORDER} 應該有訂購量。${RESEED_HINT}`).toBeGreaterThan(0);
    expect(receivedTotalOf(TARGET_ORDER), `${TARGET_ORDER} 的到貨量應該還是 0。${RESEED_HINT}`).toBe(0);
    expect(instockTotalOf(TARGET_ORDER), `${TARGET_ORDER} 的已到貨摘要應該還是 0`).toBe(0);
    expect(emailOutboxRows(), 'email_outbox 起點不是空的').toBe(0);
  });

  test('② 🔵 負對照【到貨前】:1007 那列的下一步是「到貨登記」, 而【沒有】出貨入口', async ({ page }) => {
    // 🔴 判別力正臂在 ③ —— 同一張單、同一組 locator, 到貨之後這兩個計數會對調。
    await page.goto('/orders');
    const main = page.getByRole('main');
    await expect(
      main.getByText(TARGET_ORDER).first(),
      `這一頁上找不到 ${TARGET_ORDER} ⇒ 下面每一格都不算數。成因不只一種:被篩掉 / 落在別的日期窗或別頁 / 這一頁真的沒渲染。`,
    ).toBeVisible();

    const row = rowOf(page, TARGET_ORDER);
    await expect(
      row.getByRole('link', { name: '到貨登記', exact: true }),
      '這一列上「到貨登記」的數量不是 1 —— 0 代表找不到(而它已下訂、貨還沒到, 應該要有), 大於 1 代表這把尺撈到別列去了',
    ).toHaveCount(1);
    await expect(
      row.getByRole('link', { name: '出貨', exact: true }),
      '這一列上找得到出貨入口(而它的貨還沒到, 不該有)',
    ).toHaveCount(0);
  });

  // 🔬 **這一格燒過**(2026-09-19):把票的密鑰換成錯的重跑 ⇒ 本格紅, 而**到貨量沒有落地**。
  test('③ 登記到貨 ⇒ 數量落地、貨品軸跟著變、列表那一欄的字跟著變', async ({ page }) => {
    const ordered = orderedTotalOf(TARGET_ORDER);
    expect(receivedTotalOf(TARGET_ORDER), `起點不對。${RESEED_HINT}`).toBe(0);

    await page.goto('/orders');
    await rowOf(page, TARGET_ORDER).getByRole('link', { name: '到貨登記', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog, '按了那個入口, 而彈窗沒有開起來').toBeVisible();

    // 🔵 每一個品項一列, 每一列一個「到貨幾件」+ 一顆「全到」。
    //    🔬 實測:**「全到」預設就是勾著的**, 數量也已經填成訂購量(1007 兩列 = 2 與 1)。
    //       這裡仍然逐顆 `check()` —— 已經勾著時它是 no-op, 而預設哪天改掉這一行就會把它補回來。
    const allChecks = dialog.getByRole('checkbox', { name: '全到' });
    const n = await allChecks.count();
    expect(n, '到貨彈窗裡一顆「全到」都沒有 ⇒ 這張單多半沒有還在等的採購').toBeGreaterThan(0);
    for (let i = 0; i < n; i += 1) await allChecks.nth(i).check();

    // 🛑 **多品項的單, 那顆鈕叫「確認全部」不是「確認」**(2026-09-19 實撞, 我第一版釘 `'確認'`
    //    加 `exact: true` ⇒ 等了 60 秒 timeout)。單品項時是「確認」⇒ 用前綴涵蓋兩種。
    //    ⚪ 彈窗自己逐字寫著「每一列各自寫入:有一列失敗, 其他列不會退回」——
    //      所以下面驗的是**總量**, 不是「成功了沒」。
    await dialog.getByRole('button', { name: /^確認/ }).first().click();

    // 🔴 等到【DB 真的落地】才算數 —— 不看畫面上的提示字。
    await expect
      .poll(() => receivedTotalOf(TARGET_ORDER), { timeout: 20_000, message: '按了確認, 而 DB 裡的到貨量沒有變' })
      .toBe(ordered);

    // 🔴 **摘要那一欄也要跟著推導出來** —— 它由 A4a trigger 從到貨明細算,
    //    而「明細寫進去了」與「摘要算出來了」是兩件事。
    expect(instockTotalOf(TARGET_ORDER), '到貨明細寫進去了, 而已到貨摘要沒有跟著推導出來').toBe(ordered);

    // 🔴🔴 **列表那一欄印的字要跟著變** —— 派工單三樣要求的第三樣,
    //    同時是 ② 那兩個計數的判別力正臂(同一張單、同一組 locator, 現在對調)。
    await page.goto('/orders');
    const row = rowOf(page, TARGET_ORDER);
    await expect(
      row.getByRole('link', { name: '到貨登記', exact: true }),
      '貨到齊了, 這一列不該還印「到貨登記」',
    ).toHaveCount(0);
    await expect(
      row.getByRole('link', { name: '出貨', exact: true }),
      '貨到齊了, 而這一列上「出貨」的數量不是 1 —— 0 代表下一步沒有跟著變, 大於 1 代表這把尺撈到別列去了',
    ).toHaveCount(1);
  });

  test('④ 🔵 負對照【到貨後】:到貨登記【不】在同步路徑上寫 email_outbox', () => {
    expect(receivedTotalOf(TARGET_ORDER), '③ 跑完應該已經到貨了, 而這裡量到的不是那個數').toBeGreaterThan(0);
    // 🛑 射程很窄, 與 `payment-record.spec.ts` 的 ④ 相同:這台鑽機的八支種子沒有一支碰
    //    `email_outbox` ⇒ 它幾乎恆真。它只擋一種壞法:有人在到貨的同步路徑上直接塞一列。
    expect(emailOutboxRows(), '到貨的同步路徑上跑出了 email_outbox 列').toBe(0);
  });

  test('⑤ 撤銷到貨 ⇒ 那一列回到「到貨登記」(🛑 這一格是【承重的】, 見檔頭)', async ({ page }) => {
    expect(receivedTotalOf(TARGET_ORDER), '③ 跑完應該已經到貨了').toBeGreaterThan(0);

    await page.goto('/orders');
    // 🔵 到貨登記的入口已經不見了(③ 驗過)⇒ 從「出貨」那一格進不去撤銷,
    //    而撤銷住在**到貨彈窗**的摺疊裡 ⇒ 直接走網址開那個彈窗。
    const orderUuid = probeSql(`SELECT id FROM public.orders WHERE display_id = '${TARGET_ORDER}'`);
    await page.goto(`/orders?next=${orderUuid}&do=receipt`);
    const dialog = page.getByRole('dialog');
    await expect(dialog, '按了那個入口, 而彈窗沒有開起來').toBeVisible();

    // 「已登的到貨 N 筆(撤銷在這裡)」那個摺疊 —— 有紀錄時預設是展開的。
    const history = dialog.getByTestId('next-step-receipt-history');
    await expect(history, '到貨彈窗裡找不到「已登的到貨」那個摺疊').toBeVisible();

    // 每一筆各一顆「撤銷」⇒ 逐筆展開、逐筆按「確定撤銷」。
    // 🛑 **每撤一筆就要重新開一次彈窗** —— 撤銷成功會**導回列表**(`doneHref`)
    //    ⇒ 上一輪抓到的 locator 當場失效。
    //    🔬 我第一版在同一個彈窗上連續撤:三筆只撤掉兩筆就停了,而**它停得無聲無息**
    //      (迴圈以為「找不到更多撤銷鈕」= 撤完了)⇒ 紅在下面那格,訊息說「還沒回到 0」。
    //    ⇒ 📌 判準用**資料庫的量**, 不用「畫面上還有沒有鈕」。
    for (let guard = 0; guard < 10 && receivedTotalOf(TARGET_ORDER) > 0; guard += 1) {
      await page.goto(`/orders?next=${orderUuid}&do=receipt`);
      const d = page.getByRole('dialog');
      await expect(d, '重開到貨彈窗, 而它沒有開起來 ⇒ 撤銷這一輪走不下去').toBeVisible();
      const toggle = d.getByTestId('next-step-receipt-history').getByText('撤銷', { exact: true }).first();
      if ((await toggle.count()) === 0) break;
      await toggle.click();
      await d.getByRole('button', { name: '確定撤銷', exact: true }).first().click();
      await page.waitForURL(/\/orders/, { timeout: 15_000 }).catch(() => undefined);
    }

    await expect
      .poll(() => receivedTotalOf(TARGET_ORDER), { timeout: 20_000, message: '撤銷之後 DB 裡的到貨量還沒回到 0' })
      .toBe(0);
    expect(instockTotalOf(TARGET_ORDER), '撤銷之後已到貨摘要沒有跟著回到 0').toBe(0);

    // 🔴 世界要真的回去 —— 否則 `shipping-create-box.spec.ts` 會紅在一個跟它無關的地方。
    await page.goto('/orders');
    const row = rowOf(page, TARGET_ORDER);
    await expect(
      row.getByRole('link', { name: '到貨登記', exact: true }),
      '撤銷之後這一列上「到貨登記」的數量不是 1 —— 0 代表世界沒有放回去(⇒ 出貨那支會跟著紅), 大於 1 代表撈到別列',
    ).toHaveCount(1);
  });
});
