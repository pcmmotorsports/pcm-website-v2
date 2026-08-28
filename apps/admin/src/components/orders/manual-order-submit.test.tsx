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

/**
 * 選了一位客人的畫面 + 「建立新客人」那兩格。
 * 🔴 radio 帶 `data-customer-*` —— 那是 picker 真的會畫的形狀,而 conflict 判定**靠它比內容**。
 *    少了它,`hasConflict` 讀到的是 `''` ⇒ 任何非空輸入都會被判成「不一樣」⇒ 測試會量到一個
 *    比實際嚴格的世界(而那正是 codex R2 打爆的那一版)。
 */
function renderWithBoth(name = '王小明', phone = '0912345678', justCreated = false) {
  return render(
    <form data-testid='f'>
      <input
        type='radio'
        name='customer_user_id'
        value={USER_A}
        aria-label='甲'
        data-customer-name={name}
        data-customer-phone={phone}
        {...(justCreated ? { 'data-just-created': '1' } : {})}
      />
      <input name='new_customer_name' aria-label='新客人姓名' />
      <input name='new_customer_phone' aria-label='新客人電話' />
      <ManualOrderSubmit />
    </form>,
  );
}

// ── 🔴🔴 codex R1 must-fix:選了甲, 又打了乙的資料 ⇒ 擋(2026-08-28)────────────────
//  📌 codex 直接擊破了 plan §1 那句「打了字沒按建立 ⇒ 沒有 radio ⇒ 鈕是灰的」——
//     **那句只在「他沒選過任何人」的世界裡成立。**
//     搜到甲 ⇒ 點起來 ⇒ 再到下面打乙 ⇒ 忘記按建立 ⇒ 甲的 radio 還勾著 ⇒ **鈕亮著**
//     ⇒ 按下去 ⇒ 這張單掛在甲頭上,而畫面上他看到的是乙的名字。
//  🔴 走乙之前這個反例**不存在**(搜到人時建立那塊不渲染)⇒ 又一條附贈的保護跟著閘一起消失。
describe('🔴🔴 codex R1:選了一位客人, 而下面又打了另一位 ⇒ 送出鈕【擋住】並說出兩條出路', () => {
  it('只打了【不同的】姓名就擋', () => {
    renderWithBoth();
    fireEvent.click(screen.getByLabelText('甲'));
    expect(btn().disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('新客人姓名'), { target: { value: '乙' } });
    expect(btn().disabled).toBe(true);
    const msg = screen.getByTestId('manual-order-submit-conflict').textContent ?? '';
    expect(msg).toContain('這張單只能屬於一個人');
    expect(msg).toContain('建立這位客人');
    expect(msg).toContain('清空');
  });

  it('只打了【不同的】電話也擋(兩格是 or 不是 and)', () => {
    renderWithBoth();
    fireEvent.click(screen.getByLabelText('甲'));
    fireEvent.change(screen.getByLabelText('新客人電話'), { target: { value: '0955000111' } });
    expect(btn().disabled).toBe(true);
  });

  // ── 🔴🔴 codex R2 must-fix:那道閘 R1 版擋住的全是【對的操作】────────────────────────
  //  📌 我拿「欄位有沒有字」當「他想建另一個人」的代理,而那兩件事**在成功路徑上就會分家**。
  // ⛔ ~~原本這一格模擬「搜尋把電話預填進建立區 ⇒ 再選那位客人」~~
  // 🔴 **2026-08-28 Fable R3-MF1 之後那個前提沒了**:搜尋【命中】時預填會被清掉
  //    ⇒ 主線走到「選了人」時,建立區那兩格是**空的**。
  //    ⇒ 本格改成量真正的主線;而「他自己打了字」那條改由下一格量(**它現在要擋**)。
  it('🔴🔴 R2-①(改寫):建單主線 —— 選了人而建立區【空著】⇒ 不得鎖死', () => {
    renderWithBoth('王小明', '0912345678');
    fireEvent.click(screen.getByLabelText('甲'));
    expect(btn().disabled).toBe(false);
    expect(screen.queryByTestId('manual-order-submit-conflict')).toBeNull();
  });

  it('🔴🔴 R4-MF2:他【自己打了】一組與甲一模一樣的資料 ⇒ 仍然要擋(同名同電話 ≠ 同一人)', () => {
    // 甲與乙同名、共用一支市話(一家人)—— 他選了甲、打了乙、忘記按「建立這位客人」。
    // 舊版只比內容 ⇒ 相符 ⇒ 放行 ⇒ **單掛給甲**。
    // 📌 「資料相同」不是「同一個人」。
    renderWithBoth('王小明', '0912345678');
    fireEvent.click(screen.getByLabelText('甲'));
    fireEvent.change(screen.getByLabelText('新客人姓名'), { target: { value: '王小明' } });
    fireEvent.change(screen.getByLabelText('新客人電話'), { target: { value: '0912345678' } });
    expect(btn().disabled).toBe(true);
    expect(screen.getByTestId('manual-order-submit-conflict')).toBeTruthy();
  });

  it('🔴🔴 R2-②:建立成功之後(兩格還有字 + 自動選起來)⇒ 【不得】變成死路', () => {
    // 🔴 那一顆 radio 帶 `data-just-created`(picker 會標)—— 那是「這位就是我們剛建的」的憑據。
    renderWithBoth('新客人乙', '0955000111', true);
    fireEvent.change(screen.getByLabelText('新客人姓名'), { target: { value: '新客人乙' } });
    fireEvent.change(screen.getByLabelText('新客人電話'), { target: { value: '0955000111' } });
    fireEvent.click(screen.getByLabelText('甲'));
    expect(btn().disabled).toBe(false);
    expect(screen.queryByTestId('manual-order-submit-conflict')).toBeNull();
  });

  it('🔴 對照組:同一份資料而【沒有】 data-just-created ⇒ 要擋(不然上面那格等於沒有判準)', () => {
    renderWithBoth('新客人乙', '0955000111', false);
    fireEvent.change(screen.getByLabelText('新客人姓名'), { target: { value: '新客人乙' } });
    fireEvent.change(screen.getByLabelText('新客人電話'), { target: { value: '0955000111' } });
    fireEvent.click(screen.getByLabelText('甲'));
    expect(btn().disabled).toBe(true);
  });

  it('🔴 電話比對只看數字(`0912-345-678` 與 `0912345678` 是同一支, 不得判成兩個人)', () => {
    renderWithBoth('王小明', '0912-345-678', true);
    fireEvent.click(screen.getByLabelText('甲'));
    fireEvent.change(screen.getByLabelText('新客人電話'), { target: { value: '0912345678' } });
    expect(btn().disabled).toBe(false);
  });

  it('🔴🔴 R2-③:值被程式改掉而【沒發事件】(autofill)⇒ 送出那一刻仍然攔得住', () => {
    renderWithBoth();
    fireEvent.click(screen.getByLabelText('甲'));
    expect(btn().disabled).toBe(false);
    // 🔴 直接寫 `.value`,不發 `input` / `change` —— 這正是 autofill / 密碼管理員做的事
    (screen.getByLabelText('新客人姓名') as HTMLInputElement).value = '乙';
    expect(btn().disabled).toBe(false); // state 還沒更新 ⇒ 鈕仍亮(這是預期的中間態)
    const form = screen.getByTestId('f') as HTMLFormElement;
    const ev = new Event('submit', { bubbles: true, cancelable: true });
    fireEvent(form, ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(screen.getByTestId('manual-order-submit-conflict')).toBeTruthy();
  });

  it('🔴 對照組:沒有被動手腳時 submit【不得】被攔(不然上面那格是恆真的)', () => {
    renderWithBoth();
    fireEvent.click(screen.getByLabelText('甲'));
    const form = screen.getByTestId('f') as HTMLFormElement;
    const ev = new Event('submit', { bubbles: true, cancelable: true });
    fireEvent(form, ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('🔴 清空之後解鎖(不然他照著畫面上那句做也出不去)', () => {
    renderWithBoth();
    fireEvent.click(screen.getByLabelText('甲'));
    fireEvent.change(screen.getByLabelText('新客人姓名'), { target: { value: '乙' } });
    expect(btn().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('新客人姓名'), { target: { value: '' } });
    expect(btn().disabled).toBe(false);
    expect(screen.queryByTestId('manual-order-submit-conflict')).toBeNull();
  });

  it('🔴 對照組:【沒有選人】而下面打了字 ⇒ 不是衝突, 而是「還沒有客人」那句(兩種灰不得說同一句話)', () => {
    renderWithBoth();
    fireEvent.change(screen.getByLabelText('新客人姓名'), { target: { value: '乙' } });
    expect(btn().disabled).toBe(true);
    expect(screen.queryByTestId('manual-order-submit-conflict')).toBeNull();
    expect(screen.getByTestId('manual-order-submit-hint').textContent).toContain('這張單還沒有客人');
  });

  it('🔴 對照組:選了人而下面【空著】⇒ 亮的, 兩句話都不出(不然上面全是恆真)', () => {
    renderWithBoth();
    fireEvent.click(screen.getByLabelText('甲'));
    expect(btn().disabled).toBe(false);
    expect(screen.queryByTestId('manual-order-submit-conflict')).toBeNull();
    expect(screen.queryByTestId('manual-order-submit-hint')).toBeNull();
  });

  it('🔴 只有空白字元不算打了字(空白在畫面上與空的長一樣)', () => {
    renderWithBoth();
    fireEvent.click(screen.getByLabelText('甲'));
    fireEvent.change(screen.getByLabelText('新客人姓名'), { target: { value: '   ' } });
    expect(btn().disabled).toBe(false);
  });

  it('🔴 選起來那位【沒有】姓名資料時, 打了字就算不一樣(fail-closed)', () => {
    renderWithBoth('', '');
    fireEvent.click(screen.getByLabelText('甲'));
    fireEvent.change(screen.getByLabelText('新客人姓名'), { target: { value: '乙' } });
    expect(btn().disabled).toBe(true);
  });
});

// ── 🔴🔴 R4-MF2:沒有選客人,那顆「建立訂單」不得按得下去 ────────────────────────────
//  病:按得下去 ⇒ 解析器擋(對的)⇒ 而它擋的方式是 **`redirect()`**
//     ⇒ 運費、地址、發票、每一列品項**全部消失**,只剩一個 `mrid`。
//  📌 **一道正確運作的守門,把流量推進了這一片本來要修的那個病。**
describe('🔴🔴 R4-MF2:送出鈕由【DOM 有沒有一顆被選起來的 radio】決定', () => {
  it('一顆 radio 都還沒畫出來(還沒搜)⇒ 灰的,而且那句話【點名那顆按鈕】', () => {
    renderForm(false);
    expect(btn().disabled).toBe(true);
    const hint = screen.getByTestId('manual-order-submit-hint').textContent ?? '';
    expect(hint).toContain('這張單還沒有客人');
    // 🔴🔴 **這一格是本次改文案的整個理由,不是順手加的斷言。**
    //    2026-08-28 Sean 逐字回報「直接輸入收件人資訊,但是還是無法建立訂單」——
    //    ⛔ ~~舊句「先在上面挑一位客人(找不到就在那裡建一位)」~~ 的病:
    //    員工在建立那一塊打好姓名電話,就以為**打完字就是建了**。
    //    而那兩格**不進 `parseManualOrderForm()`** ⇒ 沒按那顆鈕就沒有客人 ⇒ 這顆鈕維持灰的
    //    ⇒ **而他不知道為什麼。**
    //    📌 **改法是「點名那顆按鈕」** —— 一句話要叫得出下一步按哪裡,不是描述現在缺什麼。
    expect(hint).toContain('建立這位客人');
    expect(hint).toContain('按了才算數');
    // 反面:舊句不得殘留(它會被讀成「打完字就建好了」)
    expect(hint).not.toContain('找不到就在那裡建一位');
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
    // 🔴 2026-08-28 換文案後補:新句一樣不得出現在 SSR 那個世界
    //    ——「按了才算數」在**還沒 hydrate**時是假的(那顆建立鈕也按不動)。
    expect(html).not.toContain('建立這位客人');
  });

  it('🔴 對照組:hydrate 之後(沒有 radio)⇒ 一樣灰,而那句話換成【去挑 / 去建】', () => {
    renderForm(false);
    expect(btn().matches(':disabled')).toBe(true);
    const hint = screen.getByTestId('manual-order-submit-hint').textContent ?? '';
    expect(hint).toContain('這張單還沒有客人');
    expect(hint).toContain('建立這位客人');
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
