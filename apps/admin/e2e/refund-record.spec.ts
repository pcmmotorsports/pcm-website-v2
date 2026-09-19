import { test, expect } from '@playwright/test';
import { mintProbeCookie, probeSql, probeSqlWriteForCleanup, requireProbe } from './probe';

/**
 * 後台「登記退款」的 E2E(2026-09-19;**Sean 本人**逐字鬆的條件之下)。
 *
 * ── 🛑🛑 這一支【會把一張單推進寄信佇列】, 而那是 Sean 親自裁的 ────────────────
 *   他的原條件逐字是「不寄真信, 碰到會寄信的鈕就停下問」。我停下問了, 而他答:
 *   **「甲 = 不算, 按下去(用佇列 0→1 當證據, 跑完沖銷歸零)」**
 *   ⇒ 🔴 **那是他本人鬆的,不是任何窗代鬆的。** 要改這支的行為, 回去看那一句。
 *
 * ── 🔴 退款與收款【不對稱】, 而這一格是量出來的不是猜的 ──────────────────────
 *   收款那一側:**部分收款是安全的**(只有全額才翻成 `paid` ⇒ 掉進訂單成立信那條路)。
 *   退款這一側:**沒有安全金額。** `pcm_partial_refund_email_pending` 的述詞逐字:
 *     `payment_status = ANY (ARRAY['partiallyRefunded','refunded'])`
 *   ⇒ 📌 **退多少都會進佇列。** 昨夜「挑部分款避開寄信」那一招在這裡用不了。
 *   🔵 而那反而讓判別乾淨:**沒有「安全金額」這個混淆項。**
 *
 *   🔵 兩支掃描器要分開看(⑤ 就是在量這一格):
 *     · `SupabasePartialRefundOrderScannerAdapter` → `pcm_partial_refund_email_pending`
 *     · `SupabaseCancelledOrderScannerAdapter`     → `pcm_cancelled_email_pending`(走 `refunded` + 取消)
 *   ⇒ **部分退款應該只進前者。** 若兩張都亮, 那是另一件事。
 *
 * ── 🛑 按之前要當場再量三條(人做的事, 測試檢查不到)────────────────────────
 *   `lsof … | grep node` 有沒有 storefront · 鑽機庫有沒有 `pg_net`/`http` · `cron.job` 幾個。
 *   🔬 2026-09-19 按之前實測:storefront **0 個**(3011/3021 都是 admin)· 擴充只有
 *      `pg_cron, pg_trgm, pgcrypto, plpgsql`(**沒有 pg_net**)· `cron.job` **0**。
 *   📌 那三條**只有第一條會在你按之前改變** —— 有人起了 storefront, 就有人會來撿那封信。
 *
 * ── 🔴 這支【自己把世界放回去】(⑥), 而那一格是承重的 ──────────────────────
 *   它動的是 1007 的收款軸 ⇒ 與 `payment-record.spec.ts` 同一軸。
 *   ⇒ ⑥ 把退款作廢 + 把收款沖銷 ⇒ 1007 回到「淨已收 0 / unpaid」。
 *   ⚠️ 中間任何一格紅 ⇒ ⑥ 不會跑 ⇒ 1007 會留著錢與退款。那是 fail-closed(紅了會知道),
 *     而復原要手動, 指令在 `RESEED_HINT`。
 */

const TARGET_ORDER = 'PCM-2026-1007';
/**
 * 先收這麼多(現金軌)= **這張單的全額**(1007 應收 14,300)。
 *
 * 🔴🔴 **為什麼一定要全額, 而不是隨便一筆**(2026-09-19 實撞, 後端自己拒的):
 *    只收部分款去按退款 ⇒ 後端回
 *    `pcm_sync_order_refund_payment_status: … payment_status=partiallyPaid 不允許進入退款轉移`
 *    ⇒ 📌 **一張只收部分款的單退不了款。要退款, 它必須先是 `paid`。**
 * 🛑 而「收全額」正是昨夜 R1 MF1 指出的那一步:**它會把這張單推進【訂單成立信】的待寄佇列。**
 *    ⇒ 這一支因此點亮【三張】佇列中的第一張, 而那是 Sean 明文知情之下答「依照建議」的
 *      (主視窗端給他的題目逐字寫著「途中會多點亮一條訂單成立信的佇列, 跑完一起歸零」)。
 *    🔵 所以 ⑥ 要清的是**三張**, 不是兩張。
 */
