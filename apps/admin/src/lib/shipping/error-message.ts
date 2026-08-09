// error-message.ts — 把丟出來的東西轉成**人看得懂的一行字**(出貨線共用)。
//
// 🔴 **為什麼是獨立模組**:這段原本住在 `shipment-actions.ts` 裡,但那支是 `'use server'` ——
//    `'use server'` 模組**只能 export async function**(export 一個純函式是建置期錯誤)⇒
//    呼叫端(client 元件)沒辦法共用它,只能各寫一份。第二份就是第二個真相源。
//
// 🔴 **它擋的是哪個具體症狀**:2026-08-09 Sean 正式站實測,錯誤區塊印出 `[object Object]`。
//    根因:Supabase 丟的是 **`PostgrestError` 這種普通物件**(帶 message / code / details / hint),
//    **不是 `Error` 實例** ⇒ `e instanceof Error ? e.message : String(e)` 會落到字串化分支。
//    而 DB `RAISE EXCEPTION` 寫給員工看的中文就在那個物件的 message 欄裡 ——
//    等於把唯一能給員工看的訊息丟掉。

export function toMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null) {
    const o = e as { message?: unknown; details?: unknown; hint?: unknown };
    if (typeof o.message === 'string' && o.message !== '') return o.message;
    if (typeof o.details === 'string' && o.details !== '') return o.details;
    if (typeof o.hint === 'string' && o.hint !== '') return o.hint;
    // 🔴 真的沒有可讀欄位時吐 JSON,**也不要吐那個沒有資訊量的字串** —— 對排查零幫助。
    try {
      return JSON.stringify(e);
    } catch {
      return '未知錯誤(無法序列化)';
    }
  }
  return String(e);
}
