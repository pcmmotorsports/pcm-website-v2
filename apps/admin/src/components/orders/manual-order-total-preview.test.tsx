// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ManualOrderTotalPreview } from './manual-order-total-preview';

// manual-order-total-preview.test.tsx — ⟦b4-INVOICE5PCT⟧ ①④ 的守門。
//
// 🔴🔴 **這支檔存在的理由,是它【在 2026-09-10 之前不存在】。**
//    那個預覽從落地那天起 **一律印「沒勾發票」的答案** —— 而它存在的唯一理由,
//    就是 Sean 逐字要的「**我輸入單價,然後勾選開發票自己幫我 +5% 上去計算**」。
//    🔬 成因:它用 `form.elements.namedItem(name).value`,而 hidden + checkbox 同名
//      ⇒ `RadioNodeList.value` **恆回 `""`**(它是「第一個被勾選的 **radio**」的值,
//        而這裡一個 radio 都沒有)⇒ `=== 'on'` 恆假。
//    🛑 **而那支檔自己的註解宣稱它是「最後一個有效值」** —— 那句話是假的,
//      而它**沒有被劃掉、讀起來很有道理、還叫下一個人不要往這裡看**。
//    ⇒ 🎯 **根因不是那一行,是【沒有任何一格在問它】。** 這支檔就是那幾格。
//
// 🛑 **本檔證不到「預覽與 RPC 算得一樣」** —— 那要拿同一組輸入餵真的 RPC(拋棄式 PG)。
//    本檔每一格只證「預覽自己讀對了、算對了」。**兩件事,不要把這裡的綠讀成前者。**

afterEach(cleanup);

/** 真表單裡那顆勾選的**真實結構**:hidden `off` 墊底 + checkbox `on`。 */
function InvoiceCheckbox({ checked, withHidden = true }: { checked: boolean; withHidden?: boolean }) {
  return (
    <>
      {withHidden ? <input type='hidden' name='invoice_requested' value='off' /> : null}
      <input type='checkbox' name='invoice_requested' value='on' defaultChecked={checked} readOnly />
    </>
  );
}

function renderForm(opts: {
  price: string;
  qty?: string;
  basis?: string;
  invoice: boolean;
  withHidden?: boolean;
  shippingFee?: string;
}) {
  return render(
    <form>
      <InvoiceCheckbox checked={opts.invoice} withHidden={opts.withHidden ?? true} />
      <input name='shipping_fee' defaultValue={opts.shippingFee ?? '0'} readOnly />
      <select name='shipping_fee_tax_basis' defaultValue='untaxed' onChange={() => {}}>
        <option value='untaxed'>未稅</option>
        <option value='taxed'>含稅</option>
      </select>
      <input name='line_qty_0' defaultValue={opts.qty ?? '1'} readOnly />
      <input name='line_unit_price_0' defaultValue={opts.price} readOnly />
      <select name='line_tax_basis_0' defaultValue={opts.basis ?? 'untaxed'} onChange={() => {}}>
        <option value='untaxed'>未稅</option>
        <option value='taxed'>含稅</option>
      </select>
      <ManualOrderTotalPreview />
    </form>,
  );
}

const shown = (): string => screen.getByTestId('manual-order-total-preview').textContent ?? '';

