import type { AdminOrderCancellationReasonCode, AdminOrderDetail } from '@pcm/domain';
import { formatOrderDateTime } from '../../lib/orders/order-detail-view';
import { CANCEL_REASON_LABEL } from '../../lib/orders/cancel-form';
import {
  buildOrderCancelView,
  type OrderCancelBlockReason,
  type OrderCancelView,
} from '../../lib/orders/cancel-view';

// cancel-review-section.tsx — M-4b E10 **A13a**:取消訂單的**唯讀複核區塊**。
//
// 🔴 **server component、零 `'use client'`**(刻意):本區塊全部是唯讀顯示,
//    「同頁兩段式展開」(Sean Q2=A)用原生 `<details>/<summary>` 做,不需要任何 client JS。
//    ⇒ 順帶避開 D 窗踩過的那個坑:`AdminOrderDetail` 帶金額與會員等級脈絡,
//      整包丟進 client props 會進 RSC payload(純文字)。這裡它從頭到尾留在 server。
//    ⚠️ **本行 2026-08-10 由 D4 更正**:原本寫「A13b 的表單才需要 `'use client'`」——
//      那是 A13b v2 的舊形狀。v3 換路之後表單改成原生 form + server action;
//      **A13b E1 又加回了一層薄的 `'use client'`**(`cancel-form-body.tsx`,漸進增強)——
//      界線是「**送出值不由 client state 產生或回寫**」(不是「state 裡沒有送出值」——
//      `reason_code` 就在 state 裡),而那正是「不會誤送整單取消」的修法本體,
//      不是風格選擇。要引用這段的人**讀 `cancel-form-body.tsx` 檔頭的三條不變式**,別照抄「零 client state」。
//      兩支檔仍刻意不合併(鐵則 6:唯讀複核區塊 vs 表單,職責不同)。
// 🔴 **這條目前只有註解在守,沒有機制**(R1 F15 誠實記載):`import 'server-only'` 是正解,
//    但 `server-only` 不是 `apps/admin` 的直接依賴(實測 vite 解析不到、整支測試檔載入即炸),
//    為一條 nit 加依賴會動到 `package.json`(鐵則 12 ④ 那類)⇒ 不划算。
//    ⇒ **接線的人注意**:本元件收整包 `AdminOrderDetail`(帶金額與 tier 脈絡),
//    只能從 server component 呼叫;若哪天被 `'use client'` 檔 import,那整包會進 RSC payload 且沒有東西會紅。
//
// 🔴 判定不在本檔:`buildOrderCancelView()`(`lib/orders/cancel-view.ts`)是唯一真相,
//    本檔只把它的輸出翻成中文。**不得**在這裡重算任何一條拒因或上限 ——
//    重算一份就會有兩份會漂移的規格(同 `cancel-form.ts:52` 的紀律)。
//
// 🔴 中文字面暫定、待 Sean 肉眼定稿(結構鎖、字不鎖)。

const CARD = 'rounded-lg border bg-card p-4 text-card-foreground';
const CARD_TITLE = 'text-muted-foreground mb-3 text-xs font-medium';

/**
 * 11 條拒因的文案表。
 *
 * 🔴 **型別是守門**(主視窗 `E-005-A` 核可):`Record<OrderCancelBlockReason, …>` 要求逐碼寫滿 ——
 * `cancel-view.ts` 日後新增一個碼而這裡沒補,**編譯期就紅**,不會靜默少一句話。
 * ⚠️ plan `docs/specs/2026-08-05-e10-cancel-ui-wire-plan.md:192` 寫的是「八條拒因」——
 * 那是 **RPC 的八個條件數**,不是 UI 的碼數;本層把幾種「看不到」拆成獨立碼(處置不同),所以是 11 條。
 *
 * `hint` 的紀律(逐條依據見 `cancel-view.ts` 各碼的 docstring):
 * - 只有**狀態可能剛變動**的那幾條才寫「請重新整理」;
 * - 讀不到 / 讀不全那幾條,成因含**投影退版**(重整不會好)⇒ 一律補「若仍相同,請通知系統維護」;
 * - 帳本異常類直接指向系統維護,不叫員工重試。
 */
export const BLOCK_REASON_TEXT: Record<
  OrderCancelBlockReason,
  { title: string; hint: string }
