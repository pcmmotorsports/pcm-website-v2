import Link from 'next/link';
import { formatOrderAmount } from '../../lib/orders/order-list-view';
import { formatOrderDateTime } from '../../lib/orders/order-detail-view';
import type { OrderRefundRow } from '../../lib/payment/refund-read';
import {
  isRefundException,
  isStuckManualVerdict,
  refundFailedReasonLabel,
  refundStatusLabel,
} from '../../lib/payment/refund-ledger-view';

// refund-ledger-section.tsx — M-3 A7c RW3:訂單頁退款帳本呈現(server-render、唯讀)。
// 🔴 中文字面全部暫定、待 Sean 肉眼定稿(結構鎖、字不鎖)。
//
// 存在理由:deferred/rejected 的結果原本只活在送出當下的 action state(重新整理就沒了),
// 值班要能事後看到「這單退過什麼、卡在哪」。plan §1 RW3 列 + §3 表 UI 欄。
//
// 🔴 顯示不吃退款入口旗標(refund-ui-flag.ts;字面刻意不寫 —— wiring oracle 只准兩檔命中):
//    旗標控制的是「發起入口」;帳本列是既成事實,有列就得讓人看見
//    (尤其 processing 滯留列 —— 藏起來 = 值班不知道有錢卡在路上)。
//
// 🔴🔴 措辭鐵律(refund-ledger-view.ts 檔頭;測試掛負向格):「帳本未登記額」
//    不得寫成「還能退」「剩餘可退」—— Portal 場外退款不在帳本,真實剩餘 ≤ 此值。

