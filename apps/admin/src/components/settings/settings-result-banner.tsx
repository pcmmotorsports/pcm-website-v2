// settings-result-banner.tsx — 設定頁 PRG 結果提示(M-4a Slice D-3;server action redirect 帶 ?r=<code> 後顯示)。
// server-render;code 由頁面從 searchParams.r 讀入。未知/缺 → 不顯示。tone 鏡像 orders/result-banner。

export type SettingsResultMessages = Readonly<
  Record<string, { text: string; tone: 'ok' | 'warn' | 'error' }>
>;

// 🔴 **本元件刻意沒有預設碼表**(#332-2,Sean 2026-08-06 拍板 Q2=A):原本的預設 `MESSAGES` 是
//    `order-statuses` 設定頁的專用詞彙,那頁在 A9w2 隨九碼退場下架後就零 caller ⇒ 是死詞彙,
//    不是 fallback。留著的代價是「看起來有人在維護的預設文案」這種假安心。
//    ⇒ `messages` 為**必填**:哪個頁面用本元件,就自己帶自己的碼表,漏帶 = **編譯期報錯**,
//    不會靜默套到一份沒人維護的詞彙上。

const TONE = {
  ok: 'border-green-500/30 bg-green-500/5 text-green-700',
  warn: 'border-amber-500/30 bg-amber-500/5 text-amber-700',
  error: 'border-destructive/30 bg-destructive/5 text-destructive',
} as const;

export function SettingsResultBanner({
  code,
  messages,
}: {
  code: string | undefined;
  messages: SettingsResultMessages;
}) {
  if (!code) return null;
  // 🔴 **守門形狀必須是 `Object.hasOwn`,不得退回裸索引 `messages[code]`**(#332-2,Sean 2026-08-02
  //    拍板 B 退回過一次、2026-08-06 拍板 Q1=A 修回來):`code` 來自 URL 的 `?r=`,是**任意字串**。
  //    裸索引時 `messages['__proto__']` / `['constructor']` / `['toString']` / `['valueOf']` /
  //    `['hasOwnProperty']` 會取到**原型鏈上的屬性**且為 truthy ⇒ 下一行的 `if (!msg)` 這道守門
  //    形同虛設 ⇒ 畫出一個 `class="… undefined"` 的空框(`msg.text` 是 undefined
  //    ⇒ **不會注入任何文字**,純粹是「守門的名字大於它的能力」)。
  //    ⇒ 回歸測試釘在 `settings-result-banner.test.tsx`(五個向量逐字入測,**元件層**——
  //    不變量是「本元件對任何非自有 key 都不渲染」,與是哪張碼表無關);姊妹元件
  //    `orders/result-banner.tsx` 同形、測試在 `orders/result-banner.test.tsx`。
  //    背景與爆炸半徑(本元件 2 頁 + 姊妹元件 4 頁 = **6 頁**)見
  //    `docs/specs/2026-08-06-result-banner-cleanup-plan.md`。
  const msg = Object.hasOwn(messages, code) ? messages[code] : undefined;
  if (!msg) return null;
  return (
    <div className={`rounded-lg border p-3 text-sm ${TONE[msg.tone]}`} role='status'>
      {msg.text}
    </div>
  );
}
