import { applyOrderKeywordSearchAction } from '../../lib/orders/keyword-search-action';
import { ORDER_KEYWORD_FIELD, ORDER_KEYWORD_RETURN_TO_FIELD } from '../../lib/orders/order-keyword-cookie';

// open-order-notice.tsx — `?open=<id>` 指到的單【不在這一頁的列表裡】時，表格上方那一句。
//
// 🔴🔴 **P-d(2026-09-13,主視窗裁甲)。它補的是一個真瀏覽器驗出來的【最糟】情況：**
//    同事貼來一張單的網址、而他的篩選剛好把那張單濾掉 ⇒ 舊版**靜靜地什麼都沒有** ——
//    沒有「找不到」、沒有提示，就是一張跟平常一樣的列表。他會以為網址壞了。
//    （根因：展開列綁在「那一列底下」，那一列不存在時展開列也就不存在，沒有任何碼負責這件事。）
//
// 🔴 **兩句話是【兩件事】，不合併**（主視窗逐字）：
//    · 「它不在目前的篩選 / 這一頁裡」= **存在但被藏** ⇒ 藍提示 + 一顆連結
//    · 「找不到這張單」= **不存在**（id 亂打 / 已刪）⇒ 紅提示，沒有連結（沒有地方可去）
//    合併成一句的話，「被藏」會被讀成「壞了」—— 那正是要修的那個誤會。
//
// 🔴 **不自動改他的篩選**（乙案被否決）：「安靜地改掉他的畫面」是 Sean 被咬過的形狀，
//    而「說一句」蓋不掉那件事。⇒ 甲：**選擇權留給他** —— 看到提示、按那顆連結、篩選才變。
//    **變的那一刻是他按的。**
//
// 🔴 那顆「清除篩選並打開」**走既有的 `applyOrderKeywordSearchAction`**（= 篩選區「清除」那顆同一條路），
//    不另開一條：URL 上的六軸靠 `return_to` 不帶它們而清掉，**關鍵字那一軸住在 httpOnly cookie**
//    只有那支 action 清得到（`order-filter-bar.tsx:74-78` 記著這件事）。
//    ⇒ `return_to = /orders?open=<id>` 過得了 `safeListReturnTo` 的白名單（`/orders?` 前綴、latin-1）。
//
// 🔴 字級帶 `leading-[1.4]`:FIX-27 會把沒帶 leading 的 `text-sm` 拉到 16px 而畫面看起來完全正常(A 窗 2026-09-13 量到)。
// 🔴 文案照四條原則（`docs/specs/2026-09-13-mixed-rail-cancel-block-copy.md` §四條）：
//    「狀態 + 行動」兩段、不升三段 —— 它不是在擋一個會造成損害的動作。

export function OpenOrderNotice({
  displayId,
  openOrderId,
  exists,
}: {
  /** 給人看的單號（存在時）；不存在時沒有單號可印 ⇒ 印 id 的前 8 碼讓他對得上網址。 */
  displayId: string | null;
  openOrderId: string;
  exists: boolean;
}) {
  if (!exists) {
    return (
      <div
        role='status'
        data-testid='open-order-missing'
        className='border-destructive/40 bg-destructive/5 text-destructive mb-2 rounded-md border px-3 py-2 text-[13px] leading-[1.4]'
      >
        找不到這張單({openOrderId.slice(0, 8)}…),網址可能貼錯或已經不在了。
      </div>
    );
  }
  return (
    <div
      role='status'
      data-testid='open-order-hidden'
      className='border-primary/40 bg-primary/5 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-[13px] leading-[1.4]'
    >
      <span>
        單號 <b>{displayId}</b> 不在目前的篩選或這一頁裡。
      </span>
      <form action={applyOrderKeywordSearchAction} className='inline'>
        <input type='hidden' name={ORDER_KEYWORD_FIELD} value='' />
        <input type='hidden' name={ORDER_KEYWORD_RETURN_TO_FIELD} value={`/orders?open=${openOrderId}`} />
        <button type='submit' className='text-primary underline underline-offset-2'>
          清除篩選並打開
        </button>
      </form>
    </div>
  );
}
