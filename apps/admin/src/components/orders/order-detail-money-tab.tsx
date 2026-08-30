// order-detail-money-tab.tsx — 「收款 · 退款」分頁的內容(2026-08-24 拆檔片,自
// `order-detail.tsx` 純搬移;該檔 961 行 > 400,鐵則 6)。
//
// 🔴 **分頁的 key/label/`hashes: ['cancel']` 刻意留在呼叫端**(`order-detail.tsx` 的 tabs 陣列)——
//    `key: 'money'` 是 MF-2 那條跨三檔 CSS 契約的值來源、`hashes` 是 #cancel 深連結的認領宣告,
//    兩個字面都有源碼守門讀著呼叫端,不跟著搬。本檔只有 content 那一半。
// 🔴 **仍是 server component**(無 `'use client'`):兩顆 token 在渲染期產,立場同呼叫端。
// 🔴 搬移片零行為改動;各段註解逐字原樣。
//    呼叫端守門 = `order-detail-tabs-wiring.test.tsx` 的行為格(render 的是 `OrderDetail`,
//    斷言 #cancel 落在露出來的 money 頁裡 —— 把本元件從呼叫端拔掉,那幾格就紅)。

import type { AdminOrderDetail } from '@pcm/domain';
import { OrderHiddenNotice } from './order-hidden-notice';
import { DangerZoneDetails } from './danger-zone-details';
import { OrderCancelBlock } from './order-cancel-block';
import { RefundSection } from './refund-section';
import { RefundLedgerSection } from './refund-ledger-section';
import { isBlockingStuckVerdict, isStuckManualVerdict } from '../../lib/payment/refund-ledger-view';
import { shouldShowRefundEntry } from './refund-entry-gate';
import { ManualRefundEntrySection } from './manual-refund-entry-section';
import { ManualRefundLedgerSection } from './manual-refund-ledger-section';
import { shouldShowManualRefundEntry } from './manual-refund-entry-gate';
import type { PaymentListData } from './payment-list';
import { PaymentSection } from './payment-section';
import { generateRefundRequestToken } from '../../lib/payment/refund-action-state';
import { generateManualRefundRequestToken } from '../../lib/payment/manual-refund-action-state';
import type { OrderRefundRow } from '../../lib/payment/refund-read';
import type { ManualRefundRow } from '../../lib/payment/manual-refund-read';

/**
 * props 是 `OrderDetail` 同名 props 的直傳(預設值在呼叫端就已補完 ⇒ 這裡**全部必填**,
 * 忘了接會編不過);完整語意寫在 `order-detail.tsx` 的 props 型別上,那裡是唯一權威。
 * `refundLedgerAbnormal` 在呼叫端算(`order-detail-tab-routing.ts`,initialKey 也要它)——
 * 這裡收現成的值、不重算第二份。
 */
