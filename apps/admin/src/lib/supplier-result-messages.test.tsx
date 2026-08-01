// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SettingsResultBanner } from '../components/settings/settings-result-banner';
import {
  SUPPLIER_RESULT_MESSAGES,
  type SupplierResultCode,
} from './supplier-result-messages';

afterEach(cleanup);

// 🔴 為什麼要 jsdom 渲染而不是只斷言那個物件:驗收 7 的字面是「**banner 不顯示任何東西**」。
//    只斷言 `SUPPLIER_RESULT_MESSAGES['nope'] === undefined` 證的是查表結果,
//    證不到 banner 拿到 undefined 之後**真的**什麼都不畫(它也可能畫一個空框)。

// 🔴 **從碼表本身導出,不手抄一份**(codex K2 nit):手抄的陣列不是窮盡守門 ——
//    新增一個結果碼卻忘了加進陣列,型別與測試**都會過**,那個碼的文案永遠沒被驗過。
//    從 `Object.keys` 導出之後,任何新碼自動被下面每一條涵蓋。
const ALL_CODES = Object.keys(
  SUPPLIER_RESULT_MESSAGES,
) as SupplierResultCode[];

describe('SUPPLIER_RESULT_MESSAGES', () => {
  it.each(ALL_CODES)('should render a non-empty message for %s', (code) => {
    render(
      <SettingsResultBanner code={code} messages={SUPPLIER_RESULT_MESSAGES} />,
    );

    // 🔴 用原生 textContent 比對 —— 本 repo **沒有** jest-dom(root vitest.config 無 setupFiles),
    //    `toHaveTextContent` / `toBeEmptyDOMElement` 在這裡不存在。
    // 🔴 只比對「等於自己」是自我參照:文案改成空字串照樣綠。
    //    測試名字承諾了 non-empty ⇒ 就要真的釘住 non-empty。
    expect(screen.getByRole('status').textContent).toBe(
      SUPPLIER_RESULT_MESSAGES[code].text,
    );
    expect(screen.getByRole('status').textContent).not.toBe('');
  });

  // ── 驗收 7:未知的 ?r= 值 ⇒ 什麼都不顯示 ─────────────────────────
  // 🔴 `?r=` 是 URL 上的**任意**字串,不是我們的碼表 ⇒ 這條的輸入面是真的、不是假想的。
  it.each(['nope', 'audit_failed', '__proto__', 'constructor', 'toString'])(
    'should render nothing for the unknown result code %s',
    (code) => {
      const { container } = render(
        <SettingsResultBanner code={code} messages={SUPPLIER_RESULT_MESSAGES} />,
      );

      expect(container.innerHTML).toBe('');
      // 🔴 下面這條**不是第二份獨立證據**(codex K2 nit):空的 innerHTML 已經嚴格蘊含
      //    查不到 status。留著只是讓失敗訊息更好讀,**不得算成兩個證據面**。
      expect(screen.queryByRole('status')).toBeNull();
    },
  );

  // 🔴 `audit_failed` 出現在上面那組不是湊數:它是 **staff** 的碼。
  //    供應商這片沒有稽核 code(RPC 同交易寫)⇒ 這個碼**不該**有文案。
  //    哪天有人照抄 staff 的碼表過來,這條會轉紅。
  it('should not carry over staff-only codes', () => {
    expect(
      (SUPPLIER_RESULT_MESSAGES as Record<string, unknown>).audit_failed,
    ).toBeUndefined();
  });

  // 🔴 Sean 2026-08-02 拍板 Q2=A:訊息要指路到「按該列的啟用」,而**不是**系統代按。
  //    這條釘的是拍板的文案面 —— 把它改成「已自動為您啟用」會轉紅。
  it('should tell the employee to press 啟用 themselves on a duplicate', () => {
    const { text } = SUPPLIER_RESULT_MESSAGES.duplicate;

    expect(text).toContain('已停用');
    // 🔴 只檢查含「啟用」不夠(codex K2 nit):「已停用項目**已自動啟用**」也含這兩個詞,
    //    卻與 Q2=A「系統不代按」完全相反。要釘的是**由誰按** ⇒ 正面釘「按該列的」、
    //    反面排除「自動」。
    expect(text).toContain('按該列的');
    expect(text).not.toContain('自動');
  });

  // 🔴 bug 的文案必須叫他**停手**,不是「再試一次」——
  //    其中一支代表已經多了一筆刪不掉的供應商,再按一次可能再多一筆。
  it('should tell the employee to stop rather than retry on a caller bug', () => {
    expect(SUPPLIER_RESULT_MESSAGES.bug.text).toContain('不要重複送出');
    expect(SUPPLIER_RESULT_MESSAGES.bug.tone).toBe('error');
    expect(SUPPLIER_RESULT_MESSAGES.bug.text).not.toContain('稍後再試');
  });
});
