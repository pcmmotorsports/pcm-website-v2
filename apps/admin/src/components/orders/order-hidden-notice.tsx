import { isHiddenFromDefaultOrderList } from '@pcm/domain';

import type { PaymentListData } from './payment-list';
import { SHOW_UNPAID_CARD_ON, SHOW_UNPAID_CARD_PARAM } from '../../lib/orders/order-list-view';

/**
 * 🔴 `#841`:**這張單仍然被列表的預設規則藏著 ⇒ 在他剛做完動作的那一秒講出來。**
 *
 * ── 為什麼抽成一支檔(2026-08-23 `#841` 片1)──────────────────────────────────
 * `order-detail.tsx:421-423` 有一條 standing ruling 逐字:
 * 「『下一次動這支檔先抽再改』那條裁定…**對這支檔的【下一次非一行改動】仍然生效**」。
 * 本片是那個「下一次」。而**要抽的那一塊剛好就是本片唯一動到的那一塊** ——
 * 抽出來之後 `order-detail.tsx` 比動工前更短,而這段判斷有了自己的檔與自己的測試。
 *
 * ── 病(甲案 2026-08-22,線 A `-86` 扮員工走一天時撞到)─────────────────────
 * 員工照著那條人工出路走完(客人刷卡失敗 → 改用匯款 → 他登錄收款),
 * 而那張單仍然符合列表的預設隱藏規則 ⇒ **從他眼前消失,而沒有任何字告訴他為什麼。**
 * 真訂單 `2SQH2P` 實測:登錄 1,500 之後,總覽說「今日實收 1,500」、面板說「尾款 0」,
 * 而預設清單 **0 命中**(正對照同頁其他單 6 命中)。
 *
 * 🔴 **說話的時機才是這塊的重點**:他剛做完那個動作、人就在這張卡上。
 *    `fail-closed 不可以是沉默的;而最有效的說話時機,是他剛做完那個動作的那一秒。`
 *
 * ── 🔴🔴 顯示條件 = 「**這張單現在真的還被藏著**」,不是「它有收款列」──────────
 * 治本(`#841`,同片)之後隱藏規則改成問帳本:
 * ```
 * SupabaseOrderAdapter.ts   'payment_channel.neq.tappay,payment_status.neq.unpaid,
 *                            and(paid_total.neq.0,cancelled_at.is.null)'
 * ⇒ 隱藏 ⟺ tappay ∧ unpaid ∧ (帳本淨額 = 0 ∨ 已取消)
 * ```
 * ⚠️ **治本【之前】的條件是「有收款列就講」,而那在治本之後會說謊** ——
 *    淨額 > 0 且未取消的單**現在看得見了**,對它講「預設不會出現在訂單列表」是假的,
 *    還會教員工去勾一個不必勾的勾。
 * 🔴 而 `|| cancelled` 那一半是 code-reviewer(R1 MF3)抓的,**我漏了**:
 *    已取消 + 淨額 > 0 的 tappay/unpaid 單**仍然被藏**,而只看 `netPaid === 0` 會讓它**不再跳提示**
 *    —— 那反而比治本前更糟(治本前它會跳)。
 *
 * ⇒ 判別句寫死在這裡,免得下次又漏一半:
 *   **這個條件必須逐項對得上 adapter 那句述詞的【隱藏面】。改了那句就要回來改這裡。**
 *
 * ── 三個「不講」的理由各自不同 ────────────────────────────────────────────────
 * · 沒有收款紀錄(`rows.length === 0`)⇒ 不講。那種單被藏起來**是 Sean 要的行為**,講出來只是噪音。
 * · `status !== 'ok'` ⇒ 不講。讀不到明細時我們不知道有沒有收過錢,
 *   而「不知道」不可以被畫成「有」。(空白與讀不到不得長得一樣。)
 * · 不符隱藏規則(已付款 / 非 tappay)⇒ 不講。它本來就看得見。
 *
 * ── 🔴 M8:「即使錢已經收到了」那句【已經是假的】,而我原本想用「待定稿」帶過 ──────
 * codex 2026-08-23 逐字:「**不應以『待肉眼定稿』帶過**」。**他是對的** ——
 * 那是給員工看的字,而觸發它的兩種情況都不是「錢在我們手上」:
 * ```
 * 淨額 = 0   ⇒ 收過又沖掉了,錢不在我們手上
 * 已取消     ⇒ 收過,而單子取消了
 * ```
 * ⇒ 改成「**即使帳本上有收款紀錄**」—— 那句話對兩種情況**都為真**,而且不多講一個字。
 * 🔴 用的原則與 `apps/admin/src/app/orders/page.tsx` 那句同一條:
 *    **含糊但為真 > 精確但有一種情況說錯。** 精確版要分兩句寫(沖銷 / 取消),
 *    而這塊提示的任務是**指路到那個勾**,不是解釋規則。
 * ⚠️ **仍待 Sean 肉眼定稿**(結構鎖、字不鎖)—— 但**現在這一版不是假的**,
 *    「待定稿」不再是一句話為假時的擋箭牌。
 */
export function OrderHiddenNotice({
  paymentChannel,
  paymentStatus,
  cancelled,
  payments,
}: {
  paymentChannel: string;
  paymentStatus: string;
  cancelled: boolean;
  payments: PaymentListData;
}) {
  // 🔴 讀不到明細時**不講** —— 「不知道有沒有收過錢」不可以被畫成「有」。
  //    沒有收款列也不講:那種單被藏起來是 Sean 要的行為,講出來只是噪音。
  //    ⚠️ 這兩道是**這塊提示自己的**條件(該不該開口),不是隱藏規則的一部分。
  if (payments.status !== 'ok' || payments.rows.length === 0) return null;

  // 🔴 **加總看正負是對的;分類看正負是錯的** —— 這裡只加總,不拿 `amount < 0` 去認沖銷列
  //    (`apps/admin/src/lib/orders/payment-list-view.ts:28-31` 逐字:判斷沖銷只准看 `isReversal`)。
  const netPaid = payments.rows.reduce((sum, row) => sum + row.amount, 0);

  // 🔴🔴 **隱藏規則【不在這裡】** —— 它與 adapter 下推的那句述詞曾經是兩份互不認識的邏輯
  //    (codex 2026-08-23 M7:「改 adapter 不會讓 UI 測試紅」)。
  //    唯一定義在 `@pcm/domain` 的 `order-hidden-rule.ts` ⇒ **沒有第二份可以不一致。**
  if (!isHiddenFromDefaultOrderList({ paymentChannel, paymentStatus, netPaid, cancelled })) {
    return null;
  }

  return (
    <p
      role='status'
      className='rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-700'
    >
      這張單的刷卡紀錄還是「未付款」,所以它<strong>預設不會出現在訂單列表</strong>——
      即使帳本上有收款紀錄。要再找到它,請在列表勾「顯示刷卡未付款(預設隱藏)」,或{' '}
      <a
        className='underline underline-offset-2'
        href={`/orders?${SHOW_UNPAID_CARD_PARAM}=${SHOW_UNPAID_CARD_ON}`}
      >
        直接開一份含這類訂單的列表
      </a>
      。
    </p>
  );
}
