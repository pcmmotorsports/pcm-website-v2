import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { AdminOrderDetail } from '@pcm/domain';
import type { SupplierOption } from '../../lib/orders/procurement-suppliers';
import { getAdminOrderRepository } from '../../lib/orders/order-repository';
import { isOrderId } from '../../lib/orders/order-detail-view';
import { isRefundUiEnabled } from '../../lib/payment/refund-ui-flag';
import { isUuid } from '../../lib/orders/note-action-state';
import {
  getLedgerUnregisteredAmount,
  listOrderRefunds,
  type OrderRefundRow,
} from '../../lib/payment/refund-read';
import { listOrderPayments } from '../../lib/orders/payment-repository';
import { listSuppliers } from '../../lib/supplier';
import { OrderDetail } from './order-detail';
import type { PaymentListData } from './payment-list';
import { ResultBanner } from './result-banner';
import { getSessionActor } from '../../lib/session/actor';
import {
  CancelResultPanel,
  cancelFormsAllowedOnResultPage,
} from './cancel-result-panel';

// order-detail-route.tsx — #350c:訂單明細的**載入 + 組裝**,兩個消費者共用。
//
// 🔴 為什麼抽出來:面板版(`app/@panel/orders/page.tsx`)與整頁版(`app/orders/[id]/page.tsx`)
//    要跑**完全相同**的四路 `Promise.allSettled`(#15-B2-c 片1a 起:明細 / 供應商 / 退款帳本 /
//    **收款明細**,見 `:117-124`)與四組容錯旗標,外加收款那一路的**三態 union**
//    (`:161-166`,刻意不用旗標的理由寫在那)。複製一份 = 兩邊會慢慢分岔,
//    而分岔的其中一條是**退款入口的 fail-closed 判斷**(帳本讀不到就不准按退款)——
//    那不是可以有兩個版本的東西。
//
// 🔴 本檔**沒有 `'use client'`**:它與 `OrderDetail` 一樣是 server component
//    (PII 白名單投影 + server action 全部留在 server,鐵則 12 ②)。
//
// 🔴 `missing` 是兩個消費者**唯一**的行為差異(主視窗 2026-08-10 裁⑤「notFound 面板自理」):
//    整頁版查無 → `notFound()`(整頁 404,既有行為);
//    面板版查無 → **面板內一句話**,不得 `notFound()` —— 在平行路由槽裡呼叫它會把
//    **整個頁面**打成 root 404,員工手上的列表會整片消失,只因為某張單被刪了。

/** 讀取失敗(非查無)的共用文案 —— 兩個消費者都用這一份,不各寫一句。 */
const LOAD_FAILED_TEXT = '訂單明細載入失敗,請稍後再試或聯絡系統維護。';

