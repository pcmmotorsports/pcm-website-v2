import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { ResultBanner } from '@/components/orders/result-banner';
import { ManualOrderFormBody } from '@/components/orders/manual-order-form-body';
import {
  findCustomerCandidatesByPhone,
  type ManualCustomerCandidate,
  type ManualCustomerClient,
} from '@/lib/customers/manual-customer';
import { MANUAL_ORDER_REQUEST_ID_PARAM } from '@/lib/orders/manual-order-action-state';
import { newManualRequestId } from '@/lib/orders/manual-order-form';
import { isUuid } from '@/lib/orders/note-action-state';
import { listStaffRows } from '@/lib/staff-repository';

// app/orders/new/page.tsx — M12-A3-b:後台手動建單表單頁(`#858`)。
//
// 🔴 **它同時是 `createManualOrderAction` 的第一個呼叫端。**
//    在它落地之前那支 action 是【零呼叫端】,而那個中間態**沒有任何偵測器**:
//    2026-08-24 實測 —— action 把常數寫在 `'use server'` 檔裡,
//    typecheck / lint / build / 4702 格測試**全綠**;一接上這一頁 ⇒ build 當場紅,逐字
//    `Error: Only async functions are allowed to be exported in a "use server" file.`
//    ⇒ A3-c 要補的那格「action 有呼叫端」守門,守的就是這件事。

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

function readOne(raw: SearchParams, key: string): string {
  const v = raw[key];
  return typeof v === 'string' ? v : '';
}

export default async function ManualOrderNewPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const raw = await searchParams;
  const resultCode = readOne(raw, 'r') || undefined;
  const phoneQuery = readOne(raw, 'phone');
  const chosenCustomerId = readOne(raw, 'customer');

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

  let candidates: ManualCustomerCandidate[] = [];
  let candidatesTruncated = false;
  let customerLookupFailed = false;
  if (phoneQuery !== '') {
    try {
      const res = await findCustomerCandidatesByPhone(
        createSupabaseServiceClient() as unknown as ManualCustomerClient,
        phoneQuery,
      );
      candidates = res.candidates;
      candidatesTruncated = res.truncated;
    } catch (error) {
      console.error('[admin/orders/new] 客人查詢失敗', error);
      customerLookupFailed = true;
    }
  }

  // 🔴 選定的客人必須來自**這次查回來的候選**,不是直接信 URL 上那個 id ——
  //    否則 `?customer=<任意 uuid>` 會讓畫面顯示一個沒被查證過的對象。
  //    (RPC 的 `G3` 仍會再擋一次;這裡擋的是「畫面上說得像真的」。)
  const selectedCustomer =
    chosenCustomerId === '' ? null : (candidates.find((c) => c.userId === chosenCustomerId) ?? null);

  return (
    <div className='mx-auto space-y-4'>
      <div className='space-y-1'>
        <h1 className='text-2xl font-semibold'>手動建單</h1>
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
      {customerLookupFailed && (
        <div role='status' className='rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive'>
          客人查詢現在讀不到(不是查不到這位客人)。請重新整理再找一次。
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
        activeStaff={staffLoadFailed ? [] : activeStaff}
        staffLoadFailed={staffLoadFailed}
        candidates={candidates}
        candidatesTruncated={candidatesTruncated}
        phoneQuery={phoneQuery}
        selectedCustomer={selectedCustomer}
        lookupFailed={customerLookupFailed}
      />
    </div>
  );
}
