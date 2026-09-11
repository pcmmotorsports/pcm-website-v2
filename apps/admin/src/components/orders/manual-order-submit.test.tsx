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
 * 一張【解析器收得下】的單的其餘欄位(hidden)。
 * 🔴 為什麼要它(⟦走查 F1⟧ 2026-09-11):送出那一刻現在會跑 `parseManualOrderForm`,
 *    而下面幾格「送出【不得】被攔」的對照組原本用的是**缺欄位的表單** —— server 本來就會退它,
 *    只是以前瀏覽器不問。⇒ 補齊成一張合法的單, 那幾格的斷言一個字都不改。
 * ⚠️ 欄名手打, 理由同 `manual-order-form.test.ts` 的 `FIELDS`:共用常數會讓拼錯兩邊一起錯。
 */
function RestOfValidOrder({ omit = [] }: { omit?: string[] }) {
  const fields: Array<[string, string]> = [
    ['manual_request_id', '11111111-1111-4111-8111-111111111111'],
    ['order_source', 'manual_phone'],
    ['payment_channel', 'bank_transfer'],
    ['shipping_method', 'home'],
    ['shipping_fee', '150'],
    ['shipping_fee_tax_basis', 'untaxed'],
    ['ship_to_name', '王小明'],
    ['ship_to_phone', '0912345678'],
    ['ship_to_line', '台北市中正區某路 1 號'],
    ['invoice_requested', 'off'],
    ['notification_email', ''],
    ['invoice_type', 'personal'],
    ['line_sku_0', 'PCM-001'],
    ['line_title_0', '排氣管'],
    ['line_qty_0', '1'],
    ['line_unit_price_0', '4200'],
    ['line_variant_id_0', ''],
    ['line_spec_0', ''],
    ['line_tax_basis_0', 'untaxed'],
  ];
  return (
    <>
      {fields
        .filter(([k]) => !omit.includes(k))
        .map(([k, v]) => (
          <input key={k} type='hidden' name={k} value={v} />
        ))}
    </>
  );
}

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
      <RestOfValidOrder />
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

