// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { TierEditSubmitButton, confirmSentence } from './tier-edit-submit';
import { TIER_VALUE_FIELD, TIER_NOTE_FIELD } from '../../lib/customers/tier-form';

// tier-edit-submit.test.tsx — 「變更會員等級」那顆鈕的護欄守門。
// 拍板來源:Sean 2026-08-28 傍晚題「**換等級護欄現在做?**」答**甲**(逐字 `ｑ３：甲`;
// 落點 memory `project_0828-evening-three-rulings.md`。**抄題目文字不抄題號** —— 同一天有多個 `Q3=甲`)。
//
// 🔴 **本檔斷言的是【行為】,不是 markup** —— 前一版斷言「確認前沒有 type=submit 的鈕」,
//    那是**標記層**的不變量,而 R5 code-reviewer 用真 Chromium 量到:**那個不變量成立,而護欄照樣被繞過**
//    (表單沒有 submit 鈕、只剩一個會擋隱式提交的欄位 ⇒ 在「變更原因」按 Enter 直接送出)。
//    ⇒ 現在釘的是:**submit 事件發生時,那個 form action 到底有沒有被呼叫。**
//    📌 **一個標記層的不變量可以完全成立,而它保護的那件事完全沒發生。**
//
// 🔴 **MF6:前一版的 harness 註解說謊,而它說的謊正好蓋住 MF1**
//    前一版逐字寫「有 select、**有必填 note**…**與正式表單同形狀**」,而那個 form **只有 select**。
//    ⇒ 測試世界的 blocking field = 0、正式表單 = 1,**而 1 正是會觸發隱式提交的那個數**
//    ⇒ **這片最貴的洞,在自己的守門裡沒有形狀。** 本版把 note 欄補上了。
//
// 🔴 **本檔驗不到的三格,明寫**(不是疏漏,是這片能力的上界):
//    ① 員工【真的會停下來讀】那句話嗎 —— 測試只證明那句話在畫面上,不證明有人看它。
//    ② 經銷價上線那天這道護欄還在不在 —— 機械訊號在 `#215` 連帶段(`price_store` 出現 > 0 的列)。
//    ③ `actor` 是不是真名 —— 本窗未讀到該值。**護欄擋得住【按錯】,擋不住【否認】。**
//    🔴🔴 **Enter(瀏覽器隱式提交)【沒有自動守門】,而這一格曾經真的出事過。**
//       codex 2026-08-28 must-fix:前一版的 `[1]` 與 `[2]` **跑的是同一發 `fireEvent.submit(form)`**
//       ⇒ 刪掉 `[2]` 不會少任何覆蓋,**而兩格並排會讀成「這條路有兩層守門」** ⇒ 已刪掉重複那格。
//       ⇒ 現在 `[1]` 量的是「**不經過按鈕的 submit 一樣被擋**」—— 那是**最接近的可測代理,不是同一件事**。
//       ⇒ 真正的 Enter 要在**真瀏覽器**量(`docs/runbooks/local-admin-with-real-data-probe.md`);
//         R5 code-reviewer 已用真 Chromium 量過**修前**那一版,**修後這一版沒有人在真瀏覽器量過**。
//    ⚠️ 而 jsdom **不能**用來量真瀏覽器的隱式提交(Enter)—— 本檔量的是**我們的閘在不在那條路上**,
//       不是瀏覽器會不會走那條路。**那兩件事只有前者是我們能保證的。**

afterEach(cleanup);

type Tier = 'general' | 'store' | 'premiumStore';

/**
 * harness:**與正式表單同形狀** —— 一個 `<select name='tier'>` + **一個 `required` 的文字欄**
 * (`tier-edit-form.tsx:54-60`;`required` 那一行逐字在 **`:59`**),因為 blocking field 的**數量**
 * 正是 MF1 那條路的成因。`action` 是真的 React 19 form action ⇒ 有沒有送出量得到。
 */
function renderForm(opts: { currentTier: Tier; select?: Tier | string; note?: string }) {
  const { currentTier, select = currentTier, note = '審核通過' } = opts;
  const action = vi.fn();
  const utils = render(
    <form action={action}>
      <select name={TIER_VALUE_FIELD} defaultValue={select}>
        <option value='general'>一般</option>
        <option value='store'>店家</option>
        <option value='premiumStore'>高級</option>
        <option value='zzz-not-a-tier'>壞值</option>
      </select>
      <input name={TIER_NOTE_FIELD} type='text' required defaultValue={note} />
      <TierEditSubmitButton currentTier={currentTier} />
    </form>,
  );
  const form = utils.container.querySelector('form')!;
  return { ...utils, form, action };
}

const settle = () => new Promise((r) => setTimeout(r, 20));
const sentence = () => screen.getByTestId('tier-confirm-sentence').textContent ?? '';
const setSelect = (form: HTMLFormElement, v: string) =>
  fireEvent.change(form.querySelector('select')!, { target: { value: v } });

