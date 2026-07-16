// useLightboxSwipe.ts — 全螢幕看大圖 lightbox 的觸控手勢(共用 ProductGallery + SwatchLightbox)
//
// Sean 2026-07-09 手機肉眼驗回饋:
//   1. 上／下滑要能「關閉」大圖(原本只有 X 鈕 / 點空白 / ESC);滑動要跟手,門檻偏保守——
//      「避免不小心手滑一下就切掉」。
//   2. 左右滑 + 箭頭要「無限輪播」(滑到最後一張再往右 → 回第一張;第一張往左 → 到最後一張)。
//
// V-2g(Sean 2026-07-16 真機:「商品大圖點開後無法用手指放大看,以前有這個功能」):
//   自實作雙指縮放(pinch-zoom)——原 touch-action:none 讓 JS 全權接手勢、同時封掉瀏覽器原生縮放。
//   手勢狀態機互斥:scale===1 時單指=上下滑關閉/左右滑輪播(既有);雙指=縮放(1x~MAX);
//   scale>1 時單指=平移圖片(pan、不觸發關閉/換圖);雙擊=切 1x/2x;換圖/關閉重置 scale。
//   縮放套用在 imageRef(圖片元素)、上下滑 translateY 套在 stageRef(舞台)=兩者分離不打架。
//   🔴 imageRef 未接=zoom 全程 no-op、退化為純 swipe(既有行為 byte 級不變、零回歸);pinch 手感/門檻
//   =Sean 真機驗收點(pinch 無法 jsdom/Playwright 可靠模擬,誠實邊界同 V-1f/V-2d 慣例)。
//
// 手勢模型(2026-07-09 slice 研究、親讀主流實作原始碼定門檻):
//   - 鎖軸:位移超過 AXIS_LOCK_PX 才判手勢方向;要「明顯垂直」(|dy| > |dx|×1.5)才鎖「關閉」,
//     否則預設水平=換圖(較安全、避免斜滑誤觸關閉)。參 Android SwipeToDismiss(水平需 2:1 dominance)。
//   - 垂直(關閉)= finger-follow:圖跟手指 translateY + 背景漸透;放開時距離 > 門檻 或 快速甩才關、否則彈回。
//   - 水平(換圖):放開時距離 > NAV_DISTANCE_PX 才換,無限輪播由 caller 的 goNext/goPrev 做 modulo。
//   - stage 需 CSS `touch-action: none`(見 product-page.css .pd-lb-stage):`pan-y` 會讓瀏覽器原生接管
//     垂直手勢、JS 收到 pointercancel 拿不到 finger-follow / 亦拿不到雙指縮放(MDN touch-action 查證)。
//
// 效能:拖曳/縮放期間直接改 stageRef/overlayRef/imageRef 的 style(繞過 React re-render、走 transform),放開才收斂。

import { useRef } from 'react';

// ── 門檻常數 ────────────────────────────────────────────────────────
const DISMISS_SLOW_VH = 0.3; // 慢速拖曳:需垂直拖過視窗高度 30% 才關(保守、擋手滑)
const DISMISS_FAST_VH = 0.15; // 快速甩(velocity 達標)門檻降到 15%vh
const DISMISS_MIN_PX = 120; // 慢拖 px 下限(極矮視窗保底)
const FLICK_MIN_PX = 80; // 快甩 dismiss 的 px 下限(矮視窗/橫拿避免快甩誤關;對抗審查 F2)
const FLICK_VELOCITY = 0.6; // px/ms;高於 vaul 0.4,避免帶速手滑誤關
const NAV_DISTANCE_PX = 52; // 水平換圖距離門檻
const AXIS_LOCK_PX = 14; // 移動超過此距離才鎖手勢方向(~Android slop 15px)
const VERT_DOMINANCE = 1.5; // |dy| > |dx|×1.5 才鎖「垂直=關閉」,否則預設水平=換圖
const OVERLAY_BG_ALPHA = 0.92; // 對齊 .pd-lightbox background rgba(0,0,0,0.92)
const BG_MIN_ALPHA = 0.28; // 拖到門檻時背景最透(仍留暗、圖不刺眼)
const SNAP_BACK = 'transform 0.24s cubic-bezier(0.22, 1, 0.36, 1)';
// V-2g zoom 門檻(手感=Sean 真機驗收可調)
const MAX_SCALE = 4; // 最大放大倍率(ticket 3~4x 取上緣)
const MIN_SCALE = 1; // 回不到 1 以下(<1 於 touchend 貼回 1)
// 🔴 雙擊切 1x/2x(ticket 慣例)本版**不做**:與既有「單擊關閉」衝突(首擊會先關掉)——pinch 已可雙向縮放,
// 雙擊留 Sean 真機決定要不要 + 如何與單擊關閉並存(避免盲寫誤觸關閉)。

