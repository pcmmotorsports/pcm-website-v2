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
 * ── 🔬 收款會不會寄信 ────────────────────────────────────────────────────
 *   ⛔ ~~本檔第一版寫「量過了, 不會」~~ —— **那句超出證據**(2026-09-19 R1 對抗審查 MF1,
 *      我自己複核之後確認它是對的)。下面是縮到量得到的範圍之後的說法。
 *
 *   ✅ **量得到的**:登記**部分**收款, 在**同步路徑**上不寫 `email_outbox`。四道靜態尺:
 *     · `lib/orders/payment-actions.ts` 提到 email / mail 的次數 = 0
 *     · RPC `admin_record_manual_payment` **有**提到 `email_outbox` —— 而那是一句 **SELECT**
 *       (乾淨單判定 c6:「這張單有沒有寄過 order_created」), **不是寫入**
 *     · `order_payments` / `orders` 上的 12 支 trigger 函式, 碰 `email_outbox` 的 = 0 支
 *     · 全庫唯一會 `INSERT INTO public.email_outbox` 的**資料庫函式** = `record_manual_cancel_notice`
 *     ⚪ 判別力:最後那把尺找得到 1 支 ⇒ 它會動。
 *
 *   🔴🔴 **而那四道尺全是【資料庫這一側】, 真正寄給客人的信不是資料庫寫的**:
 *     `packages/adapters/src/email/SupabasePaidOrderScannerAdapter.ts:190,218-225`
 *     它是 **cron 端的 TypeScript 掃描器**, 讀 `pcm_order_created_email_pending`,
 *     而那張 view 的述詞逐字含 `payment_status = 'paid'`。
 *     ⇒ 📌 **登記收款動的正是它 key 的那個欄位。**
 *     🔴 **收全額 ⇒ `payment_status` 翻成 `'paid'` ⇒ 那張單就【符合那張 view 的第一個條件】。**
 *     🛑 **而那不是全部條件, 不要寫成確定句**(2026-09-19 R2 consider 1):那張 view 還要
 *        `cancelled_at IS NULL`、收件信箱至少一個非空;掃描器另有 `paid_at >= cutoff`
 *        **而且** `created_at >= cutoff` ⇒ 1007 是舊種子單, `created_at` 很可能落在 cutoff 之外。
 *     ⇒ ✅ 正確的說法是【若…則】:**若其餘條件也成立, 收全額就會讓它掉進待寄清單。**
 *     ⚠️ 這一格錯的方向是往安全那邊(我把風險講大)—— 而**它跟 MF1 是同一個形狀**:
 *        條件沒列全的確定句。方向對不代表話是對的。
 *     🔬 而這不是推論:2026-09-19 實測,`pcm_order_created_email_pending` **現在就有 1 列**
 *        (`PCM-2026-9001`, 那張已付清的種子單)—— 而同一刻 `email_outbox` 是 **0 列**。
 *        ⇒ 📌 **`email_outbox = 0` 不但不證明「沒有信要寄」, 它正是那張待寄 view 滿的條件**
 *          (那張 view 是 anti-join:已付清 **而且** 還沒有 `email_outbox` 列)。
 *
 *   🛑 **⇒ 所以下面那顆 `PAY_AMOUNT` 不是隨便挑的**:它是**部分款**(10,000 / 14,300)。
 *      **把它改成全額, 就把這張單推到寄信那條路的入口**(其餘條件見上), 而本支的 ④ 照樣會綠
 *      —— 它量不到 cron 那一側。
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
// 🛑 **這裡曾經有一個 `SETTLED_ORDER = 'PCM-2026-9001'`, 2026-09-19 拿掉了。**
//    理由與「不要加回來」寫在 ② 的註解裡, 一句話:拿另一張單當正臂 = 賭那張單的狀態。

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
    // 🔵 起點:整張 email_outbox 是空的。
    //    🛑 而它在這台鑽機上**幾乎恆真**(八支種子沒有一支碰那張表)⇒ 射程見 ④ 那一格的註解。
    expect(emailOutboxRows(), 'email_outbox 起點不是空的').toBe(0);
  });

  test('② 🔵 負對照【收款前】:1007 那格是一顆點得下去的「還沒收」', async ({ page }) => {
    // 🔴🔴 **這一格的判別力正臂【不在這裡, 在 ③】** —— 那是刻意的, 2026-09-19 改的。
    //
    //    ⛔ ~~原本的正臂是「已付清的 9001 印的不是『還沒收』」~~ ⇒ **拿掉了**, 理由一句話:
    //    📌 **拿另一張單當正臂, 本來就是在賭那張單的狀態。**
    //    🔴 而那個賭是**會輸的**:`shipping-create-box.spec.ts` 跑完會把 9001 留在【已出貨】,
    //       而出完貨的單**掉出預設的「未完成」清單** ⇒ 整列不在頁上
    //       ⇒ 這一格會紅, 而訊息會把人指向**收款欄**, 真因在**貨品軸的篩選**。
    //       (先跑出貨那支、再跑這一支就會踩到。)
    //    ⚠️ 更糟的是它**綠的時候也不算數**:分不出是「收款欄邏輯對」還是「9001 剛好還沒被標出貨」。
    //       **一個分不出成因的綠, 不是覆蓋。**
    //    ✅ ⇒ 正臂改成**同一張單自己的前後**:這裡「還沒收」/ ③ 收完之後「還差 4,300」。
    //       兩臂同一張單、同一支測試、零外部依賴。
    //    🛑 **不要把 9001 那兩格加回來** —— 它不是漏掉的, 是拿掉的假覆蓋。
    //    ⚪ 真的少掉的那一格 =「已收足在真頁面真庫上長什麼樣」。
    //       vitest 兩層有守(`order-list-view.test.ts:981` 字面 / `orders-table.test.tsx:2188` 渲染),
    //       缺的只有 e2e 這一層。**主視窗 2026-09-19 裁:不為它再種一張專屬單。**
    await page.goto('/orders');
    const main = page.getByRole('main');
    // 🔵 講**觀察**不講結論:這一格紅的成因不只一種(單被篩掉 / 日期窗 / 分頁 / 頁面真的沒渲染),
    //    所以訊息只說「這把尺在這一頁上找不到它」, 不說「這一頁沒渲染」。
    await expect(
      main.getByText(TARGET_ORDER).first(),
      `這一頁上找不到 ${TARGET_ORDER} ⇒ 下面每一格都不算數。成因不只一種:它可能被篩掉(例如刷卡未付款那道預設關著的篩選)、落在別的日期窗或別頁, 也可能這一頁真的沒渲染。`,
    ).toBeVisible();

    // 🔴 那一格**是連結**(= 有收款要做)。`order-list-view.ts` 逐字:
    //    「已收足 / 需確認 / 多收 N」三態不可點;只有「還差 N」與「還沒收」可點。
    await expect(
      rowOf(page, TARGET_ORDER).getByRole('link', { name: '還沒收', exact: true }),
      '這一列上找不到一顆叫「還沒收」的連結(而它沒收過錢, 應該要有)',
    ).toHaveCount(1);
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
    // 🛑 **按名字抓, 不要用 `.last()`**(2026-09-19 R1 C1):那是一道**碰錢的確認閘**,
    //    而用位置抓的話, 哪天彈窗多一顆 checkbox 就會**勾到別的東西而照樣綠**
    //    ⇒ 量到的就不是員工真的走的那一條路了。
    //    ⚠️ 逐字是「我**已**看過…這一筆**不是重複的**」—— 我第一版寫 `/我看過/` 少一個字, 當場 timeout。
    //       這裡釘的是「不是重複的」那半句:它是**這道閘在講的那件事**, 前半句改寫的機會比較大。
    await dialog.getByRole('checkbox', { name: /不是重複的/ }).check();
    await dialog.getByRole('button', { name: '確認', exact: true }).click();

    // 🔴 等到【DB 真的落地】才算數 —— 不看畫面上的提示字。
    await expect
      .poll(() => paidTotalOf(TARGET_ORDER), { timeout: 20_000, message: '按了確認, 而 DB 裡的已收金額沒有變' })
      .toBe(before.paid + PAY_AMOUNT);
    expect(paymentCountOf(TARGET_ORDER), '應該剛好多一筆, 不是兩筆').toBe(before.count + 1);

    // 🔴 訂單的收款狀態要跟著變(沒付清 ⇒ partiallyPaid)。
    expect(paymentStatusOf(TARGET_ORDER), '收了一部分, 狀態該是 partiallyPaid').toBe('partiallyPaid');

    // 🔴 **列表那一欄印的字也要跟著變** —— 派工單三樣要求的第三樣。
    // 🔴🔴 **這兩格同時是 ② 的判別力正臂**:同一張單、同一個 locator,
    //    收款前找得到 1 顆「還沒收」、收款後 0 顆而且變成「還差 N」
    //    ⇒ ② 那個 1 是真的 1, 不是「這把尺對每一列都回 1」。
    await page.goto('/orders');
    const row = rowOf(page, TARGET_ORDER);
    await expect(
      row.getByRole('link', { name: '還沒收', exact: true }),
      '這一列上還找得到「還沒收」(而它剛剛收過錢了)',
    ).toHaveCount(0);
    await expect(
      row.getByText(new RegExp(`還差[^0-9]*${EXPECTED_REMAINDER.toLocaleString('en-US')}`)).first(),
      `收了 ${PAY_AMOUNT} 之後那一欄該印「還差 ${EXPECTED_REMAINDER.toLocaleString('en-US')}」`,
    ).toBeVisible();
  });

  test('④ 部分收款沒有在【同步路徑】上寫 email_outbox', () => {
    expect(paidTotalOf(TARGET_ORDER), '③ 跑完應該已經收到錢了, 而這裡量到的不是那個數').toBe(PAY_AMOUNT);

    // 🛑🛑 **這一格的射程很窄, 先講清楚, 不然它會被讀成「收款不寄信」**(2026-09-19 R1 MF1):
    //    ⚠️ **在這台鑽機上它幾乎是恆真的** —— `scripts/admin-probe/*.sql` **八支種子沒有任何一支
    //       碰 `email_outbox`**(實測 0 命中)⇒ 那張表每一次跑都是空的, **與收款路徑做了什麼無關**。
    //    ⇒ 📌 所以它**不是**「收款不寄信」的證據。它只擋一種很具體的壞法:
    //       **哪天有人在收款的同步路徑上直接塞一列 `email_outbox`**, 這一格會叫。
    //    🔴 而真正會寄給客人的那條路**這一格量不到**:那是 cron 端的 TypeScript 掃描器
    //       (`SupabasePaidOrderScannerAdapter`), 它讀的是 `pcm_order_created_email_pending`,
    //       而那張 view 的述詞含 `payment_status = 'paid'`(**不只這一個條件**, 全部列在檔頭)。
    //       ⇒ 若其餘條件也成立, **收全額就會讓這張單掉進那條路**。
    //    🔬 反證就在同一個庫裡:量這一格的當下 `email_outbox` = 0, 而那張**待寄 view 有 1 列**。
    expect(emailOutboxRows(), '收款的同步路徑上跑出了 email_outbox 列').toBe(0);
  });
});
