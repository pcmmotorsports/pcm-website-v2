import { test, expect } from '@playwright/test';
import { mintProbeCookie, probeSql, requireProbe } from './probe';

/**
 * 後台「登記收款」的 E2E(2026-09-19;主視窗派工 —— 出貨動線往【前】走一格)。
 *
 * 🎯 動線是「收單 → **收款** → 建單 / 訂貨 / 到貨 → 出貨」。出貨那兩格已經有 e2e
 *    (`shipping-create-box.spec.ts`),而**收款這一格在此之前沒有人驗過**。
 *
 * ── 🛑 這一支【不碰退款】────────────────────────────────────────────────
 *   退款會動客人的錢, 而且可能寄信 ⇒ 要 Sean 點頭。本支只登記一筆收款。
 *
 * ── 🔬 收款會不會寄信:量過了, 不會 ──────────────────────────────────────
 *   2026-09-19 實測四道(**先講盲區**:都是靜態掃 + DB 目錄, 不是 runtime 追蹤):
 *     · `lib/orders/payment-actions.ts` 提到 email / mail 的次數 = 0
 *     · RPC `admin_record_manual_payment` **有**提到 `email_outbox` —— 而那是一句 **SELECT**
 *       (乾淨單判定 c6:「這張單有沒有寄過 order_created」), **不是寫入**
 *     · `order_payments` / `orders` 上的 12 支 trigger 函式, 碰 `email_outbox` 的 = 0 支
 *     · 全庫唯一會 `INSERT INTO public.email_outbox` 的函式 = `record_manual_cancel_notice`
 *       (人工取消通知)⇒ **跟收款無關**
 *   ⚪ 判別力:最後那把尺**找得到 1 支** ⇒ 它會動, 所以前面那些 0 是真的 0。
 *   ⇒ ✅ 所以本支把「`email_outbox` 維持 0」當成一格斷言 —— 那是**免費的負對照**。
 *
 * ── 🔴 起點:PCM-2026-1007 ───────────────────────────────────────────────
 *   未付款 + 0 筆付款 + 未取消 + 匯款軌(應收 14,300)。
 *   🔵 **不用 9001** —— 那張已經付清了(出貨那兩支在用), 再收就變成「多收待退」,
 *     而那是另一個情境, 還會碰到待退款(= 退款的鄰居)。
 *
 *   🔴🔴 **也【不用 1001】, 而這一格是撞出來的**(2026-09-19):
 *     1001 帳面上更乾淨(未付款、0 筆付款、應收 16,750), 而它**在預設清單上根本看不到**
 *     ⇒ 我第一版寫它, 紅在「這一頁要有渲染」, 而那句話**把原因指錯了**:頁面渲染得好好的。
 *     真因:`1001.payment_channel = 'tappay'` 且未付款 ⇒ 落在「**含刷卡未付款**」那個
 *     **預設關著**的篩選裡(工具列上那顆 `show_unpaid_card=1`)。
 *     ⚪ 對照:`1007.payment_channel = 'bank_transfer'` ⇒ 看得到;
 *       `ZZQPRB` 也是 tappay 而**收過錢了** ⇒ 也看得到 ⇒ 藏起來的條件是【刷卡 **且** 未付款】。
 *     📌 ⇒ **「這張單不在清單上」與「這一頁壞了」長得一模一樣。** 下一個人挑起點單之前先看這一段。
 *
 * ── ⚠️ 跟出貨那支共用 1007, 而兩支看的是【不同的軸】───────────────────────
 *   `shipping-create-box.spec.ts` 拿 1007 當負對照, 看的是**貨品軸**(沒到貨 ⇒ 沒有出貨入口)。
 *   本支動的是**收款**。那一欄的字由 `ORDER_NEXT_STEP_LABEL` 決定, 而它**只看貨、不看錢**
 *   (`order-status-axes.ts` 逐字:「品項層動作只看貨的狀態;收款是訂單層的事」)
 *   ⇒ 本支收了錢**不會**動到那一支的任何一格。🛑 哪天有人改成「下一步也看錢」, 這句就失效。
 *
 * ── ⚠️ 這支會【改變世界】, 不是冪等的 ──────────────────────────────────
 *   `order_payments` 是 append-only(`pcm_op2b_no_delete` / `pcm_op2b_immutable_columns`)
 *   ⇒ **登記了就刪不掉**。重跑前要把那一筆**沖銷**掉, 指令逐字在 `RESEED_HINT`。
 */

const TARGET_ORDER = 'PCM-2026-1007';
/** 🔵 已經付清的那一張 —— 拿來當「收款欄那把尺會動」的正臂(它印的不是「還沒收」)。 */
const SETTLED_ORDER = 'PCM-2026-9001';