const PAY_AMOUNT = 14300;
/** 退這麼多。**故意不是全額** —— 不是為了避開寄信(避不掉), 是為了讓狀態停在 `partiallyRefunded`。 */
const REFUND_AMOUNT = 3000;

function orderUuid(displayId: string): string {
  return probeSql(`SELECT id FROM public.orders WHERE display_id = '${displayId}'`);
}

function paidTotalOf(displayId: string): number {
  return Number(
    probeSql(`
      SELECT coalesce(sum(p.amount), 0) FROM public.order_payments p
      JOIN public.orders o ON o.id = p.order_id WHERE o.display_id = '${displayId}'`),
  );
}

/**
 * 那張單【未作廢】的手動退款總額。
 * 🔵 欄名是 `refund_amount` 不是 `amount`(實查:id / order_id / rail / **refund_amount** / reason /
 *    actor / occurred_at / created_at / voided_at / void_reason / voided_by / request_id /
 *    over_cap_by / cap_state)—— 我第一版照收款那邊的習慣寫 `amount`, psql 當場報錯,
 *    而錯訊只印「Command failed」⇒ 看起來像鑽機掛了。**同一個形狀今天第二次。**
 */
function refundTotalOf(displayId: string): number {
  return Number(
    probeSql(`
      SELECT coalesce(sum(r.refund_amount), 0) FROM public.order_manual_refunds r
      JOIN public.orders o ON o.id = r.order_id
      WHERE o.display_id = '${displayId}' AND r.voided_at IS NULL`),
  );
}

function paymentStatusOf(displayId: string): string {
  return probeSql(`SELECT payment_status FROM public.orders WHERE display_id = '${displayId}'`);
}

/**
 * 三張待寄佇列, **一律按【這一張單】計, 不用全域數**。
 *
 * 🔴🔴 **這一格是 2026-09-19 撞出來的, 而它差一點讓整支的基準線是假的**:
 *    我第一版寫全域 `count(*)`, 而 `pcm_order_created_email_pending` **本來就有 1 列**
 *    —— 那是 `PCM-2026-9001`(出貨那支的種子單, 已付清)。
 *    ⇒ 📌 **「佇列是 0」那句話在全域尺上是假的, 而它看起來像個乾淨的起點。**
 *    ⇒ ✅ 三張 view 都帶 `display_id` ⇒ 按單計, 別張單的狀態就進不來。
 */
function pendingOf(view: string, displayId: string): number {
  return Number(probeSql(`SELECT count(*) FROM public.${view} WHERE display_id = '${displayId}'`));
}
/** 訂單成立信 —— 🔴 **收全額就會點亮它**(Sean 這一輪明文知道並答「依照建議」)。 */
function createdPending(displayId: string): number {
  return pendingOf('pcm_order_created_email_pending', displayId);
}
/** 部分退款那條線。 */
function partialRefundPending(displayId: string): number {
  return pendingOf('pcm_partial_refund_email_pending', displayId);
}
/** 取消 / 全額退款那條線 —— **與上面那張是不同的掃描器**。 */
function cancelledPending(displayId: string): number {
  return pendingOf('pcm_cancelled_email_pending', displayId);
}

function emailOutboxRows(): number {
  return Number(probeSql('SELECT count(*) FROM public.email_outbox'));
}

const RESEED_HINT =
  '⇒ 這支會改變世界。⑥ 沒跑到的話要手動放回去:先作廢那筆退款' +
  "(UPDATE public.order_manual_refunds SET voided_at=now() … WHERE order_id=…), 再沖銷那筆收款" +
  "(SELECT public.admin_reverse_manual_payment(<payment_id>,'probe_staff','probe reseed'))。" +
  '放回去之後:淨已收 0 · 狀態 unpaid · 兩張待寄 view 都 0。';

function rowOf(page: import('@playwright/test').Page, displayId: string) {
  return page.getByRole('main').locator('tbody', { hasText: displayId }).first();
}

