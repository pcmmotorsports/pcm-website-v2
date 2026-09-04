/**
 * @module @pcm/adapters/email/SupabasePaidEmailContextAdapter — 付款成功通知信的**寄送時讀取**(M-4b)
 *
 * 實作 `IPaidEmailContext`。形狀刻意鏡像 `SupabaseShippedEmailContextAdapter`
 * (同一個問題的同一個解),差異只在:**這裡讀的是金額,而金額有兩條它獨有的紅線。**
 *
 * 🔴 **紅線一:經銷價零滲入(CLAUDE.md Server 端鐵則)。**
 * 這封信寄給一般客人,而 `price_store` / `price_by_tier` / `cost` / `price_general`
 * 是**經銷價**。⇒ 本檔的 `select` 是**正面白名單**,不是「撈回來再挑」。
 * ⚠️ 差別是承重的:`select('*')` 之後在 TS 挑欄位,**經銷價已經到過這個 process**,
 *    而任何一次 `...row` 展開就把它送進信裡。⇒ **不要撈回來。**
 * 📎 同一句話 `order/types.ts:797` 對明細側講過(逐字「**非**經銷價表…零滲入」)。
 *
 * 🔴 **紅線二:金額是整數元,浮點禁入。**
 * 四個總額與每列小計都過 `toMoneyAmount()`,它對非整數/負數**直接 throw**
 * (`domain/src/shared/types.ts:44-51`)。**刻意不接住** ——
 * 讓它炸掉 ⇒ `sweepEmailOutbox` 計 error、不寄;接住它 ⇒ 寄出一封金額是 `NaN` 或被無聲取整的信。
 * ⚠️ 而**那種信客人看不出是系統壞了還是他被多收了**,這正是不可回收的那一類(鐵則 12⑤)。
 *
 * 🔴 **不重算 `total`。** 一致性由 DB 保證:`20260604120000:112`
 * `orders_total_balances CHECK (total = subtotal + shipping_fee - discount_total)`。
 * 在這裡自己加一次 = 在信件層複製一份會漂的算式,而漂了之後**兩邊都說自己是對的**。
 *
 * ── 現況(三層分開講;合成一句就會有一句不成立)──────────────────────────
 * ```
 * ① 有實作嗎？   ✅ 本檔
 * ② 被建構了嗎？ 🔴 **沒有** —— `composition.ts` 未注入
 * ③ 被呼叫了嗎？ 🔴 **沒有** —— `sweepEmailOutbox` 仍只解構 `{ outbox, sender }`
 * ```
 * ⇒ **客人收到的信一個字都沒變。** 接上它的是模板那一片(合併 plan 的 S4)。
 */
import { toMoneyAmount } from '@pcm/domain';
import type { IPaidEmailContext, LoadPaidContextResult, PaidEmailLine } from '@pcm/ports';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../supabase/database.types';
// 🔴 **共用同一個假設值,不另抄一份**:兩份數字會各自漂,而漂了之後
//    「截斷偵測還有沒有餘裕」在兩支檔會給出不同答案。
import { ASSUMED_DB_MAX_ROWS } from './SupabaseShippedEmailContextAdapter';

/** 生成型別把關表名/欄名/回傳形狀(鏡像 `ShippedEmailContextClient`)。 */
export type PaidEmailContextClient = SupabaseClient<Database>;

/**
 * 一封付款信最多印幾項。
 * 🔴 這不是「夠用就好」,是 fail-closed 的門檻:超過 ⇒ `linesTruncated=true` ⇒ 呼叫端**不寄**。
 * ⚠️ 少列幾項的付款確認信與正常的長得一模一樣,而客人照著清單對帳 ——
 *    少的那一項他不會知道要問。
 */
export const PAID_EMAIL_MAX_LINES = 50;

/**
 * 探針餘裕:`MAX + 1` 必須**嚴格小於**假設的 `db-max-rows`,否則伺服器會**先**截斷,
 * 我們看到的是「剛好沒有第 51 列」⇒ `linesTruncated` 算成 `false` 而信真的少列了。
 * 🔴 module 載入時就跑 —— 調壞常數的人 `import` 這支檔當場炸,不必等某一封信少列了才發現。
 * ⚠️ 而 `ASSUMED_DB_MAX_ROWS` 仍是**申告不是量到的**(程式問不到伺服器設定)——
 *    有人把它調到 51 以下時**這裡不會紅**,那一格沒有量具,照實寫。
 */
function assertProbeHeadroom(): void {
  if (PAID_EMAIL_MAX_LINES + 1 >= ASSUMED_DB_MAX_ROWS) {
    throw new Error(
      `付款信品項上限(${PAID_EMAIL_MAX_LINES})+1 必須嚴格小於假設的 db-max-rows(${ASSUMED_DB_MAX_ROWS})` +
        ' —— 否則截斷偵測會靜默失效(信少列了品項,而 linesTruncated 是 false)',
    );
  }
}
assertProbeHeadroom();

