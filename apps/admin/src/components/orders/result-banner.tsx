// 相對 import(非 @/):vitest 的 `@` alias 指向 storefront(見 `lib/session/actor.ts` 註解)
// ⇒ 用 `@/` 會讓本元件在測試環境解析失敗。
import { NOTE_ADDED_RESULT_CODE } from '../../lib/orders/note-action-state';
import {
  PROCUREMENT_CREATED_RESULT_CODE,
  PROCUREMENT_NO_CHANGE_RESULT_CODE,
  PROCUREMENT_UPDATED_RESULT_CODE,
} from '../../lib/orders/procurement-action-state';
import { REFUND_SUBMITTED_RESULT_CODE } from '../../lib/payment/refund-action-state';
import {
  REFUND_MARKED_FAILED_RESULT_CODE,
  REFUND_RECOVERED_RESULT_CODE,
} from '../../lib/payment/refund-recovery-state';

// result-banner.tsx — 改單 PRG 結果提示(M-4a Slice C;server action redirect 帶 ?r=<code> 後顯示)。
// server-render;code 由頁面從 searchParams.r 讀入。未知/缺 → 不顯示。

const MESSAGES: Record<string, { text: string; tone: 'ok' | 'warn' | 'error' }> = {
  saved: { text: '已儲存變更。', tone: 'ok' },
  noop: { text: '沒有變更(內容與原本相同)。', tone: 'ok' },
  conflict: { text: '這張單在你編輯期間被改過了,已重新載入最新狀態,請確認後再存一次。', tone: 'warn' },
  invalid: { text: '表單內容不正確,未儲存。', tone: 'warn' },
  denied: { text: '沒有權限或登入狀態已失效,未儲存。', tone: 'error' },
  not_found: { text: '找不到對象資料(可能已被移除),未儲存。', tone: 'warn' },
  error: { text: '儲存失敗,請稍後再試或聯絡系統維護。', tone: 'error' },
  // 🔴 M-4b E10 A9d2-1:備註**只有成功**會走 redirect 到這裡 —— 失敗一律回 action state
  //    (Sean 拍板 Q1=A:保留員工打的內容)⇒ 這裡**不該**出現 note 的任何失敗碼。
  //    `APPENDED` 與 `DUPLICATE_REQUEST` **共用這一則**:後者意謂「這個請求已寫入過且經查驗」,
  //    對員工就是同一件事(母 plan v4 §5 F3:顯示成別的會誘發他換一把 token 重送 = 製造重複備註)。
  [NOTE_ADDED_RESULT_CODE]: { text: '備註已新增。', tone: 'ok' },
  // 🔴 M-3 RW2c:退款也只有成功走 redirect(失敗全回 action state,同備註片 Q1=A 慣例)。
  //    措辭鐵律:confirmed = TapPay **受理** ≠ 已入帳(入帳以對帳為準;plan §3 第一列)。
  //    `DUPLICATE_REQUEST`(前次已 confirmed)共用本則 —— 對員工是同一件事。
  [REFUND_SUBMITTED_RESULT_CODE]: {
    text: '退款已送出,TapPay 已受理。受理不等於已入帳,入帳以之後的對帳為準。',
    tone: 'ok',
  },
  // 🔴 M-3 RW4:人工結案兩碼(同樣只有成功走 redirect;失敗全回 action state)。
  //    兩碼刻意不共用 —— 「錢沒動、已作廢」與「錢已退、登記完成」是相反的事實。
  [REFUND_MARKED_FAILED_RESULT_CODE]: {
    text: '已標記失敗結案:對帳確認這筆退款的錢沒有動。若仍需退款,請回訂單頁重新發起。',
    tone: 'ok',
  },
  [REFUND_RECOVERED_RESULT_CODE]: {
    text: '已恢復結案:這筆退款以 Portal 退款編號登記為完成,訂單付款狀態已同步。',
    tone: 'ok',
  },
  // 🔴 M-4b E10 A10b:採購同樣**只有成功**會走 redirect(失敗回 action state、保留輸入)。
  //    三個成功碼**刻意不共用一則** —— 員工要看得出「這次到底有沒有改到東西」:
  //    `NO_CHANGE` 意謂「送出的內容與現況完全相同、零寫入」(A5a `:300-322`),
  //    若與「已更新」說同一句話,他會以為改成功了而不再檢查。
  [PROCUREMENT_CREATED_RESULT_CODE]: { text: '已新增這筆採購。', tone: 'ok' },
  [PROCUREMENT_UPDATED_RESULT_CODE]: { text: '已更新這筆採購。', tone: 'ok' },
  [PROCUREMENT_NO_CHANGE_RESULT_CODE]: {
    text: '沒有變更(送出的內容與目前的採購紀錄完全相同)。',
    tone: 'ok',
  },
};

const TONE = {
  ok: 'border-green-500/30 bg-green-500/5 text-green-700',
  warn: 'border-amber-500/30 bg-amber-500/5 text-amber-700',
  error: 'border-destructive/30 bg-destructive/5 text-destructive',
} as const;

export function ResultBanner({ code }: { code: string | undefined }) {
  if (!code) return null;
  // 🔴 **守門形狀必須是 `Object.hasOwn`,不得退回裸索引 `MESSAGES[code]`**(#332-2,Sean 2026-08-02
  //    拍板 B 退回過一次、2026-08-06 拍板 Q1=A 修回來):`code` 來自頁面的 `searchParams.r`,
  //    是**任意字串**。裸索引時 `MESSAGES['__proto__']` / `['constructor']` / `['toString']` /
  //    `['valueOf']` / `['hasOwnProperty']` 取到的是**原型鏈上的屬性**且為 truthy
  //    ⇒ 下一行的 `if (!msg)` 這道守門形同虛設 ⇒ 畫出一個 `class="… undefined"` 的空框。
  //    無注入風險(`msg.text` 是 undefined ⇒ React 不渲染任何文字),但那是
  //    「守門的名字大於它的實際能力」——`if (!msg)` 承諾擋掉所有非自有 key,實際擋不掉最好猜的那五個。
  //    ⇒ 回歸測試釘在 `result-banner.test.tsx`(五個向量逐字入測);姊妹元件
  //    `settings/settings-result-banner.tsx` 同形、測試在 `settings-result-banner.test.tsx`。
  //    背景與爆炸半徑(本元件 4 頁 + 姊妹元件 2 頁 = **6 頁**)見
  //    `docs/specs/2026-08-06-result-banner-cleanup-plan.md`。
  const msg = Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : undefined;
  if (!msg) return null;
  return (
    <div className={`rounded-lg border p-3 text-sm ${TONE[msg.tone]}`} role='status'>
      {msg.text}
    </div>
  );
}