export function OrderDetailMoneyTab({
  detail,
  returnTo,
  payments,
  refunds,
  refundsFailed,
  refundsTruncated,
  stuckVerdicts,
  refundUnregisteredAmount,
  refundUnregisteredFailed,
  manualRefunds,
  manualRefundsFailed,
  manualRefundsTruncated,
  refundEnabled,
  cancelFormsAllowed,
  refundLedgerAbnormal,
}: {
  detail: AdminOrderDetail;
  returnTo: string;
  payments: PaymentListData;
  refunds: readonly OrderRefundRow[];
  refundsFailed: boolean;
  refundsTruncated: boolean;
  /** `#890` 片4:卡住那幾列現行有效的更正判定;`null` = 讀不到 ⇒ fail-closed。 */
  stuckVerdicts: ReadonlyMap<string, { correctedTo: string }> | null;
  refundUnregisteredAmount: number | null;
  refundUnregisteredFailed: boolean;
  manualRefunds: readonly ManualRefundRow[];
  manualRefundsFailed: boolean;
  manualRefundsTruncated: boolean;
  refundEnabled: boolean;
  cancelFormsAllowed: boolean;
  refundLedgerAbnormal: boolean;
}) {
  const cancelled = detail.cancelledAt !== null;

  /**
   * 🔴 SUB2-009:帳本裡有沒有「人工判定沒動到錢」而卡住的列。
   *
   * **算在這裡、不算在閘裡**:閘吃的是旗標(它是純判斷、不認識列),
   * 而判準本身住在 `refund-ledger-view.ts` —— 這裡只是把它套在列上,**不複製那個判準**
   * (複製一份就是下一個漂移點,同檔頭那條「兩處各養一份 label」的教訓)。
   * ⚠️ 這一顆**刻意不併進 `refundLedgerAbnormal`**:它不是對帳異常,掛紅標題會說謊
   *    —— 與 `refundsTruncated` 同一個理由。
   */
  // 🔴 `#890` 片4(Sean 2026-08-30 拍板做 (b)):**已經有人更正成「錢沒有動」的那幾列不再擋**。
  //    判準本體在 `refund-ledger-view.ts` 的 `isBlockingStuckVerdict`(三態預設關),
  //    **與 server 端 `refund-actions.ts` 的 ④-b 共用同一支** —— 這裡只是把它套在列上。
  //    ⚠️ 這一顆的名字沒有改:它問的仍然是「有沒有卡住的判定在擋」,只是「擋不擋」的答案
  //       現在多看一格更正紀錄。
  const hasStuckRefundVerdict = refunds.some((r) => isBlockingStuckVerdict(r, stuckVerdicts));

  return (
            <>
              {/* #15-B2-c:已登錄的收款明細 + 登錄表單(片2a 起同一張卡,Sean 拍板 Q-D2=A)。
                  🔴 位置 = 採購與到貨【之後】、出貨之前(2026-08-18 Sean 逐字 `09 收款區搬到到貨之後 = 甲`;
                  出處 memory `project_0818-sean-eleven-rulings-noon.md:19`,plan
                  `docs/specs/2026-08-18-m4b-order-detail-payment-block-order-plan.md`)。
                  🔴 這個位置推翻了原本寫在這裡的一個理由,而**那個理由不是錯的** —— 兩個都成立:
                    看單  打開這張單想知道現況 ⇒ 付款狀態 → 錢收了哪幾筆   ← 原安排(收款緊跟付款/發票那一組)
                    做事  要把這張單往前推一步 ⇒ …到貨了 → 收尾款 → 出貨   ← Sean 09=甲 拍的是這個
                  搬**之前**量到的病(過去式,不是現況):收尾款得捲回頁面上方 ↑2,578 px
                  (5 品項單;真後台真資料 viewport 1728×1117、**拋棄式庫非正式站**)。
                  搬之後那一步是 ↓569。⚠️ **折返沒有消失,只是換了位置** —— 收訂金現在也在採購下面,
                  第 1→2 步變成 ↑2,322。Sean 的五步裡收款出現兩次,線性頁面在其中一次會折返。
                  (所以不要寫「唯一的折返」——那句在改前改後都不成立。)
                  **留著這段是為了不讓下一個人照「看單」那個理由把它搬回去。**
                  ⚠️ 只動渲染順序:零 props、零查詢、零業務邏輯改動。
                  🔴 **但不要寫成「什麼行為都沒變」** —— DOM 順序就是鍵盤 Tab 與螢幕閱讀器的朗讀順序,
                  它跟著一起變了(codex 對抗審查 2026-08-18 抓到)。這是**這片本來就要的效果**、不是副作用,
                  但它是行為。「已取消」橫幅留在原地(訂單層狀態、不屬收款)。
                  退款相關的兩塊刻意留在頁尾(危險操作沉底,見 `RefundSection` 那段),不與收款混在一起。 */}
              {/* 🔴 `detail.total.amount` 與 `order_payments.amount` **同單位(整數元、非分)**:
                  前者見 `order-list-view.ts:675` 逐字引 migration `20260604120000`「金額一律 integer 元位」,
                  後者見 `order_payments.amount` 欄 COMMENT 逐字「整數元、非零」⇒ 彙總行直接相減、零換算。 */}
              <PaymentSection
                orderId={detail.id}
                returnTo={returnTo}
                payments={payments}
                amountDue={detail.total.amount}
              />
              {/* 🔴 `#841`:這一整塊(判斷 + 文案)**2026-08-23 抽到 `order-hidden-notice.tsx`** ——
                  理由是 `:421-423` 那條 standing ruling(「下一次非一行改動先抽再改」),而本片就是那個下一次。
                  🔴 **判斷不留在這裡**:它必須逐項對得上 `SupabaseOrderAdapter.ts` 那句述詞的隱藏面,
                     而那個對應關係寫在新檔的檔頭。改述詞的人要去那裡。 */}
              <OrderHiddenNotice
                paymentChannel={detail.paymentChannel}
                paymentStatus={detail.paymentStatus}
                cancelled={cancelled}
                payments={payments}
              />
              {/* ═══ 危險操作沉底:取消 / 退款 ═════════════════════════════════════════════
                  🔴🔴 **鈕上不得出現「退貨」二字**(2026-08-19,W1)——
                     **退貨整條功能在本 repo 一行程式碼都沒有**,而這顆鈕原本寫著「退貨 / 退款」
                     ⇒ 那是一顆通往不存在功能的入口。
                     權威 = **Aug-17 18:39「720 側邊欄確認稿」**(`<title>` 逐字;
                     `~/.claude/projects/-Users-sean-1-pcm-website-v2/07788b5a-.../tool-results/
                      artifact-c3c6cc94-1786959567-bf41.html`,另見 `globals.css:1460` /
                      `order-detail-items-table.tsx:228` 兩處也指著它):
                       `:429` 區塊標題逐字「取消 / 退款」、`:431` 鈕逐字「線上退款(TapPay)」
                       `:432` 逐字「🔴 退貨 —— 整條功能後台沒有。畫面已經改成講明
                                    『退貨功能目前還沒有』,不會叫你去走。」
                     ⚠️ **這覆蓋了 Aug-13 稿的「退貨 / 退款」**,而片12 當時照的是 Aug-13
                        (經由二手轉述 `MAIN-057`)⇒ **不是兩份稿打架,是後者明文處理了前者沒處理的問題。**
                     📎 同族的另一處早就改對了:`cancel-review-section.tsx:142` 逐字
                        「而退貨功能目前還沒有」(2026-08-14 止血)⇒ 本次是把**最後一處**補齊。
                  🔴 **取消從第 ④ 位(夾在收款與品項中間)移到這裡**(2026-08-16)。
                  **兩個獨立來源都說墊底,而【當時的】現況兩邊都不符** ⇒ 這是**缺陷不是選項**,不需要拍板。
                  (2026-08-18 修字面:那句原本是現在式,而它描述的是 08-16 改**之前**;現在已經墊底了。)
                    · Sean 逐字(`docs/specs/2026-08-12-admin-order-ui-design-brief.md` 搜
                      `回去採購等於說跟國外下單`,同段末):「最難的大概就是取消,**所以放最下面沒問題**」
                    · OD 定案主稿 `overview-desktop.html` 搜 `危險操作沉底` —— 同一句話的設計版
                  ⚠️ **只動渲染順序,零 props / 零查詢 / 零業務邏輯改動**:`OrderCancelBlock` 的 props、
                     `cancelFormsAllowed` 的算法、它自己的判斷全部一個字沒動。
                     🔴 **這裡原本還寫了一句「什麼行為都沒變」,2026-08-18 撤回**(codex R2 抓到,
                     與收款搬位那段同一個病):搬動含互動元件的區塊會改變**鍵盤 Tab 與螢幕閱讀器的朗讀順序**
                     —— 那也是行為。(撤回句刻意不留原字面:留著的話字面掃描會一直命中一句已經作廢的話。)
                  📎 **與 OD 的最後一塊對齊**:OD `more` 區塊 = 取消 → 退貨/退款面板(同一塊、取消在前)
                     ⇒ 我方擺成 取消 → 退款帳本 → 退款入口,是同一個順序。
                  🔴 **這片可能會被之後的版面重排吸收掉**(`~/pcm-mailbox/A-218-demo-brief.md`
                     那一輪若改掉整個面板編排)—— **那不是白做**:它**現在**就是缺陷,
                     而 demo 那一輪還要好幾天。 */}
              {/* 🔴 片12(2026-08-19):設計稿區塊⑥ —— 面板最底是**一列兩顆鈕**:
                     `[退款]                            [申請取消整張單(紅)]`
                     (~~原寫 `[退貨 / 退款]`~~ —— 那是 Aug-13 稿的字面,已被確認稿覆蓋,見上一段。)
                  ⇒ 三大塊(複核 / 退款帳本 / 退款入口)收進兩顆鈕底下。
                  🔴 **DOM 順序 = 設計稿的左右順序(退款在前、取消在後),沒有 `order-*`**。
                     ⚠️ **我第一版用 `order-1/2` 把視覺左右對調、DOM 維持「取消在前」,理由寫「朗讀順序跟 DOM」**
                        —— 那個理由本身沒錯,**但它換來的是【視覺順序與鍵盤焦點順序打架】**
                        (codex K2 2026-08-19 抓到:畫面左邊是退款,而 Tab 先跳到右邊的取消)。
                     ⇒ 兩害相權:設計稿自己就把退款排左邊 ⇒ **照它排 DOM,三個順序(視覺/Tab/朗讀)一致。**
                        (先前那句「與 OD `more` 同序」講的是**舊的直排版**,那個版面已經不存在了。)
                  ⚠️ **零 props / 零查詢 / 零閘改動**:`shouldShowRefundEntry(…)` 那道顯示閘、
                     `cancelFormsAllowed`、各元件自己的判斷,一個字沒動 —— 它們只是換了位置。
                  🔴 **而「換位置」本身就是行為**(codex R2 在收款搬位那次抓過同款):
                     Tab 與朗讀順序會變,且**收起來的內容報讀器預設讀不到**
                     ⇒ 這不是純視覺,不要寫成零風險。 */}
              {/* 🔴 2026-08-20:Sean 親自開後台看畫面後裁定,兩塊改成【上下堆疊、各自摺疊】,
                  與上面收款/出貨/備註等卡片統一(原字:「不要左右,改成上下然後欄位可以點開.
                  跟上面其他功能意思一樣．讓介面統一性」)。
                  🔴 判準去畫面上找,不是自己設計:比對既有卡片(`payment-list.tsx`/`notes-timeline.tsx`)
                  的收合寫法——外層 `<details className='group bg-card ... rounded-lg border p-4'>`、
                  `<summary>` 內自己畫一顆 `▶` 三角(`group-open:rotate-90`,`display:flex` 會蓋掉原生
                  marker)、標題用 `<h2 className='font-semibold'>`。plan 見
                  `~/pcm-mailbox/W2-014-退款取消版面上下堆疊-plan-20260820.md`。
                  ⚠️ **只換外層樣式與排列方式,`DangerZoneDetails` 本體(hash 深連結/對帳異常強制展開/
                  捲進視野三個行為邏輯)一行未動**,`OrderCancelBlock`/`RefundLedgerSection`/
                  `ManualRefundLedgerSection` 等內容元件也未動。文字(「退款」「申請取消整張單」)
                  不改——文案是另一題(main window 2026-08-20 交代:等自動退刷那題答完再動)。 */}
              <div className='space-y-4'>
                {/* 🔴🔴 **對帳異常時這一塊【自己打開】,而且鈕上就寫著異常**(codex K2 2026-08-19 finding 3)。
                    我第一版把帳本無條件收進鈕底下,而帳本裡有「帳本讀不到 / 未登記額為負 ⇒ 勿再發起退款」
                    這種**警告** —— 那類警告存在的唯一理由就是要員工看到它。
                    收起來 ⇒ 員工看到的是一顆平平無奇的「退款」鈕,退款入口消失了他也**不知道為什麼**
                    ⇒ **那是把一個 fail-closed 的安全設計,退化成一個沉默的安全設計。**
                    ⇒ 判準與那道閘**高度重疊而不相同** —— 逐格差異寫在 `refundLedgerAbnormal` 那段
                    (2026-08-24 更正;~~原句「同一組輸入」~~ 是同一句話的**第三份副本**。
                    🔴 本檔今天有三份, 只改一份 = 同一份檔案把兩個相反的說法各餵給不同的人 ——
                    改這句話之前先 `grep -c '同一組輸入'`)。 */}
                <DangerZoneDetails
                  className='group bg-card text-card-foreground rounded-lg border p-4'
                  /* 🔴 codex MF-2(2026-08-24):截斷兩態也要自己打開 —— 截斷紅區(「勿發起退款」/
                     「不顯示任何一列」)住在這一塊【裡面】,只開對分頁、塊還收著,紅字一樣看不到。
                     ⚠️ 刻意不用 `moneyTabMustSee`:收款讀不到的紅字在 PaymentList、不在這一塊裡,
                        拿它來開這一塊會對一個其實沒事的退款區平白掛開。
                     ⚠️ 紅標題「退款(對帳異常)」的判準【不動】(仍是 refundLedgerAbnormal):
                        截斷不是對帳異常,掛那五個字會說謊 —— 打開之後紅區自己會講話。 */
                  defaultOpen={refundLedgerAbnormal || refundsTruncated || manualRefundsTruncated}
                  summary={
                    <span className='flex flex-wrap items-center gap-2'>
                      {/* 🔴 A2(2026-08-21 Sean 拍板乙=最小13px):10px → 13px。 */}
                      <span className='text-muted-foreground text-[13px] transition-transform group-open:rotate-90'>
                        ▶
                      </span>
                      {/* 🔴 FIX-03(OD):標題規格從 4 種壓成 2 種 —— 這一顆走**卡片標題**那一級
                          (`text-muted-foreground text-xs font-bold tracking-[1.5px]`),與摘要卡、
                          商品明細卡同一組。⚠️ **對帳異常時仍然走 `text-destructive`** ——
                          那不是「另一種標題規格」,是同一級的**警示色**;
                          OD 對「申請取消整張單」也是同規格 + 保留 destructive。 */}
                      <h2
                        className={
                          refundLedgerAbnormal
                            ? 'text-destructive text-xs font-bold tracking-[1.5px]'
                            : 'text-muted-foreground text-xs font-bold tracking-[1.5px]'
                        }
                      >
                        {refundLedgerAbnormal ? '退款(對帳異常)' : '退款'}
                      </h2>
                    </span>
                  }
                >
                  {/* M-3 RW3:退款帳本呈現(唯讀、不吃旗標;零列且未失敗時區塊自回 null)。
                      nowMs 在 server render 期取 —— 列級「滯留逾閾」判定的現在時刻。 */}
                  <RefundLedgerSection
                    rows={refunds}
                    unregisteredAmount={refundUnregisteredAmount}
                    unregisteredFailed={refundUnregisteredFailed}
                    rowsTruncated={refundsTruncated}
                    loadFailed={refundsFailed}
                    nowMs={Date.now()}
                  />

                  {/* M-4b E10 D3:非卡退款登記列表(唯讀、不吃旗標,同上一塊的立場)。
                      並列於 RefundLedgerSection、不合併型別,理由見該元件檔頭。 */}
                  <ManualRefundLedgerSection
                    rows={manualRefunds}
                    orderId={detail.id}
                    returnTo={returnTo}
                    rowsTruncated={manualRefundsTruncated}
                    loadFailed={manualRefundsFailed}
                  />

                  {/* M-3 RW2d:退款入口(危險操作沉底)。旗標 && 顯示層狀態閘 && tappay 管道才渲染;
                      token 同備註片慣例 = server component 渲染期產(頁層 force-dynamic、零快取層)。
                      channel 閘(R1 N5)=顯示層:轉帳/現金單不該看到「線上退款(TapPay)」紅框;
                      已知代價 = 若歷史資料 channel 記錯而 rec_trade_id 其實存在,入口會隱藏(fail-closed,
                      修資料即恢復)—— 真權威仍是 action 步 ④ 的 rec_trade_id 檢查與 RPC。
                      🔴 帳本健康閘(codex MF2 + R2/opus R2b 負值補格):帳本列或未登記額讀不到、
                      或未登記額為**負**(帳本登記已超過訂單總額=對帳異常,區塊明寫「勿再發起」)
                      ⇒ 入口 fail-closed —— 同一頁「文字叫你別按、按鈕還亮著」就是自打嘴巴。
                      負值下錢仍安全(S5 single-flight 擋下一發),關的是矛盾畫面。
                      🔴 **片12 沒有動這道閘**:它照舊決定「渲不渲染」,片12 只決定「渲出來的東西收在哪」。 */}
                  {shouldShowRefundEntry({
                    refundEnabled,
                    refundsFailed,
                    refundUnregisteredFailed,
                    refundUnregisteredAmount,
                    refundsTruncated,
                    hasStuckRefundVerdict,
                    paymentChannel: detail.paymentChannel,
                    paymentStatus: detail.paymentStatus,
                  }) && (
                      <RefundSection
                        orderId={detail.id}
                        returnTo={returnTo}
                        serverToken={generateRefundRequestToken()}
                      />
                    )}

                  {/* 🔴 2026-08-22(線 A `-86` 扮員工走一天時撞到):旗標關著時,這一整塊會渲染成
                      **一個只有「退款」兩個字、底下一片空白的盒子** —— 而**同一張畫面上的取消區
                      正在叫他來這裡**(逐字「請到本頁最下方的「退款」裡處理;錢退完之後這張單才能取消」)
                      ⇒ 員工照著做,到了這裡什麼都沒有,而**沒有任何東西告訴他為什麼**。
                      📌 這正是本檔 :528-534 那段已經寫過的病,只是那段治的是「對帳異常」那一種:
                         逐字「退款入口消失了他也**不知道為什麼** ⇒ 那是把一個 fail-closed 的安全設計,
                         **退化成一個沉默的安全設計**」。⇒ 同一個判準,補上旗標關著的那一種。
                      🔴 **文案刻意不寫「你不能退款」** —— 那不是真的(換一個有開旗標的環境就能退),
                         寫的是**這個環境沒開放**,並指出下一步找誰。
                      ⚠️ 只補顯示;**旗標本身、`shouldShowRefundEntry`、server 端 `refund-actions.ts:124`
                         的閘一個字都沒動** ⇒ fail-closed 的立場完全不變,變的只是它會不會講話。
                      🔴 **這句話裡不可以出現「退款紀錄」四個字** —— 我第一版寫「上面的退款紀錄照常顯示」,
                         被 `refund-wiring.test.tsx:411` 那條既有守門當場擋下(它斷言零帳本列時整頁不得
                         出現「退款紀錄」)。而**那條守門擋對了**:零帳本列的時候上面**根本沒有**退款紀錄,
                         我那句是一個沒查過就寫下的宣稱。⇒ 加字前先想:**這句話在【每一種】會顯示它的
                         情況下都成立嗎?** */}
                  {!refundEnabled && (
                    <p
                      role='status'
                      className='rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-700'
                    >
                      這個環境沒有開放「線上退款(TapPay)」的操作入口 ——
                      這是系統設定,不是這張單的問題。要退這張單的款,
                      請通知系統維護開放之後再操作。
                    </p>
                  )}

                  {/* M-4b E10 D3:非卡退款登記入口。與上面的 TapPay 入口互斥並列——gating 用
                      order_payments.rail(非 paymentChannel),理由見 manual-refund-entry-gate.ts 檔頭。 */}
                  {shouldShowManualRefundEntry({
                    payments,
                    refundUnregisteredFailed,
                    refundUnregisteredAmount,
                  }) && (
                      <ManualRefundEntrySection
                        orderId={detail.id}
                        returnTo={returnTo}
                        serverToken={generateManualRefundRequestToken()}
                      />
                    )}
                </DangerZoneDetails>

                {/* A13b D6-a:取消區塊(複核 + 兩支表單)。判斷全部收在該檔內,見鐵則 6 的抽檔理由。
                    🔴 `anchorId='cancel'` 是**承重的**:列表那兩條 `#cancel` 深連結的目的地
                       (`id='cancel'`)住在這一塊裡面 ⇒ 收起來就等於連過去看到空白。
                       為什麼不能只靠瀏覽器自動展開,量測與射程見 `danger-zone-details.tsx` 檔頭。 */}
                {/* 🔴🔴 `key={detail.id}` 是**承重的**(codex K2 2026-08-19 finding 2):
                    面板已經開著、員工再點**另一張單**的 `#cancel` 連結時,那是 Next 的 client-side 導航
                    ⇒ 網址換了但**不一定發出 `hashchange`**,而 `anchorId` 一直是 `'cancel'` 沒變
                    ⇒ effect 不會重跑 ⇒ **連過去是收起來的**。
                    換單就換 key ⇒ 強制重新掛載 ⇒ effect 一定重跑一次讀 hash。 */}
                <DangerZoneDetails
                  key={detail.id}
                  anchorId='cancel'
                  className='group bg-card text-card-foreground rounded-lg border p-4'
                  summary={
                    <span className='flex flex-wrap items-center gap-2'>
                      {/* 🔴 A2(2026-08-21 Sean 拍板乙=最小13px):10px → 13px。 */}
                      <span className='text-muted-foreground text-[13px] transition-transform group-open:rotate-90'>
                        ▶
                      </span>
                      <h2 className='text-destructive text-xs font-bold tracking-[1.5px]'>
                        申請取消整張單
                      </h2>
                    </span>
                  }
                >
                  {/* 🔴 片 B:`payments` 是「現金/匯款可取消、刷卡不行」的唯一輸入 ——
                      必填無預設,忘了傳會編不過(理由見 cancel-view.ts 的 payments 欄)。 */}
                  <OrderCancelBlock
                    detail={detail}
                    payments={payments}
                    returnTo={returnTo}
                    formsAllowed={cancelFormsAllowed}
                  />
                </DangerZoneDetails>
              </div>
            </>
  );
}
