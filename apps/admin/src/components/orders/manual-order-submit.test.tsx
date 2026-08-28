// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { renderToStaticMarkup } from 'react-dom/server';
import { ManualOrderSubmit } from './manual-order-submit';

afterEach(cleanup);

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function renderForm(withRadio: boolean) {
  return render(
    <form data-testid='f'>
      {withRadio && <input type='radio' name='customer_user_id' value={USER_A} aria-label='甲' />}
      <ManualOrderSubmit />
    </form>,
  );
}

const btn = () => screen.getByTestId('manual-order-submit') as HTMLButtonElement;

// ── 🔴🔴 R4-MF2:沒有選客人,那顆「建立訂單」不得按得下去 ────────────────────────────
//  病:按得下去 ⇒ 解析器擋(對的)⇒ 而它擋的方式是 **`redirect()`**
//     ⇒ 運費、地址、發票、每一列品項**全部消失**,只剩一個 `mrid`。
//  📌 **一道正確運作的守門,把流量推進了這一片本來要修的那個病。**
describe('🔴🔴 R4-MF2:送出鈕由【DOM 有沒有一顆被選起來的 radio】決定', () => {
  it('一顆 radio 都還沒畫出來(還沒搜)⇒ 灰的,而且有一句話說現在缺什麼', () => {
    renderForm(false);
    expect(btn().disabled).toBe(true);
    expect(screen.getByTestId('manual-order-submit-hint').textContent).toContain('挑一位客人');
  });

  it('有候選但一個都沒點 ⇒ 還是灰的', () => {
    renderForm(true);
    expect(btn().disabled).toBe(true);
  });

  it('🔴 點下去 ⇒ 亮起來,那句提示同時消失', () => {
    renderForm(true);
    fireEvent.click(screen.getByRole('radio', { name: '甲' }));
    expect(btn().disabled).toBe(false);
    expect(screen.queryByTestId('manual-order-submit-hint')).toBeNull();
  });

  it('🔴 取消勾選(改選同組別顆之外的情況)⇒ 回到灰的', () => {
    renderForm(true);
    const radio = screen.getByRole('radio', { name: '甲' }) as HTMLInputElement;
    fireEvent.click(radio);
    expect(btn().disabled).toBe(false);
    // 直接改 DOM 再發一次 change —— 模擬「那一顆被移除選取」
    radio.checked = false;
    fireEvent.change(radio);
    expect(btn().disabled).toBe(true);
  });

  // 🔴🔴 這一格量的是**另一個訊號**:剛建好的那位是用 `defaultChecked` 畫進來的,
  //    它**不會發 `change` 事件** ⇒ 只掛 `change` 監聽的話,畫面上明明打勾了而按鈕還是灰的。
  //    ⇒ 少了 `MutationObserver` 的世界,上面每一格仍然全綠,只有這一格會紅。
  it('radio 是【後來才被畫進 DOM】而且自帶打勾 ⇒ 按鈕要自己亮起來', async () => {
    const { container } = renderForm(false);
    expect(btn().disabled).toBe(true);

    await act(async () => {
      const form = screen.getByTestId('f');
      const el = container.ownerDocument.createElement('input');
      el.type = 'radio';
      el.name = 'customer_user_id';
      el.value = USER_A;
      el.defaultChecked = true;
      form.insertBefore(el, form.firstChild);
    });

    await waitFor(() => expect(btn().disabled).toBe(false));
  });

  it('🔴 對照組:後來畫進去的是【別的欄位】⇒ 按鈕不得亮(不然它只是「有東西變了就亮」)', async () => {
    const { container } = renderForm(false);
    await act(async () => {
      const form = screen.getByTestId('f');
      const el = container.ownerDocument.createElement('input');
      el.type = 'radio';
      el.name = 'something_else';
      el.defaultChecked = true;
      form.insertBefore(el, form.firstChild);
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(btn().disabled).toBe(true);
  });
});

// ── 🔴🔴 隱式送出:守門掛在【整張表單】上,不是掛在我知道的那幾個框上 ──────────────
//  這一族是**真瀏覽器量出來的**(2026-08-28,`localhost:3011`):
//    在客人電話框按 Enter ⇒ 不送出 ✅ / 🔴 在**運費**框按 Enter ⇒ **送出、換頁、值全清**
//  📌 我照著 finding 的【例子】修,而 finding 講的是【類】。
//  ⚠️ 效度限制:jsdom **不實作隱式送出** ⇒ 這裡量的是「那一發有沒有被 cancel」,
//     不是「表單有沒有真的被送出去」。真瀏覽器那一格另外跑,見交件檔。
describe('🔴🔴 隱式送出:表單裡【任何】文字框按 Enter 都不得送出', () => {
  function renderFullForm() {
    return render(
      <form data-testid='f'>
        <input type='radio' name='customer_user_id' value={USER_A} aria-label='甲' defaultChecked />
        <input name='shipping_fee' aria-label='運費' defaultValue='150' />
        <input name='ship_to_line' aria-label='地址' />
        <textarea aria-label='備註' />
        <ManualOrderSubmit />
      </form>,
    );
  }

  it('運費框按 Enter ⇒ 被擋下來(這一格就是真瀏覽器抓到的那一發)', () => {
    renderFullForm();
    expect(fireEvent.keyDown(screen.getByLabelText('運費'), { key: 'Enter' })).toBe(false);
  });

  it('地址框按 Enter ⇒ 一樣被擋(證明它不是只認得運費那一個 name)', () => {
    renderFullForm();
    expect(fireEvent.keyDown(screen.getByLabelText('地址'), { key: 'Enter' })).toBe(false);
  });

  it('🔴 對照組:按別的鍵不擋(不然這道閘是恆擋、量不出判別力)', () => {
    renderFullForm();
    expect(fireEvent.keyDown(screen.getByLabelText('運費'), { key: 'a' })).toBe(true);
  });

  it('🔴 對照組:`textarea` 裡的 Enter【不擋】—— 那裡的 Enter 是換行,本來就不送出', () => {
    renderFullForm();
    expect(fireEvent.keyDown(screen.getByLabelText('備註'), { key: 'Enter' })).toBe(true);
  });

  it('🔴 對照組:送出鈕自己身上的 Enter【不擋】—— 不然員工用鍵盤永遠送不出去', () => {
    renderFullForm();
    expect(fireEvent.keyDown(btn(), { key: 'Enter' })).toBe(true);
  });
});

// ── 🔴🔴 R6:沒 hydrate 那個世界要【停用 + 說載入中】,不是亮著 ────────────────────────
//  ⛔ ~~R5-F4 的修法:null ⇒ 亮著(退回沒有這道閘的舊行為)~~
//  🔴 codex R6 推翻它:沒 hydrate 的世界裡 **picker 根本選不了任何人**(搜尋是 client action)
//     ⇒ 那顆亮著的鈕**只可能**產生一種結果:送出 ⇒ 解析器擋 ⇒ PRG ⇒ 整張值清空。
//     📌 **我為了修「按不下去」, 做出了一顆【按下去一定會弄丟資料】的按鈕。**
describe('🔴🔴 R6:SSR(還沒 hydrate)⇒ 停用,而且說的是「載入中」不是「先挑客人」', () => {
  it('SSR 的 HTML:按鈕停用 + 那句話是【載入中】', () => {
    const html = renderToStaticMarkup(<ManualOrderSubmit />);
    expect(html).toContain('建立訂單');
    expect(html).toContain('disabled=');
    expect(html).toContain('畫面還在載入');
    // 🔴 負向:這個世界裡**不得**出現「先挑一位客人」——
    //    那句話會把系統故障說成員工還沒做完事,而他照著做也不會有用。
    expect(html).not.toContain('先在上面挑一位客人');
  });

  it('🔴 對照組:hydrate 之後(沒有 radio)⇒ 一樣灰,而那句話換成【先挑客人】', () => {
    renderForm(false);
    expect(btn().matches(':disabled')).toBe(true);
    const hint = screen.getByTestId('manual-order-submit-hint').textContent ?? '';
    expect(hint).toContain('挑一位客人');
    expect(hint).not.toContain('載入中');
  });
});

// ── 🔴🔴 R6:表單層守門的兩道收窄(IME + 只擋文字類)────────────────────────────────
describe('🔴🔴 R6:表單層守門不得擋掉不該擋的', () => {
  function renderTypes() {
    return render(
      <form data-testid='f'>
        <input type='radio' name='customer_user_id' value={USER_A} aria-label='甲' defaultChecked />
        <input name='shipping_fee' aria-label='運費' />
        <input type='date' aria-label='日期' />
        <input type='checkbox' aria-label='勾' />
        <ManualOrderSubmit />
      </form>,
    );
  }

  it('組字中的 Enter【不擋】—— picker 補了它自己那道, 而事件照樣會冒泡到這一層', () => {
    renderTypes();
    expect(fireEvent.keyDown(screen.getByLabelText('運費'), { key: 'Enter', isComposing: true })).toBe(true);
  });

  it('🔴 對照組:同一格、組字結束 ⇒ 照擋(不然這道收窄等於把守門關掉)', () => {
    renderTypes();
    expect(fireEvent.keyDown(screen.getByLabelText('運費'), { key: 'Enter', isComposing: false })).toBe(false);
  });

  it('`date` 上的 Enter【不擋】—— 那裡的 Enter 是開/收日曆', () => {
    renderTypes();
    expect(fireEvent.keyDown(screen.getByLabelText('日期'), { key: 'Enter' })).toBe(true);
  });

  it('`checkbox` / `radio` 上的 Enter【不擋】', () => {
    renderTypes();
    expect(fireEvent.keyDown(screen.getByLabelText('勾'), { key: 'Enter' })).toBe(true);
    expect(fireEvent.keyDown(screen.getByLabelText('甲'), { key: 'Enter' })).toBe(true);
  });
});
