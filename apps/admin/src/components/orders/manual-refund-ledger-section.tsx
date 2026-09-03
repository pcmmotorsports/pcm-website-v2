import { formatOrderAmount } from '../../lib/orders/order-list-view';
import { formatOrderDateTime } from '../../lib/orders/order-detail-view';
import type { ManualRefundRow } from '../../lib/payment/manual-refund-read';
import { ManualRefundVoidButton } from './manual-refund-void-button';

// manual-refund-ledger-section.tsx — M-4b E10 D3:非卡退款登記列表(server-render、唯讀)。
//
// 🔴 與 `RefundLedgerSection`(TapPay 帳本)刻意並列、不合併(見主視窗批准的 plan
// W2-012 §1②):`order_manual_refunds` 沒有 status 欄、沒有「異常/滯留」判定 ——
// 這張表記的是一件已經發生的事,不是一個要發起的動作(D1 建表 migration header 段)。
// 硬塞進同一個型別/元件會製造出一堆對這張表永遠是同一個值的欄位。
//
// 🔴 這個區塊存在的理由:員工今天對現金/匯款訂單「按了退款登記」之後,**沒有任何地方能
// 確認他按成功了**(主視窗 2026-08-20 裁示原文)——他會再按一次,冪等閘會擋住,但他不知道
// 被擋了還是成功了。這裡就是那個「看得到」的地方。
//
// 🔴🔴 **D3-c:這裡多了「作廢」** —— 而它是 `#787` 的解除鍵。
//    #787 封印登記入口的理由逐字是「登記錯了改不掉」;這一欄就是「改得掉」的那條路。
//    ⇒ 作廢**不動錢**,它說的是「這筆登記本身記錯了」(D3-b 的 COMMENT 原話)。
//    ⚠️ 已作廢的列**不移除、不隱藏** —— 它是帳本,而帳本記的是發生過的事。
//       整列改成淡出 + 刪除線 + 一行「已作廢」,理由與金額原樣留著給對帳的人看。

/**
 * 🔴🔴 **⟦b4-PCM01RECORD⟧ 那兩條紅【現在會不會出現】—— 單一權威, 三個呼叫端共用。**
 *
 * 🛑 **為什麼抽出來(R3/Fable 2026-09-02 F1, 而它打的是【框架】不是某一行)**:
 *    這條紅住在「金流」分頁的「退款」收合塊**裡面**。而後台開單時走兩道判斷:
 *      ① `resolveOrderDetailTabFlags` 的 `moneyTabMustSee` —— 決定**開哪一頁**
 *      ② 那顆收合塊的 `defaultOpen`                        —— 決定**開了頁之後看不看得到**
 *    ⇒ 🛑 **兩道原本都沒有接這條紅** ⇒ 員工登記完一筆超額退款 → action `redirect` → 頁面重掛
 *      → 落在「商品」分頁、警示圓點不亮 → **那條紅在一個 `hidden` 的分頁裡**
 *      ⇒ ⇒ **剛造成超額的那個人, 看到的是「登記成功」加一片正常的商品頁。**
 *    📌 **⇒ 那正是 `20260902020000` 檔頭怕的世界** —— 只是紅從【不存在】變成
 *       【存在但沒有人會走到】。**而這兩者在 code 上、在 diff 上、在三綠上完全一樣。**
 *    ⚠️ 而 `order-detail-tab-routing.ts` 自己就寫著這句(錨:**只開分頁不夠**):
 *       「截斷紅區住在收合塊【裡面】⇒ 只開分頁不夠, defaultOpen 也要接」
 *       —— **那句話當時完全正確, 而我還是漏了同一格。**
 *    📌 **而我第一版在這裡寫的是行號 `:88`, 而 codex R4 量到它已經是 `:98`** ——
 *       **我在一句警告「行號會漂」的註解旁邊, 寫了一個【在 commit 之前就已經漂掉】的行號。**
 *       ⇒ 改成錨字串。
 *
 * 🔵 **抽成函式而不是各自寫一份**:`order-detail.tsx`(算分頁)、`order-detail-money-tab.tsx`
 *    (算 defaultOpen)、本元件(畫)三處要問同一個問題。寫三份 = 三個漂移點,
 *    而漂移的那一刻**三綠全綠**(同 `order-detail-tab-routing.ts` 那段 SUB2-009 的教訓:
 *    「兩套會各自漂」寫成規範之後, 它警告的事**真的發生了**, 而中間那一刻零訊號)。
 */