describe('🔴🔴 那顆勾選要【真的被讀到】—— 這一族是本檔存在的理由', () => {
  // 🛡️ 它擋掉:**「永遠不加稅」** —— 而那正是 2026-09-10 之前的實際行為。
  it('🎯 勾了開發票 ⇒ 未稅 1,000 的總額要變成 1,050', () => {
    renderForm({ price: '1000', invoice: true });
    expect(shown(), '勾了而總額沒變 ⇒ 那顆勾選又沒被讀到').toContain('1,050');
  });

  // 🛡️ 它擋掉:**「永遠加 5%」** —— 只有上一格的話,一個恆真的實作也會綠。
  it('⚪ 負對照:沒勾 ⇒ 總額仍然是 1,000', () => {
    renderForm({ price: '1000', invoice: false });
    expect(shown()).toContain('1,000');
    expect(shown(), '沒勾卻加了稅').not.toContain('1,050');
  });

  // 🔴🔴 **結構那一格** —— 拿掉 hidden 要會紅。
  //    📌 少了它,下一個人改表單結構(例如拿掉那顆 hidden),
  //      這個 bug 會**換一種形狀回來**,而沒有任何東西會叫。
  //    🔵 而拿掉 hidden 之後 `namedItem` 回的是 `HTMLInputElement` 而不是 `RadioNodeList`
  //      ⇒ 舊實作在那個世界裡**反而會對** ⇒ 🎯 **那正是「它在一半的世界裡是對的」那件事。**
  // 🔴🔴 **[codex 唯讀審 nit,採信]上面兩格【只驗初次渲染】。**
  //    🔬 codex 實測:把 `input` / `change` 兩個事件監聽拿掉 ⇒ **九格全過**。
  //    ⇒ 📌 而員工的真實動線是【進頁 → 填單價 → 才去勾發票】——
  //      監聽掉了的話, 預覽會**停在舊金額**, 而那正是這個元件唯一的用途。
  it('🔴 勾發票是【進頁之後才勾的】⇒ 預覽要當場變(而不是停在舊金額)', () => {
    const { container } = render(
      <form>
        <InvoiceCheckbox checked={false} />
        <input name='shipping_fee' defaultValue='0' readOnly />
        <select name='shipping_fee_tax_basis' defaultValue='untaxed' onChange={() => {}}>
          <option value='untaxed'>未稅</option>
          <option value='taxed'>含稅</option>
        </select>
        <input name='line_qty_0' defaultValue='1' readOnly />
        <input name='line_unit_price_0' defaultValue='1000' readOnly />
        <select name='line_tax_basis_0' defaultValue='untaxed' onChange={() => {}}>
          <option value='untaxed'>未稅</option>
          <option value='taxed'>含稅</option>
        </select>
        <ManualOrderTotalPreview />
      </form>,
    );
    expect(shown(), '前提:還沒勾的時候是 1,000').toContain('1,000');
    const box = container.querySelector('input[type="checkbox"]')!;
    fireEvent.click(box);
    // 🛡️ 它擋掉:**事件監聽被拿掉** ⇒ 預覽停在舊金額
    expect(shown(), '勾下去而數字沒變 ⇒ 這個元件的唯一用途沒了').toContain('1,050');
  });

  it('🔴 拿掉那顆同名 hidden ⇒ 這一格要能看見差別(結構被改了要有人叫)', () => {
    const { unmount } = renderForm({ price: '1000', invoice: true });
    const withHidden = shown();
    unmount();
    renderForm({ price: '1000', invoice: true, withHidden: false });
    // 🛡️ 它擋掉:**讀法只在其中一種結構下正確** —— 兩種結構都要給同一個答案。
    expect(shown(), '兩種結構下的總額必須一樣(勾了就是勾了)').toBe(withHidden);
    expect(shown()).toContain('1,050');
  });

  // 🔴🔴 **[codex 唯讀審 nit,採信]上一格只比較兩種【已勾選】的結構。**
  //    🔬 codex 實測:把 reader 的 `null` 改成 `false` ⇒ **九格全過**。
  //    ⇒ 📌 而「判不出來」與「沒勾」是兩件事 ——
  //      **把讀不到讀成沒勾, 正是這整個 bug 的形狀。**
  it('🔴 那顆勾選【整格不見】⇒ 不編一個總額出來(判不出來 ≠ 沒勾)', () => {
    render(
      <form>
        {/* 🛑 兩顆都不放 ⇒ `readInvoiceRequestedFromForm` 回 `null` */}
        <input name='shipping_fee' defaultValue='0' readOnly />
        <select name='shipping_fee_tax_basis' defaultValue='untaxed' onChange={() => {}}>
          <option value='untaxed'>未稅</option>
          <option value='taxed'>含稅</option>
        </select>
        <input name='line_qty_0' defaultValue='1' readOnly />
        <input name='line_unit_price_0' defaultValue='1000' readOnly />
        <select name='line_tax_basis_0' defaultValue='untaxed' onChange={() => {}}>
          <option value='untaxed'>未稅</option>
          <option value='taxed'>含稅</option>
        </select>
        <ManualOrderTotalPreview />
      </form>,
    );
    // 🛡️ 它擋掉:**把 `null` 當成 `false`** ⇒ 印出一個「假裝沒勾」的總額
    const said = shown();
    expect(said, '那一格壞掉了而它照樣算了一個總額').not.toContain('1,000');
    // 🔴 而它**也不可以**印成「還沒填品項」那句 —— 他已經填了, 壞的是別的東西
    //    ⇒ 📌 那句話會讓他一直去改品項, 而問題不在那裡。
    expect(said, '「算不出來」被說成「還沒開始算」').not.toContain('填了品項');
    expect(said, '要說出是哪一格讀不到').toContain('開發票');
  });
});