export async function OrderDetailRoute({
  id,
  resultCode,
  requestToken,
  correctNoteId,
  back,
  returnTo,
  missing,
  buildCustomerHref,
}: {
  id: string;
  /**
   * URL 的 `?r=`,**原封轉入**。
   * 🔴🔴 **不要在呼叫端先 narrow**(A13b D6-a 實測踩過):頁層若先寫
   *    `typeof x === 'string' ? x : undefined`,重複鍵(`?r=a&r=b`)就會變成 `undefined`
   *    ⇒ `cancelFormsAllowedOnResultPage` 收到「沒有結果碼」⇒ **把取消表單放行**。
   *    面板那側因為自己也 narrow 所以不顯示 ⇒ 症狀是「**面板不出現、表單卻開著**」= fail-open。
   *    ⇒ 原始值一路帶到閘門前,narrow 只在**真的需要字串的那一個消費點**(banner)做。
   */
  resultCode: string | string[] | undefined;
  /**
   * A13b D6-a:URL 的 `?rt=`(**原封轉入,呼叫端不要先 narrow**)。
   * 🔴 重複鍵(`string[]`)的 fail-closed 決定收攏在 D3 的 classifier,不在頁層。
   */
  requestToken?: string | string[] | null;
  correctNoteId: string | null;
  /** 返回連結:整頁版 = 回列表;面板版 = 關閉面板(同一份列表 href、不帶 `panel`)。 */
  back: { href: string; label: string };
  /**
   * OD 片 3b:給定客人 id → 「客人明細」入口的連結。**不傳 = 不顯示入口。**
   *
   * 🔴 收 **builder 而不是現成字串**:本層才知道 `detail.customerUserId`(它在投影裡),
   *    而**連去哪**只有呼叫端知道(面板版換 param、整頁版換路徑)。
   *    傳現成字串的話,呼叫端得先自己拿到客人 id —— 那要嘛多一次查詢,要嘛把 id 從別處抄一份。
   * 🔴 **fail-closed 的決定點不在這裡**:`customerUserId` 為 `null`(投影退版)時本層直接不呼叫
   *    builder、傳 `null` 下去 ⇒ 入口不渲染。拼網址的收斂點見
   *    `lib/orders/order-detail-view.ts` 的 `customerDetailHref()`。
   */
  buildCustomerHref?: (customerId: string) => string | null;
  /**
   * #350d C1:**這個視圖自己的網址** —— 表單裡的 `return_to` hidden 欄位吃它,
   * server action 動作做完就導回這裡(整頁版 = `/orders/{id}`;面板版 = 帶 `panel` 的列表網址)。
   *
   * 🔴🔴 **不是 `back.href`**(契約 §4/§6-2 的字面錯誤,`D-420-NOTE` §1 實查更正):
   *    `back.href` 面板版是**關閉**連結、整頁版是回列表 ⇒ 拿它當 `return_to` 會讓動作做完
   *    面板被關掉 / 整頁版的人被踢回列表(後者是回歸)。兩者長得很像,差別只在有沒有 `panel`,
   *    所以這裡刻意收兩個 prop 而不是從 `back` 推 —— 推錯不會編譯紅,只會在畫面上默默發生。
   * ⚠️ 值不信任:action 端一律再過 `parseOrderReturnTo`(站內白名單 + 剝一次性參數)。
   */
  returnTo: string;
  missing: 'not-found' | 'inline';
  // 🔴 **`showResultBanner` prop 已於 #350d 刪除**(code-reviewer R1 must-fix 1):
  //    C2 把 `r` 的擁有權翻給面板之後,兩個消費者都要畫 ⇒ 這個 prop 零呼叫端。
  //    「誰不畫」的決定搬到**列表**那一側(`app/orders/page.tsx` 的 `!panelOpen &&`),
  //    因為只有列表有辦法知道面板開著。留一個沒人傳的 prop = 下一個人以為還有這個旋鈕。
}) {
  // 🔴 只有 banner 需要字串;閘門吃原始值(見 `resultCode` 的 docstring)。
  //    算在最前面是因為**每一條 return 路徑都要畫得出它**(#350d nit-6:少畫一條 = 零橫幅)。
  const bannerCode = typeof resultCode === 'string' ? resultCode : undefined;

  // id 形狀守門:非 UUID 不打 DB(路由參數不透傳查詢)。
  if (!isOrderId(id)) {
    if (missing === 'not-found') notFound();
    return <PanelMessage text='找不到這張訂單。' back={back} bannerCode={bannerCode} />;
  }

  // 🔴 防禦:讀取失敗 → 錯誤態 200(不 500、DB error 不外洩);查無 → 依 `missing` 分流。
  // A10b:供應商選單與明細**各自容錯** —— 供應商壞掉不該讓整頁看不了,但也**不得靜默**:
  // 空選單會讓員工以為「這家不存在」而去建重複的供應商,而供應商不可刪除(`lib/supplier.ts:22-26`)。
  let detail: AdminOrderDetail | null = null;
  let suppliers: SupplierOption[] = [];
  let suppliersFailed = false;
  let loadFailed = false;
  // M-3 RW3:退款帳本(獨立容錯,不靜默 —— 藏掉 processing 滯留列比整頁掛掉更糟)。
  // 🔴 兩種讀取健康各自成旗標(codex MF2):任一失敗 ⇒ 退款發起入口 fail-closed
  //    (order-detail 掛載閘),不只顯示警告 —— 看不見帳本現況時放人按退款=盲飛。
  let refunds: OrderRefundRow[] = [];
  let refundsFailed = false;
  let refundsTruncated = false;
  let refundUnregisteredAmount: number | null = null;
  let refundUnregisteredFailed = false;
  // 🔴 A13b D6-a:取消面板要拿它比對「這筆是不是你送的」。
  //    ⚠️ **不是授權邊界**(`session/actor.ts:6-7` 自陳:cookie 承載、使用者自選、未驗證)——
  //    只做顯示層比對;`null`(尚未選人)時 D3 會 fail-closed 走 `match_other_actor`。
  const actor = await getSessionActor();
  const [detailSettled, suppliersSettled, refundsSettled, paymentsSettled, unregisteredSettled] =
    await Promise.allSettled([
      (async () => getAdminOrderRepository().findAdminOrderDetail(id))(),
      (async () => listSuppliers())(),
      (async () => listOrderRefunds(id))(),
      // #15-B2-c 片1a:收款明細(獨立容錯 —— 讀不到**不是**「沒收過款」,見下方折三態)。
      (async () => listOrderPayments(id))(),
      // 🔴 #445a-3:帳本未登記額**併進這一批平行查**,不放在下面串著等。
      //    它不依賴 `refunds`(445a-3 之後是無條件查)⇒ 沒有理由多一趟往返。
      //    ⚠️ 第一版我寫在 `refundsSettled` 的 fulfilled 區塊裡 `await` ——
      //    那是**串行**的第二趟,而且位置在 `detail === null → notFound()` 之前
      //    ⇒ **連「找不到訂單」的 404 頁都要先等這支 RPC**。關卡2 codex 抓到。
      (async () => getLedgerUnregisteredAmount(id))(),
    ]);
  if (detailSettled.status === 'fulfilled') {
    detail = detailSettled.value;
  } else {
    console.error('[admin/order-detail] 訂單明細載入失敗', detailSettled.reason);
    loadFailed = true;
  }
  if (suppliersSettled.status === 'fulfilled') {
    suppliers = suppliersSettled.value;
  } else {
    console.error('[admin/order-detail] 供應商清單載入失敗(採購選單只剩既有供應商)', suppliersSettled.reason);
    suppliersFailed = true;
  }
  if (refundsSettled.status === 'fulfilled') {
    refunds = refundsSettled.value.rows;
    refundsTruncated = refundsSettled.value.truncated;
  } else {
    console.error('[admin/order-detail] 退款帳本載入失敗(區塊顯示警告、入口 fail-closed)', refundsSettled.reason);
    refundsFailed = true;
  }
  // 🔴 #445a-3:帳本未登記額改成**無條件查**(原本只在 `refunds.length > 0` 才查)。
  // ⚠️ **本片只鋪管線,不負責把那個數字顯示出來** —— 零帳本列時
  //    `RefundLedgerSection` 仍然整區不渲染(plan §6-33 明文要求「不因刪短路多冒空區塊」),
  //    **顯示是 445c 的工作**(開退款面板時顯示可受理上限)。
  //    🔴 我第一版註解寫成「省掉的那趟正是員工最需要金額參考的時候」——
  //    那句把**本片的收益**講成已經兌現,實際上零列訂單今天看到的仍是空的。
  //    code-reviewer 與 codex 各自獨立抓到同一句。**照 plan 排序上,但字面不准灌水。**
  //    ⇒ 本片此刻的淨效果 = 零列訂單多一趟(已併平行、零額外往返)+ 一條新的
  //    fail-closed 失敗路徑;收益要等 445c。主視窗 2026-08-14 裁「照 plan 排序、不綁 445c」,
  //    理由 = 後台尚未啟用、只有 Sean 在測(memory `project_admin-preprod-planning-posture`)
  //    ⇒ 那條失敗路徑的代價落在他自己身上,而綁著等會讓 diff 長大、關卡 2 難審。
  // ⚠️ **這不是零行為變化**:每一張訂單的退款入口自此新增一條對
  //    `pcm_order_refundable_remaining` 可用性的 **fail-closed 依賴**
  //    (`refund-entry-gate.ts` 的 `!refundUnregisteredFailed`)——
  //    以前零列時根本不呼叫、不可能失敗;現在會。**不得宣稱「零變化」。**
  if (unregisteredSettled.status === 'fulfilled') {
    refundUnregisteredAmount = unregisteredSettled.value;
  } else {
    // 🔴 失敗≠查無(codex MF2):壓成 null 會顯示成普通「查無」被照著操作。
    console.error(
      '[admin/order-detail] 帳本未登記額查詢失敗(顯錯誤態+入口 fail-closed)',
      unregisteredSettled.reason,
    );
    refundUnregisteredFailed = true;
  }

  // 🔴🔴 #15-B2-c 片1a:**三態不可收斂成兩態**(`payment-repository.ts:93-96` 逐字)——
  //    `[]` = 訂單在、還沒收過款;`null` = **訂單不存在**;`throw` = **沒讀到**。
  //    把 `throw` 或 `null` 畫成「尚未登錄任何收款」= 員工照著再登一次 ⇒ **重複入帳**。
  //    ⚠️ 這裡刻意**不用**上面那三段的 `let + 旗標` 形狀:旗標形狀要兩個變數才表達得完
  //    (`failed` 與 `notFound`),而兩個布林能組出第四種不存在的狀態。一個 union 收斂成三態,
  //    多出來的組合在型別上就不存在。
  const payments: PaymentListData =
    paymentsSettled.status === 'rejected'
      ? { status: 'unreadable' }
      : paymentsSettled.value === null
        ? { status: 'order_not_found' }
        : { status: 'ok', rows: paymentsSettled.value };
  if (paymentsSettled.status === 'rejected') {
    console.error('[admin/order-detail] 收款明細載入失敗(顯錯誤態≠查無)', paymentsSettled.reason);
  }

  if (!loadFailed && detail === null) {
    if (missing === 'not-found') notFound();
    return (
      <PanelMessage text='找不到這張訂單(可能已被刪除)。' back={back} bannerCode={bannerCode} />
    );
  }

  return (
    <>
      <BackLink back={back} />

      {/* 🔴 #350d C2:兩個消費者都畫 —— 「面板開著時列表停畫」的決定在
          `app/orders/page.tsx`(只有列表知道面板開著)。這裡不再有旋鈕。 */}
      <ResultBanner code={bannerCode} />

      {/* 🔴 `cancellationsTruncated` 缺值折成 `true` 不是 `false`(R1 must-fix):
          折成 false ⇒ classifier 落 `miss_complete` ⇒ 面板說「仍然沒有,才重新送一次」
          = 全片唯一會讓員工按第二次的那句;折成 true 只會多說一句「無法斷定」,方向安全。
          ⚠️ `detail` 為 null 時 `cancellations` 已先觸發 `unreadable`,這行不影響那條路。 */}
      {/* 🔴🔴 A13b D6-a:取消結果面板掛在**資格閘之外**(plan D6-a 逐字)——
          RPC 關單成功之後 `canCancel` 會變 false,若把面板掛在資格閘內,
          **最需要看到「寫進去了沒有」的那一刻反而什麼都不顯示**。
          🔴 它也在 `loadFailed` 分支之外:明細**讀取失敗(repo throw)**時仍說得出「你剛才那筆怎麼了」。
          ⚠️ **但「查無」那條走不到這裡**(R1 must-fix 更正原本說滿的字面):`missing === 'not-found'`
          時上面已經 `notFound()` return ⇒ 員工帶著 `?r=&rt=` 開一張被刪掉的單,看到的是整頁 404。
          那是既有的路由行為,本片不改;寫下來免得下一個人以為面板涵蓋所有失敗路徑。 */}
      <CancelResultPanel
        resultCode={resultCode}
        requestToken={requestToken}
        actor={actor?.id ?? null}
        cancellations={detail?.cancellations ?? null}
        cancellationsTruncated={detail?.cancellationsTruncated ?? true}
      />

      {loadFailed || detail === null ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          {LOAD_FAILED_TEXT}
        </div>
      ) : (
        <OrderDetail
          detail={detail}
          returnTo={returnTo}
          correctNoteId={correctNoteId}
          suppliers={suppliers}
          suppliersFailed={suppliersFailed}
          refundEnabled={isRefundUiEnabled()}
          refunds={refunds}
          refundsFailed={refundsFailed}
          refundsTruncated={refundsTruncated}
          refundUnregisteredAmount={refundUnregisteredAmount}
          refundUnregisteredFailed={refundUnregisteredFailed}
          cancelFormsAllowed={cancelFormsAllowedOnResultPage(resultCode)}
          customerHref={
            // 🔴 **形狀閘、不是只有 falsy**:型別是 `string | null`,但實際可能是
            //    `undefined`(手寫 detail 物件缺這一欄)、空字串、或**任何非 UUID 字串**。
            //    第一版寫 `=== null` 漏掉 undefined;第二版改 falsy **仍漏掉第四類**
            //    ——`'null'`、空白字串、亂碼都會產生一個點下去沒反應(面板版)或 404(整頁版)的入口
            //    (codex 關卡2 important:**我的「fail-closed」宣稱當時沒有涵蓋那一類**)。
            //    ⇒ 改用與槽頁同一支 `isUuid`,讓**宣稱與實作一致**:進不了閘就不渲染入口。
            //    ⚠️ 這不是在擋洩漏(DB 端是 uuid 欄、值本來就合法),是讓壞形狀**當場不出現**
            //    而不是變成一條壞連結。
            buildCustomerHref === undefined ||
            typeof detail.customerUserId !== 'string' ||
            !isUuid(detail.customerUserId)
              ? null
              : buildCustomerHref(detail.customerUserId)
          }
          payments={payments}
        />
      )}
    </>
  );
}

function BackLink({ back }: { back: { href: string; label: string } }) {
  return (
    <Link
      href={back.href}
      className='text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm'
    >
      {back.label}
    </Link>
  );
}

/**
 * 面板版的「這張單看不到」訊息。
 *
 * 🔴 **橫幅也要畫在這裡**(#350d code-reviewer R1 nit-6):C2 之後列表在面板開著時會停畫,
 *    而這條路徑原本在畫橫幅**之前**就 return ⇒ `?panel=<合法 uuid 但查無>&r=saved` 會變成
 *    **零橫幅**:動作做完了、單同時被別人刪掉,員工兩邊都看不到「存好了沒有」。
 *    到得了這裡的方式不只「單被刪」——書籤與上一頁都算。
 */
function PanelMessage({
  text,
  back,
  bannerCode,
}: {
  text: string;
  back: { href: string; label: string };
  bannerCode?: string;
}) {
  return (
    <>
      <BackLink back={back} />
      <ResultBanner code={bannerCode} />
      <div className='text-muted-foreground rounded-lg border p-6 text-sm'>{text}</div>
    </>
  );
}