// ── ⟦b4-PURCHTAX1⟧ 稅基除不盡 ⇒ 【擋】而不是提示(2026-09-06,Sean `Q5 = 甲`)────────
//  🔴 server 那一側已經會拒了, 而**員工看不到那句話**(PRG + 固定錯誤碼 ⇒ 值全清)。
//     ⇒ 這一族守的是「他知道自己被什麼擋住, 而且知道兩個數字」。
// 🔴🔴 **[2026-09-10] 這一族的期望值整個反過來 —— Sean 拍「Q2′ 甲 = 改成用減的」。**
//    ⛔ ~~含稅換不回整數 ⇒ 建單鈕變灰 + 說出兩個數字~~
//    🛑 **那道守門今天對品項沒有題目了**(`findTaxBasisProblem` 是明確的 no-op)——
//      而它以前擋的那些單, **今天全部收得下來**(走殘差, 總額湊回他打的數)。
//    ⇒ 📌 **這一族現在守的是「它【不要】再擋」** —— 少了這一族, 有人把那道守門加回來,
//      而那會讓 **95.2% 的含稅單**又開始退件, 沒有任何東西會紅。
describe('🔴🔴 ⟦b4-INVOICE5PCT⟧:含稅換不回整數 ⇒ 【不再擋】(鈕是亮的, 那句話不出現)', () => {
  const taxRow = (index: number, price: string, basis: string) => (
    <>
      <input name={`line_unit_price_${index}`} defaultValue={price} readOnly />
      <select name={`line_tax_basis_${index}`} defaultValue={basis} onChange={() => {}}>
        <option value='untaxed'>未稅</option>
        <option value='taxed'>含稅</option>
      </select>
    </>
  );
  const renderWith = (rows: React.ReactNode) =>
    render(
      <form>
        <input type='radio' name='customer_user_id' value='u1' defaultChecked readOnly />
        {/* 🔴🔴 **發票那兩顆要在**(`⟦b4-INVOICE5PCT⟧` 2026-09-09)——
            真表單裡它是 **hidden `off` + checkbox `on`** 兩顆同名的
            (`manual-order-form-body.tsx`)。而這一族守門從今天起**只在「要開發票」時才有題目**:
            沒勾就不加稅 ⇒ 含稅價根本不會被換算 ⇒ 沒有「除不盡」這件事。
            🛑 少了它們, `readInvoiceRequestedFromForm` 回 `null`(契約壞掉)⇒ 這一族整個不出聲,
              而那與「守門壞掉了」印同一個東西。 */}
        <input type='hidden' name='invoice_requested' value='off' />
        <input type='checkbox' name='invoice_requested' value='on' defaultChecked readOnly />
        {rows}
        <ManualOrderSubmit />
      </form>,
    );

  it('🎯 含稅 999(換不回整數)⇒ 鈕是【亮的】, 而且那句話不出現', () => {
    renderWith(taxRow(0, '999', 'taxed'));
    const btn = screen.getByTestId('manual-order-submit') as HTMLButtonElement;
    // 🛡️ 它擋掉:**有人把那道守門加回來** ⇒ 95.2% 的含稅單又開始退件
    expect(btn.disabled, '999 是走殘差收得下來的 ⇒ 鈕不該灰').toBe(false);
    // 🔵 沒有問題時那個節點【根本不渲染】(不是渲染一個空字串)——
    //    照本檔既有那格「單價還空著 ⇒ 這一道不說話」的寫法。
    expect(
      screen.queryByTestId('manual-order-submit-tax-basis'),
      '那句話講的是一個不會發生的換算 ⇒ 不該再出現',
    ).toBeNull();
  });

  it('🔵 正對照 · 含稅 4,200(換回 4,000 剛好整除)⇒ 鈕是亮的, 沒有那句話', () => {
    renderWith(taxRow(0, '4200', 'taxed'));
    expect((screen.getByTestId('manual-order-submit') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId('manual-order-submit-tax-basis')).toBeNull();
  });

  it('🔵 正對照 · 同一個 999 標成【未稅】⇒ 這一道不說話(它只管標成含稅的那些)', () => {
    renderWith(taxRow(0, '999', 'untaxed'));
    expect((screen.getByTestId('manual-order-submit') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId('manual-order-submit-tax-basis')).toBeNull();
  });

  // 🔵 **這一格原本守「訊息要指名第幾列」** —— 而今天沒有訊息了。
  //    ⇒ 🛑 而它不刪掉:**多列**是這一族最容易漏的形狀(以前的病就是「永遠說第 1 個」),
  //      所以改成守「**多列都換不回整數時, 整張單仍然送得出去**」。
  it('🎯 多列都換不回整數 ⇒ 整張單仍然送得出去(以前這裡會指名第 2 列並擋下來)', () => {
    renderWith(
      <>
        {taxRow(0, '4200', 'taxed')}
        {taxRow(1, '999', 'taxed')}
      </>,
    );
    // 🛡️ 它擋掉:**只放寬了第一列**(例如迴圈改成只看 index 0)
    expect((screen.getByTestId('manual-order-submit') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId('manual-order-submit-tax-basis')).toBeNull();
  });

  it('🔴 單價還空著 ⇒ 這一道【不說話】(那是別的守門的題目, 兩句話會互相干擾)', () => {
    renderWith(taxRow(0, '', 'taxed'));
    expect(screen.queryByTestId('manual-order-submit-tax-basis')).toBeNull();
  });
});

// ── ⟦b4-PURCHTAX1⟧ ⑤ 送出【那一刻】的那道(codex nit, 2026-09-06)──────────────────
//  🔴 病:上面那五格只驗**初始畫面**。實測把 `guardSubmit` 裡那段稅基檢查整段刪掉,
//     **五格仍然全綠** —— 因為它們從來沒有真的送出過。
//  📌 而那一道存在的理由是:autofill / 擴充套件 / 程式化的 `.value =` **不發事件**
//     ⇒ state 是過期的 ⇒ 鈕亮著。**它過期的樣子與正確的樣子在畫面上一模一樣。**
// 🔵 **這一族原本守的是「值被無聲改掉之後, 送出那一刻要再問一次」** ——
//    那個【機制】仍然是對的(送出時重讀表單), 而它今天【問不到題目】,
//    因為品項的含稅價不再有「換不回整數」這種錯。
//    ⇒ 🛑 保留這一族並反轉期望:**改成換不回整數的數之後, 送出仍然要通過。**
describe('🔴🔴 ⟦b4-INVOICE5PCT⟧:值被無聲改掉之後, 送出那一刻【不再被攔】', () => {
  it('🔴 鈕亮著的時候把單價改成換不回整數的數(不發事件)⇒ 送出被攔下來', () => {
    const { container } = render(
      <form>
        {/* 🔵 客人值 `u1` ⇒ uuid、補 `RestOfValidOrder`(⟦走查 F1⟧):送出那一刻會跑解析器,
            一張 server 本來就會退的表單不能拿來當「不得被攔」的對照組。 */}
        <input type='radio' name='customer_user_id' value={USER_A} defaultChecked readOnly />
        {/* 🔴 發票那兩顆:理由同本檔上面幾處(這一族只在「要開發票」時才有題目)。 */}
        <input type='hidden' name='invoice_requested' value='off' />
        <input type='checkbox' name='invoice_requested' value='on' defaultChecked readOnly />
        <input name='line_unit_price_0' defaultValue='4200' readOnly />
        <select name='line_tax_basis_0' defaultValue='taxed' onChange={() => {}}>
          <option value='untaxed'>未稅</option>
          <option value='taxed'>含稅</option>
        </select>
        <RestOfValidOrder omit={['invoice_requested', 'line_unit_price_0', 'line_tax_basis_0']} />
        <ManualOrderSubmit />
      </form>,
    );
    const btn = screen.getByTestId('manual-order-submit') as HTMLButtonElement;
    expect(btn.disabled, '前提:這個世界一開始是可以送的').toBe(false);
    // 🔵 **[2026-09-10] 而下面那半的期望值反轉了** —— 把值改成「換不回整數」之後,
    //    送出**不再被攔**(含稅列走殘差)。而**送出時重讀 DOM 那個機制仍然要在**:
    //    它是 autofill / 擴充套件無聲改值那條路的唯一防線, 只是今天問不到題目。

    // 🔵 直接寫 DOM、**不發任何事件** —— 那正是 autofill / 擴充套件在做的事。
    (container.querySelector('[name="line_unit_price_0"]') as HTMLInputElement).value = '999';

    const form = container.querySelector('form')!;
    const ev = new Event('submit', { bubbles: true, cancelable: true });
    // 🔵 包 `act` 是因為那道守門會 `setTaxProblem` ⇒ 不包的話畫面還沒重繪,
    //    而下面那句會紅在「找不到訊息」而不是「沒攔下來」—— 兩種紅要分得開。
    act(() => {
      form.dispatchEvent(ev);
    });
    // 🛡️ 它擋掉:**有人把品項那道守門加回來** ⇒ 一個【走殘差收得下來】的值又被攔在送出那一刻
    expect(ev.defaultPrevented, '999 走殘差收得下來 ⇒ 不該再被攔').toBe(false);
    expect(screen.queryByTestId('manual-order-submit-tax-basis')).toBeNull();
  });

  it('🔵 負對照 · 同樣無聲改成 4,200(換得回整數)⇒ 送出【不】被攔(不得變成永遠攔)', () => {
    const { container } = render(
      <form>
        <input type='radio' name='customer_user_id' value={USER_A} defaultChecked readOnly />
        <input type='hidden' name='invoice_requested' value='off' />
        <input type='checkbox' name='invoice_requested' value='on' defaultChecked readOnly />
        <input name='line_unit_price_0' defaultValue='999' readOnly />
        <select name='line_tax_basis_0' defaultValue='taxed' onChange={() => {}}>
          <option value='untaxed'>未稅</option>
          <option value='taxed'>含稅</option>
        </select>
        <RestOfValidOrder omit={['invoice_requested', 'line_unit_price_0', 'line_tax_basis_0']} />
        <ManualOrderSubmit />
      </form>,
    );
    (container.querySelector('[name="line_unit_price_0"]') as HTMLInputElement).value = '4200';
    const form = container.querySelector('form')!;
    const ev = new Event('submit', { bubbles: true, cancelable: true });
    act(() => {
      form.dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(false);
  });
});

// 🔴 這一格是為了讓「拿掉 `trim()`」那一發突變【咬得到】而補的(2026-09-06)。
//    沒有它:trim 在不在都是 236 全綠 ⇒ 那一行的存在與否沒有任何人在看。
it('🎯 單價前後有空白而換不回整數(`" 999 "` + 含稅)⇒ 【收下來】(不再擋)', () => {
  render(
    <form>
      <input type='radio' name='customer_user_id' value='u1' defaultChecked readOnly />
      {/* 🔴 發票那兩顆:理由同上面 `renderWith`(這一族只在「要開發票」時才有題目)。 */}
      <input type='hidden' name='invoice_requested' value='off' />
      <input type='checkbox' name='invoice_requested' value='on' defaultChecked readOnly />
      <input name='line_unit_price_0' defaultValue=' 999 ' readOnly />
      <select name='line_tax_basis_0' defaultValue='taxed' onChange={() => {}}>
        <option value='untaxed'>未稅</option>
        <option value='taxed'>含稅</option>
      </select>
      <ManualOrderSubmit />
    </form>,
  );
  // 🛡️ 它擋掉:**有人把那道守門加回來** ⇒ 95.2% 的含稅單又開始退件
  expect((screen.getByTestId('manual-order-submit') as HTMLButtonElement).disabled).toBe(false);
  expect(
    screen.queryByTestId('manual-order-submit-tax-basis'),
    '那句話在講一個不會發生的換算 ⇒ 它不該再出現',
  ).toBeNull();
});

// 🔴🔴 **負對照:同一張單【沒勾開發票】⇒ 不得擋**(`⟦b4-INVOICE5PCT⟧` 2026-09-09)。
//    沒勾就不加稅 ⇒ `manual-order-form.ts` 那一側也不換算 ⇒ 「999 換不回整數」這件事不存在。
//    🛑 少了這一格,一個「不管勾沒勾都擋」的版本會在上面那格全綠 ——
//      而它擋下的是一張**完全合法**的單,理由是一個沒有發生的換算。
it('🔴🔴 同一個 `" 999 "` 含稅, 而【沒勾開發票】⇒ 鈕要亮著, 也不出那句話', () => {
  render(
    <form>
      <input type='radio' name='customer_user_id' value='u1' defaultChecked readOnly />
      <input type='hidden' name='invoice_requested' value='off' />
      <input type='checkbox' name='invoice_requested' value='on' readOnly />
      <input name='line_unit_price_0' defaultValue=' 999 ' readOnly />
      <select name='line_tax_basis_0' defaultValue='taxed' onChange={() => {}}>
        <option value='untaxed'>未稅</option>
        <option value='taxed'>含稅</option>
      </select>
      <ManualOrderSubmit />
    </form>,
  );
  expect((screen.getByTestId('manual-order-submit') as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByTestId('manual-order-submit-tax-basis')).toBeNull();
});

// ── ⟦走查 F1⟧ 2026-09-11:代購列沒填料號 ⇒ 送出前就擋, 說第幾列, 表單不清空 ────────────
//  病(鑽機實點):按「建立訂單」⇒ server 解析器擋 ⇒ PRG 導頁只帶 `invalid`
//  ⇒ 畫面「表單有欄位沒填,單沒建出來」+ **整張表清空**;而 log 其實知道「第 1 個品項沒有料號」。
describe('⟦走查 F1⟧ 送出前跑同一支解析器', () => {
  function renderMissingSku() {
    return render(
      <form data-testid='f'>
        <input type='radio' name='customer_user_id' value={USER_A} defaultChecked readOnly />
        <input name='line_sku_0' aria-label='第 1 列料號' defaultValue='' />
        <input name='line_title_0' aria-label='第 1 列品名' defaultValue='走查代購零件' />
        <RestOfValidOrder omit={['line_sku_0', 'line_title_0']} />
        <ManualOrderSubmit />
      </form>,
    );
  }
  const submit = () => {
    const ev = new Event('submit', { bubbles: true, cancelable: true });
    act(() => {
      screen.getByTestId('f').dispatchEvent(ev);
    });
    return ev;
  };

  it('🔴 沒填料號 ⇒ 不送出、說出第幾列、游標跳到那一列, 已填的值還在', () => {
    renderMissingSku();
    expect(submit().defaultPrevented).toBe(true);
    const msg = screen.getByTestId('manual-order-submit-form-problem').textContent ?? '';
    expect(msg).toContain('第 1 個品項沒有料號');
    expect(document.activeElement).toBe(screen.getByLabelText('第 1 列料號'));
    expect((screen.getByLabelText('第 1 列品名') as HTMLInputElement).value).toBe('走查代購零件');
  });

  it('🔵 對照組:補上料號 ⇒ 送出【不】被攔, 也不出那句話(不得變成永遠攔)', () => {
    renderMissingSku();
    fireEvent.change(screen.getByLabelText('第 1 列料號'), { target: { value: 'WALK-001' } });
    expect(submit().defaultPrevented).toBe(false);
    expect(screen.queryByTestId('manual-order-submit-form-problem')).toBeNull();
  });

  it('🔵 那句話在他再動任何一格時消失(不然補完了還掛著舊錯)', () => {
    renderMissingSku();
    submit();
    expect(screen.getByTestId('manual-order-submit-form-problem')).toBeTruthy();
    fireEvent.input(screen.getByLabelText('第 1 列料號'), { target: { value: 'W' } });
    expect(screen.queryByTestId('manual-order-submit-form-problem')).toBeNull();
  });
});
