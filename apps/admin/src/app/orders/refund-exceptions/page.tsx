import Link from 'next/link';
import { RefundExceptionResolve } from '../../../components/orders/refund-exception-resolve';
import { RefundVerdictCorrection } from '../../../components/orders/refund-verdict-correction';
import { ResultBanner } from '../../../components/orders/result-banner';
import { formatOrderAmount, formatOrderListDate } from '../../../lib/orders/order-list-view';
import { formatOrderDateTime } from '../../../lib/orders/order-detail-view';
import { generateRefundRequestToken } from '../../../lib/payment/refund-action-state';
import { listRefundExceptions } from '../../../lib/payment/refund-read';
import {
  listPartialCancelReconciliation,
  PARTIAL_CANCEL_RECONCILIATION_LABEL,
  type PartialCancelReconciliationRow,
} from '../../../lib/payment/partial-cancel-reconciliation-read';
import type { EffectiveVerdict } from '../../../lib/payment/refund-correction-read';
import {
  REFUND_EXCEPTION_STALL_MS,
  isStuckManualVerdict,
  refundStatusLabelWithCorrection,
} from '../../../lib/payment/refund-ledger-view';

// /orders/refund-exceptions — M-3 A7c RW3 清單 + RW4 操作(對帳判定/人工結案)。
// 🔴 中文字面全部暫定、待 Sean 肉眼定稿(結構鎖、字不鎖)。
//
// 清單有**兩類列**(`#473b-2` 起,述詞單一真相在 refund-read.ts 的 listRefundExceptions):
//   ① 可處理(plan §4-1):processing 且(滯留 >30 分 或 已有 TapPay 受理證據)。
//      證據列(G7-hold)= 當下已知異常、不等 30 分(fable N4)。
//   ② 卡住(backlog `#473`):已人工判定結案、但**判定本身沒有更正入口**。
// 🔴 **只有①類掛具名結案流程**(refund-exception-resolve.tsx);②類**零按鈕**。
//    ①類的按鈕只在「對帳判定」成立後出現,且結案 action 送出當下會重新對帳過判定閘 ——
//    沒有對帳依據的按鈕仍然不存在,只是「依據」從人工查改成了流程內建。
//    ⚠️ 改動前這裡寫的是「RW4 起**每列**掛具名結案流程」,那句已被 `#473b-2` 證偽。
// 🔴 靜態 route 優先於 /orders/[id] 動態段(Next 慣例);[id] 頁另有 isOrderId 閘。

export const dynamic = 'force-dynamic';

