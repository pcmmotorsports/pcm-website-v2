// hct-pickup-confirm.test.ts — 守「叫人去按某顆鈕」那一類句子(2026-09-16 新建)。
//
// 🔴 **為什麼非要有它**:2026-09-16 那顆鈕改名成「跟新竹要託運單號」,而 `HCT_PICKUP_REQUIRED_MESSAGE`
//    逐字還寫著「再按【送新竹】」⇒ **它叫員工去按一顆已經不存在的鈕**,而**全套測試沒有一格紅**。
//    ⇒ 📌 那不是「文案不一致」,是【指令錯誤】—— 而它安靜了半天,直到有人 grep 才看見。
//
// ⚠️ **它擋得住什麼、擋不住什麼**:
//   擋得住 —— 退役的動作名(「送新竹」)重新長回這幾句裡;指路句少掉其中一顆鈕的名字。
//   **擋不住** —— 那顆鈕【自己】被改名而沒人改常數(那時這裡照樣全綠,因為兩邊同源)。
//     🛑 那一格靠的是**碼的形狀**:鈕的 JSX 與這幾句都引同一個常數 ⇒ 改一處兩邊一起動。
//     ⇒ 📌 **同源是它的保護, 也是這道尺的天花板** —— 兩件事要分開讀。

import { describe, expect, it } from 'vitest';

import {
  HCT_DISPATCH_BUTTON,
  HCT_PICKUP_CONFIRM_LABEL,
  HCT_PICKUP_REQUIRED_MESSAGE,
  HCT_REQUEST_NUMBER_BUTTON,
  needsHctPickupConfirm,
} from './hct-pickup-confirm';

// 🔴 **手打字面,刻意不引常數** —— 這一格要的是【外部觀點】:
//    引同一顆常數的話,常數被改壞時這格會跟著改壞而永遠綠。
const RETIRED_ACTION_NAME = '送新竹';

describe('🔴 指路句不得指向一顆不存在的鈕', () => {
  it('🔴 退役的動作名「送新竹」不得出現', () => {
    expect(
      HCT_PICKUP_REQUIRED_MESSAGE.includes(RETIRED_ACTION_NAME),
      `那顆鈕 2026-09-16 已改名為「${HCT_REQUEST_NUMBER_BUTTON}」;` +
        '寫「送新竹」等於叫員工去找一顆畫面上沒有的鈕。',
    ).toBe(false);
  });

  it('🔴 兩顆鈕的名字都要在 —— 少一顆這條路就走不完', () => {
    // 流程:只建箱 → 跟新竹要託運單號 → 出貨清單叫車 → 系統自己標出貨。
    // 🛑 中間那一步不能省:沒有託運單號, 叫車那顆按下去新竹不知道要收哪一箱。
    expect(HCT_PICKUP_REQUIRED_MESSAGE, '少了「要託運單號」那一步').toContain(
      HCT_REQUEST_NUMBER_BUTTON,
    );
    expect(HCT_PICKUP_REQUIRED_MESSAGE, '少了「叫車」那一步 ⇒ 貨永遠留在店裡').toContain(
      HCT_DISPATCH_BUTTON,
    );
    // 🔴 而要帶【路徑】,不是只寫「到出貨清單」—— 2026-09-16 實證:Sean 在被口頭告知之後
    //    仍然回訂單頁按那顆鈕 ⇒ 畫面上的字勝過口頭給的正確資訊。
    expect(HCT_PICKUP_REQUIRED_MESSAGE, '沒帶「左邊選單的」⇒ 他找不到那一頁').toContain('左邊選單');
  });

  // 🔵 **負對照:沒有它,上面兩格在「這幾個常數變成空字串」時照樣綠。**
  it('🔵 負對照:這幾個常數不是空的', () => {
    expect(HCT_REQUEST_NUMBER_BUTTON.length).toBeGreaterThan(0);
    expect(HCT_DISPATCH_BUTTON.length).toBeGreaterThan(0);
    expect(HCT_PICKUP_CONFIRM_LABEL.length).toBeGreaterThan(0);
  });
});

describe('🔵 勾選框只掛在新竹(既有行為,本片沒動)', () => {
  it('hct 要勾,其他貨運商不要', () => {
    expect(needsHctPickupConfirm('hct')).toBe(true);
    expect(needsHctPickupConfirm('other')).toBe(false);
    expect(needsHctPickupConfirm('')).toBe(false);
  });
});
