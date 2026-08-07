// use-reveal-form.ts — 會員中心 inline 表單「展開後把它帶到眼前」的共用 hook(AddressTab / VehiclesTab)
//
// 由來:Sean 2026-08-06 手機實測回報「新增地址 / 新增愛車時,畫面沒有自動捲到該輸入欄位」。
// 原本就有 scrollIntoView,壞在三個地方疊在一起:
//   ① `block: 'nearest'` —— 元素只要有一點點露在視窗內就**完全不捲**,這就是「捲了但沒效果」。
//   ② `.acc-inline-form` 沒有 `scroll-margin-top`,而 header 是 `position: sticky`
//      ⇒ 就算捲到位,表單開頭仍被壓在 header 底下(值與推導寫在 `account.css` 的 `.acc-inline-form`)。
//   ③ 掛成 inline ref callback,箭頭函式每次 render 身分都變 ⇒ 每次 re-render 都重跑。
//
// 🔴 **焦點不落在輸入欄位**(Sean 2026-08-07 拍板 Q1=A):
//    ADR-0007 已為同一個手機情境拍過板 —— `docs/decisions/0007-catalog-vehicle-selection-ux.md`
//    的「不自動聚焦」與驗收重點「手機不會在開面板時自動跳鍵盤」(守門在 `MobileVehicleSheet.test.tsx`,
//    grep `activeElement).toBe(document.body`)。焦點落到 text input 會把手機鍵盤叫出來,
//    鍵盤又反過來壓縮 viewport 把剛捲好的位置頂掉(`MobileVehicleSheet.tsx` 逐字記過這件事,
//    grep `KEYBOARD_SETTLE_MS`)。
//    ⇒ 焦點改落**表單容器本身**(呼叫端給 `tabIndex={-1}` 與 aria-label)——
//      容器不是輸入欄,所以不會彈鍵盤。
//      ⚠️ **「讀屏會念出『新增地址 / 編輯地址』」是預期、不是實測結論**(R2 抓到我把它寫成事實):
//      桌機 NVDA/JAWS 對程式化 focus 到具名 `role="group"` 會播報,但 **iOS VoiceOver 不保證把
//      VO cursor 帶過去** —— 而本片的動機情境正是 Sean 的手機。真機讀屏這道**沒有人驗過**。
//
// 這顆 hook 存在的理由不只是去重:兩個 tab 的邏輯逐字相同,分開寫的話下次只改一邊 = 靜默偏離。
import { useEffect, useRef } from 'react';

/**
 * @param openState 該 tab 的編輯 state 物件(`null` = 表單關閉)。
 *   🔴 依賴刻意收**物件本身**而不是 boolean:使用者從「編輯 A」直接切到「編輯 B」時,
 *   `!!state` 兩次都是 true、React 判定依賴沒變就不重跑,切換會漏掉捲動。
 *   (R2 抓到這條理由原本零覆蓋 —— 依賴改成 `[!!openState]` 時全部測試照樣綠;
 *    現在兩個 tab 各有一條「開著編輯 A 直接點編輯 B」把它釘住。)
 * @returns 掛在 `.acc-inline-form` 包裹層上的 ref(新增態與編輯態同時間只會有一個 mount、共用安全)。
 */
export function useRevealForm(openState: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!openState) return;
    const el = ref.current;
    if (!el) return;
    // 開表單前誰有焦點(通常是「＋ 新增」或該卡的「編輯」鈕)—— 關表單時要還回去。
    // 🔴 R2 抓到:本片把焦點從觸發鈕搶走卻沒還,鍵盤使用者關掉表單後焦點掉到 <body>、
    //    下一次 Tab 得從文件頂端重來。改動**之前**焦點本來是留在觸發鈕上的,這是本片新造的退步。
    //    同型修法已在 MobileMenu.tsx 用過(grep `skipFocusRestore`)。
    const trigger = document.activeElement as HTMLElement | null;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // preventScroll:focus() 預設會自己把目標捲進視野,那會跟上一行的 smooth 捲動打架
    // ⇒ 結果是瞬間跳位而不是平滑捲動。這裡只要焦點語意,捲動交給上一行。
    el.focus({ preventScroll: true });
    return () => {
      // isConnected:該筆被刪掉時觸發鈕會跟著卸載,那就不還(還了會拋或跳到孤兒節點)。
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [openState]);
  return ref;
}