describe('🎯 含稅列走殘差 —— 總額要湊回員工打的那個數', () => {
  // 🛡️ 它擋掉:**完全沒接上**(總額變 1,155 / 印不出東西)
  // ⚠️ **而它擋不到「寫成正推」** —— 1,100 兩種算法同一個數 ⇒ 判別交給下面那格
  it('主格:含稅 1,100 + 勾發票 ⇒ 總額【正好 1,100】(Sean 的例子)', () => {
    renderForm({ price: '1100', basis: 'taxed', invoice: true });
    expect(shown()).toContain('1,100');
    expect(shown(), '把含稅當未稅再加一次 5%').not.toContain('1,155');
  });

  // 🔴 判別格的挑法是**規則不是數字**:從「half-up 分岔」與「banker's 分岔」的**交集**裡挑。
  //    🔬 那個交集是等差數列 `31 · 73 · 115 · 157 …`,公差 **42 = 2 × 21**。
  //    ⛔ ~~含稅 11~~(只在 banker's 下分得開)· ⛔ ~~含稅 10~~(只在 half-up 下分得開)
  //      ⇒ 📌 兩次都挑到 `.5` 上,而 `.5` 正是兩種捨入唯一會分岔的地方。
  it('🎯 判別格:含稅 31 ⇒ 總額 31(而【正推】會給 32)', () => {
    renderForm({ price: '31', basis: 'taxed', invoice: true });
    // 🛡️ 它擋掉:**把稅寫成正推**(未稅 30 回推 5% ⇒ 稅 2 ⇒ 32)而不是殘差
    expect(shown()).toContain('31');
    expect(shown(), '正推會給 32').not.toContain('32');
  });

  it('🎯 判別格:qty 2 ⇒ 2,200(而【從小計重算】會給 2,201)', () => {
    renderForm({ price: '1100', qty: '2', basis: 'taxed', invoice: true });
    // ⚪ 而 qty 1 分不開(兩種都給 1,100)⇒ 📌 這一格是【必要】的,不是加分的
    expect(shown()).toContain('2,200');
    expect(shown()).not.toContain('2,201');
  });

  // 🛡️ 它擋掉:**含稅列的殘差被套到沒勾發票的單上**
  it('⚪ 負對照:含稅 1,100 而【沒勾】發票 ⇒ 原樣 1,100,一毛稅都不加', () => {
    renderForm({ price: '1100', basis: 'taxed', invoice: false });
    expect(shown()).toContain('1,100');
  });

  // 🔴🔴 **[codex 唯讀審 nit,採信]上面那三格【還蒙混得過去】。**
  //    🔬 codex 實測的接線錯法:**「只要有含稅列就傳 `invoiceRequested: false`」**
  //      ⇒ 單純含稅列不換算也不加稅 ⇒ 總額**碰巧相同** ⇒ **九格全過**。
  //    🎯 而它在**混合列**上就現形:含稅 31 + 未稅 1,000 ⇒ 預覽會印 **1,031**(少算 50)。
  //    ⇒ 📌 **一個只有單一含稅列的測試,分不出「殘差算對了」與「整個沒在算稅」。**
  it('🎯 混合列(元件層):含稅 31 + 未稅 1,000 ⇒ 小計 1,030 · 稅 51 · 總計 1,081', () => {
    render(
      <form>
        <InvoiceCheckbox checked />
        <input name='shipping_fee' defaultValue='0' readOnly />
        <select name='shipping_fee_tax_basis' defaultValue='untaxed' onChange={() => {}}>
          <option value='untaxed'>未稅</option>
          <option value='taxed'>含稅</option>
        </select>
        <input name='line_qty_0' defaultValue='1' readOnly />
        <input name='line_unit_price_0' defaultValue='31' readOnly />
        <select name='line_tax_basis_0' defaultValue='taxed' onChange={() => {}}>
          <option value='untaxed'>未稅</option>
          <option value='taxed'>含稅</option>
        </select>
        <input name='line_qty_1' defaultValue='1' readOnly />
        <input name='line_unit_price_1' defaultValue='1000' readOnly />
        <select name='line_tax_basis_1' defaultValue='untaxed' onChange={() => {}}>
          <option value='untaxed'>未稅</option>
          <option value='taxed'>含稅</option>
        </select>
        <ManualOrderTotalPreview />
      </form>,
    );
    // 🛡️ 三個數【分別】斷言 —— 只看總計的話,「小計錯而稅剛好補回來」也會綠。
    const said = shown();
    expect(said, '小計 = 未稅 30 + 1,000').toContain('1,030');
    expect(said, '稅 = 未稅底 1,000 的 5% 再加殘差 1').toContain('51');
    expect(said, '總計 = 他打的 31 + 未稅列含稅後的 1,050').toContain('1,081');
    // ⚪ 而 codex 那個接線錯法會給 1,031
    expect(said, '整個沒在算稅 ⇒ 少算 50').not.toContain('1,031');
    // ⚪ 而整包正推會給 1,082
    expect(said, '整包正推 ⇒ 多收一塊').not.toContain('1,082');
  });
});

