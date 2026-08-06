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
  // 🔴 **原型鏈那組向量不在本檔**(#332-2 起):守門已於 `settings-result-banner.tsx` 硬化成
  //    `Object.hasOwn`,而「本元件對任何非自有 key 都不渲染」這個不變量在**元件層**成立、
  //    與是哪一張碼表無關 ⇒ 五個向量釘在 `components/settings/settings-result-banner.test.tsx`。
  //    本檔只負責**供應商這張碼表**自己的事(每個碼有文案、staff 專屬碼沒被抄過來、文案措辭)。
  //    ⇒ 下面的 `nope` / `audit_failed` 留著不動:它們驗的是「一般未知碼」那條路徑。
  it.each(['nope', 'audit_failed'])(
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
    // 🔴 codex K2 must-fix 1:banner 只看得到 `?r=`,看不到定位有沒有成功
    //    (沒帶 `q` / `q` 命中 0 筆 / 名單載入失敗時都沒有定位這回事)
    //    ⇒ 文案**不得**宣稱清單已經定位好了。那句話由 `page.tsx` 的 `locating` 分支負責,
    //    它是唯一看得到結果的地方。
    expect(text).not.toContain('已定位');
  });

  // 🔴🔴 改名撞名那則:員工最可能的誤讀是「我的改名成功了」(Fable R4 must-fix 2)——
  //    清單被篩到**佔用那個名字的別家**,而他要改的那一家仍叫舊名字、從畫面上消失了。
  //    ⇒ 文案必須三件事都講:①沒成功 ②篩到的不是你要改的那家 ③怎麼找回它。
  it('should tell the employee the rename did NOT happen and what the filtered row is', () => {
    const { text } = SUPPLIER_RESULT_MESSAGES.duplicate_rename;

    expect(text).toContain('改名沒有成功');
    expect(text).toContain('不是你要改名的那一家');
    expect(text).toContain('顯示全部');
    // 🔴 反面:不得沿用新增那則的字面,那句話在改名路徑上是錯的。
    expect(text).not.toContain('沒有新增');
  });

  it('should keep the create-path and rename-path duplicate messages distinct', () => {
    // 少了這條,把兩則寫成同一段文字仍會通過上面每一條(它們各自只看自己那則)。
    expect(SUPPLIER_RESULT_MESSAGES.duplicate_rename.text).not.toBe(
      SUPPLIER_RESULT_MESSAGES.duplicate.text,
    );
  });

  // 🔴 bug 的文案必須叫他**停手**,不是「再試一次」——
  //    其中一支代表已經多了一筆刪不掉的供應商,再按一次可能再多一筆。
  it('should tell the employee to stop rather than retry on a caller bug', () => {
    expect(SUPPLIER_RESULT_MESSAGES.bug.text).toContain('不要重複送出');
    expect(SUPPLIER_RESULT_MESSAGES.bug.tone).toBe('error');
    expect(SUPPLIER_RESULT_MESSAGES.bug.text).not.toContain('稍後再試');
  });
});
