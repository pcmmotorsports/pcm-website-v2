// useLightboxSwipe.ts — 全螢幕看大圖 lightbox 的觸控手勢(共用 ProductGallery + SwatchLightbox)
//
// Sean 2026-07-09 手機肉眼驗回饋:
//   1. 上／下滑要能「關閉」大圖(原本只有 X 鈕 / 點空白 / ESC);滑動要跟手,門檻偏保守——
//      「避免不小心手滑一下就切掉」。
//   2. 左右滑 + 箭頭要「無限輪播」(滑到最後一張再往右 → 回第一張;第一張往左 → 到最後一張)。
//
// 手勢模型(2026-07-09 slice 研究、親讀主流實作原始碼定門檻):
//   - 鎖軸:位移超過 AXIS_LOCK_PX 才判手勢方向;要「明顯垂直」(|dy| > |dx|×1.5)才鎖「關閉」,
//     否則預設水平=換圖(較安全、避免斜滑誤觸關閉)。參 Android SwipeToDismiss(水平需 2:1 dominance)。
//   - 垂直(關閉)= finger-follow:圖跟手指 translateY + 背景漸透(業界共識、4/4 查證來源皆此模式:
//     PhotoSwipe / Telegram / vaul / yet-another-react-lightbox);放開時距離 > 門檻 或 快速甩才關、否則彈回。
//   - 水平(換圖):放開時距離 > NAV_DISTANCE_PX 才換,無限輪播由 caller 的 goNext/goPrev 做 modulo。
//   - stage 需 CSS `touch-action: none`(見 product-page.css .pd-lb-stage):PhotoSwipe 實測用此值;
//     `pan-y` 會讓瀏覽器原生接管垂直手勢、JS 收到 pointercancel 拿不到 finger-follow(MDN touch-action 查證)。
//
// 效能:拖曳期間直接改 stageRef/overlayRef 的 style(繞過 React re-render、走 transform),放開才 setState。
//
// 🔴 門檻取值(來源:2026-07-09 查證原始碼 + 保守綜合建議):
//   查證區間 — PhotoSwipe ~13.3%vh / Telegram ~16.7%vh / vaul 25% or 0.4px/ms / yarl 固定 60px。
//   PCM 優先「防誤觸」→ 慢拖門檻取 30%vh(高於查證上緣 25%)、快甩門檻降 15%vh 但 velocity 需 > 0.6px/ms
//   (高於 vaul 0.4,避免手滑帶速也誤關)。

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

type Axis = 'none' | 'x' | 'y';

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
  const startX = useRef(0);
  const startY = useRef(0);
  const startT = useRef(0);
  const axis = useRef<Axis>('none');

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
    if (e.touches.length > 1) { axis.current = 'none'; return; } // 多指(pinch)不當單指拖曳(F3)
    const t = e.touches[0];
    if (!t) return;
    startX.current = t.clientX;
    startY.current = t.clientY;
    startT.current = e.timeStamp;
    axis.current = 'none';
    resetVisual(false); // 清掉上次手勢可能殘留的位移/背景(如系統中斷 touchcancel 後未復位)、即時跟手無過渡(F1 自癒)
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length > 1) return; // 多指不當單指拖曳(F3)
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - startX.current;
    const dy = t.clientY - startY.current;
    if (axis.current === 'none') {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
      // 明顯垂直才鎖關閉,否則預設水平(換圖)—— 偏向不誤觸關閉
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
    // axis 'x':拖曳期間不位移(放開才換圖),與原實作一致、避免 track 半截狀態
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const t = e.changedTouches[0];
    const currentAxis = axis.current;
    axis.current = 'none';
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
      const fast = Math.max(FLICK_MIN_PX, DISMISS_FAST_VH * vh); // 快甩也給 px 下限(F2)
      const velocity = Math.abs(dy) / dt;
      const dismiss = Math.abs(dy) > slow || (velocity > FLICK_VELOCITY && Math.abs(dy) > fast);
      if (dismiss) onDismiss(); // 卸載時 style 隨 DOM 移除、不需手動 reset
      else resetVisual(true); // 未過門檻 → 彈回
      return;
    }
    if (currentAxis === 'x' && count > 1 && Math.abs(dx) > NAV_DISTANCE_PX) {
      if (dx < 0) goNext();
      else goPrev();
    }
  };

  // 系統中斷手勢(來電/通知下拉/邊緣返回/截圖)發 touchcancel 而非 touchend → 立即復位,
  // 否則圖停在半拖位置、背景卡半透明(對抗審查 F1)。
  const onTouchCancel = () => {
    axis.current = 'none';
    resetVisual(false);
  };

  return { stageRef, overlayRef, stageProps: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel } };
}