describe('換等級護欄', () => {
  it('[1] 第一段:submit 事件不會送出,而是打開確認段(行為,不是 markup)', async () => {
    const { form, action } = renderForm({ currentTier: 'general', select: 'store' });
    fireEvent.submit(form);
    await settle();
    // 🔴 怎麼會紅:把 form 層那道 listener 拿掉 ⇒ action 被呼叫 ⇒ 這裡 0 變 1。
    expect(action, '第一段就送出去了 ⇒ 確認段等於不存在').toHaveBeenCalledTimes(0);
    expect(sentence()).toContain('店家會員');
  });

  it('[3] 確認句同時印【舊值】與【新值】', async () => {
    const { form } = renderForm({ currentTier: 'general', select: 'store' });
    fireEvent.submit(form);
    await settle();
    // 🔴 怎麼會紅:只印新值(拿掉 `TIER_LABEL[from]`)⇒ 第一條斷言紅。
    expect(sentence(), '只印結果的確認框，擋掉的是同一群人').toContain('一般會員');
    expect(sentence()).toContain('店家會員');
  });

  it('[4] 🔴 MF2:確認之後改下拉 ⇒ 不送出,而且句子換成新的 X→Y', async () => {
    const { form, action } = renderForm({ currentTier: 'general', select: 'store' });
    fireEvent.submit(form);
    await settle();
    expect(sentence()).toContain('店家會員');

    setSelect(form, 'premiumStore'); // 確認段【已經在畫面上】之後才改
    fireEvent.submit(form);
    await settle();
    // 🔴 怎麼會紅:submit 那一刻不重讀比對 ⇒ 直接送出 ⇒ 這裡 0 變 1(＝確認了 A 送出 B)。
    expect(action, '確認了 A 卻送出 B').toHaveBeenCalledTimes(0);
    expect(sentence()).toContain('PREMIUM STORE');
  });

  it('[5] 正對照:值沒被改過 ⇒ 第二次送出【真的會送出去】(閘不是恆擋)', async () => {
    const { form, action } = renderForm({ currentTier: 'general', select: 'store' });
    fireEvent.submit(form);
    await settle();
    fireEvent.submit(form);
    await settle();
    // 🔴 這一格是本檔的正對照:沒有它,一個「永遠 preventDefault」的閘也會讓上面四格全綠。
    expect(action, '閘恆擋 ⇒ 這顆鈕永遠送不出去').toHaveBeenCalledTimes(1);
  });

  it('[6] 取消:回到第一段', async () => {
    const { form } = renderForm({ currentTier: 'general', select: 'store' });
    fireEvent.submit(form);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    // 🔴 怎麼會紅:取消的 onClick 不呼叫 setTarget(null) ⇒ 確認句還在 ⇒ query 不會 throw。
    expect(screen.queryByTestId('tier-confirm-sentence')).toBeNull();
  });

  it('[7] 既有行為零改動:變更原因沒填 ⇒ 不進確認段', async () => {
    const { form, action } = renderForm({ currentTier: 'general', select: 'store', note: '' });
    fireEvent.submit(form);
    await settle();
    // 🔴 怎麼會紅:拿掉 `if (!form.reportValidity()) return;` ⇒ 確認段照樣出現。
    //    ⚠️ 射程限制(R5 nit N1):這裡量的是【我們有沒有問過 reportValidity 並尊重它的答案】,
    //       **不是**「瀏覽器的必填真的擋得住」—— 後者是瀏覽器的事,不是我們能保證的。
    expect(screen.queryByTestId('tier-confirm-sentence')).toBeNull();
    expect(action).toHaveBeenCalledTimes(0);
  });

  it('[8] 🔴 N4:認不得的值 ⇒ 不送出,而且退回第一段(不印「A → A 等於沒變」)', async () => {
    const { form, action } = renderForm({ currentTier: 'general', select: 'store' });
    fireEvent.submit(form);
    await settle();
    setSelect(form, 'zzz-not-a-tier');
    fireEvent.submit(form);
    await settle();
    // 🔴 怎麼會紅:`readTier` 認不得就退回現值 ⇒ 畫面印「一般會員 → 一般會員」而壞值照樣送出。
    expect(action, '認不得的值被送出去了').toHaveBeenCalledTimes(0);
    expect(screen.queryByTestId('tier-confirm-sentence')).toBeNull();
  });

  it('[9] 🔴 MF8:確認句是 live region(報讀器會念),且焦點接得住', async () => {
    const { form } = renderForm({ currentTier: 'general', select: 'store' });
    fireEvent.submit(form);
    await settle();
    // 🔴 怎麼會紅:拿掉 role='status' ⇒ 這裡紅。理由不是品味 ——
    //    `admin-form.tsx:47` 逐字把 aria 定為「無障礙的地板」。
    expect(screen.getByTestId('tier-confirm-sentence').getAttribute('role')).toBe('status');
    // 🔴 怎麼會紅:拿掉那個 focus() 的 effect ⇒ activeElement 會是 BODY。
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '確認變更' }));
  });

  it('[10] 文案守門:帶著【一眼看得出未拍板】的前綴', () => {
    // 🔴 怎麼會紅:把 PLACEHOLDER_PREFIX 換成一句像成品的文案 ⇒ 這裡紅。
    // ⚠️ 這一格守的是【那個字還在】,不是任何行為(R5 nit N2)—— 不要把它算進行為覆蓋。
    expect(
      confirmSentence('general', 'store'),
      '換正式文案要先去 docs/phase-1-backlog.md #297 拿授權,不要直接改這個字串',
    ).toContain('【暫定文案・未拍板 #297】');
    expect(confirmSentence('general', 'store')).toContain('一般會員 → 店家會員');
  });
});