export default async function RefundExceptionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rawSearch = await searchParams;
  const resultCode = typeof rawSearch.r === 'string' ? rawSearch.r : undefined;
  let rows: Awaited<ReturnType<typeof listRefundExceptions>>['rows'] = [];
  let truncated = false;
  let loadFailed = false;
  // 🔴 **灰字那一行吃這兩顆,不自己重算**(R1 nit1):本頁下面另有一發
  //    `findEffectiveVerdicts` 是給【每一列的更正入口】用的,兩發可能一成一敗
  //    ⇒ 自己重算會出現「側欄說判定讀不到、而同一台螢幕上灰字精確地說另有 1 筆」。
  let decidedCount = 0;
  let verdictsUnavailable = false;
  // 🔴 **這一份就是側欄那顆數字用的那一份**(R3 consider-2)——
  //    本頁不再自己打第二發 `findEffectiveVerdicts`。理由寫在 `refund-read.ts` 的
  //    `stuckVerdicts` 欄位旁邊:`cache()` 以引數 reference 當 key,兩個呼叫端各造一個
  //    新陣列 ⇒ 永遠 miss ⇒ 「同成同敗」那句是假的,而它不會報錯、只會安靜地多打一發。
  let effectiveVerdicts: Map<string, EffectiveVerdict> | null = null;
  try {
    const result = await listRefundExceptions();
    rows = result.rows;
    truncated = result.truncated;
    decidedCount = result.decidedCount;
    verdictsUnavailable = result.verdictsUnavailable;
    effectiveVerdicts = (result.stuckVerdicts as Map<string, EffectiveVerdict> | null) ?? null;
  } catch (error) {
    console.error('[admin/orders/refund-exceptions] 異常清單載入失敗', error);
    loadFailed = true;
  }
  // OP7 ④ 對帳(部分取消 / 改價之後該退而沒開、或系統算不出的單)—— 與上面那張表分開載入、分開失敗:
  // 一邊掛了不該把另一邊一起帶走。view 沒貼(20260914070000)⇒ 這一段顯示「載入失敗」,不是「0 張」。
  let reconRows: PartialCancelReconciliationRow[] = [];
  let reconTruncated = false;
  let reconFailed = false;
  try {
    const r = await listPartialCancelReconciliation();
    reconRows = r.rows;
    reconTruncated = r.truncated;
  } catch (error) {
    console.error('[admin/orders/refund-exceptions] 部分取消退款對帳載入失敗', error);
    reconFailed = true;
  }

  // 🔴🔴 **`#890` 片3 原本在這裡有【自己一個 try】的第二發更正查詢**(plan §1d #13)。
  //    ⛔ ~~它與上面那個 try 分開,是為了「更正查詢失敗不該讓整頁看起來像沒有資料」。~~
  //    🔵 **2026-08-30(R3 consider-2)搬走了,而那個理由【仍然成立、只是換人做】**:
  //       `listRefundExceptions` 現在把它撈到的那一份一起回出來(`stuckVerdicts`),
  //       而它在**自己的 try 裡**吞掉例外、只翻 `verdictsUnavailable` ⇒ 清單照樣顯示。
  //       ⇒ 分離 fail 的語意一個字沒變,變的是**只撈一次**。
  //    🔴 為什麼一定要搬:上一片宣稱「包 `cache()` ⇒ 兩發同成同敗」——**那句是假的**,
  //       React `cache()` 以引數 reference 當 key,兩端各造一個新陣列 ⇒ 永遠 miss。
  //       📌 **一個「快取會幫我去重」的假設,在引數是新造物件時永遠不成立,而它不會報錯。**
  // 🔴 `null` 與空 Map 仍然是**兩件事**(語意未變):
  //    · `null`  = 讀失敗 ⇒ **fail-closed,不渲染更正入口**(一顆按不動的鈕比沒有鈕糟)
  //    · 空 Map  = 讀到了,只是這些列都還沒被更正過 ⇒ 入口照渲染,CAS 送 NULL

  // 🔴🔴 **同一張訂單在這張表上會出現不只一次, 而那正是 Sean 說「視覺上難以辨認」的第一層**
  //    (2026-08-31 Sean 逐字:「這個頁面顯示方式重新設計, 現在太佔空間並且視覺上難以辨認」;
  //     他手上那張截圖裡 `8X3N5Q` 出現兩次, 而兩列**長得一模一樣**)。
  //    ⇒ 一張單可以有多筆退款(全額一次 + 部分數次, 或同一筆重試過)⇒ 這是**正常資料**, 不是重複。
  //    📌 而區分它們的欄位(發起時間 / 種類 / 金額)在第 2-4 欄, 而**第 1 欄才是人在掃的那一欄**
  //       ⇒ 員工看到兩個一樣的單號, 會以為畫面壞了或自己看重複了。
  //    ⚠️ **codex R3 nit(我裁定不改, 理由寫在這)**:「這張單在這頁有 M 筆」字面偏長,
  //       可能與時間/種類/金額**搶注意力** —— 而那正是我們自己講過的「一個看起來有用的欄位
  //       把注意力從可靠的欄位吸走」。⇒ 🔵 **我仍然留著, 而理由是**:它只在**多筆時**出現
  //       (單筆列零噪音), 而它要回答的是一個**會讓人停下來的疑惑**(「我是不是看重複了」)——
  //       ⇒ 那種疑惑用**短而含糊**的字面(例如「本頁 2 筆」)回答會需要讀第二次。
  //       🛑 **而這是品味題** ⇒ 它不是我能拍的板:**Sean 早上開後台看到覺得吵, 就縮短它。**
  //    ✅ ⇒ 只在**真的出現多次**時標「這張單在這頁有 M 筆」—— 只出現一次的列不加任何東西
  //       (每一列都掛一個「有 1 筆」= 每一列都多一塊噪音, 而它一個問題都沒回答)。
  //
  // 🔴🔴 ⛔ ~~我第一版寫的是「這張單**共** M 筆」~~ ——**那是一個我算不出來的數字**(codex R2 must-fix)。
  //    這一頁有**顯示上限**, 超過就截斷(`truncated` 旗標與它上面那則橫幅就是為此存在)
  //    ⇒ 而 `orderTotal` 數的是**畫面上這一批 `rows`**, 不是資料庫裡那張單的退款筆數
  //    ⇒ ⇒ 🔴 **同一張單的第 3 筆被截在上限之外時, 畫面會說「共 2 筆」—— 而那是錯的。**
  //    📌 **⇒ 而它錯的方式最糟:它把【一份被裁掉的清單】講成一個【精確的總數】,**
  //       **而讀的人沒有任何訊號知道它只數了看得見的那些。**
  //    ✅ ⇒ 字面改成「**在這頁有** M 筆」—— 它在**截斷與沒截斷兩個世界都是真的**,
  //       而它仍然回答了他真正的問題(「我是不是看重複了」= 不是, 這張單在這頁真的有 2 筆)。
  //    🔵 **⇒ 而修法不是加一個 `!truncated` 條件** —— 那樣「截斷時整個標記消失」,
  //       ⇒ 而截斷正是列最多、最容易看重複的時候。**把宣稱縮到你算得出來的範圍, 不要把功能關掉。**
  //
  // 🔴🔴 ⛔ ~~我第一版寫的是「**第 N** / 共 M 筆」, 而那個 N 是【不穩定】的~~ ——
  //    ⇒ 這一頁的兩支查詢都是 `.order('created_at')`(`refund-read.ts:208` / `:218`),
  //      而 `created_at` **不是唯一鍵** ⇒ 同值列的順序在 Postgres 沒有保證
  //      ⇒ ⇒ **同一筆退款這次是「第 1」、重新整理可能變成「第 2」。**
  //    📌 本 repo 自己的規則就寫著這件事:`docs/patterns/pagination-loop-review.md:68`
  //       「排序鍵不唯一 ⇒ 同值列的順序不穩定, **而且每次執行還不一樣**」。
  //    🔴 而它在**退款頁**上不是美觀問題:員工記下「第 2 筆有問題」再重新整理,
  //       那個編號可能已經指到另一筆錢。**一個會變的編號比沒有編號糟。**
  //    🔴🔴 **而第二層才是這個結論的承重腳, 不是第一層**:`rows` 是**兩支查詢串接**而成
  //       (可處理的一批 + 卡住的一批, `refund-read.ts:225-228`)⇒ 同一張單的兩筆若分屬兩類,
  //       那個「第幾」跨了兩個各自排序的清單 ⇒ **它連「時間先後」都不是。**
  //    📌 **⇒ 兩層的差別會改變修法, 所以不可以並列**:
  //       · 第一層(排序鍵不唯一)= **偶爾錯**, 而它**修得掉** —— 正解是「排序補一個唯一鍵」
  //       · 第二層(兩份清單串接)= **結構上就不是那個意思**, 而它**修不掉** —— 除非合併後重排
  //       ⇒ ⇒ 🔴 **只有第一層的話, 正解會是「加唯一鍵」而不是「拿掉序號」** ——
  //            也就是說, 把兩層並列會讓人做出**錯的修法**, 而它看起來一樣有理。
  //    ✅ ⇒ 只留【共幾筆】。它回答的正是他真正的問題(「我是不是看重複了」= 不是, 這張單真的有 2 筆),
  //       而**要分辨哪一筆是哪一筆, 靠的是第 2-4 欄(時間 / 種類 / 金額)與那條把一列圈起來的線。**
  //    📌 **⇒ 少一個不能重現的數字, 比多一個看起來有用的數字好。**
  const orderTotal = new Map<string, number>();
  for (const r of rows) {
    orderTotal.set(r.orderDisplayId, (orderTotal.get(r.orderDisplayId) ?? 0) + 1);
  }

  // 🆕 C2(2026-09-14)對稿 v22 §3(`盤點-稿v22-清單.md`;圖 `inv-draft-refx.png`;幾何走設計窗 `.pcm-plist` 那層):
  //    h1「退款異常」+ 灰字一句;表 6 欄 發生時間 / 訂單 / 客人 / 金額(右)/ 系統看到的狀況 / 處理;列高 38;
  //    處理欄 = 小鈕(人工判定 · 結案 / 更正判定)。稿上沒有彈窗 ⇒ 小鈕是 `<details>` 的 summary, 按了把【原本那塊工作區】
  //    (`RefundExceptionResolve` / `RefundVerdictCorrection`, 兩支原封、action 原封)在這一列底下攤開(`globals.css` `.refx-*`, 純 CSS `:has()`)。
  //    ⛔ ~~7 欄(訂單 / 發起時間 / 種類 / 金額 / 狀態 / 證據 / 發起人)+ 每列無條件攤開的工作區 + 六行頁首說明~~
  //    ⇒ 種類併進金額格(小字「部分」)、發起人併進狀況格尾巴、狀態 + 證據併成一句「系統看到的狀況」。
  //    🔴 狀況那一句的字面【仍由】`refundStatusLabelWithCorrection` 供應(板 ⟦b9-VERDICT2LINE⟧「狀態欄跟著更正走」不動),
  //       本檔只在它前後接稿的白話;「優先處理 / 滯留逾時 / TapPay 曾受理」三個既有標示留著(page.test 釘的是它們)。
  //    🔴 結案鈕在稿上與「人工判定」並排, 而我方結案要先過對帳判定(`RefundExceptionResolve` 內建那道閘)⇒ 兩顆小鈕開的是
  //       同一塊工作區, 順序由工作區自己講;不另造第二條結案路。
  // 稿「發生時間」= `09/11 17:40`(月/日 + 時:分, 等寬)。日期走列表同一支(今年不印年), 時分從 `formatOrderDateTime`(到分)切尾巴;
  // 兩支都是 Asia/Taipei, 不自己算時區。
  const formatOccurredAt = (iso: string) => `${formatOrderListDate(iso)} ${formatOrderDateTime(iso).slice(-5)}`;
  const TH = 'text-left';
  const TD = 'align-middle';
  const PILL = 'refx-pill';

  return (
    <div className='pcm-plist space-y-3'>
      <div className='pcm-head'>
        <h1>退款異常</h1>
        {/* 稿逐字。⛔ 舊版六行說明(30 分鐘 / 勿重複發起 / 通知維護)縮成表下一句 + 灰字這句;分鐘數不再出現在頁首。 */}
        <span className='pcm-count'>錢有沒有真的退出去,系統自己判不出來的都會掉到這裡</span>
      </div>

      {/* 🔴 **灰字保底(Sean 2026-08-30 那板的配套)** —— 側欄/首頁那顆數字改成只數「尚未判定」之後,
          已判定的那幾筆**從數字上消失了**。而 `#473b-2`(2026-08-14)把它們列出來的理由逐字是
          「這條不解卡單,**只解看不見**」(`docs/phase-1-backlog.md:13843`)
          ⇒ 讓它們**從數字上消失**是拍板要的,讓它們**從畫面上消失**不是。
          ⚠️ 讀不到更正時(`verdictsUnavailable`)**這一行不出現** —— 那時 `decidedCount` 會是 0,而印「另有 0 筆」會把「讀不到」講成「沒有」。 */}
      {!verdictsUnavailable && decidedCount > 0 && (
        <p className='pcm-note2'>
          另有 <span className='font-medium'>{decidedCount}</span>{' '}
          筆已經有人更正過判定 —— 它們不算在側欄與首頁那顆數字裡,但仍然列在下面。
        </p>
      )}

      <ResultBanner code={resultCode} />

      {/* codex MF1:平台 max-rows 會靜默截斷,顯式上限+可見旗標;舊的排前=被截的是較新的 */}
      {truncated && (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-3 text-sm'>
          ⚠ 清單超過顯示上限,有退款沒有列出來 —— 這代表累積量已異常龐大,請立即通知系統維護。
        </div>
      )}

      {loadFailed ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          清單載入失敗,請稍後再試或聯絡系統維護。
        </div>
      ) : rows.length === 0 ? (
        <div className='bg-card text-muted-foreground rounded-lg border p-6 text-sm'>
          目前沒有滯留或卡住的退款。
        </div>
      ) : (
        <div className='overflow-x-auto rounded-lg border bg-card'>
          <table className='w-full border-collapse'>
            <thead>
              <tr>
                <th className={TH}>發生時間</th>
                <th className={TH}>訂單</th>
                <th className={TH}>客人</th>
                <th className={`${TH} text-right`}>金額</th>
                <th className={TH}>系統看到的狀況</th>
                <th className={TH}>處理</th>
              </tr>
            </thead>
            {/* 🔴 一列 = 一個 `<tbody>`(2026-08-31 片3):資料列 + 工作列被同一組圈住, 工作列預設收著、由處理欄的小鈕攤開。 */}
            {rows.map((row) => {
              // 🔴 卡住的列(backlog #473)= 已結案、判定改不了 ⇒ 只有「更正判定」, 沒有結案。
              const stuck = isStuckManualVerdict(row);
              const sameOrderCount = orderTotal.get(row.orderDisplayId) ?? 1;
              const statusLabel = refundStatusLabelWithCorrection(
                row.status,
                // 🔴 三態(codex must-fix):整批讀不到 ⇒ 'unreadable'(不對錢下斷言);讀到而這列沒更正 ⇒ null(原字面)。
                effectiveVerdicts === null ? 'unreadable' : (effectiveVerdicts.get(row.id)?.correctedTo ?? null),
              );
              const unreadableStuck = stuck && effectiveVerdicts === null;
              // 🔴 收合那一行【自己就說得出來】(片3 那條:收合可以藏細節, 不可以藏他要據以決定的東西):
              //    有沒有被改過 / 第幾次 / 誰改的, 在小鈕旁邊就講, 不用展開。
              const eff = stuck && effectiveVerdicts !== null ? (effectiveVerdicts.get(row.id) ?? null) : null;
              // 「等更正」只給還沒被更正過的(codex R1 nit:已更正的列不該同時印「已更正 … 等更正」)。
              const stuckTail = `${eff === null && effectiveVerdicts !== null ? ',等更正' : ''}${row.providerEvidence !== null ? ' · TapPay 曾受理' : ''}`;
              // 稿的「系統看到的狀況」= 一句白話;既有三個標示字面留在句尾(它們是測試與員工都認得的訊號)。
              const situation = stuck
                ? `${statusLabel}${stuckTail}`
                : row.providerEvidence !== null
                  ? 'TapPay 已受理,優先處理 —— 帳本還沒結案'
                  : '送出去之後沒有收到回覆,不知道退了沒(滯留逾時)';
              return (
                <tbody key={row.id} className='refx-row border-t'>
                  <tr>
                    <td className={`${TD} whitespace-nowrap font-mono`}>{formatOccurredAt(row.createdAt)}</td>
                    <td className={`${TD} whitespace-nowrap`}>
                      <Link href={`/orders/${row.orderId}`} className='font-mono'>
                        {row.orderDisplayId}
                      </Link>
                      {/* 🔴 只在真的有多筆時出現 —— 理由見上面 `orderTotal` 那段。 */}
                      {sameOrderCount > 1 && (
                        <span className='text-muted-foreground ml-2 text-xs whitespace-nowrap'>這張單在這頁有 {sameOrderCount} 筆</span>
                      )}
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>{row.customerName ?? '—'}</td>
                    <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>
                      {formatOrderAmount(row.refundAmount)}
                      {row.kind !== 'full' && <span className='text-muted-foreground ml-1 text-xs'>部分</span>}
                    </td>
                    <td className={TD}>
                      <span className={stuck ? undefined : row.providerEvidence !== null ? 'text-destructive font-medium' : undefined}>
                        {situation}
                      </span>
                      <span className='text-muted-foreground ml-2 text-xs whitespace-nowrap'>· {row.actor} 發起</span>
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
                      {unreadableStuck ? (
                        /* 更正查詢失敗 ⇒ 零鈕(按不動的鈕比沒有鈕糟)+ 一句話;`<p>` 是刻意的(文案守門掃 <p>)。 */
                        <p className='text-muted-foreground m-0 text-xs whitespace-normal'>
                          這一列當初被人工判定為「沒有動到錢」並結案。現在讀不到它的更正紀錄,所以這裡暫時沒有可以按的動作 ——
                          請重新整理;若一直如此,請聯絡工程師處理。
                        </p>
                      ) : (
                        /* 稿的小鈕 = 這顆 `<details>` 的 summary;它沒有內容, 只當開關 —— 工作列由 CSS `:has([open])` 跟著攤開。
                           結案在稿上是第二顆鈕, 我方要先過對帳判定 ⇒ 兩顆開同一塊工作區(見檔頭)。 */
                        <details className='refx-toggle'>
                          <summary>
                            <span className={PILL}>{stuck ? '更正判定' : '人工判定'}</span>
                            {!stuck && <span className={PILL}>結案</span>}
                            {stuck && (
                              <span className='text-muted-foreground self-center text-xs'>
                                {eff === null ? '尚未更正' : `已更正過(第 ${eff.seq} 次,${eff.actor})`}
                              </span>
                            )}
                          </summary>
                        </details>
                      )}
                    </td>
                  </tr>
                  {!unreadableStuck && (
                    <tr className='refx-work'>
                      <td colSpan={6}>
                        {stuck && effectiveVerdicts !== null ? (
                          /* 更正表單(`#890` 片3)—— 欄位名 / verdict / reason / CAS / 每列一把 token / server action 全部原封。
                             ⛔ ~~原本外面再包一層 `<details>` 收合~~ ⇒ 收合現在由處理欄的小鈕統一做, 這裡只留摘要一行 + 表單。 */
                          <div className='refx-panel'>
                            <RefundVerdictCorrection refundId={row.id} serverToken={generateRefundRequestToken()} effective={eff} />
                          </div>
                        ) : (
                          // token=渲染期產、每列一把(force-dynamic 零快取;refund-action-state.ts:41-43)。
                          <div className='refx-panel'>
                            <RefundExceptionResolve refundId={row.id} serverToken={generateRefundRequestToken()} />
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              );
            })}
          </table>
        </div>
      )}

      {/* OP7 ④:部分取消 / 改價之後的待退款對帳(migration 20260914070000 的 view)。
          🔴 這一段就是「對帳在交易外」那一半(A 2026-09-08 丙的必要條件)—— 值班每天看這頁, 所以掛這裡。
          零 PII:只有訂單連結 + 四個數字。 */}
      <section data-testid='partial-cancel-reconciliation' className='space-y-2'>
        <h2 className='text-base font-semibold'>
          部分取消 / 改價之後的待退款對帳
          <span className='pcm-count'>{reconFailed ? '載入失敗' : `${reconRows.length} 張要看`}</span>
        </h2>
        {reconFailed ? (
          <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-3 text-sm'>
            對帳資料載入失敗(這不是「沒有異常」)—— 可能是 20260914070000 還沒貼,請回報。
          </div>
        ) : reconRows.length === 0 ? (
          <p className='pcm-note2'>目前沒有算起來該退而沒開、或系統算不出的單。</p>
        ) : (
          <div className='overflow-x-auto rounded-lg border bg-card'>
            <table className='w-full border-collapse'>
              <thead>
                <tr>
                  <th className='text-left'>訂單</th>
                  <th className='text-left'>要看什麼</th>
                  <th className='text-right'>該退</th>
                  <th className='text-right'>已開</th>
                  <th className='text-right'>非卡淨收</th>
                  <th className='text-right'>剩餘應收</th>
                </tr>
              </thead>
              <tbody>
                {reconRows.map((r) => (
                  <tr key={r.orderId} data-recon-kind={r.kind}>
                    <td className='align-middle'>
                      <Link href={`/orders?open=${r.orderId}`} className='underline'>{r.orderId.slice(0, 8)}</Link>
                    </td>
                    <td className='align-middle'>{PARTIAL_CANCEL_RECONCILIATION_LABEL[r.kind]}</td>
                    <td className='text-right align-middle'>{r.expectedTotal === null ? '待人工確認' : formatOrderAmount(r.expectedTotal)}</td>
                    <td className='text-right align-middle'>{formatOrderAmount(r.openTotal)}</td>
                    <td className='text-right align-middle'>{formatOrderAmount(r.noncardNet)}</td>
                    <td className='text-right align-middle'>{r.remaining === null ? '算不出' : formatOrderAmount(r.remaining)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {reconTruncated ? <p className='pcm-note2'>超過 200 張, 只顯示前 200。</p> : null}
          </div>
        )}
      </section>

      {/* 稿逐字那句 + 舊頁首說明裡真正承重的兩件事(勿重複發起 / 判定不明停手)。 */}
      <p className='pcm-note2'>
        判定跟更正在訂單那邊的「退款 / 取消」也做得到,這一頁是把待處理的集中起來看。
        這些單<span className='font-medium'>勿重複發起退款</span>;先按「人工判定」讓系統對帳,照結果結案;判定不明時停手並通知系統維護。
      </p>
    </div>
  );
}
