'use client';

import * as React from 'react';

import {
  MIN_PANEL_WIDTH,
  WORKSPACE_PANEL_COOKIE,
  WORKSPACE_PANEL_COOKIE_MAX_AGE,
  clampPanelWidth,
  defaultPanelWidth,
  maxPanelWidth,
} from '@/lib/layout/workspace-panel';

// workspace-shell.tsx — #350b 工作區殼:內容區 + 可調寬度的右側面板槽。
//
// 🔴 **面板是共用基礎設施,不是訂單專屬**(wave-plan `:23`:「D 的殼落地後,E 的取消畫面與
//    B 的收款/對帳讀面都掛進同一個右側面板系統」)⇒ 本檔**不認得任何業務概念**,只認「有沒有內容」。
//
// 🔴 **為什麼 `children` 與 `panel` 是 props 而不是在這裡渲染**:本檔是 client component
//    (drag 需要),而各頁面與面板內容**必須維持 server component**(PII 白名單投影 + server action,
//    鐵則 12 ②)。當成 ReactNode 收進來,它們仍在 server 渲染、只是被塞進這個殼。
//    (2026-08-10 code-reviewer R1/R2 兩輪實跑 `next build` 複驗:所有 route 仍 server-rendered、
//     `prerender-manifest.json` 零真實 route 被預渲染、無既有頁被拉進 client bundle。)
//
// ── 🔴🔴 捲動模型:**刻意不改**(code-reviewer R1 第一條 must-fix)────────────────
// 第一版把 row 寫成 `min-h-0 flex-1`、main 加 `overflow-auto`。那看起來只是排版,實際上是
// **把全站的捲動模型從「document 捲」換成「main 內捲」** —— `sidebar-wrapper` 有 `min-h-svh`,
// row 一旦 `min-h-0` 就拿到確定高度、`overflow-auto` 就真的生效。
// 後果不只是捲軸位置:`multi-check-filter.tsx` 那種非 portal 的 `absolute` 下拉
// (訂單列表篩選在用)會被新的 scroll container **裁切**。
// ⇒ 殼只負責「多切一欄」,不順手改每一個既有頁面的行為;面板自己的捲動留給 350c
//   (那時它有內容、看得見、驗得到)。`workspace-shell.test.ts` 有兩格釘住這條「不要做」。
//
// ── 🔴 寬度的夾範圍在 **CSS**,不在這裡(code-reviewer R2)──────────────────────
// 本檔只負責「使用者拖到多少」與「寫進 cookie」;**實際渲染寬度由 `globals.css` 的
// `min-width`/`max-width` 夾**。理由與取捨全文在那條規則旁邊(第一幀正確 + 不會因為縮視窗
// 把使用者存的偏好永久改小)。⇒ **本檔沒有 resize 監聽,那是刻意的。**

/** 拖曳把手的鍵盤步進(px)。 */
const KEYBOARD_STEP = 24;

export function WorkspaceShell({
  children,
  panel,
  initialPanelWidth,
}: {
  children: React.ReactNode;
  panel: React.ReactNode;
  /** server 端從 cookie 讀到的偏好;`null` = 還沒有偏好。 */
  initialPanelWidth: number | null;
}) {
  const [width, setWidth] = React.useState<number>(initialPanelWidth ?? 0);
  // 🔴 `viewport` **只服務 `aria-valuemax`**,不參與版面(版面由 CSS 夾)。
  //    分開之後,resize 不再碰 cookie ⇒ 使用者的偏好不會被縮視窗改掉。
  const [viewport, setViewport] = React.useState<number>(0);

  React.useEffect(() => {
    const sync = () => setViewport(window.innerWidth);
    sync();
    if (initialPanelWidth === null) setWidth(defaultPanelWidth(window.innerWidth));
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, [initialPanelWidth]);

  /**
   * 使用者**主動**調整寬度時才走這裡(拖曳 / 鍵盤)——**唯一會寫 cookie 的路徑**。
   * 🔴 副作用不放在 `setWidth` 的 updater 裡:updater 依 React 契約必須純,
   *    StrictMode / concurrent 下會被重跑,被丟棄的 render 也會落 cookie。
   */
  const commit = React.useCallback((next: number) => {
    const clamped = clampPanelWidth(next, window.innerWidth);
    setWidth(clamped);
    // 🔴 server 端**真的會讀它**(`app/layout.tsx`)。
    //    ⚠️ 對照組:`ui/sidebar.tsx` 也寫 cookie,但 admin 的 `<SidebarProvider>` 沒傳 `defaultOpen`
    //    ⇒ 那顆只寫不讀、重整後側欄一律回展開。本檔刻意不重蹈。
    document.cookie = `${WORKSPACE_PANEL_COOKIE}=${clamped}; path=/; max-age=${WORKSPACE_PANEL_COOKIE_MAX_AGE}`;
  }, []);

  const onPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const handle = e.currentTarget;
      handle.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => commit(window.innerWidth - ev.clientX);
      // 🔴 `pointercancel` 也要收尾(系統手勢/裝置切換會發它而不是 `pointerup`);
      //    漏了它,監聽會留在 window 上、下次滑鼠一動面板就自己跟著跑。
      const end = () => {
        if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    },
    [commit],
  );

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      // 讀 state 而非 closure 陳舊值的理由:同一 render 內連按兩下要能累加。
      setWidth((prev) => {
        const next = clampPanelWidth(prev + (e.key === 'ArrowLeft' ? KEYBOARD_STEP : -KEYBOARD_STEP), window.innerWidth);
        document.cookie = `${WORKSPACE_PANEL_COOKIE}=${next}; path=/; max-age=${WORKSPACE_PANEL_COOKIE_MAX_AGE}`;
        return next;
      });
    },
    [],
  );

  return (
    <div
      className='workspace-row flex flex-1'
      style={{ '--workspace-panel-width': `${width}px` } as React.CSSProperties}
    >
      {/* 🔴 內層是 `<div>` 不是 `<main>`:`SidebarInset` 本身已經是 `<main>`
          (`components/ui/sidebar.tsx`)⇒ 再包一個會有兩個 main landmark。
          舊版就有這個問題,本片動到這一行、順手改對(code-reviewer R2 nit)。 */}
      <div className='workspace-content min-w-0 flex-1 p-6'>{children}</div>
      {/* 🔴 把手與面板欄在**沒有面板內容時整組隱藏** —— 規則在 `globals.css`(`:has()`,零 JS)。
          class 名是 TSX 與那條 CSS 之間**唯一的接點** ⇒ 測試把三個 class 在兩邊對照釘死。 */}
      <div
        className='workspace-handle bg-border hover:bg-primary/40 focus-visible:bg-primary/60 w-1 shrink-0 cursor-col-resize outline-hidden'
        role='separator'
        aria-orientation='vertical'
        aria-label='調整面板寬度'
        // 🔴 可聚焦的 separator(window splitter)依 ARIA **必須**報得出目前位置與範圍。
        //    `viewport` 未知時(SSR 那一幀)把上限退成「至少不小於目前值」,
        //    避免報出 `valuenow > valuemax` 這種不合法的組合。
        aria-valuenow={width}
        aria-valuemin={MIN_PANEL_WIDTH}
        aria-valuemax={viewport ? maxPanelWidth(viewport) : Math.max(width, MIN_PANEL_WIDTH)}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      />
      <div className='workspace-panel shrink-0'>{panel}</div>
    </div>
  );
}