/** 這一次要登記的金額。**故意不是全額**(應收 14,300)⇒ 欄位的字要從「還沒收」變成「還差 4,300」。 */
const PAY_AMOUNT = 10000;
const EXPECTED_REMAINDER = 4300;

function paidTotalOf(displayId: string): number {
  return Number(
    probeSql(`
      SELECT coalesce(sum(p.amount), 0) FROM public.order_payments p
      JOIN public.orders o ON o.id = p.order_id
      WHERE o.display_id = '${displayId}'`),
  );
}

function paymentCountOf(displayId: string): number {
  return Number(
    probeSql(`
      SELECT count(*) FROM public.order_payments p
      JOIN public.orders o ON o.id = p.order_id
      WHERE o.display_id = '${displayId}'`),
  );
}

function paymentStatusOf(displayId: string): string {
  return probeSql(`SELECT payment_status FROM public.orders WHERE display_id = '${displayId}'`);
}

/** 整張 `email_outbox` 的列數。**只數, 不印** —— 那張表有收件人(PII)。 */
function emailOutboxRows(): number {
  return Number(probeSql('SELECT count(*) FROM public.email_outbox'));
}

/**
 * 重跑前怎麼把起點放回去。
 *
 * 🔴 **不是「刪掉那一筆」** —— `order_payments` 是 append-only(`pcm_op2b_no_delete`
 *    / `pcm_op2b_immutable_columns`)⇒ 正解是產品自己的補救動作:**沖銷**,
 *    而沖銷**是再記一筆負的**(實測留下 10000 / -10000 兩列, 淨額 0)。
 */
const RESEED_HINT =
  '⇒ 這支會改變世界。重跑前把那一筆【沖銷】(刪不掉, DB 會擋):' +
  'psql -h 127.0.0.1 -p $ADMIN_PROBE_PG -U postgres -tAc "SELECT public.admin_reverse_manual_payment(' +
  "p.id, 'probe_staff', 'probe reseed') FROM public.order_payments p JOIN public.orders o ON o.id=p.order_id " +
  "WHERE o.display_id='PCM-2026-1007' AND p.amount > 0\" 。沖銷之後淨已收回到 0、狀態回到 unpaid。";

/** 那一張單在清單頁上的列。 */
function rowOf(page: import('@playwright/test').Page, displayId: string) {
  return page.getByRole('main').locator('tbody', { hasText: displayId }).first();
}

