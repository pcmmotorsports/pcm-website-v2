/**
 * ⟦b4-PAIDTHENOVERPAID⟧ **客人多匯了 —— 在後台那張單上把它說出來。**
 *
 * ── 拍板(逐字,不要改字面)────────────────────────────────────
 * Sean 2026-09-05 拍 `Q-多匯 = 乙`:「客人同一張單匯兩次 ⇒ `payment_status` **不翻**(維持原狀),
 * 只在單上標**「多付, 待人工」**」。
 * 🛑 **「處理」兩個字是我們加的, 不是他的** —— memory `project_0905-overpaid-keeps-status-marks-text`
 * 逐字訂正過一次。⇒ 這裡的字面就是**「多付, 待人工」**, 改它之前先回去看那支 memory。
 * 🔵 而他答的是**一個字「乙」** —— 選項的文字是我們寫的 ⇒ 引用這一板要說「他選了乙」。
 *
 * ── 🔴🔴 金額從哪裡來:**只有一份, 而它不在這支檔裡** ──────────────────
 * `order_balance_base_v.balance_due`(`supabase/migrations/20260906150000_m4b_order_balance_base_v.sql`)。
 * 那支 view 的 COMMENT 逐字:「**要改應付餘額的算法, 改這裡, 不要在別處再寫一份。**」
 * ⇒ 本檔**不做任何算術**, 只把符號翻成人話:
 * ```
 * balanceDue < 0   ⇒ 多付了, 多的金額 = -balanceDue     ⇒ 印
 * balanceDue = 0   ⇒ 剛好付清                            ⇒ 不印
 * balanceDue > 0   ⇒ 他還欠錢(那是尾款, 不是多付)      ⇒ 不印
 * balanceDue null  ⇒ 算不出來                            ⇒ 不印
 * ```
 * 🛑 **`> 0` 那一格要當成【承重的】** —— 把條件寫成 `!== 0` 或把符號弄反, 畫面會對一個
 *    **還欠我們錢**的客人印「多付」。⇒ 測試逐格釘住三個世界(見 `.test.tsx`)。
 *
 * ── 🔴 `null` 有兩個成因, 而對後台是同一件事 ─────────────────────────
 * ① 那張單有 confirmed 退款或未作廢的手動退款 ⇒ view 的 `CASE` **刻意回 NULL**
 *    (理由在該 migration 裡:退了款的單今天算不出「他還要付多少」, 而在
 *     「印一個可能錯的數」與「不印」之間, 對錢永遠選不印)
 * ② 那一發查詢讀不到(view 沒貼 / 權限 / 異常)⇒ adapter 的 try/catch 給 `null`
 * ⇒ 兩者都**不印** —— 📌 **不猜、不補 0。**「補 0」的意思是「剛好付清」, 那是一個具體斷言。
 *
 * ── 🛑 它【不做】什麼 ───────────────────────────────────────
 * · **不翻 `payment_status`**(那正是 Sean 的乙:不翻狀態, 只標字)
 * · **不開待退款列** —— 他沒選的那個甲才是「自動開待退款」⇒ 📌 答案在他沒選的選項裡
 * · **不寄信**(信那一側是 `20260905060000` 的分母, 與本檔無關)
 */
export function OrderOverpaidNotice({ balanceDue }: { balanceDue: number | null }) {
  // 🔴 一個條件、一個方向:**只有嚴格小於 0 才是「多付」**。
  if (balanceDue === null || balanceDue >= 0) {
    return null;
  }
  const overpaid = -balanceDue;
  // 🔴 底色那一組 class **逐字抄**隔壁 `order-hidden-notice.tsx:91`(`rounded-md border`
  //    `border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-700`),**不發明新名字** ——
  //    同族坑逐字:「我發明了一個 class 名字, 而發明一個名字不會讓樣式跟著出現。」
  // ⚠️ **而版面那四個是我加的, 不在抄的範圍裡**(`flex flex-wrap items-center gap-2`)——
  //    本檔要並列兩個元素, 隔壁那支只有一段文字。⇒ 📌 寫「逐字抄」而實際多了四個,
  //    下一個人比對時會以為自己看錯(code-reviewer 2026-09-06 nit)。
  return (
    <div
      className='flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-700'
      data-testid="order-overpaid-notice"
    >
      {/* 🔴 標籤與金額**並列而不合成一句** —— 標籤是 Sean 的字面(不得改),
          金額是我們量到的值(來源在檔頭)。合成一句之後, 改金額格式的人會順手改到他的字。 */}
      <strong data-testid="order-overpaid-label">多付, 待人工</strong>
      <span data-testid="order-overpaid-amount">多匯 NT$ {overpaid.toLocaleString()}</span>
    </div>
  );
}