export function RefundLedgerSection({
  rows,
  unregisteredAmount,
  unregisteredFailed = false,
  rowsTruncated = false,
  loadFailed = false,
  nowMs,
  cardPayment,
}: {
  rows: readonly OrderRefundRow[];
  /** `pcm_order_refundable_remaining`;查無訂單 → null(顯示「查無」而非 0)。 */
  unregisteredAmount: number | null;
  /** RPC 讀取失敗(codex MF2:不得壓成 null 假裝查無 —— 那是會被照著操作的狀態)。 */
  unregisteredFailed?: boolean;
  /** 帳本列被上限截斷(codex MF1:平台 max-rows 會靜默截,顯式旗標=截斷可見)。 */
  rowsTruncated?: boolean;
  /** 帳本讀取失敗(不靜默:processing 滯留列被藏起來比沒有這區塊更糟)。 */
  loadFailed?: boolean;
  /** 列級異常判定的「現在」;由呼叫端(server component render 期)供給,可測。 */
  nowMs: number;
  /**
   * 這張單**有沒有一筆刷卡(`rail === 'card'`)收款列** —— 三態, 不是布林。
   *
   * 🔴🔴 **為什麼是「有沒有刷卡列」而不是「有沒有收款列」**(codex must-fix, 而它也是規格原話):
   *    「請以 TapPay Record 對帳」這句話**只在有刷卡收款時才對得出來**。
   *    ⛔ ~~我第一版用「零筆收款紀錄」~~ ⇒ **漏掉第三個世界**:
   *       一張**只有現金/匯款收款列**的單, `rows.length > 0` ⇒ 被我判成「有收款」
   *       ⇒ 照樣印「請以 TapPay Record 對帳」⇒ **一樣把員工指去查不存在的紀錄。**
   *
   * 🔴 **而它必須是三態, 不是布林**(codex must-fix):
   *    `PaymentListData` 刻意分 `ok` / `order_not_found` / `unreadable`,
   *    而後兩者逐字是**「不知道有沒有」不是「沒有」**。
   *    ⇒ 🛑 把它們壓成 `false`(= 當成有刷卡)⇒ 讀不到時我們仍然宣稱有 TapPay 紀錄可對
   *       ⇒ **那是一句我們證不到的話。**
   *
   * ⇒ `'card'` = 有刷卡列 · `'none'` = 讀得到而沒有刷卡列 · `'unknown'` = 讀不到 / 查無此單
   *
   * 🛑 **必填無預設**:給預設值等於「忘了接就把那句錯話留著」。
   */
  cardPayment: 'card' | 'none' | 'unknown';
}) {
  if (loadFailed) {
    return (
      <section className='border-destructive/30 bg-destructive/5 rounded-lg border p-4 text-sm'>
        <h2 className='text-destructive mb-1 text-sm font-semibold'>退款紀錄</h2>
        <p className='text-destructive'>
          退款帳本載入失敗 —— 這張單可能有看不見的退款紀錄(含處理中的),
          請重新整理;持續失敗請通知系統維護,勿在此期間發起退款。
        </p>
      </section>
    );
  }
  // 🏁 #445a-3 兌現了這個檔自己寫的交辦。原文(保留備查):
  //    「零列時本區回 null ⇒『零列 && unregisteredFailed』若可達,值班會看到
  //     『按鈕不見了、又沒有任何說明』。目前不可達的保證住在呼叫端(僅 rows.length>0
  //     才打 RPC)—— 若日後改成無條件打 RPC,這裡要先於零列早退補一個失敗顯示分支。」
  // ⚠️ 原註解把呼叫端寫成 `[id]/page.tsx`,**那是過期字面** —— 實際在
  //    `order-detail-route.tsx`(該檔自己就是被改的那一支)。引用前一律用字面 anchor。
  // 🔴 445a-3 做的正是它說的「改成無條件打 RPC」⇒ 「零列 && 讀取失敗」**現在可達了**,
  //    所以這個分支必須**排在零列早退之前**。順序反了 = 症狀原樣復活,而且測試若只造
  //    「有列 + 失敗」是驗不到的(那條路徑本來就會渲染)。
  if (unregisteredFailed && rows.length === 0) {
    return (
      <section className='border-destructive/30 bg-destructive/5 rounded-lg border p-4 text-sm'>
        <h2 className='text-destructive mb-1 text-sm font-semibold'>退款紀錄</h2>
        {/* 🔴 Sean 08-13 定調「使用上直覺、好用即可」⇒ 要回答:發生什麼 / 錢有沒有動 / 他該做什麼。
            ⚠️ **不得宣稱「退款按鈕被關掉了」** —— 本區塊刻意不吃退款入口旗標(見檔頭 :17-19),
            也看不到 channel 與 payment status ⇒ 轉帳/現金單、未付款單、或旗標關著時,
            入口**本來就不存在**,不是被這個錯誤關掉的。講了就是對值班說一句假話。
            (code-reviewer 抓到;我第一版真的寫了「退款按鈕暫時收起來了」。)
            ⚠️ **不得混 Markdown 星號** —— 這是 `<p>` 純文字輸出,`**` 會原樣顯示。
            我在同一天的 `refund-action-state.ts` 才被 codex 抓過一次,一小時後又犯。 */}
        <p className='text-destructive'>
          查不到這張單的退款金額參考(系統讀取失敗,不是這張單不能退)。
          這張單目前沒有任何退款紀錄,也沒有任何退款被發起、錢沒有動。
          請先重新整理頁面;如果重新整理幾次都一樣,請通知系統維護。
        </p>
      </section>
    );
  }
  // 🔴🔴 **Sean 2026-08-17 Q2 ＝ 甲:撈不完整時,那一區塊【明確失敗、不顯示任何一列】。**
  //   他否決的乙案正是本區塊 0a3e2a44(2026-08-04)的原設計:「顯示已取得的 + 標可能不完整」。
  //   🔴 理由逐字:**「標了警告的清單,對帳的人還是會照著算。」**
  //      —— 而這一區塊就是【退款帳本】= 對帳本身,他講的就是這個畫面。
  //   ⚠️ 原本的處置留痕(不要默默當它沒存在過):`rowsTruncated` 曾經只印一行紅字
  //      「⚠ 帳本列超過顯示上限,更舊的紀錄未列出 —— 完整清單請以資料庫對帳為準。」
  //      然後【列照印】。那行字沒有錯,錯的是它下面還有一張可以照著算的表。
  //   📌 這格比拍板早 13 天 ⇒ 不是明知故犯,是拍板之後沒有人回頭掃它推翻掉的既有實作。
  //   🔴 順序:排在零列早退【之前】—— 截斷時 rows.length 必 > 0,但別讓下一個人改動零列
  //      分支時把這條擠到後面去(同 :62-64 那個順序坑,本檔已經踩過一次)。
  if (rowsTruncated) {
    return (
      <section className='border-destructive/30 bg-destructive/5 rounded-lg border p-4 text-sm'>
        <h2 className='text-destructive mb-1 text-sm font-semibold'>退款紀錄</h2>
        {/* 文案要回答三件(Sean 08-11「操作直覺化」):發生什麼 / 現在能不能信這一頁 / 他該做什麼。
            🔴🔴 **不得宣稱「錢沒有變動」或「沒有退款被取消」** —— codex 2026-08-18 關卡2 抓到:
               本元件只知道「列被截斷」,它【看不到被藏起來的那些列】⇒ 那兩句它證明不了,
               而值班會把它讀成「退款還沒發生」,然後【重複發起退款】。
               ⚠️ 這與 :69-75 那條是同一個病(當時是誤稱「退款按鈕被關掉了」)——
                  本檔第二次在同一個地方犯:**對值班說一句自己證明不了的話。**
            ⚠️ 不混 Markdown 星號 —— 這是 `<p>` 純文字,`**` 會原樣顯示。

            ── 🔴 2026-08-24 SUB2-009 補的兩句,而它們的形狀是承重的 ──────────────
            **TODO(L2,`#889`):字是暫用的,Sean 可改。** 鐵則 9 L2 = hardcode + TODO + backlog。
            ① 「不要改用 TapPay 後台直接退」**是這一整段唯一在攔一個【動作】的句子**,
               其餘都是說明。codex 2026-08-24 的 finding:入口被藏起來之後,值班的出路就是
               繞去 Portal,而**那筆退款不會進帳本**(檔頭 :4-8 那條措辭鐵律的同一件事)。
               ⇒ **潤稿可以改字,不可以把這句磨掉。**
            ② 「這張單**若原本有**『線上退款』入口」——**那個「若」是承重的,不是語氣。**
               上面 :70 已經明文禁止宣稱「退款按鈕被關掉了」:本區塊看不到 channel /
               payment status / 旗標 ⇒ 轉帳、現金、未付款、旗標關著的單,入口**本來就不存在**。
               🔴 我第一版草稿寫的正是那句被禁止的話 —— **而這支檔【已經被 code-reviewer 抓過同一句】**
               (:70-73 那段自陳;⚠️ 那段沒寫日期,我也不補一個我沒查過的日期)。
               ⇒ 想把它改成肯定句之前,先回答:**這一格怎麼知道那張單有入口?**(它不知道。) */}
        <p className='text-destructive'>
          這張單的退款紀錄太多,超過本頁一次能列出的上限。
          為了不讓任何人照著一份缺漏的清單對帳,這一區塊不顯示任何一列。
          也就是說,這一頁現在看不出這張單有沒有退款、退了多少 —— 請不要用這一頁判斷,
          也不要在這個狀態下發起退款。
          也不要改用 TapPay 後台直接退 —— 那一筆不會進本系統帳本,這張單之後就對不起來了。
          (這張單若原本有「線上退款」入口,在這個狀態下它不會出現。)
          請通知系統維護直接從資料庫調這張單的完整退款帳本。
        </p>
      </section>
    );
  }
  if (rows.length === 0) return null;

  const TH = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap';
  const TD = 'px-3 py-2 text-sm align-top';

  return (
    <section className='bg-card text-card-foreground rounded-lg border p-4'>
      <div className='mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1'>
        <h2 className='text-muted-foreground text-xs font-medium'>退款紀錄</h2>
        <span className='text-sm'>
          帳本未登記額:
          {/* 四態(codex MF2/MF3):讀失敗≠查無(前者=系統問題勿操作、後者=資料不在);
              負值=帳本登記已超過訂單總額 —— 「真實可退 ≤ 此數」的宣稱對負值不成立,
              當普通金額顯示會被照著操作,一律標對帳異常。 */}
          {unregisteredFailed ? (
            <span className='text-destructive font-medium'>
              讀取失敗(勿依本頁發起退款,請通知系統維護)
            </span>
          ) : unregisteredAmount === null ? (
            <span className='font-medium tabular-nums'>查無</span>
          ) : unregisteredAmount < 0 ? (
            /* 🔴🔴 **異常態的三個世界 —— 它們要說三句不同的話。**
             * ⇒ 病灶不是「紅字該不該消」(帳本真的超額了), 是**它指員工去查什麼**。
             * 🛑 原本無條件寫「請以 TapPay Record 對帳」⇒ 現金/匯款單那個世界根本沒有那筆紀錄
             *    ⇒ 對不出來 ⇒ 回到畫面上唯一按得動的「作廢」⇒ **作廢一筆真實發生過的退款。**
             * 🔴 **字面是暫用的, 等 Sean 定稿** —— 文案是他的板, 已進待定稿清單。 */
            <span className='text-destructive font-medium tabular-nums'>
              對帳異常(帳本登記已超過訂單總額 NT$ {formatOrderAmount(-unregisteredAmount)};
              {cardPayment === 'card'
                ? '請以 TapPay Record 對帳,勿再發起退款)'
                : cardPayment === 'none'
                  ? /* 🔵 讀得到收款而沒有刷卡列 ⇒ 這筆錢不是刷卡收的 ⇒ 指向上方那張登錄表單。
                     * 📌 **不宣稱它是現金單**(我們只知道「沒有刷卡列」), 而**位置寫「上方」** ——
                     *    `order-detail-money-tab.tsx:134` 的 `PaymentSection` 在退款區(`:263`)**之前**。
                     *    (我第一版寫「下方」, codex 抓到 —— 把人指錯方向與不指路一樣沒用。) */
                    '這張單沒有刷卡收款紀錄 —— 若這筆錢是現金/匯款收的,請在上方「收款」區登錄那筆收款,勿再發起退款)'
                  : /* 🛑 讀不到 ⇒ **兩句都不能說** —— 我們不知道有沒有刷卡紀錄。 */
                    '目前讀不到這張單的收款紀錄,無法判斷要對哪一份;請先重新整理,勿再發起退款)'}
            </span>
          ) : (
            <span className='font-medium tabular-nums'>
              NT$ {formatOrderAmount(unregisteredAmount)}
            </span>
          )}
        </span>
        {/* 🔴🔴 **這句附註也提 TapPay Record, 而它原本是【無條件】印的。**
         * ⇒ 而它與上面那句犯的是**同一個錯**:現金/匯款單根本沒有 TapPay 紀錄可對。
         * 🎯 **抓到它的不是規格, 是我為上面那句寫的測試** —— 規格只點名了紅字那一句,
         *    而 `not.toContain('TapPay Record')` 掃的是整塊, 於是這句自己跳出來。
         *    ⇒ 📌 **一個「這個詞不得出現」的斷言, 比「那一句要改成 X」多抓到一處。**
         * 🔵 兩個世界各說各的:有收款列才提對帳來源;零收款時只說本系統帳本的範圍。 */}
        <span className='text-muted-foreground text-xs'>
          {/* 🔴 這句附註原本也**無條件**寫「真實可退額以 TapPay Record 對帳為準、只會 ≤ 此數」——
            * 兩個錯:①沒有刷卡列時那份紀錄不存在 ②**未登記額為負時「只會 ≤ 此數」不成立**
            *   (此數是負的, 而「可退額 ≤ 負數」是一句沒有意義的話)。兩格都是 codex 抓的。 */}
          {cardPayment === 'card' && (unregisteredAmount ?? 0) >= 0
            ? '僅計本系統帳本(處理中+已受理佔額);Portal 場外退款不在其中,真實可退額以 TapPay Record 對帳為準、只會 ≤ 此數。'
            : cardPayment === 'card'
              ? '僅計本系統帳本(處理中+已受理佔額);Portal 場外退款不在其中,真實可退額以 TapPay Record 對帳為準。'
              : cardPayment === 'none'
                ? '僅計本系統帳本(處理中+已受理佔額);這張單沒有刷卡收款紀錄。'
                : '僅計本系統帳本(處理中+已受理佔額);目前讀不到這張單的收款紀錄。'}
        </span>
      </div>

      {/* 🔴 這裡曾經有一段 `rowsTruncated && <p>⚠ …更舊的紀錄未列出…</p>`,而下面的表照印。
          Sean 2026-08-17 Q2＝甲推翻了那個設計 ⇒ 已改成上面的 early-return(見 :84 起)。
          留這行註解是為了讓「這裡為什麼沒有截斷提示」有答案 —— 否則下一個人會以為漏了。 */}
      <div className='overflow-x-auto'>
        <table className='w-full border-collapse'>
          <thead>
            <tr>
              <th className={TH}>發起時間</th>
              <th className={TH}>種類</th>
              <th className={`${TH} text-right`}>金額</th>
              <th className={TH}>狀態</th>
              <th className={TH}>原因/說明</th>
              <th className={TH}>發起人</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const exception = isRefundException(
                {
                  status: row.status,
                  createdAt: row.createdAt,
                  providerEvidence: row.providerEvidence,
                },
                nowMs,
              );
              // 🔴 `#483`(`#473b-2` 沒收完的尾):清單那邊已經看得見卡住的列了,
              //    訂單頁卻還是不說 —— 而**訂單頁才是員工每天在看的那頁**,
              //    異常清單是值班才開的 ⇒ 兩邊說法不一致時他會相信訂單頁。
              //    ⚠️ 與 `exception` **刻意分成兩個 boolean**:那個代表「這列可以按對帳判定」,
              //       這個代表「這列**沒有動作可按**」—— 併成一個徽章會讓兩種列長得一樣。
              const stuck = isStuckManualVerdict({
                status: row.status,
                failedReason: row.failedReason,
              });
              const failedLabel = refundFailedReasonLabel(row.failedReason);
              return (
                <tr key={row.id} className='border-t'>
                  <td className={`${TD} whitespace-nowrap`}>{formatOrderDateTime(row.createdAt)}</td>
                  <td className={`${TD} whitespace-nowrap`}>
                    {row.kind === 'full' ? '全額' : '部分'}
                  </td>
                  <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>
                    NT$ {formatOrderAmount(row.refundAmount)}
                  </td>
                  <td className={TD}>
                    {refundStatusLabel(row.status)}
                    {exception && (
                      <div className='mt-1'>
                        {/* G7-hold(有受理證據)= 當下已知異常;滯留逾閾 = 保守異常(plan §4-1)。 */}
                        <Link
                          href='/orders/refund-exceptions'
                          className='text-destructive text-xs font-medium underline'
                        >
                          ⚠ 已列入退款異常清單(勿重複發起,待對帳處理)
                        </Link>
                      </div>
                    )}
                    {stuck && (
                      <div className='mt-1'>
                        {/* 🔴 措辭與上面那顆**刻意不同**:那顆說「待對帳處理」(有事可做),
                            這顆的重點是「**這裡沒有可以按的動作**」+ 下一步找誰。
                            ⚠️ 不得在這裡寫「錢沒有動」—— 那正是可能判錯、需要更正的東西
                            (`#473b-2` 兩關同抓)。狀態欄顯示的是判定內容,這裡不再複述。
                            ponytail: 天花板 —— 異常清單那半有 `REFUND_STUCK_LIMIT` 上限且**舊的排前**,
                            全站卡住列超過上限時,較新的那些點進去會找不到自己。今天可接受
                            (卡住列要人判錯才會產生、後台未啟用),而且本文案的**下一步本來就是
                            「聯絡工程師」不是「去清單處理」** ⇒ 連結是便利、不是指示。
                            要處理就是給清單加分頁,不是把徽章拿掉。 */}
                        <Link
                          href='/orders/refund-exceptions'
                          // 🔴 不用 text-muted-foreground(關卡1 nit):那是同列 failedLabel /
                          //    failedDetail 的最低對比 token —— 本片的存在理由就是「訂單頁要說話」,
                          //    用畫面上最不會被看到的顏色講等於沒說。也不用 text-destructive:
                          //    那顆是「有事快做」,這顆是「沒事可做」,兩種列不該搶同一種急迫感。
                          //    ⚠️ 顏色最終由 Sean 肉眼定稿(結構鎖、字與色不鎖)。
                          className='text-foreground text-xs font-medium underline'
                        >
                          ⚠ 已列入退款異常清單(這裡沒有可以改的動作,需要更正請聯絡工程師)
                        </Link>
                        {/* 🔴 SUB2-009(2026-08-24):上面那句逐字說「這裡沒有可以改的動作」——
                            而在本片之前,**退款入口就亮在同一塊裡,而且按下去會真的送出**
                            (`S5` 只認 `processing`,這一列是 `failed`)⇒ 那不是矛盾,
                            是一句**會被照著相信的假話**。⇒ 入口已改為在這個狀態下不渲染
                            (`refund-entry-gate.ts` 的 `hasStuckRefundVerdict`)。
                            ⚠️ 而句子**必須是條件句** —— 本區塊看不到 channel / payment status /
                            旗標(禁令逐字在 :70-73):轉帳、現金、未付款、旗標關著的單,
                            入口**本來就不存在**,寫成肯定句就是對值班說假話。
                            🔴 **這句不是提醒,是本片唯一告訴他「入口為什麼不見了」的地方** ——
                            fail-closed 的安全設計若不說話,就退化成沉默的安全設計。
                            📌 而**那個被高估的未登記額沒有被修掉**(backlog `#890`):
                            這一格關的是「有沒有人按得到」,不是「那個數字對不對」。 */}
                        <p className='text-muted-foreground mt-1 text-xs'>
                          這張單若原本有「線上退款」入口,在這一列還卡著的期間它不會出現;
                          這一頁現在算不準這張單實際退過多少,請先聯絡工程師確認再處理。
                        </p>
                      </div>
                    )}
                  </td>
                  <td className={TD}>
                    <div>{row.reason}</div>
                    {failedLabel && (
                      <div className='text-muted-foreground mt-0.5 text-xs'>{failedLabel}</div>
                    )}
                    {row.failedDetail && (
                      <div className='text-muted-foreground mt-0.5 text-xs break-all'>
                        {row.failedDetail}
                      </div>
                    )}
                  </td>
                  <td className={`${TD} text-muted-foreground whitespace-nowrap text-xs`}>
                    {row.actor}
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