type Axis = 'none' | 'x' | 'y';
type Mode = 'idle' | 'swipe' | 'pinch' | 'pan';

function dist(a: React.Touch, b: React.Touch): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

export type UseLightboxSwipeArgs = {
  /** 圖片總數(<2 時不換圖,仍可上下滑關閉)。 */
  count: number;
  /** 換下一張(caller 負責 modulo 無限輪播)。 */
  goNext: () => void;
  /** 換上一張(caller 負責 modulo 無限輪播)。 */
  goPrev: () => void;
  /** 關閉 lightbox。 */
  onDismiss: () => void;
};

export function useLightboxSwipe({ count, goNext, goPrev, onDismiss }: UseLightboxSwipeArgs) {
  const stageRef = useRef<HTMLDivElement>(null); // 圖片舞台(translateY 跟手)
  const overlayRef = useRef<HTMLDivElement>(null); // 整個 .pd-lightbox(拖曳時漸透背景)
  const imageRef = useRef<HTMLImageElement>(null); // V-2g:縮放/平移套此(未接=zoom no-op、純 swipe)
  const startX = useRef(0);
  const startY = useRef(0);
  const startT = useRef(0);
  const axis = useRef<Axis>('none');
  // V-2g zoom 狀態(ref=繞過 re-render、手勢期直接改 style)
  const mode = useRef<Mode>('idle');
  const scale = useRef(1);
  const tx = useRef(0);
  const ty = useRef(0);
  const pinchStartDist = useRef(0);
  const pinchStartScale = useRef(1);
  const panStartX = useRef(0);
  const panStartY = useRef(0);
  const panStartTx = useRef(0);
  const panStartTy = useRef(0);

  const applyZoom = (animate: boolean) => {
    const img = imageRef.current;
    if (!img) return;
    img.style.transition = animate ? SNAP_BACK : '';
    img.style.transform =
      scale.current > 1 ? `translate(${tx.current}px, ${ty.current}px) scale(${scale.current})` : '';
  };

  /** 平移邊界:縮放後圖片超出視窗的一半,允許往兩側各拖到剛好貼齊(不讓圖飄離視野)。 */
  const clampPan = () => {
    const img = imageRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect(); // 已含 transform 的視覺尺寸
    const baseW = rect.width / scale.current;
    const baseH = rect.height / scale.current;
    const maxX = Math.max(0, (baseW * scale.current - baseW) / 2);
    const maxY = Math.max(0, (baseH * scale.current - baseH) / 2);
    tx.current = Math.max(-maxX, Math.min(maxX, tx.current));
    ty.current = Math.max(-maxY, Math.min(maxY, ty.current));
  };

  /** V-2g:重置縮放(換圖/關閉時 caller 呼叫;避免上一張的縮放殘留到下一張)。 */
  const resetZoom = () => {
    scale.current = 1;
    tx.current = 0;
    ty.current = 0;
    mode.current = 'idle';
    applyZoom(false);
  };

  const resetVisual = (animate: boolean) => {
    const stage = stageRef.current;
    if (stage) {
      stage.style.transition = animate ? SNAP_BACK : '';
      stage.style.transform = '';
    }
    const overlay = overlayRef.current;
    if (overlay) {
      overlay.style.transition = animate ? 'background 0.24s ease' : '';
      overlay.style.background = '';
    }
  };

  const onTouchStart = (e: React.TouchEvent) => {
    // V-2g 雙指 → pinch(記錄起始間距/倍率)
    if (e.touches.length >= 2 && imageRef.current) {
      const [a, b] = [e.touches[0]!, e.touches[1]!];
      mode.current = 'pinch';
      pinchStartDist.current = dist(a, b) || 1;
      pinchStartScale.current = scale.current;
      axis.current = 'none';
      return;
    }
    if (e.touches.length > 1) { mode.current = 'idle'; axis.current = 'none'; return; } // 無 imageRef 的多指=沿用舊守門(不當單指拖曳、F3)
    const t = e.touches[0];
    if (!t) return;
    startX.current = t.clientX;
    startY.current = t.clientY;
    startT.current = e.timeStamp;
    axis.current = 'none';
    // V-2g:已放大 → 單指=平移(不進 swipe);否則走既有 swipe。
    if (scale.current > 1 && imageRef.current) {
      mode.current = 'pan';
      panStartX.current = t.clientX;
      panStartY.current = t.clientY;
      panStartTx.current = tx.current;
      panStartTy.current = ty.current;
    } else {
      mode.current = 'swipe';
      resetVisual(false); // 清掉上次手勢殘留(如系統中斷 touchcancel 後未復位)、即時跟手無過渡(F1 自癒)
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (mode.current === 'pinch') {
      if (e.touches.length < 2) return;
      const d = dist(e.touches[0]!, e.touches[1]!);
      const next = pinchStartScale.current * (d / pinchStartDist.current);
      scale.current = Math.max(MIN_SCALE * 0.9, Math.min(MAX_SCALE, next)); // 暫允微低於 1(touchend 貼回)、給回彈手感
      clampPan();
      applyZoom(false);
      return;
    }
    if (mode.current === 'pan') {
      const t = e.touches[0];
      if (!t) return;
      tx.current = panStartTx.current + (t.clientX - panStartX.current);
      ty.current = panStartTy.current + (t.clientY - panStartY.current);
      clampPan();
      applyZoom(false);
      return;
    }
    // ── 既有 swipe(scale===1 單指)path,byte 級不變 ──
    if (e.touches.length > 1) return; // 多指不當單指拖曳(F3)
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - startX.current;
    const dy = t.clientY - startY.current;
    if (axis.current === 'none') {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
      axis.current = Math.abs(dy) > Math.abs(dx) * VERT_DOMINANCE ? 'y' : 'x';
    }
    if (axis.current === 'y') {
      const stage = stageRef.current;
      if (stage) stage.style.transform = `translateY(${dy}px)`;
      const overlay = overlayRef.current;
      if (overlay) {
        const threshold = Math.max(DISMISS_MIN_PX, DISMISS_SLOW_VH * window.innerHeight);
        const p = Math.min(1, Math.abs(dy) / threshold);
        const alpha = OVERLAY_BG_ALPHA - (OVERLAY_BG_ALPHA - BG_MIN_ALPHA) * p;
        overlay.style.background = `rgba(0, 0, 0, ${alpha.toFixed(3)})`;
      }
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (mode.current === 'pinch') {
      if (e.touches.length >= 1) return; // 還有手指留著(pinch→pan 轉換)→ 待下個 touchstart 重判
      if (scale.current < 1.05) { scale.current = 1; tx.current = 0; ty.current = 0; }
      else clampPan();
      mode.current = 'idle';
      applyZoom(true);
      return;
    }
    if (mode.current === 'pan') {
      clampPan();
      applyZoom(true);
      mode.current = 'idle';
      return;
    }

    const t = e.changedTouches[0];
    const currentAxis = axis.current;
    axis.current = 'none';
    mode.current = 'idle';
    if (!t) {
      resetVisual(true);
      return;
    }
    const dx = t.clientX - startX.current;
    const dy = t.clientY - startY.current;
    const dt = Math.max(1, e.timeStamp - startT.current);

    if (currentAxis === 'y') {
      const vh = window.innerHeight;
      const slow = Math.max(DISMISS_MIN_PX, DISMISS_SLOW_VH * vh);
      const fast = Math.max(FLICK_MIN_PX, DISMISS_FAST_VH * vh);
      const velocity = Math.abs(dy) / dt;
      const dismiss = Math.abs(dy) > slow || (velocity > FLICK_VELOCITY && Math.abs(dy) > fast);
      if (dismiss) onDismiss();
      else resetVisual(true);
      return;
    }
    if (currentAxis === 'x' && count > 1 && Math.abs(dx) > NAV_DISTANCE_PX) {
      if (dx < 0) goNext();
      else goPrev();
    }
  };

  const onTouchCancel = () => {
    axis.current = 'none';
    mode.current = 'idle';
    resetVisual(false);
  };

  return {
    stageRef,
    overlayRef,
    imageRef,
    resetZoom,
    /** 目前是否放大(元件用:zoom 時單擊不關閉、cursor 切換)。 */
    isZoomed: () => scale.current > 1,
    stageProps: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel },
  };
}