/** 只帶固定 code、不帶任何 DB 訊息(DB 錯誤訊息裡可能裝著出事那一行的內容)。 */
export class PaidContextQueryError extends Error {
  constructor(readonly code: string) {
    super(`付款脈絡讀取失敗(code=${code})`);
    this.name = 'PaidContextQueryError';
  }
}

/** `order_items.product_snapshot` 的 title(白名單三欄之一;缺 → null,與 `AdminOrderDetailItem` 同慣例)。 */
function snapshotTitle(raw: unknown): string | null {
  if (raw === null || typeof raw !== 'object') return null;
  const t = (raw as Record<string, unknown>).title;
  return typeof t === 'string' && t.trim() !== '' ? t : null;
}

function emptyToNull(v: string | null): string | null {
  return v === null || v.trim() === '' ? null : v;
}

export class SupabasePaidEmailContextAdapter implements IPaidEmailContext {
  constructor(private readonly client: PaidEmailContextClient) {}

  async loadPaidContext(input: { orderId: string }): Promise<LoadPaidContextResult> {
    // ── ① 這張單的表頭與四個金額 ─────────────────────────────────────────────
    // 🔴 **正面白名單**:這五欄是稿上要印的全部(`email-order-paid-A.html`
    //    小計 / 運費 / 折扣 / 訂單金額 + 編號)。多撈一欄 = 多一個外洩面。
    const orders = await this.query('order', () =>
      this.client
        .from('orders')
        // 🔴 `cancelled_at` 是 2026-08-24 加的**第六欄**,而它**不進信裡** ——
        //    它只用來判「這封信還該不該寄」(見下方 `cancelled` 那一段)。
        //    ⇒ 白名單的原則沒有鬆動:**多撈的這一欄不會被印出去**。
        .select('display_id, subtotal, shipping_fee, discount_total, total, tax_total, cancelled_at')
        .eq('id', input.orderId)
        .limit(1),
    );
    const order = orders?.[0];
    // 撈不到 ⇒ 我們對「這封信該寄」的判斷與資料對不上 ⇒ 這一態**應該**吵。
    if (order === undefined) return { kind: 'unavailable' };

    // ── 🔴 已取消的單:不寄,而**這一態不是錯誤**(Sean 2026-08-24 拍【甲】)──────────
    //    A8a3(`20260820030000`)之後,「現金/匯款已付款的單被取消」是**正常業務動作**,
    //    而**取消不改 `payment_status`** ⇒ 這張單仍是 `paid` ⇒ 付款信仍在佇列裡。
    // 🔴 **這一格擺在 `display_id` 檢查【之前】,是刻意的**:
    //    一張已取消的單就算 `display_id` 是空的,答案也還是「不寄」——
    //    先判它,才不會把一個**正常業務狀態**回報成 `unavailable`(那一態的合約是「應該吵」)。
    // ⚠️ 這裡**只判非空**,不判取消原因、不判時間先後 —— 那些是業務語意,不是這根管子的事。
    // 🔴 **三分,不是二分**(2026-08-24 codex R2 M3 —— 第一版在同一個 `if` 裡有兩種極性):
    //    `null`        ⇒ 沒取消,往下走
    //    非空字串      ⇒ 已取消 ⇒ `cancelled`(正常業務動作,不吵)
    //    其餘(`undefined` 欄位沒回來 / `''` 壞值)
    //                  ⇒ 🔴 我們**不知道**它取消了沒有 ⇒ `unavailable`(**應該吵**)
    // ⚠️ 第一版把 `''` 當成已取消、把 `undefined` 當成未取消 —— **兩種極性**,
    //    而缺欄時(回應漂移 / fixture 漂移)取消判斷會**靜默失效**。
    // 📌 收斂的判準不是「哪個值比較像取消」,是:**這個值讓我知道答案了嗎?**
    //    知道 ⇒ 照答案走;不知道 ⇒ 交給那個合約寫著「應該吵」的態。
    // ⚠️⚠️ **【未量】`cancelled_at` 在真實 PostgREST 回應裡到底長什麼樣,本窗沒有打過一發。**
    //    下面三分的【方向】是推理出來的(fail-closed 那一邊錯得比較輕),
    //    而**觸發條件是猜的** —— 我不知道缺欄時它回 `undefined` 還是根本不會缺。
    //    🔴 **本檔全部測試都是 mock**(檔頭 :58-60 自己寫著「抓不到 PostgREST 的真實語意」)
    //    ⇒ 下次有真實鑽機起來時**順手打一發**確認,不必為它專門起環境。
    //    ⇒ **在那之前這一段標【未量】,不要引用成「已驗證」。**
    const cancelledAt = order.cancelled_at;
    if (typeof cancelledAt === 'string' && cancelledAt !== '') {
      return { kind: 'cancelled' };
    }
    if (cancelledAt !== null) {
      return { kind: 'unavailable' };
    }

    // 🔴 `display_id` 是必填,而**回一個空字串等於寫一封「訂單 」開頭的信** ——
    //    那個值看起來合法、長度也對,是本 repo 反覆記載的「接通了而送空值」的形狀。
    const displayId = emptyToNull(order.display_id);
    if (displayId === null) return { kind: 'unavailable' };

    // ── ② 品項 ─────────────────────────────────────────────────────────────
    // 多要一列當探針:拿到 MAX+1 就代表沒載完。
    const items = await this.query('items', () =>
      this.client
        .from('order_items')
        // 🔴 這四欄是稿上品項表要的全部。**`unit_price` 也不撈** ——
        //    稿上印的是「小計」,而多撈一個單價只是多一個能被誤印進信裡的價格欄。
        .select('variant_sku, quantity, line_total, product_snapshot')
        .eq('order_id', input.orderId)
        // 🔴 排序帶唯一鍵:少了它,兩封重送的信品項順序可能不同 ⇒ 客人對不起來。
        .order('id', { ascending: true })
        .limit(PAID_EMAIL_MAX_LINES + 1),
    );
    if (items === null) return { kind: 'unavailable' };

    // 🔴 **0 項也回 unavailable**,不寄一封空清單的付款確認信:
    //    一封「已收到您的款項,品項:(空白)」比不寄更糟 —— 客人無法分辨是壞了還是被多收了。
    if (items.length === 0) return { kind: 'unavailable' };

    const linesTruncated = items.length > PAID_EMAIL_MAX_LINES;
    // 🔴 **逐欄具名建構,不用 `...row` 展開** —— 展開會把未來新增的欄(含經銷價)自動帶進信裡,
    //    而那種洩漏在 typecheck 與三綠都不會紅。
    const lines: PaidEmailLine[] = items.slice(0, PAID_EMAIL_MAX_LINES).map((row) => ({
      title: snapshotTitle(row.product_snapshot),
      variantSku: emptyToNull(row.variant_sku),
      quantity: row.quantity,
      lineTotal: toMoneyAmount(row.line_total),
    }));

    return {
      kind: 'ok',
      context: {
        orderDisplayId: displayId,
        lines,
        linesTruncated,
        subtotal: toMoneyAmount(order.subtotal),
        shippingFee: toMoneyAmount(order.shipping_fee),
        // 🔴 **正值**:DB `CHECK (discount_total >= 0)`(`20260604120000:103`)。
        //    稿上那個 `−790` 是排版,負號由模板加 —— 帶號進來的話,
        //    「沒有折扣」「折扣 0」「負折扣」會在模板層合成同一個分支。
        discountTotal: toMoneyAmount(order.discount_total),
        // 🔴 直接用 DB 的 `total`,**不重算**(理由見檔頭)。
        total: toMoneyAmount(order.total),
        // 🔴🔴 `tax_total`(`⟦b4-INVOICE5PCT⟧` 第 6 步, 2026-09-04)——
        //   **今天恆為 0**, 而它在這裡是為了讓三份明細印得出稅那一行。
        //   🛑 **白名單只加了這一欄, 沒有改成 `*`** —— 該檔 `:9-10` 逐字:
        //      `select('*')` 之後在 TS 挑欄位, **經銷價已經到過這個 process**。
        //      ⇒ 而那道防線由 `SupabasePaidEmailContextAdapter.test.ts:126`(逐字釘整串)
        //        與 `:130`(禁 `price_store` / `price_by_tier` / `cost` / `price_general` / `*`)守著
        //        ⇒ **加這一欄會讓 `:126` 那格紅, 而那正是它該做的事** —— 我改了期望字串, 沒有把它放寬。
        taxTotal: toMoneyAmount(order.tax_total),
      },
    };
  }

  /** 兩條失敗路徑(error 欄 / 直接 reject)收成一條,且**不接住原始錯誤物件**。 */
  private async query<T>(
    stage: string,
    run: () => PromiseLike<{
      data: T[] | null;
      error: { code?: string } | null;
    }>,
  ): Promise<T[] | null> {
    let outcome: { data: T[] | null; error: { code?: string } | null };
    try {
      outcome = await run();
    } catch {
      throw new PaidContextQueryError(`${stage}:rejected`);
    }
    if (outcome.error) {
      throw new PaidContextQueryError(`${stage}:${outcome.error.code || 'unknown'}`);
    }
    return outcome.data;
  }
}
