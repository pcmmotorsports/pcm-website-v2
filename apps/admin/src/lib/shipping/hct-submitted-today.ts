// hct-submitted-today.ts — ⟦ship-HCTLABEL⟧「這張單是不是【今天】送到新竹的」(台北曆面)。
//
// 🔴 新竹 V15 P.8:同貨號+同單號**當日**重複上傳 = 更正;隔天再送同單號 = **新的一張單**(新貨號)。
//    ⇒ 重取標籤那條路只准在同一天走。伺服器在 UTC ⇒ 一定指定 Asia/Taipei(同 `shipping-doc-dispatch.ts` 那條教訓)。
// 🔴 NULL / 解不開 ⇒ false:不知道哪天送的就不賭(既有列在 migration 20260914080000 之前一律 NULL)。
// 🔵 `now` 可注入:綁死真時鐘的話, 測試會在台北半夜自己變色。
const TAIPEI: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' };
/** 台北午夜前這幾分鐘不送:判完「同一天」到新竹真的收到中間還有備註查詢 + HTTP, 跨過 00:00 就變新單(codex R2 must-fix)。 */
export const HCT_MIDNIGHT_BUFFER_MINUTES = 5;

export function isHctSubmittedToday(submittedAtIso: string | null, now: Date = new Date()): boolean {
  if (submittedAtIso === null) return false;
  const t = new Date(submittedAtIso);
  if (Number.isNaN(t.getTime())) return false;
  return t.toLocaleDateString('en-CA', TAIPEI) === now.toLocaleDateString('en-CA', TAIPEI);
}

/**
 * 「現在送過去, 新竹收到時還會是同一天嗎」—— 同一天 **且** 離台北午夜還有 HCT_MIDNIGHT_BUFFER_MINUTES 以上。
 * 🔴 要在 HTTP 發出去的【前一行】叫, 不是在 action 開頭叫(中間那幾個 await 會吃時間)。
 */
export function canRefetchHctLabelNow(submittedAtIso: string | null, now: Date = new Date()): boolean {
  if (!isHctSubmittedToday(submittedAtIso, now)) return false;
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(now)
    .split(':');
  const minutesOfDay = Number(hm[0]) * 60 + Number(hm[1]);
  return minutesOfDay < 24 * 60 - HCT_MIDNIGHT_BUFFER_MINUTES;
}
