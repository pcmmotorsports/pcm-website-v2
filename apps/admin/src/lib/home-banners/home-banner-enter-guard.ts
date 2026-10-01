// home-banner-enter-guard.ts — 首頁大圖面板:在單行輸入框按 Enter 不送出表單(主視窗 2026-10-01)。
//
// 🔴 為什麼:瀏覽器的「隱式提交」會觸發表單裡第一顆送出按鈕。面板的送出按鈕依狀態不同,
//    第一顆可能是「封存」這種會造成破壞的動作(第 4 片之前就是)⇒ 在眉標按 Enter 會把草稿封存。
//    ⇒ 不靠按鈕順序, 直接讓單行輸入框的 Enter 不送出;要存檔就按按鈕。
// 🔵 多行文字框(FB / IG 貼文)的 Enter 是換行, 照常;按鈕上的 Enter 是按那顆鈕, 照常。
// 🔴 中文輸入法選字時的 Enter 是「確定選字」, 不能攔(攔了會打不出字)⇒ isComposing / keyCode 229 放過。

// 這些 input 按 Enter 本來就不會送出, 或 Enter 有自己的意思 ⇒ 不管
const NOT_TEXT = new Set(['checkbox', 'radio', 'file', 'submit', 'button', 'reset', 'image']);

export interface EnterGuardEvent {
  readonly key: string;
  readonly target: EventTarget | null;
  readonly nativeEvent?: { readonly isComposing?: boolean; readonly keyCode?: number };
  preventDefault(): void;
}

export function preventEnterSubmit(e: EnterGuardEvent): void {
  if (e.key !== 'Enter') return;
  if (e.nativeEvent?.isComposing || e.nativeEvent?.keyCode === 229) return;
  const t = e.target as { tagName?: string; type?: string } | null;
  if (t?.tagName !== 'INPUT' || NOT_TEXT.has((t.type ?? 'text').toLowerCase())) return;
  e.preventDefault();
}
