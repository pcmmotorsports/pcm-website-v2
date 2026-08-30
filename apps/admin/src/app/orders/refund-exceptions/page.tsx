import React from 'react';
import Link from 'next/link';
import { RefundExceptionResolve } from '../../../components/orders/refund-exception-resolve';
import { RefundVerdictCorrection } from '../../../components/orders/refund-verdict-correction';
import { ResultBanner } from '../../../components/orders/result-banner';
import { formatOrderAmount } from '../../../lib/orders/order-list-view';
import { formatOrderDateTime } from '../../../lib/orders/order-detail-view';
import { generateRefundRequestToken } from '../../../lib/payment/refund-action-state';
import { listRefundExceptions } from '../../../lib/payment/refund-read';
import {
  findEffectiveVerdicts,
  type EffectiveVerdict,
} from '../../../lib/payment/refund-correction-read';
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
  try {
    const result = await listRefundExceptions();
    rows = result.rows;
    truncated = result.truncated;
  } catch (error) {
    console.error('[admin/orders/refund-exceptions] 異常清單載入失敗', error);
    loadFailed = true;
  }

  // 🔴🔴 **`#890` 片3:更正查詢【自己一個 try】,不得併進上面那個**(plan §1d #13 逐字)。
  //    上面那個 try 失敗 ⇒ 整張清單不顯示;而更正查詢失敗**不該讓整頁看起來像「沒有資料」**
  //    ⇒ 它只該讓那幾列少一個入口。
  // 🔴 而 `null` 與空 Map 是**兩件事**:
  //    · `null`  = 讀失敗 ⇒ **fail-closed,不渲染更正入口**（那時他確實沒有可以按的東西，
  //      而**一顆按不動的鈕比沒有鈕糟**）
  //    · 空 Map  = 讀到了，只是這些列都還沒被更正過 ⇒ 入口照渲染，CAS 送 NULL
  let effectiveVerdicts: Map<string, EffectiveVerdict> | null = null;
  const stuckIds = rows.filter((row) => isStuckManualVerdict(row)).map((row) => row.id);
  try {
    const got = await findEffectiveVerdicts(stuckIds);
    // 🔴 **型別漂移也要 fail-closed**(codex 2026-08-29):`!== null` 放行的不只 Map ——
    //    一個回 `undefined` 或別的東西的實作會通過那個判斷,而下一步 `.get()` **炸整頁**。
    //    ⇒ 這裡只認 `Map`;不是 Map 就當成「讀失敗」。
    effectiveVerdicts = got instanceof Map ? got : null;
  } catch (error) {
    console.error('[admin/orders/refund-exceptions] 現行更正判定載入失敗', error);
    effectiveVerdicts = null;
  }

  const TH = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap';
  const TD = 'px-3 py-2 text-sm align-top';

  return (
    <div className='mx-auto space-y-4'>
      <div>
        <h1 className='text-2xl font-semibold'>退款異常清單</h1>
        <p className='text-muted-foreground mt-1 text-sm'>
          {/* 分鐘數由常數推導(opus R1:員工唯一看得到的那個 30 不得是第三份硬寫字面)。 */}
          處理中且滯留超過 {REFUND_EXCEPTION_STALL_MS / 60_000} 分鐘、或 TapPay
          已受理但帳本尚未結案的退款。
          另外也會列出<span className='font-medium'>已經人工判定失敗、但這裡改不了判定</span>的退款,
          那幾列沒有可以按的按鈕。
          這些單<span className='font-medium'>勿重複發起退款</span>;
          有「執行對帳判定」按鈕的請先按它,依判定結果結案(標記失敗/恢復結案),
          判定不明時停手並通知系統維護。
        </p>
      </div>

      <ResultBanner code={resultCode} />

      {/* codex MF1:平台 max-rows 會靜默截斷,顯式上限+可見旗標;舊的排前=被截的是較新的 */}
      {truncated && (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-3 text-sm'>
          {/* 兩關 nit:原文把爆量一律歸因成「滯留量」;#473b-2 之後也可能是卡住的列堆積。
              ⇒ 只講「有東西沒列出來」這個可觀察事實,不歸因。 */}
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
                <th className={TH}>訂單</th>
                <th className={TH}>發起時間</th>
                <th className={TH}>種類</th>
                <th className={`${TH} text-right`}>金額</th>
                <th className={TH}>狀態</th>
                <th className={TH}>TapPay 受理證據</th>
                <th className={TH}>發起人</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                // 🔴 卡住的列(backlog #473)= 已結案、判定改不了 ⇒ **不掛任何操作入口**。
                //    掛了它只會回「已結案」,而給員工一個按了沒有結果的按鈕 = 誤導。
                const stuck = isStuckManualVerdict(row);
                return (
                // 每列兩 <tr>:資料列 + 操作列(colSpan 全寬;fragment key 掛在資料列上即可)
                <React.Fragment key={row.id}>
                  <tr className='border-t'>
                    <td className={`${TD} whitespace-nowrap`}>
                      <Link href={`/orders/${row.orderId}`} className='font-medium underline'>
                        {row.orderDisplayId}
                      </Link>
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
                      {formatOrderDateTime(row.createdAt)}
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
                      {row.kind === 'full' ? '全額' : '部分'}
                    </td>
                    <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>
                      NT$ {formatOrderAmount(row.refundAmount)}
                    </td>
                    {/* 🔴🔴 板 `:638` ⟦b9-VERDICT2LINE⟧:**狀態欄跟著更正走**
                        (Sean 2026-08-30 拍【甲】, 逐字「退款異常那頁:狀態欄跟著更正走」)。
                        改之前這一格印 `refundStatusLabel(row.status)` = **「失敗(錢沒有動)」**,
                        而它**正下方**的更正區塊印「現行判定是『錢有動』」
                        ⇒ **員工同時看到兩行相反的話。**
                        📌 而那個矛盾**只有開畫面才看得到** —— 兩邊各自都是對的,
                           **錯的是它們並排在一起**, 而在此之前沒有任何一支檔同時看得到兩邊。
                        ⛔ ~~⚠️ 讀不到更正時(`effectiveVerdicts === null`)傳 `null` ⇒ 退回原始字面,
                           而那時畫面上另一段會說「現在讀不到它的更正紀錄」⇒ 兩行仍然一致。~~
                        🔴🔴 **那一段【與它正下方的碼相反】了 —— codex R2 抓到。**
                           碼現在傳的是 `'unreadable'`(見下面那三行), 而那句註解還在說傳 `null`。
                           ⇒ **後人照著它回退, 就會把 codex R1 那條 must-fix 原封裝回去。**
                           📌 **⇒ 而這正是本片在修的那個病, 只是換了載體**:
                              上面那半是【狀態欄與更正區塊】並排說相反的話,
                              這一半是【註解與它下面三行碼】並排說相反的話。
                              ⇒ ⇒ **我在修一個矛盾的同時, 在它正上方造了另一個。**
                        ✅ **現行行為(以下面那三行為準)**:讀不到 ⇒ `'unreadable'` ⇒
                           狀態欄印「失敗(更正紀錄讀不到)」、**不對錢下任何斷言**。 */}
                    <td className={TD}>
                      {refundStatusLabelWithCorrection(
                        row.status,
                        // 🔴 **三態, 而這裡是分得出來的地方**(codex must-fix):
                        //    `effectiveVerdicts === null` = **整批讀不到**(上面那個 try 掛了)
                        //    ⇒ 傳 `'unreadable'` ⇒ 狀態欄**不對錢下斷言**。
                        //    ⚠️ 而 `.get()` 回 undefined 是**另一件事**:讀得到, 而這一列沒有更正
                        //    ⇒ 傳 `null` ⇒ 原始字面(那時「錢沒有動」是帳本上最後一筆人工判定, 有依據)。
                        effectiveVerdicts === null
                          ? 'unreadable'
                          : (effectiveVerdicts.get(row.id)?.correctedTo ?? null),
                      )}
                    </td>
                    <td className={TD}>
                      {/* 🔴 括號裡那句是「這列為什麼在清單上」。卡住的列既不是滯留逾時、
                          也沒有「優先處理」可言(沒有動作可做)⇒ 兩句都不能沿用。 */}
                      {row.providerEvidence !== null ? (
                        <span className={stuck ? 'font-medium' : 'text-destructive font-medium'}>
                          {stuck ? '有(TapPay 曾受理)' : '有(TapPay 已受理,優先處理)'}
                        </span>
                      ) : (
                        <span className='text-muted-foreground'>
                          {stuck ? '無' : '無(滯留逾時)'}
                        </span>
                      )}
                    </td>
                    <td className={`${TD} text-muted-foreground whitespace-nowrap text-xs`}>
                      {row.actor}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={7} className='px-3 pt-0 pb-3'>
                      {stuck && effectiveVerdicts !== null ? (
                        <RefundVerdictCorrection
                          refundId={row.id}
                          serverToken={generateRefundRequestToken()}
                          effective={effectiveVerdicts.get(row.id) ?? null}
                        />
                      ) : stuck ? (
                        // 文案與訂單頁那條早退路徑同一句意思(refund-recovery-state.ts):
                        // 說清楚「這裡沒有可以改的地方」+ 下一步找誰,不叫員工去做沒有結果的事。
                        <p className='text-muted-foreground text-sm'>
                          {/* 🔴 兩關同抓:第一版寫「判定為失敗、錢沒有動」= 把**待查的人工判定**
                              當成金流事實。這一列存在的理由就是那個判定可能錯(尤其是 TapPay
                              曾受理的列,錢可能真的動了)—— 說死了員工就不會再去追。
                              ⇒ 敘述「當初判定的內容」,不敘述「錢的狀態」。 */}
                          {/* 🔴 `#890` 片3 之後,這一段**只在【更正查詢失敗】時出現** ——
                              入口本身已經做出來了(見上面那個分支)。
                              ⇒ 而這時他確實沒有可以按的東西,所以這句話仍然是真的。 */}
                          這一列當初被人工判定為「沒有動到錢」並結案。
                          現在讀不到它的更正紀錄,所以這裡暫時沒有可以按的動作 ——
                          請重新整理;若一直如此,請聯絡工程師處理。
                        </p>
                      ) : (
                        // token=渲染期產、每列一把(force-dynamic 零快取;refund-action-state.ts:41-43)。
                        <RefundExceptionResolve
                          refundId={row.id}
                          serverToken={generateRefundRequestToken()}
                        />
                      )}
                    </td>
                  </tr>
                </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