> = {
  already_cancelled: {
    title: '這張單已經取消過了',
    hint: '整單取消只會發生一次。若你要看取消了什麼,見下方「取消紀錄」。',
  },
  payment_expired: {
    title: '這張單因為未付款已自動失效',
    hint: '系統在付款期限內沒有收到款項,自動把它關閉了,不是客服取消的。客人要買請重新下單。',
  },
  payment_not_unpaid: {
    title: '已付款的單這期還不能在這裡取消',
    hint: '已付款的取消要連著退款一起做,退款線之後才開通。現在請走人工退款流程。',
  },
  charge_attempt_blocked: {
    title: '這張單有一筆刷卡還在進行中',
    hint: '等那筆刷卡結束(成功或失敗)才能取消。請重新整理看看最新狀態。',
  },
  charge_attempt_unknown: {
    title: '付款狀態沒有讀完整',
    hint: '看不到全部的刷卡紀錄,不能確定有沒有在進行中的刷卡。請重新整理;若仍相同,請通知系統維護。',
  },
  items_truncated: {
    title: '這張單的品項太多,畫面沒有列完',
    hint: '沒有看到全部品項就不能複核取消範圍。請通知系統維護處理。',
  },
  no_items: {
    title: '這張單沒有任何品項',
    hint: '這是不該出現的狀態,請通知系統維護。',
  },
  quantity_summary_missing: {
    title: '有品項的數量資料異常',
    hint: '這張單有採購或取消紀錄,數量卻對不起來(或採購清單沒讀完整)。請通知系統維護,不要重試。',
  },
  ledger_unhealthy: {
    // 🔴 三種病理共用一碼(`cancel-view.ts` 的 `ledger_unhealthy` docstring),文案不可只描述其中一種
    //    ——員工會照著向維護回報錯的症狀(R1 F5)。
    title: '取消紀錄異常',
    hint: '這張單的取消紀錄本身有問題(數量對不起來、或有一筆紀錄底下沒有品項、或關單資料殘留)。請通知系統維護,不要重試。',
  },
  cancellations_unreadable: {
    title: '取消紀錄沒有讀完整',
    hint: '看不到全部的取消紀錄,不能確定已經取消過多少。請重新整理;若仍相同,請通知系統維護。',
  },
  nothing_cancellable: {
    // 🔴 本碼有已知的假陽性路徑(`cancel-view.ts` 的 `INSTOCK_PROXY` ②:快取到貨非 0 / 真相 0
    //    ⇒ 整張單錯報,而 RPC 其實會放行)⇒ 不可把成因講死、也不可零出路(R1 F4)。
    title: '這張單看起來沒有可以取消的數量',
    hint: '下表每個品項的「還能取消」都是 0。已到貨的部分要走退貨流程;若你確定還有沒到貨的數量,請重新整理,仍相同就通知系統維護。',
  },
};

/**
 * 🔴 **字典搬到 `cancel-form.ts`(A13b D4)** —— 表單下拉與歷程顯示必須是同一組字。
 *    這裡只留一個別名,呼叫點不動。搬家理由見那支常數的 docstring。
 * ⚠️ 型別對齊:`CancelReasonCode`(解析器的七碼)與 `AdminOrderCancellationReasonCode`
 *    (domain 的七碼)是同一組字面值,兩者都由 `20260730130000:131-139` 的 CHECK 當權威。
 */
const REASON_CODE_LABEL: Record<AdminOrderCancellationReasonCode, string> = CANCEL_REASON_LABEL;

/**
 * 這次取消共幾件。
 *
 * 🔴 **不能裸 `reduce`**(R1 F2):`mappers/order-cancellations.ts:88-93` 逐欄直送、
 * **沒有** `Number.isFinite` 守門(`cancel-view.ts` 的 `LEDGER_FROM_TRUTH` ④ 逐字記著這件事)
 * ⇒ `null` 會被加法靜默當 0(少算)、`NaN` 會畫出「共 NaN 件」。
 * 本檔宣稱「不知道不畫成 0」,這一格也要做到 ⇒ 任一列不是有限正數就回 `null`、畫成「無法計算」。
 */