describe('🛑 運費那半【維持整除才收】—— 而預覽要照著擋', () => {
  // 🛡️ 它擋掉:**順手把運費也放寬** —— 那支殘差 migration `:120` 點名警告過:
  //    RPC 收不到運費稅基 ⇒ 放寬它 ⇒ 含稅品項 1,050 + 含稅運費 31 ⇒ 算成 1,082 而應收 1,081
  //    ⇒ 🔴 **那是【多收】一塊**(我第一版寫成「少收」, 方向反了 —— codex nit, 採信);
  //      一般地說它【可能多收也可能少收】, 取決於捨入往哪一邊落。
  it('🔴 含稅運費 31(除不盡)⇒ 預覽【不編一個數字出來】', () => {
    render(
      <form>
        <InvoiceCheckbox checked />
        <input name='shipping_fee' defaultValue='31' readOnly />
        <select name='shipping_fee_tax_basis' defaultValue='taxed' onChange={() => {}}>
          <option value='untaxed'>未稅</option>
          <option value='taxed'>含稅</option>
        </select>
        <input name='line_qty_0' defaultValue='1' readOnly />
        <input name='line_unit_price_0' defaultValue='1000' readOnly />
        <select name='line_tax_basis_0' defaultValue='untaxed' onChange={() => {}}>
          <option value='untaxed'>未稅</option>
          <option value='taxed'>含稅</option>
        </select>
        <ManualOrderTotalPreview />
      </form>,
    );
    // 🛡️ 它擋掉:**順手放寬運費**(算出一個總額)—— 而【只驗「不含某個數字」不夠】:
    //    🔬 codex 實測把整段阻擋訊息清空 ⇒ 那個否定式照樣綠。
    //    ⇒ 📌 **肯定式要有一格**:員工要看得到「運費那一格有問題」與那兩個數字。
    const said = shown();
    expect(said, '運費除不盡而它照樣算了一個總額出來').not.toContain('1,0');
    expect(said, '要讓他知道是【運費】那一格').toContain('運費');
    expect(said, '要說他填的那個數').toContain('31');
  });

  // ⚪ 而「整除的含稅運費」要收得下來 —— 否則一個「運費永遠擋」的實作也會綠。
  it('⚪ 負對照:含稅運費 21(整除 ⇒ 未稅 20)⇒ 算得出來', () => {
    render(
      <form>
        <InvoiceCheckbox checked />
        <input name='shipping_fee' defaultValue='21' readOnly />
        <select name='shipping_fee_tax_basis' defaultValue='taxed' onChange={() => {}}>
          <option value='untaxed'>未稅</option>
          <option value='taxed'>含稅</option>
        </select>
        <input name='line_qty_0' defaultValue='1' readOnly />
        <input name='line_unit_price_0' defaultValue='1000' readOnly />
        <select name='line_tax_basis_0' defaultValue='untaxed' onChange={() => {}}>
          <option value='untaxed'>未稅</option>
          <option value='taxed'>含稅</option>
        </select>
        <ManualOrderTotalPreview />
      </form>,
    );
    // 小計 1,000 + 運費 20 + 稅 round(1020×5%)=51 ⇒ 1,071
    expect(shown()).toContain('1,071');
  });
});