/**
 * 把世界放回去:**先作廢退款, 後沖銷收款**。
 *
 * 🔴🔴 **順序是承重的, 而它是量出來的不是推的**(2026-09-19 實跑兩種順序):
 * ```
 * 先沖銷收款、後作廢退款 ⇒ 狀態卡在 partiallyRefunded(帳本淨額 0 而狀態不對)
 * 先作廢退款、後沖銷收款 ⇒ 狀態正確回到 unpaid
 * ```
 * 📌 **重算是跟著【最後那一個動作】走的** ⇒ 順序反了, **兩邊帳面都對而狀態是錯的**,
 *    而那種錯不會有任何東西叫。
 *
 * 🔴 **為什麼走 SQL 不走畫面**(2026-09-19 主視窗裁「換路」):
 *    我用畫面點作廢連兩輪都紅在 `locator.click` timeout ⇒ 規矩逐字
 *    「**相同錯法第 2 次 ⇒ 換路不重試**」。而這兩支正是產品自己的 RPC,
 *    畫面上那兩顆鈕底下叫的就是它們 —— **換的是抵達方式, 不是繞過守門。**
 * 🛑 而**被測的那個動作(登記退款)仍然走畫面** —— 收尾走 SQL 不等於測試走 SQL。
 */
function restoreWorld(): void {
  probeSqlWriteForCleanup(`
    SELECT public.admin_void_manual_refund(r.id, 'probe reseed', 'probe_staff')
      FROM public.order_manual_refunds r
      JOIN public.orders o ON o.id = r.order_id
     WHERE o.display_id = '${TARGET_ORDER}' AND r.voided_at IS NULL`);
  probeSqlWriteForCleanup(`
    SELECT public.admin_reverse_manual_payment(p.id, 'probe_staff', 'probe reseed')
      FROM public.order_payments p
      JOIN public.orders o ON o.id = p.order_id
     WHERE o.display_id = '${TARGET_ORDER}' AND p.amount > 0
       AND NOT EXISTS (SELECT 1 FROM public.order_payments r
                        WHERE r.order_id = p.order_id AND r.amount = -p.amount
                          AND r.created_at > p.created_at)`);
}

/**
 * 把「退款 / 取消」彈窗裡的【退款】那一區展開。
 *
 * 🔴 **它預設是收合的** —— 彈窗一打開只看得到兩顆 `▶`:「退款」與「申請取消整張單」。
 *    ⇒ 📌 「登記退款」那個標題**在展開之前根本沒有渲染** ⇒ 直接找它會 timeout,
 *      而失敗訊息會說「找不到登記退款那一區」—— **那句話會把人指向權限閘**
 *      (`manual-refund-entry-gate`), 而真因只是**沒有人去點開它**。
 *    🔬 2026-09-19 實撞:我第一版就是這樣紅的。
 */
async function openRefundSection(dialog: import('@playwright/test').Locator) {
  const summary = dialog.getByRole('group').filter({ hasText: '退款' }).first().getByText('退款', { exact: true }).first();
  if ((await summary.count()) > 0) await summary.click();
}

