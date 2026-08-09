/**
 * 工作區右側面板的寬度規則與持久化(#350b)。
 *
 * 🔴 **純函式,零 DOM、零 React** —— 放這裡而不是塞進元件,是為了讓「夾範圍」與「解析 cookie」
 * 這兩件會出錯的事**測得到**。元件那半(pointer drag、CSS 變數)要真瀏覽器才驗得了,
 * 本檔刻意只裝**不需要瀏覽器就能判對錯**的邏輯,兩者的界線寫在 `workspace-shell.tsx` 檔頭。
 *
 * 真權威 = Sean 2026-08-09 逐字(`docs/phase-1-backlog.md:9406`):
 * 「點擊訂單編號後,直接在右邊切一個畫面,**畫面大約是現在視窗的一半,可以調整**,
 *   我們 90% 時間都會是跟截圖一樣的狀態下工作」。
 * ⇒ ①預設約一半 ②可調 ③**狀態要留著**(「90% 時間都在這個狀態」= 重整/換頁不能歸零)。
 */

/**
 * cookie 名。
 *
 * 🔴 **與側欄的 `sidebar_state` 分開**:兩者的生命週期不同(側欄是全站慣用姿勢、
 * 面板寬度是工作區偏好),合成一顆會讓其中一邊的清除連坐另一邊。
 */
export const WORKSPACE_PANEL_COOKIE = 'workspace_panel_width';

/** 與側欄同壽(7 天);同一個 admin session 的使用者不必每天重調。 */
export const WORKSPACE_PANEL_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

/**
 * 面板最小寬度(px)。
 *
 * 訂單詳情裡最擠的是採購/出貨那幾張表;低於這個寬度它們會開始橫向捲,
 * 那時候「分割視窗」就沒有比整頁好。**這是產品下限,不是技術下限。**
 * ⚠️ 誠實邊界:320 是依現有表格欄數估的**起點**,不是量出來的 —— 真值要等 350c 把詳情
 * 放進面板、用真瀏覽器看才知道。屆時調這裡一個數字即可。
 */
export const MIN_PANEL_WIDTH = 320;

/**
 * 左側內容區(訂單列表)必須保留的最小寬度(px)⇒ 面板的上限由它反推。
 *
 * 🔴 **上限用「內容區至少留多少」表達,不是寫死面板最大 px**:視窗大小會變,
 * 寫死面板上限會讓小螢幕上的面板把列表擠成一條縫 —— 而列表是員工的主畫面
 * (Sean:「90% 時間都會是跟截圖一樣的狀態」= 兩邊都要看得見)。
 */
export const MIN_CONTENT_WIDTH = 480;

/** 預設佔視窗的一半(Sean 逐字「大約是現在視窗的一半」)。 */
export const DEFAULT_PANEL_RATIO = 0.5;

/**
 * 把想要的面板寬度夾進可用範圍。
 *
 * 規則(順序有意義):
 * 1. 上限 = `viewportWidth - MIN_CONTENT_WIDTH`(內容區優先,見上);
 * 2. 下限 = `MIN_PANEL_WIDTH`;
 * 3. 🔴 **視窗太窄、兩個下限同時滿足不了時,下限贏** —— 面板寧可佔滿也不要縮成不能用的一條。
 *    (真正的小螢幕解法是「不分割」,那是 Q5 已裁的手機路徑、不歸這個函式管。)
 *
 * ⚠️ 非有限值(NaN/Infinity,例如 cookie 被手改成 `abc`)⇒ 回預設寬度,**不回 NaN**:
 * NaN 進到 CSS 變數會讓整條 `grid-template-columns` 失效、版面塌掉,而那是靜默的。
 */
export function clampPanelWidth(desired: number, viewportWidth: number): number {
  // 🔴 **兩個守門都排在遞迴/運算之前**(code-reviewer nit):第一版先算 `max` 再檢查 `desired`,
  //    而 `viewportWidth` 非有限時 `defaultPanelWidth()` 也回 NaN ⇒ 自我遞迴不收斂。
  //    現在只餵 `window.innerWidth` 故不可達,但「不可達」不是把守門排錯位置的理由。
  const vw = Number.isFinite(viewportWidth) ? viewportWidth : 0;
  const max = maxPanelWidth(vw);
  if (!Number.isFinite(desired)) return Math.min(defaultPanelWidth(vw) || MIN_PANEL_WIDTH, max);
  return Math.min(Math.max(Math.round(desired), MIN_PANEL_WIDTH), max);
}

/**
 * 目前視窗下面板的最大寬度。
 *
 * 抽成具名函式是因為**畫面也要用它** —— 拖曳把手的 `aria-valuemax` 必須報得出真範圍
 * (可聚焦的 separator 依 ARIA 要報 valuenow/min/max),而那個上限與夾寬度用的是同一條規則。
 * 兩邊各算一次 = 兩個真相源。
 */
export function maxPanelWidth(viewportWidth: number): number {
  return Math.max(MIN_PANEL_WIDTH, viewportWidth - MIN_CONTENT_WIDTH);
}

/** 沒有存過偏好時的寬度 = 視窗的一半(仍會被 {@link clampPanelWidth} 夾)。 */
export function defaultPanelWidth(viewportWidth: number): number {
  return Math.round(viewportWidth * DEFAULT_PANEL_RATIO);
}

/**
 * 解析 cookie 值 → 寬度(px);解析不出來回 `null`(= 沒有偏好、交給 client 依視窗算)。
 *
 * 🔴 **回 `null` 而不是回一個猜的數字**:server 端**不知道使用者的視窗有多寬**
 * (cookie 只有 px、沒有視窗尺寸)⇒ 這裡若自己編一個預設值,第一畫面會用錯的寬度渲染、
 * 然後在 client 跳一下。回 `null` 讓 shell 明確走「還沒有偏好」那條路。
 * ⚠️ 負數與 0 也當沒有偏好(那是被手改過的值,不是使用者調出來的)。
 */
export function parsePanelWidthCookie(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}
