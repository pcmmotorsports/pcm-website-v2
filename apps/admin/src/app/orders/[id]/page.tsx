import { isUuid } from '../../../lib/orders/note-action-state';
import { OrderDetailRoute } from '../../../components/orders/order-detail-route';

// 相對 import(非 `@/`):root vitest.config 的 `@` alias 指向 storefront ⇒ 用 `@/` 的話這一頁
// **完全沒辦法被單測載入**(A10b 關卡2 codex MF10 要求補頁層接線測試時當場踩到)。
// 同 `lib/session/actor.ts:2` 的既有慣例。
//
// M-4a Slice B:後台訂單明細頁(server component、唯讀)。
// 🔴 PII:客人姓名/電話/email+收件快照只在本頁(明細專用白名單、service_role、登入閘後);列表不帶。
//
// 🔴 **#350c 之後本檔是薄殼**:載入與組裝全在 `components/orders/order-detail-route.tsx`,
//    因為右側面板(`app/@panel/orders/page.tsx`)要跑**完全相同**的那一段(含退款入口的
//    fail-closed 判斷)。本檔只負責:route 參數解析、segment config、整頁版的外框與返回連結。
export const dynamic = 'force-dynamic';

// 🔴 M-3 RW2b:退款 server action(RW2c)由本頁的表單送出 ⇒ 那個 POST 走的是**本 route segment**
//    的函式時限,不是 action 檔自己的。顯式釘死、不吃平台預設:
//    · adapter 的 refund fetch 有 30s 硬逾時(`REFUND_DEFAULT_TIMEOUT_MS`,
//      `packages/adapters/src/tappay/TapPayChargeAdapter.ts:63`),平台時限一旦低於它,
//      每一次慢回應都會被砍在 fetch 中途 = 錢可能已動、帳本停在 processing
//      (plan v3.2 §3 表:throw 其他 → 不 finalize、留 processing;「不得自動重發」的字面在
//      `packages/ports/src/ITapPayAdapter.ts:116`)—— 那是最貴的一種失敗。
//    · 預算 = 授權 + server 重讀訂單 + G0 baseline Record 查詢 + initiate RPC + **30s 退款** +
//      finalize RPC(plan v3.2 §1 RW2c 的動作序列)。plan 只要求「≥45s」;取 **60** 是因為 45 扣掉
//      30s 退款後只剩十幾秒給其餘五步,而 60 在本 repo 已有實際部署過的前例
//      (`apps/storefront/src/app/api/cron/email-sweep/route.ts:47`)。代價誠實說:多出來的時限只有在
//      「真的跑很久」時才會被用掉並計費 —— 而那正是我們要它撐住的那一次。
//    ⚠️ **契約債(RW2c 必還)**:`recordQuery` 預設**無**逾時(`packages/ports/src/ITapPayAdapter.ts:97-100`)
//      ⇒ action 呼叫它時必須自帶 `AbortSignal.timeout(≤10s)`。要講精確:Record **無限 hang** 時會被砍在
//      Record 上(那反而安全 —— 錢沒動、帳本沒列);真正危險的是 Record **慢但有回應**,把餘額吃到
//      不足 30s,退款才送出就被砍 —— 那一刀落在 fetch 中途,正是本行想擋的結局。
//    ⚠️ RW2c/RW2d 若把退款入口移到別的 route(獨立 route handler / 別的頁),那條 route 也要帶
//      同一個 maxDuration;本行只保護本 segment(釘死它的斷言在
//      `apps/admin/src/lib/payment/composition-tappay-wiring.test.ts` 最後一格)。
//    🔴 **#350c 已經發生一次那個「移到別的 route」**:面板版的退款表單掛在 `/orders?panel=<id>`
//      ⇒ `app/orders/page.tsx` 與 `app/@panel/orders/page.tsx` 都補了同一個 60,
//      三處由 `order-panel-wiring.test.ts` 釘在一起。
export const maxDuration = 60;

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const rawSearch = await searchParams;
  const resultCode = typeof rawSearch.r === 'string' ? rawSearch.r : undefined;
  // A10a-3:更正模式目標(uuid 形狀閘;非 uuid 視同沒帶,不透傳)
  const correctNoteId =
    typeof rawSearch.correct === 'string' && isUuid(rawSearch.correct)
      ? rawSearch.correct
      : null;

  // 🔴 **`await` 它、不要當成 JSX 子元素塞進去**:`OrderDetailRoute` 是 async server component,
  //    寫成 `<OrderDetailRoute />` 的話,`await OrderDetailPage(...)` 拿到的樹裡它還沒解析
  //    ⇒ 既有的頁層接線測試(procurement / refund / nine-code 三支、12 格)會 render 出**空字串**
  //    而且**不會報錯** —— 2026-08-10 實測踩過一次。
  //    ⚠️ **誠實代價**(codex 關卡2 2026-08-10 nit):當成函式呼叫等於**消掉一層元件邊界** ——
  //    失去巢狀 Suspense、失去獨立的錯誤隔離與 streaming(快取不受影響)。本片沒有 Suspense 邊界
  //    要切,所以現在不痛;但**日後要在 `OrderDetailRoute` 裡加 hook 或 Suspense 就得先改回元件寫法**,
  //    而那會同時弄紅那 12 格既有測試 —— 兩件事要一起做。
  const body = await OrderDetailRoute({
    id,
    resultCode,
    correctNoteId,
    back: { href: '/orders', label: '← 返回訂單列表' },
    missing: 'not-found',
  });

  // #350c:`@container` 是 `order-detail.tsx:275` 容器斷點的參照對象,漏了會退回單欄。
  return <div className='@container mx-auto max-w-6xl space-y-4'>{body}</div>;
}