test.describe('後台登記退款(鑽機)', () => {
  test.beforeEach(async ({ context }) => {
    requireProbe();
    const { name, value } = mintProbeCookie();
    await context.addCookies([
      { name, value, url: process.env.E2E_ADMIN_BASE_URL ?? 'http://localhost:3011' },
    ]);
  });

  test('① 前提:起點乾淨 —— 這一格紅, 底下每一格都不算數', () => {
    expect(paidTotalOf(TARGET_ORDER), `${TARGET_ORDER} 淨已收應該是 0。${RESEED_HINT}`).toBe(0);
    expect(refundTotalOf(TARGET_ORDER), `${TARGET_ORDER} 不該有未作廢的退款。${RESEED_HINT}`).toBe(0);
    expect(paymentStatusOf(TARGET_ORDER), `${TARGET_ORDER} 應該是 unpaid`).toBe('unpaid');
    expect(createdPending(TARGET_ORDER), '訂單成立信佇列起點不是 0').toBe(0);
    expect(partialRefundPending(TARGET_ORDER), '部分退款待寄佇列起點不是 0').toBe(0);
    expect(cancelledPending(TARGET_ORDER), '取消信待寄佇列起點不是 0').toBe(0);
    expect(emailOutboxRows(), 'email_outbox 起點不是空的').toBe(0);
  });

  test('② 先收一筆現金 —— 這是【前置】不是被測對象(退款入口要求單上有現金/匯款收款)', async ({ page }) => {
    // 🔵 收款本身由 `payment-record.spec.ts` 驗, 這裡只是把世界推到可退款的狀態。
    //    ⇒ 所以這一格的斷言只有一條:錢進去了。其餘不重複驗。
    await page.goto(`/orders?pay=${orderUuid(TARGET_ORDER)}`);
    const dialog = page.getByRole('dialog');
    await expect(dialog, '開不了收款彈窗 ⇒ 底下每一格都走不下去').toBeVisible();
    await dialog.getByLabel('方式').selectOption({ label: '現金' });
    await dialog.getByLabel('金額(新臺幣元)').fill(String(PAY_AMOUNT));
    await dialog.getByRole('checkbox', { name: /不是重複的/ }).check();
    await dialog.getByRole('button', { name: '確認', exact: true }).click();

    await expect
      .poll(() => paidTotalOf(TARGET_ORDER), { timeout: 20_000, message: '前置收款沒有落地' })
      .toBe(PAY_AMOUNT);
    expect(paymentStatusOf(TARGET_ORDER), '收了全額, 狀態該是 paid').toBe('paid');

    // 🔴🔴 **誠實斷言:這一步【點亮了訂單成立信那張佇列】** —— 不假裝沒發生。
    //    它是走到退款的必經之路(部分款退不了), 而 Sean 是在明文知道這一條的情況下答「依照建議」。
    await expect
      .poll(() => createdPending(TARGET_ORDER), { timeout: 20_000, message: '收全額之後【訂單成立信】佇列沒有亮 ⇒ 那條路跟我們以為的不一樣' })
      .toBe(1);
    // 🔵 而**收款不該動到退款那兩張** —— 這一格順便是 ④ 的乾淨起點。
    expect(partialRefundPending(TARGET_ORDER), '只是收款, 不該進部分退款佇列').toBe(0);
    expect(cancelledPending(TARGET_ORDER), '只是收款, 不該進取消信佇列').toBe(0);
  });

  test('③ 🔵 負對照【退款前】:退款那一區在, 而兩張待寄佇列都還是 0', async ({ page }) => {
    expect(paidTotalOf(TARGET_ORDER), `② 跑完應該有錢了。${RESEED_HINT}`).toBe(PAY_AMOUNT);

    await page.goto(`/orders?cancel=${orderUuid(TARGET_ORDER)}`);
    const dialog = page.getByRole('dialog');
    await expect(dialog, '開不了「退款 / 取消」彈窗').toBeVisible();
    await openRefundSection(dialog);
    // 🔴 判別力正臂在 ④ —— 同一個入口, 按下去之後佇列會從 0 變 1。
    await expect(
      dialog.getByRole('heading', { name: /登記退款/ }),
      '彈窗裡找不到「登記退款」那一區(而這張單有現金收款, 依 manual-refund-entry-gate 應該要給)',
    ).toBeVisible();

    expect(partialRefundPending(TARGET_ORDER), '還沒退款, 部分退款佇列不該有東西').toBe(0);
    expect(cancelledPending(TARGET_ORDER), '還沒退款, 取消信佇列不該有東西').toBe(0);
  });

  // 🔬 **這一格燒過**(2026-09-19):把票的密鑰換成錯的重跑
  //    ⇒ 本格紅, 而**退款沒落地、兩張佇列都還是 0** ⇒ 0→1 不是時間差。
  test('④ 登記退款 ⇒ 金額落地、狀態變 partiallyRefunded、列表那一欄跟著變、待寄佇列 0→1', async ({ page }) => {
    expect(refundTotalOf(TARGET_ORDER), `起點不對。${RESEED_HINT}`).toBe(0);

    await page.goto(`/orders?cancel=${orderUuid(TARGET_ORDER)}`);
    const dialog = page.getByRole('dialog');
    await expect(dialog, '開不了「退款 / 取消」彈窗').toBeVisible();
    await openRefundSection(dialog);

    const section = dialog.locator('section', { hasText: '登記退款' }).first();
    await section.getByRole('textbox', { name: /金額|不含小數/ }).first().fill(String(REFUND_AMOUNT));
    await section.getByRole('textbox', { name: /原因|會寫入退款紀錄/ }).first().fill('鑽機 e2e:退款登記驗證');
    await section.getByRole('button', { name: '登記退款', exact: true }).click();

    // 🔴 等到【DB 真的落地】才算數。
    await expect
      .poll(() => refundTotalOf(TARGET_ORDER), { timeout: 20_000, message: '按了登記退款, 而 DB 裡的退款金額沒有變' })
      .toBe(REFUND_AMOUNT);
    expect(paymentStatusOf(TARGET_ORDER), '退了一部分, 狀態該是 partiallyRefunded').toBe('partiallyRefunded');

    // 🔴🔴 **那封信真的被排進去了** —— 這是 Sean 裁甲時指定的那個證據。
    await expect
      .poll(() => partialRefundPending(TARGET_ORDER), { timeout: 20_000, message: '退款之後, 部分退款的待寄信沒有長出來' })
      .toBe(1);

    // 🔴 列表那一欄要跟著變(派工單三樣要求的第三樣)。
    await page.goto('/orders');
    await expect(
      rowOf(page, TARGET_ORDER).getByRole('link', { name: '還沒收', exact: true }),
      '退過款了, 這一列不該還印「還沒收」',
    ).toHaveCount(0);
  });

  test('⑤ 🔵 負對照【退款後】:只亮【部分退款】那一張, 取消信那一張仍然是 0', () => {
    // 🔴🔴 這一格分的是**兩支不同的掃描器**:部分退款走一支、取消 / 全額退款走另一支。
    //    ⚪ 判別力:上面那張剛剛才從 0 變 1 ⇒ 這把「數佇列」的尺**確定會動**
    //      ⇒ 所以這裡的 0 是「真的沒進那一張」, 不是尺量不到。
    expect(partialRefundPending(TARGET_ORDER), '④ 跑完部分退款佇列應該是 1').toBe(1);
    expect(cancelledPending(TARGET_ORDER), '部分退款不該掉進【取消信】那條線').toBe(0);
    expect(emailOutboxRows(), '退款的同步路徑上跑出了 email_outbox 列').toBe(0);
  });

  test('⑥ 把世界放回去:三張佇列都回 0(🛑 這一格是承重的)', () => {
    expect(refundTotalOf(TARGET_ORDER), '④ 跑完應該有一筆退款').toBe(REFUND_AMOUNT);
    restoreWorld();

    // 🔴 **收不乾淨就要紅** —— 不要靜靜地清一半。
    expect(refundTotalOf(TARGET_ORDER), '作廢之後還有未作廢的退款').toBe(0);
    expect(paidTotalOf(TARGET_ORDER), '沖銷之後淨已收沒有回到 0').toBe(0);
    expect(paymentStatusOf(TARGET_ORDER), '放回去之後狀態該是 unpaid').toBe('unpaid');
    // 🛑 **三張都要回 0, 不是兩張** —— 收全額點亮的那一張也是我們點的。
    expect(createdPending(TARGET_ORDER), '收尾之後【訂單成立信】佇列沒有回到 0').toBe(0);
    expect(partialRefundPending(TARGET_ORDER), '收尾之後部分退款佇列沒有回到 0').toBe(0);
    expect(cancelledPending(TARGET_ORDER), '收尾之後取消信佇列沒有回到 0').toBe(0);
  });

  /**
   * 🛑 **安全網:不管上面哪一格紅了, 這裡都會跑。**
   *
   * 🔴 為什麼要有它, 而 ⑥ 不夠:④ 若紅掉, ⑥ 根本不會執行 ⇒ 那條待寄信會留在佇列裡等人。
   *    ⇒ 📌 **⑥ 是【會紅的那一半】, 這裡是【一定會跑的那一半】。兩個都要。**
   * ⚪ 重複做一次是安全的:兩支 RPC 都只挑「還沒被處理的那些」。
   */
  test.afterAll(() => {
    if (process.env.E2E_ADMIN_BASE_URL !== undefined) restoreWorld();
  });
});
