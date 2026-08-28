import { ResultBanner } from '@/components/orders/result-banner';
import { ManualOrderFormBody } from '@/components/orders/manual-order-form-body';
import { MANUAL_ORDER_REQUEST_ID_PARAM } from '@/lib/orders/manual-order-action-state';
import { newManualRequestId } from '@/lib/orders/manual-order-form';
import { isUuid } from '@/lib/orders/note-action-state';
import { listStaffRows } from '@/lib/staff-repository';

// manual-order-view.tsx — 手動建單畫面的**唯一內容來源**(2026-08-28 線A)。
//
// 🔴🔴 **為什麼把它從 `app/orders/new/page.tsx` 搬出來**:Sean 2026-08-27 要的是
//    「一樣是側邊欄位、直接跳出一個視窗」⇒ 同一份畫面要同時長在**整頁**與**右側面板**兩個地方。
//    兩邊各自載一次資料 = 兩個真相源,而改一邊的那天**不會有東西紅**
//    (同款理由逐字見 `lib/layout/workspace-panel.ts:73-74`)。
// ⇒ 兩個容器只負責「我是誰、把 searchParams 給它」,內容一律走本檔。
//
// 🔴 **本片沒有改任何欄位、任何驗證、任何導頁規則** —— 逐字搬,只多一個 `inPanel`。
//    (主視窗 2026-08-28 裁定:Q1/Q2 未回之前不動車輛三欄、料號帶入、五塊欄位的擺法。)

export type ManualOrderSearchParams = Record<string, string | string[] | undefined>;

function readOne(raw: ManualOrderSearchParams, key: string): string {
  const v = raw[key];
  return typeof v === 'string' ? v : '';
}

export async function ManualOrderView({
  raw,
  inPanel = false,
}: {
  raw: ManualOrderSearchParams;
  /** 長在右側面板裡(`/orders?panel=new`)⇒ 所有連結與導頁都留在面板裡。 */
  inPanel?: boolean;
}) {
  const resultCode = readOne(raw, 'r') || undefined;
  // 🔴🔴 **2026-08-28:客人不再由本層載** —— 搜尋與建檔都改成就地(不導頁),
  //    所以 `?phone=` / `?customer=` 這兩個參數**整組退場**。
  //    ⇒ 連帶關掉一個板子上的洞:電話不再進網址(⟦b4-PII2⟧)。
  //    ⚠️ 而那一格要**跑證據**才算關,不是因為改了架構就算(逐條驗表 #4)。

  // 🔴 冪等鍵:失敗導回時**沿用 URL 帶回來的那顆**,否則鑄新的。
  //    少了「沿用」這一半,`concurrent` 的文案「再按一次送出」會讓他建出**第二張真訂單**
  //    (理由全文在 `manual-order-action-state.ts` 的 MANUAL_ORDER_REQUEST_ID_PARAM)。
  //    ⚠️ 只認**合法 uuid**:那是任何人都能自己打的字,而 RPC 對非 uuid 一律拒 ——
  //    先在這裡擋掉,員工才不會拿到一個看不懂的資料庫錯誤。
  const carried = readOne(raw, MANUAL_ORDER_REQUEST_ID_PARAM);
  const manualRequestId = isUuid(carried) ? carried : newManualRequestId();
  // 🔴🔴 **「帶著結果碼回來、卻沒有鍵」是一個必須講出來的狀態**(codex R2:光印編號不夠)。
  //    到得了的路:員工手動把網址上的 `mrid` 刪掉 / 改壞 / 從歷史紀錄挑到一個舊網址。
  //    那時頁面會**靜默鑄一顆新的**,而 `error` / `concurrent` 的文案正在叫他「再送一次」
  //    ⇒ 他會拿【新鍵】重送 ⇒ **建出第二張真訂單**。
  //    ⇒ 有結果碼而沒有合法的鍵 ⇒ 出一句警告,並且**明說那句「編號不變」在這一頁不成立**。
  const keyWasLost = resultCode !== undefined && !isUuid(carried);

  // 🔴 兩個讀取各自 try —— **一個掛掉不得讓另一個也不見**:
  //    員工名單掛掉時,表單會走「沒有員工」那條停用態,而那是**假的**(見下面那句)。
  let activeStaff: Array<{ id: string; label: string }> = [];
  let staffLoadFailed = false;
  try {
    activeStaff = (await listStaffRows())
      .filter((s) => s.is_active)
      .map((s) => ({ id: s.id, label: s.label }));
  } catch (error) {
    console.error('[admin/orders/new] 員工名單載入失敗', error);
    staffLoadFailed = true;
  }

  // 🔴 建客人那一步的冪等鍵 —— **與建單那顆是兩顆不同的鍵**,每次 render 各鑄一顆。
  //    同一份畫面連按兩次「建立這位客人」⇒ 同一顆 ⇒ 建不出第二個帳號;
  //    重新載入 ⇒ 換一顆 ⇒ 真的要開第二個帳號時做得到(Sean 08-24「一支電話不設硬上限」)。
  const customerRequestId = newManualRequestId();

  return (
    <div className='mx-auto space-y-4'>
      <div className='space-y-1'>
        <h1 className={inPanel ? 'text-xl font-semibold' : 'text-2xl font-semibold'}>手動建單</h1>
        <p className='text-muted-foreground text-sm'>
          客人用電話或 LINE 下的單,在這裡幫他建。建好之後就跟網站上的單一樣,可以出貨、開發票。
        </p>
      </div>

      <ResultBanner code={resultCode} />

      {/* 🔴 **「載入失敗」與「真的沒有員工」不得印同一個畫面** ——
          後者要他去建員工(做得到),前者要他找人(他建再多員工都沒用)。 */}
      {staffLoadFailed && (
        <div role='status' className='rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive'>
          員工名單現在讀不到,所以先不讓你建單(不是沒有員工)。請重新整理,一直這樣就找人看一下。
        </div>
      )}
      {/* 🔴 **這張表單的編號要看得見**(codex R1 must-fix):
          `error` 那句文案逐字說「編號不變,不會建成兩張」——
          而員工若把網址上的 `mrid` 刪掉再整理,頁面會**靜默鑄一顆新的**,那句話就變成假的。
          把編號印在畫面上 ⇒ **他自己看得出來變了沒有**,不必相信一句他驗不了的話。 */}
      {keyWasLost && (
        <div
          role='status'
          data-testid='manual-order-key-lost'
          className='rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive'
        >
          網址上的表單編號不見了,這一頁已經換成一個新的編號。
          🔴 如果你剛剛送出過,請【先去訂單列表找一下這位客人的新單】——
          直接在這裡再送一次會變成兩張單。
        </div>
      )}

      <p className='text-muted-foreground text-xs' data-testid='manual-order-request-id'>
        這張表單的編號:<code>{manualRequestId}</code>
        (重送同一張單時這串不會變;變了就是換成新的一張了)
      </p>

      <ManualOrderFormBody
        manualRequestId={manualRequestId}
        customerRequestId={customerRequestId}
        activeStaff={staffLoadFailed ? [] : activeStaff}
        staffLoadFailed={staffLoadFailed}
        inPanel={inPanel}
      />
    </div>
  );
}