export function manualRefundRedState(input: {
  rows: readonly ManualRefundRow[];
  railCap: number | null;
  rowsTruncated?: boolean;
  loadFailed?: boolean;
}): { overCap: boolean; capUnknown: boolean } {
  const { rows, railCap, rowsTruncated = false, loadFailed = false } = input;
  const overCap = railCap !== null && railCap < 0;
  const hasLiveRow = rows.some((r) => r.voidedAt === null);
  const capUnknown = railCap === null && (hasLiveRow || rowsTruncated || loadFailed);
  return { overCap, capUnknown };
}

export function ManualRefundLedgerSection({
  rows,
  orderId,
  displayId,
  railCap,
  returnTo,
  rowsTruncated = false,
  loadFailed = false,
}: {
  rows: readonly ManualRefundRow[];
  /** 只給作廢後重新驗證那張訂單頁用,**不進 RPC**(見 manual-refund-void-actions.ts)。 */
  orderId: string;
  /** 員工看得懂的單號 —— 只用在「請通知系統維護」那句裡,見 `railCap` 的 `null` 段。 */
  displayId: string;
  /**
   * ⟦b4-PCM01RECORD⟧ 這張單在【現金 + 匯款】兩軌上還剩多少可退(`pcm_manual_refund_rail_cap`)。
   *
   * 🔴 **負數 = 已經登記的比收到的多** ⇒ 這一區要標紅。Sean 2026-09-02 拍甲:
   *    上限閘從【擋下來】改成【記得下來, 但標紅】⇒ **那個「標紅」就是下面那一段**,
   *    而它是 `20260902020000` 得以上線的條件(該檔檔頭逐字:不得單獨貼)。
   * 🔴 `null` = **算不出來**(Sean Q4 甲另拍:算不出上限也要記, 標一個【不同的】紅)。
   *
   * 🛑🛑 **一張單一條紅, 不是逐列標紅 —— 這一格有三個獨立來源, 不是挑的**:
   *    ① Sean Q3 甲逐字問的是「現在有幾張【單】是紅的」⇒ 計數單位是單
   *    ② `pcm_manual_refund_red_counts()`(`20260902040000`)數的也是【單】⇒ **單位**相同
   *       🛑🛑 **而「分母也相同」那句話我原本寫了, 它被打掉【兩次】, 兩次都是真的**:
   *          · codex R1③:那支 RPC 只算 `voided_at IS NULL` 的列, 而我原本數的是總列數
   *          · codex R2③:更根本 —— **`pcm_manual_refund_rail_cap` 兩段都 `COALESCE(...,0)`**
   *            (`20260824010000:124-133`, 本窗開檔核過)⇒ **它正常回傳【不可能是 NULL】**
   *            ⇒ 📌 **畫面這一側的 `null` 一格都不是來自 DB 說「算不出來」** ——
   *               它全部來自**傳輸失敗 / 形狀不對 / 超出 JS 安全整數**。
   *       ⇒ ⇒ **所以兩個數字【不保證相等】, 而我不再宣稱它們對齊。**
 *          ⚠️ 措辭是被改過的(codex R4 nit):~~原本寫「本來就不會相等」~~ —— 太絕對。
 *          分母不同只代表**沒有保證**, 兩個數字仍然可能碰巧相同 ——
 *          📌 而【碰巧相同】比【不相等】危險:它會讓下一個人以為對齊成立。
   *          🔵 真正共用的只有【單位是單】與【超額那一側的判準】(cap < 0)。
   *          ⚠️ 引用這兩個數字的人:`cap_unknown` 與畫面上這條紅**不是同一件事的兩個視角**。
   *    ③ cap 是**整張單兩軌的淨額** ⇒ 它在【列】這一層**根本算不出來**
   *    ⇒ ⇒ **逐列標紅會製造一個【算不出來的數字】, 而它會看起來很精確。**
   *    📌 下一個人如果想「順手改成逐列」—— 那一刻你要編出一個每列的 cap, 而它不存在。
   *
   * ⚠️ **必填、沒有預設值**(刻意):給了預設就等於幫每個呼叫端先答了「這張單不紅」,
   *    而漏接的那一頁會**安靜地沒有紅** —— 那正是這一整片要防的東西。
   */
  railCap: number | null;
  returnTo: string;
  rowsTruncated?: boolean;
  loadFailed?: boolean;
}) {
  // ══ 🔴🔴 那條紅要在【每一條 return 路徑】上, 不是只在正常那一條 ═══════════════════
  //
  // 🛑 **codex 2026-09-02 must-fix ②(實證輸入)**:第一版只把紅畫在最後那個正常分支裡
  //    ⇒ `rowsTruncated=true` 或 `loadFailed=true` 時**先 return 掉** ⇒ 超額的紅整個不見。
  //    ⇒ 📌 而那正是**最該紅**的時候:列看不全, 而 cap 說錢多退了。
  //
  // 🛑 **codex must-fix ③**:早退條件原本寫 `rows.length === 0`, 而我在旁邊宣稱
  //    「與 `pcm_manual_refund_red_counts()` 同一個分母」—— **那句話是假的**:
  //    那支 RPC 只算 `voided_at IS NULL` 的列 ⇒ **一張單只剩已作廢的列時, 兩邊會不一致。**
  //
  // 🛑 **codex must-fix ④**:`rows` 與 `railCap` 是**兩支平行查詢、兩個快照**
  //    ⇒ 存在 `rows=[]` 而 `railCap=-500` 的真實時序(另一名員工在兩支查詢之間登記)。
  //
  // ✅ **⇒ 三條的共同解法只有一個:超額那條紅【不看列】, 只看 cap。**
  //    理由講得完:**`railCap < 0` 本身就是證據** —— 它是 DB 端對整張單重算出來的,
  //    不需要列來佐證, 而列反而可能被截斷、被作廢、或比 cap 舊。
  //    ⇒ ⇒ 所以下面 `overCap` 是**無條件**的, 連「這一區塊本來不渲染」都要為它渲染。
  //
  // ✅ **而 must-fix ④ 那個漏紅的時序【已經修掉了】, 修在 route 那一側**:
  //    cap 改成**排在列之後讀** ⇒ cap 的快照永遠不早於列 ⇒ 「新列配舊 cap」不存在了。
  //    ~~原本這裡寫「沒有修掉, 只被縮小, 已記為 ⟦5b-RAILCAPTWICE⟧」~~ **兩句都作廢**:
  //    ① 它修得掉, 而「寫成已知限制」是在替一個該修的東西找藉口(codex R2① 逐字)
  //    ② 那個錨**本來就不是講這件事的**(它講的是兩份公式差一個 GROUP BY)⇒ 引錯了(R2②)
  //    📌 **留著這段訃聞**:一個「已記為某某 backlog」的句子, 讀起來與真的記了一模一樣。
  /**
   * 🔵 「算不出上限」那條紅**有條件** —— 它與超額那條不同, 不能無條件掛:
   *    一張**從來沒有人登記過退款**的單, cap 算不出來對員工**沒有任何下一步**
   *    ⇒ 掛上去 = 全站每一張單都掛一句紅字 ⇒ 而那會讓真的那幾張淹掉。
   * 🔴 而**列看不全時仍要掛**(truncated / loadFailed):那時我們**不知道**有沒有登記,
   *    而「不知道」要往紅的那一側倒。
   *
   * 🛑 **這個判準【不是】為了對齊 `cap_unknown` 的分母**(codex R2④ 更正我原本那句):
   *    `rowsTruncated` / `loadFailed` 這兩格把畫面的分母撐得比 DB 那一側寬, 兩者不相等。
   *    ⇒ 📌 **它的理由是【對員工有沒有下一步】, 就這一條。** 而那條理由自己站得住,
   *       不需要借 DB 那個計數來背書 —— 借了反而多一句會過期的宣稱。
   */
  // 🔴 判準住在 `manualRefundRedState`(本檔上方)—— 這裡**不重算一份**, 理由寫在那支函式上。
  const { overCap, capUnknown } = manualRefundRedState({ rows, railCap, rowsTruncated, loadFailed });

  const RedBanners = (
    <>
      {/* 🔴🔴 ⟦b4-PCM01RECORD⟧ 那條紅。**兩種紅刻意分成兩句, 不合成一句** ——
          Sean Q4 甲逐字要求「標一個【不同的】紅」, 而理由是**下一步不同**:
            超額     ⇒ 去確認金額(數字可能打錯了)
            算不出上限 ⇒ 去找工程(金額可能完全沒問題)
          ⇒ 合成同一句 = 把該找工程的人送去改一個沒問題的金額。
          ⚠️ **JSX 文字節點裡 React 不解析 markdown** ⇒ 要強調用 `<strong>`,不要寫 `**…**`
             (同 `today-summary.tsx` 的 R2 MF-D)。 */}
      {overCap && (
        <p
          role='alert'
          className='border-destructive/40 bg-destructive/10 text-destructive mb-3 rounded-md border px-3 py-2 text-sm'
        >
          ⚠️ 這張單的退款登記
          <strong>超出可退上限 NT$ {formatOrderAmount(-(railCap as number))}</strong>
          ——請確認<strong>兩件事</strong>:①退款金額有沒有打錯 ②這張單的收款有沒有登錄齊全
          (少記一筆收款,上限就會變小)。登記已經記下來了,沒有被擋掉。
          <strong>若這筆退款屬實,請勿用「作廢」來消除這個提示</strong>——作廢是說「這筆登記記錯了」,
          用它消警示會讓帳與事實分家。
        </p>
      )}
      {capUnknown && (
        // 🔴🔴 **這一條刻意與上面那條【長得不一樣】—— Sean 2026-09-02 拍 `Q17 = B`**(逐字「3. B」)。
        //    他看的是三個實體版本(`~/pcm-mailbox/樣張-Q17-兩條紅要換成什麼-20260902.html`):
        //      A 灰(「這不是你做錯了」)· **B 實心紅(「這件更嚴重」)** · C 深色系統訊息
        //    ⇒ 而「不同」那個要求本身是他更早那一板(2026-09-02 01:2x 第二批 `q4: 甲`,
        //      原話「一起改, **標一個不同的紅**」)⇒ 上面 :150-156 那段是它的理由。
        // 🔵 **`text-destructive-foreground` 不是 `text-white`, 而那是承重的**:
        //    `globals.css` 淺色 `--destructive-foreground:#ffffff`、`.dark` 那一組是 `oklch(0 0 0)`(黑)
        //    ⇒ 寫死 `text-white` 在深色模式會變成【亮紅底 + 白字】, 而 token 那一對本來就是為對比設計的。
        //    ⚠️ 而本檔外多數 `bg-destructive` 的用法寫的是 `text-white`(9 處裡 8 處)——
        //       **那是另一片的事, 本片不動它們**;先例在 `cancel-form-body.tsx:95`。
        // 🛑 **而同檔 :188 / :203 那兩個 `text-destructive`(載入失敗 / 列被截斷)不在這一題裡, 沒有動。**
        <p
          role='alert'
          className='border-destructive bg-destructive text-destructive-foreground mb-3 rounded-md border px-3 py-2 text-sm'
        >
          {/* 🔴 單號要在這一句裡 —— 員工看到它會去打電話, 而電話那頭第一句一定是「哪一張」。
              📌 而它與上面那句的差別不只是文案:上面那句員工自己就能處理, 這一句他不能。 */}
          ⚠️ <strong>算不出這張單的可退上限</strong>——請先重新整理一次;若仍然如此,請通知系統維護
          並告知單號 <strong>{displayId}</strong>。在這之前,這一區塊的金額<strong>不代表</strong>
          已經核對過。
        </p>
      )}
    </>
  );

  if (loadFailed) {
    return (
      <section className='border-destructive/30 bg-destructive/5 rounded-lg border p-4 text-sm'>
        <h2 className='text-destructive mb-1 text-sm font-semibold'>非卡退款登記</h2>
        {RedBanners}
        <p className='text-destructive'>
          非卡退款登記載入失敗——這張單可能有看不見的登記紀錄,請重新整理;
          持續失敗請通知系統維護,勿在此期間重複登記。
        </p>
      </section>
    );
  }

  // 同 RefundLedgerSection 的立場(Sean 2026-08-17 Q2=甲):撈不完整時整區明確失敗、
  // 不顯示任何一列,不讓對帳的人照著一份缺漏的清單算。
  if (rowsTruncated) {
    return (
      <section className='border-destructive/30 bg-destructive/5 rounded-lg border p-4 text-sm'>
        <h2 className='text-destructive mb-1 text-sm font-semibold'>非卡退款登記</h2>
        {RedBanners}
        <p className='text-destructive'>
          這張單的非卡退款登記太多,超過本頁一次能列出的上限,這一區塊不顯示任何一列。
          請通知系統維護直接從資料庫調這張單的完整登記紀錄。
        </p>
      </section>
    );
  }

  // 🔴 **早退條件從 `rows.length === 0` 改成「連一條紅都沒有」**(codex must-fix ③/④)。
  //    ~~原本寫「沒有登記過的單 cap 不可能是負的」~~ —— **那句話在單機世界成立, 在並發世界不成立**:
  //    列與 cap 是兩支平行查詢、兩個快照 ⇒ `rows=[]` 而 `railCap=-500` 是真的會發生的組合。
  //    ⇒ 那一刻早退 = **該紅而整個區塊不存在**, 而畫面上不會有任何東西告訴你少了什麼。
  if (rows.length === 0 && !overCap && !capUnknown) return null;

  // 🔵 而**有紅但零列**時仍要渲染 —— 這一段就是那個世界的樣子(只有紅, 沒有表格)。
  if (rows.length === 0) {
    return (
      <section className='bg-card text-card-foreground rounded-lg border p-4'>
        <h2 className='text-muted-foreground mb-3 text-xs font-medium'>非卡退款登記</h2>
        {RedBanners}
      </section>
    );
  }

  const TH = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap';
  const TD = 'px-3 py-2 text-sm align-top';

  return (
    <section className='bg-card text-card-foreground rounded-lg border p-4'>
      <h2 className='text-muted-foreground mb-3 text-xs font-medium'>非卡退款登記</h2>
      {RedBanners}
      <div className='overflow-x-auto'>
        <table className='w-full border-collapse'>
          <thead>
            <tr>
              <th className={TH}>錢交回去的時間</th>
              <th className={TH}>管道</th>
              <th className={`${TH} text-right`}>金額</th>
              <th className={TH}>原因</th>
              <th className={TH}>經手人</th>
              <th className={TH}>登記時間</th>
              <th className={TH}>作廢</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const voided = row.voidedAt !== null;
              return (
                <tr key={row.id} className={`border-t ${voided ? 'text-muted-foreground' : ''}`}>
                  <td className={`${TD} whitespace-nowrap`}>
                    {formatOrderDateTime(row.occurredAt)}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    {row.rail === 'cash' ? '現金' : '匯款'}
                  </td>
                  {/* 🔴 金額打刪除線是**唯一**一眼看得出「這筆不算數了」的地方 ——
                      對帳的人掃的是金額欄,不是最右邊那一欄。 */}
                  <td
                    className={`${TD} text-right tabular-nums whitespace-nowrap ${voided ? 'line-through' : ''}`}
                  >
                    NT$ {formatOrderAmount(row.refundAmount)}
                  </td>
                  <td className={TD}>{row.reason}</td>
                  <td className={`${TD} whitespace-nowrap text-xs`}>{row.actor}</td>
                  <td className={`${TD} whitespace-nowrap text-xs`}>
                    {formatOrderDateTime(row.createdAt)}
                  </td>
                  <td className={TD}>
                    {voided ? (
                      <div className='text-xs'>
                        <p className='font-medium'>已作廢</p>
                        <p>{formatOrderDateTime(row.voidedAt as string)}</p>
                        <p>由 {row.voidedBy ?? '(未記錄)'}</p>
                        <p className='max-w-[16rem]'>理由:{row.voidReason ?? '(未記錄)'}</p>
                      </div>
                    ) : (
                      <>
                        {/* 🔴🔴 **超額那個狀態下, 把那句提醒放在【按鈕旁邊】。**
                         * ⇒ 區塊頂端**已經有**一段寫得很好的警告(`:161-168`), 而它在**畫面上方** ——
                         *   員工捲到這一列要按的時候, 那段話已經不在視線裡。
                         * ⇒ 📌 **警告要在動作旁邊, 不是在頁面頂端** —— 一段沒有被讀到的正確警告,
                         *   與沒有那段話, 在行為上是同一件事。
                         * 🛑 **而按鈕【沒有】被拿掉, 那是刻意的**:
                         *   `manual-refund-void-button.tsx` 自己的 docstring 逐字寫「作廢不動錢,
                         *   它說的是**這筆登記本身記錯了**」⇒ 而**超額正是登記記錯最可能發生的時候**
                         *   (例如同一筆退款被登記兩次)⇒ 在這個狀態拿掉它, 會讓一個
                         *   **真的記錯的登記變成改不掉**。
                         * ⇒ 🔵 所以做的是「換成說明」那一半, 不是「拿掉」那一半。
                         *   **而要不要真的拿掉是 Sean 的板** —— 已回報主視窗。 */}
                        {overCap && (
                          <p className='text-destructive mb-1 max-w-[16rem] text-xs'>
                            這張單的退款登記超出可退上限。
                            <strong>若這筆退款屬實,不要用作廢消除提示</strong>
                            ——先確認收款有沒有登錄齊全。
                          </p>
                        )}
                        <ManualRefundVoidButton
                          refundId={row.id}
                          orderId={orderId}
                          returnTo={returnTo}
                        />
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
