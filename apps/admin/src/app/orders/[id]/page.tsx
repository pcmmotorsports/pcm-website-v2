import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { AdminOrderDetail, OrderStatusOption } from '@pcm/domain';
import type { SupplierOption } from '../../../lib/orders/procurement-suppliers';
import {
  getAdminOrderRepository,
  getAdminOrderStatusOptionsRepository,
} from '../../../lib/orders/order-repository';
import { isOrderId } from '../../../lib/orders/order-detail-view';
import { isUuid } from '../../../lib/orders/note-action-state';
import { listSuppliers } from '../../../lib/supplier';
import { OrderDetail } from '../../../components/orders/order-detail';
import { ResultBanner } from '../../../components/orders/result-banner';

// 相對 import(非 `@/`):root vitest.config 的 `@` alias 指向 storefront ⇒ 用 `@/` 的話這一頁
// **完全沒辦法被單測載入**(A10b 關卡2 codex MF10 要求補頁層接線測試時當場踩到)。
// 同 `lib/session/actor.ts:2` 的既有慣例。
//
// M-4a Slice B:後台訂單明細頁(server component、唯讀)。
// 🔴 PII:客人姓名/電話/email+收件快照只在本頁(明細專用白名單、service_role、登入閘後);列表不帶。
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
  // id 形狀守門:非 UUID 直接 404、不打 DB(路由參數不透傳查詢)。
  if (!isOrderId(id)) {
    notFound();
  }

  // 🔴 防禦:讀取失敗 → 錯誤態 200(不 500、DB error 不外洩);查無 → 404。
  // 明細與狀態詞彙分開容錯(詞彙壞 → badge 降級中性灰,明細仍可看;同列表頁慣例)。
  // A10b:供應商選單(S3a)與明細、狀態詞彙三者**各自容錯** —— 供應商壞掉不該讓整頁看不了,
  // 但也**不得靜默**:空選單會讓員工以為「這家不存在」而去建重複的供應商,而供應商不可刪除
  // (`lib/supplier.ts:22-26` 逐字)⇒ 傳 `suppliersFailed` 下去顯示。
  let detail: AdminOrderDetail | null = null;
  let statusOptions: OrderStatusOption[] = [];
  let suppliers: SupplierOption[] = [];
  let suppliersFailed = false;
  let loadFailed = false;
  const [detailSettled, optionsSettled, suppliersSettled] = await Promise.allSettled([
    (async () => getAdminOrderRepository().findAdminOrderDetail(id))(),
    (async () => getAdminOrderStatusOptionsRepository().listOrderStatusOptions())(),
    (async () => listSuppliers())(),
  ]);
  if (detailSettled.status === 'fulfilled') {
    detail = detailSettled.value;
  } else {
    console.error('[admin/orders/:id] 訂單明細載入失敗', detailSettled.reason);
    loadFailed = true;
  }
  if (optionsSettled.status === 'fulfilled') {
    statusOptions = optionsSettled.value;
  } else {
    console.error('[admin/orders/:id] 訂單狀態詞彙載入失敗(badge 降級中性灰)', optionsSettled.reason);
  }
  if (suppliersSettled.status === 'fulfilled') {
    suppliers = suppliersSettled.value;
  } else {
    console.error('[admin/orders/:id] 供應商清單載入失敗(採購選單只剩既有供應商)', suppliersSettled.reason);
    suppliersFailed = true;
  }

  if (!loadFailed && detail === null) {
    notFound();
  }

  return (
    <div className='mx-auto max-w-6xl space-y-4'>
      <Link
        href='/orders'
        className='text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm'
      >
        ← 返回訂單列表
      </Link>

      <ResultBanner code={resultCode} />

      {loadFailed || detail === null ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          訂單明細載入失敗,請稍後再試或聯絡系統維護。
        </div>
      ) : (
        <OrderDetail
          detail={detail}
          statusOptions={statusOptions}
          correctNoteId={correctNoteId}
          suppliers={suppliers}
          suppliersFailed={suppliersFailed}
        />
      )}
    </div>
  );
}