test.describe('後台登記收款(鑽機)', () => {
  test.beforeEach(async ({ context }) => {
    requireProbe();
    // 🔴 現簽一張票 —— 讀檔裡那一張會拿到死票,理由見 `probe.ts` 的 `mintProbeCookie`。
    const { name, value } = mintProbeCookie();
    await context.addCookies([
      { name, value, url: process.env.E2E_ADMIN_BASE_URL ?? 'http://localhost:3011' },
    ]);
  });

  test('① 前提:起點乾淨 —— 這一格紅, 底下每一格都不算數', () => {
    // 🔴🔴 **判準是【淨額 0】, 不是【零筆】** —— 這一格是 2026-09-19 沖銷之後撞出來的:
    //    `order_payments` 是流水帳, **沖銷 = 再記一筆負的**(實測 10000 / -10000 兩列, 淨額 0)
    //    ⇒ 寫成「零筆」的話, 這支跑過一次、沖銷回去之後就**永遠再也跑不起來**,
    //      而那個紅會長得像「種子壞了」。📌 帳本型的表不要用列數當狀態。
    expect(paidTotalOf(TARGET_ORDER), `${TARGET_ORDER} 淨已收金額應該是 0。${RESEED_HINT}`).toBe(0);
    expect(paymentStatusOf(TARGET_ORDER), `${TARGET_ORDER} 應該是 unpaid`).toBe('unpaid');
    // 🔵 免費的負對照起點:整張 email_outbox 是空的 ⇒ 下面「收完還是 0」才有意義。
    expect(emailOutboxRows(), 'email_outbox 起點應該是空的').toBe(0);
  });

  test('② 🔵 負對照【收款前】:1007 那格印「還沒收」而且點得下去, 已收足的 9001 印的不是那個', async ({ page }) => {
    await page.goto('/orders');
    const main = page.getByRole('main');
    await expect(main.getByText(TARGET_ORDER).first(), '這一頁要有渲染, 否則下面每一格都不算數').toBeVisible();

    // 🔴 那一格**是連結**(= 有收款要做)。`order-list-view.ts` 逐字:
    //    「已收足 / 需確認 / 多收 N」三態不可點;只有「還差 N」與「還沒收」可點。
    await expect(
      rowOf(page, TARGET_ORDER).getByRole('link', { name: '還沒收', exact: true }),
      '沒收過錢那張單, 收款欄要是一顆點得下去的「還沒收」',
    ).toHaveCount(1);

    // 🔴🔴 **判別力正臂**:同一頁、同一把尺, 已收足那張**不是**「還沒收」——
    //    少了這一格, 上面那個 1 與「這把尺對每一列都回 1」分不出來。
    await expect(
      rowOf(page, SETTLED_ORDER).getByText('已收足', { exact: true }).first(),
      '已經付清那張單, 收款欄要印「已收足」',
    ).toBeVisible();
    await expect(
      rowOf(page, SETTLED_ORDER).getByRole('link', { name: '還沒收', exact: true }),
      '已經付清那張單不該印「還沒收」',
    ).toHaveCount(0);
  });

  // 🔬 **這一格燒過**(2026-09-19):把票的密鑰換成錯的(`ADMIN_PROBE_SECRET=wrong-…`)重跑
  //    ⇒ 本格紅在「按了確認, 而 DB 裡的已收金額沒有變」、④ 跟著紅;而 ①② 照樣綠(唯讀)。
  //    ⚪ 而且**錢沒有落地**:燒完 1007 淨已收實測 = 0。
  //    📌 ⇒ 這支的綠真的綁在那張票上, 而它紅的時候【不會留下半筆錢】。
  test('③ 登記一筆收款 ⇒ 金額落地、payment_status 跟著變、列表那一欄的字跟著變', async ({ page }) => {
    const before = { paid: paidTotalOf(TARGET_ORDER), count: paymentCountOf(TARGET_ORDER) };
    // 🔴 起點判準同 ①:**淨額**, 不是列數。
    //    📌 我第一版這裡寫 `count === 0` ⇒ ① 修好之後這一格照樣紅 ——
    //    **同一個教訓在隔壁那一格沒有被套上去。**(今晚第二次踩同一個形狀。)
    expect(before.paid, `起點不對。${RESEED_HINT}`).toBe(0);

    await page.goto('/orders');
    await rowOf(page, TARGET_ORDER).getByRole('link', { name: '還沒收', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // 🔵 用現金軌 —— 匯款軌還要單號 / 末五碼, 而這一支要測的是「收款登記走不走得通」,
    //    不是「匯款軌的欄位驗證」(那是另一片)。
    await dialog.getByLabel('方式').selectOption({ label: '現金' });
    await dialog.getByLabel('金額(新臺幣元)').fill(String(PAY_AMOUNT));
    // 🔴 Sean 拍 `Q-D8=B`:那顆「我看過已收的」**每一次全新掛載都要勾**。不勾就送不出去。
    await dialog.getByRole('checkbox').last().check();
    await dialog.getByRole('button', { name: '確認', exact: true }).click();

    // 🔴 等到【DB 真的落地】才算數 —— 不看畫面上的提示字。
    await expect
      .poll(() => paidTotalOf(TARGET_ORDER), { timeout: 20_000, message: '按了確認, 而 DB 裡的已收金額沒有變' })
      .toBe(before.paid + PAY_AMOUNT);
    expect(paymentCountOf(TARGET_ORDER), '應該剛好多一筆, 不是兩筆').toBe(before.count + 1);

    // 🔴 訂單的收款狀態要跟著變(沒付清 ⇒ partiallyPaid)。
    expect(paymentStatusOf(TARGET_ORDER), '收了一部分, 狀態該是 partiallyPaid').toBe('partiallyPaid');

    // 🔴 **列表那一欄印的字也要跟著變** —— 派工單三樣要求的第三樣。
    await page.goto('/orders');
    const row = rowOf(page, TARGET_ORDER);
    await expect(
      row.getByRole('link', { name: '還沒收', exact: true }),
      '收過錢了就不該還印「還沒收」',
    ).toHaveCount(0);
    await expect(
      row.getByText(new RegExp(`還差[^0-9]*${EXPECTED_REMAINDER.toLocaleString('en-US')}`)).first(),
      `收了 ${PAY_AMOUNT} 之後那一欄該印「還差 ${EXPECTED_REMAINDER.toLocaleString('en-US')}」`,
    ).toBeVisible();
  });

  test('④ 🔵 負對照【收款後】:收款【不】寄信 —— email_outbox 還是 0', () => {
    expect(paidTotalOf(TARGET_ORDER), '③ 跑完應該已經收到錢了').toBe(PAY_AMOUNT);
    // 🔴🔴 **判別力**:這把尺**找得到東西** —— 全庫唯一會寫這張表的是 `record_manual_cancel_notice`,
    //    而它 2026-09-19 實測存在(見檔頭)。⇒ 這裡的 0 是「收款真的沒排信」, 不是尺量不到。
    expect(emailOutboxRows(), '登記收款不該產生任何待寄信').toBe(0);
  });
});