function sumCancelledQuantity(
  rows: readonly { cancelledQuantity: number }[],
): number | null {
  let total = 0;
  for (const row of rows) {
    // 🔴 `isInteger` 不是 `isFinite`(R2 nit):欄位是 int4,`1.5` 會畫出「共 3.5 件」。
    //    真實資料不可達(DB CHECK + integer 欄),但同長度的寫法就選強的那個。
    if (!Number.isInteger(row.cancelledQuantity) || row.cancelledQuantity <= 0) return null;
    total += row.cancelledQuantity;
  }
  return total;
}

function BlockReasons({ reasons }: { reasons: readonly OrderCancelBlockReason[] }) {
  return (
    <ul className='space-y-2'>
      {reasons.map((reason) => {
        const text = BLOCK_REASON_TEXT[reason];
        return (
          <li key={reason} className='border-destructive/30 bg-destructive/5 rounded border p-3'>
            <p className='text-destructive text-sm font-medium'>{text.title}</p>
            <p className='text-muted-foreground mt-1 text-xs'>{text.hint}</p>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 逐品項的影響範圍。
 *
 * 🔴 **已到貨量與尚可取消量分開顯示**(plan §1.2 的 K1-7 更正逐字):
 * 買 5、到貨 2、已取消 0 時**剩下 3 仍可取消** —— 不可把整個品項標成「不可取消」。
 * 已到貨的那部分要指路退貨(第 3 批),那是**部分**不可取消,不是整項。
 */
function ItemRows({
  detail,
  view,
}: {
  detail: AdminOrderDetail;
  view: OrderCancelView;
}) {
  const byId = new Map(view.items.map((item) => [item.orderItemId, item]));
  return (
    <table className='w-full text-sm'>
      <thead>
        <tr className='text-muted-foreground border-b text-left text-xs'>
          <th className='py-2 font-medium'>品項</th>
          <th className='py-2 text-right font-medium'>買了</th>
          <th className='py-2 text-right font-medium'>已到貨</th>
          <th className='py-2 text-right font-medium'>已取消</th>
          <th className='py-2 text-right font-medium'>還能取消</th>
        </tr>
      </thead>
      <tbody>
        {detail.items.map((item) => {
          const row = byId.get(item.id);
          return (
            <tr key={item.id} className='border-b last:border-0'>
              <td className='py-2'>
                <span className='block'>{item.title ?? item.variantSku}</span>
                <span className='text-muted-foreground text-xs'>{item.variantSku}</span>
              </td>
              {/* 🔴 整列一律走 `view`(R1 F9):混用 `item` 與 view 算出來的欄位,
                  快取漂移時整列算式會對不起來(買 5 / 到貨 0 / 取消 0 / 還能取消 3)。
                  ⚠️ 精確講 view 內部仍是兩源(`quantity` 取真相、其餘取摘要快取),
                  只是被複合 FK 釘成同值 —— 不可達性見 `cancel-view.ts` 的 `quantity` 註解(R2 nit)。 */}
              <td className='py-2 text-right tabular-nums'>{row?.quantity ?? item.quantity}</td>
              {/* 🔴 `null` 是「不知道」不是 0 —— 畫成「?」而不是數字,免得員工照著它算。 */}
              <td className='py-2 text-right tabular-nums'>{row?.instockQuantity ?? '?'}</td>
              <td className='py-2 text-right tabular-nums'>{row?.cancelledQuantity ?? '?'}</td>
              <td className='py-2 text-right font-medium tabular-nums'>
                {row?.maxCancellable ?? '?'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CancellationHistory({ detail }: { detail: AdminOrderDetail }) {
  // 🔴 三態逐條分開(`types.ts` 對 `cancellations` 的契約):
  //    `null` = 沒讀到(別畫成空清單)/ `[]` = 真的沒取消過 / 有內容才畫清單。
  // 🔴 **`== null` 而不是 `=== null`**(A13b D6-a 加的**防禦性**收斂)。
  //    ⚠️ **誠實更正(R1 must-fix)**:我第一版把理由寫成「投影退版時這個鍵會整個不存在、
  //    是產線真的會發生的值」——**那句不實**。實查 `mappers/order.ts:750-751`:
  //    `cancellations` 與 `cancellationsTruncated` 由 mapper **恆設**,產不出 `undefined`。
  //    真正的觸發是 D6-a 接線時,三支既有頁層測試的 **fixture 沒有這兩個鍵** ⇒ `.length` throw。
  //    ⇒ 保留 `== null` 的理由只有一條:**入口是結構型別、擋不住手寫物件**,而缺值與 `null`
  //    在這裡的處置本來就相同 —— 純防禦,**不是**在修一個已知的產線缺陷。
  //    ⚠️ 方向不變:兩種缺值都走「讀取失敗」那句(fail-closed),不是畫成「沒有取消紀錄」。
  if (detail.cancellations == null) {
    return (
      <p className='text-muted-foreground text-sm'>
        取消紀錄讀取失敗,無法顯示。請重新整理;若仍相同,請通知系統維護。
      </p>
    );
  }
  if (detail.cancellations.length === 0) {
    return <p className='text-muted-foreground text-sm'>這張單沒有取消紀錄。</p>;
  }
  return (
    <div className='space-y-3'>
      {detail.cancellationsTruncated ? (
        <p className='text-muted-foreground text-xs'>
          只顯示最近幾筆,更早的取消紀錄沒有列出來。
        </p>
      ) : null}
      <ul className='space-y-2'>
        {detail.cancellations.map((entry) => (
          <li key={entry.id} className='rounded border p-3 text-sm'>
            <div className='flex justify-between gap-4'>
              <span>{REASON_CODE_LABEL[entry.reasonCode] ?? entry.reasonCode}</span>
              {/* 🔴 用同頁姊妹區塊那支(R1 F8):①同一張訂單頁不出現兩種日期格式
                  ②`Intl.DateTimeFormat().format(new Date('bad'))` **丟 RangeError** ⇒ 整頁 server render 500,
                  而那支走 `toLocaleDateString`、壞值只會印 "Invalid Date"。`createdAt` 同樣是直送未驗字串。 */}
              <span className='text-muted-foreground text-xs'>
                {formatOrderDateTime(entry.createdAt)}
              </span>
            </div>
            {entry.reasonDetail === null ? null : (
              <p className='text-muted-foreground mt-1 text-xs break-all'>{entry.reasonDetail}</p>
            )}
            {/* 🔴 `items === null` = 沒讀到,不是「這次取消沒動到品項」(後者在 DB 端不存在)。 */}
            {entry.items === null ? (
              <p className='text-muted-foreground mt-1 text-xs'>這次取消的品項明細沒有讀到。</p>
            ) : (
              <p className='text-muted-foreground mt-1 text-xs'>
                {(() => {
                  const total = sumCancelledQuantity(entry.items);
                  return total === null ? '件數無法計算(明細數字異常)' : `共 ${total} 件`;
                })()}
                {entry.itemsTruncated ? '(品項明細沒有列完)' : null}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A13a 唯讀複核區塊。**不含任何送出動作**(那是 A13b)。
 *
 * 🔴 `<details>` 預設收合、可取消時才預設展開:能取消的單員工要先看影響範圍;
 * 不能取消的單只要看到「為什麼不能」就夠了,展開一整張表是噪音。
 */
export function CancelReviewSection({ detail }: { detail: AdminOrderDetail }) {
  const view = buildOrderCancelView(detail);

  return (
    <section className={CARD}>
      <h2 className={CARD_TITLE}>取消訂單</h2>

      {view.canCancel ? (
        // 🔴 不可把「不能整單取消」的成因講死(R1 F1):`fullCancelAllowed` 有**兩個**獨立成因
        //    (任一品項有到貨 / 某品項的上限被壓到低於剩餘量),寫死其中一個會與下表自打嘴巴。
        <p className='text-sm'>
          這張單可以取消。
          {view.fullCancelAllowed
            ? '可以整單取消,也可以只取消部分品項。'
            : '這張單只能逐項取消,請照下表每個品項的「還能取消」勾選。'}
        </p>
      ) : (
        <BlockReasons reasons={view.blockReasons} />
      )}

      <details className='mt-4' open={view.canCancel}>
        <summary className='cursor-pointer text-sm font-medium'>影響範圍與取消紀錄</summary>
        <div className='mt-3 space-y-4'>
          <ItemRows detail={detail} view={view} />
          <div>
            <h3 className={CARD_TITLE}>取消紀錄</h3>
            <CancellationHistory detail={detail} />
          </div>
        </div>
      </details>
    </section>
  );
}
