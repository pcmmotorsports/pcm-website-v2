// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// 🔴 本元件 import 那支 server action, 而它那條鏈上有 `server-only`
//    ⇒ 在 vitest 裡(沒有 Next 的 'use server' 轉換)會直接拋
//      「This module cannot be imported from a Client Component module」。
//    ⚠️ 而那一發**不是紅是「沒有跑」** —— `vitest-ran-gate` 印 rc=97 而不是一個綠,
//       那正是它存在的理由(少了它, 這裡會是「Tests no tests」而被讀成通過)。
vi.mock('server-only', () => ({}));

import { ManualOrderCatalogLookup } from './manual-order-catalog-lookup';

// ⟦b4-SKULOOKUP⟧ 片2 的守門。
//
// 🔴🔴 **本檔最重要的那一族是「稅基標籤」** —— 而它不是文案測試:
//    `manual-order-catalog.ts` 的「只讀 price_general」那個副作用今天已經被拿掉
//    (Sean 拍甲, 經銷價進目錄)⇒ **含稅保證的持有人從【碼】換成了【畫面上那三個字】**。
//    ⇒ 沒有那個標籤, 員工把未稅價貼進單價 ⇒ 那張單少收 5%, 而沒有東西會叫。
//    📌 **⇒ 所以「標籤有沒有渲染」這一格, 守的是錢, 不是排版。**

afterEach(cleanup);

const HIT = {
  variantId: 'v1',
  sku: 'SKU-1',
  title: '測試品名',
  unitPrice: 1050,
  dealerPriceUntaxed: 900,
};
const ok = (hits: (typeof HIT)[]) => async () => ({ ok: true as const, hits });

const SRC = readFileSync(join(__dirname, 'manual-order-catalog-lookup.tsx'), 'utf8');

async function searchWith(action: Parameters<typeof ManualOrderCatalogLookup>[0]) {
  render(<ManualOrderCatalogLookup {...action} />);
  fireEvent.change(screen.getByLabelText('要查的料號'), { target: { value: 'SKU' } });
  fireEvent.click(screen.getByRole('button', { name: '查詢' }));
}

describe('🔴🔴 稅基標籤 —— 含稅保證今天唯一的持有人', () => {
  it('🔴 經銷價那一格必須帶「未稅」兩個字', async () => {
    await searchWith({ searchAction: ok([HIT]) });
    const el = await screen.findByTestId('catalog-hit-price-store');
    expect(
      el.textContent,
      '沒有「未稅」⇒ 員工把 900 貼進單價 ⇒ 那張單少收 5%, 而沒有東西會叫',
    ).toContain('未稅');
    expect(el.textContent).toContain('900');
  });

  it('🔴 售價那一格必須帶「含稅」—— **只標一邊會讓人以為另一邊沒問題**', async () => {
    await searchWith({ searchAction: ok([HIT]) });
    const el = await screen.findByTestId('catalog-hit-price-general');
    expect(el.textContent).toContain('含稅');
    expect(el.textContent).toContain('1,050');
  });

  it('🔴🔴 標籤與數字在【同一個節點】—— 員工選取數字時眼睛在數字上', async () => {
    await searchWith({ searchAction: ok([HIT]) });
    const store = await screen.findByTestId('catalog-hit-price-store');
    // 失敗情境:標籤被搬到別行 / 別的灰字區 ⇒ 上面那兩格【照樣綠】(字還在畫面上),
    //   而員工在複製的那一刻看不到它。⇒ 這一格釘的是「在同一個節點裡」。
    expect(store.textContent).toMatch(/900[^0-9]*未稅|未稅[^0-9]*900/);
  });

  it('🔴🔴 而「在同一個節點裡」還不夠 —— 它必須【看得見】(codex R1 must-fix ②)', async () => {
    // 它舉的反例逐字:把「未稅」包成同節點內的 `<span className="sr-only">`
    //   ⇒ 上面三格**仍然全綠**(textContent 讀得到), 而**員工看不到**。
    // 📌 **⇒ `textContent` 讀的是【文字在不在 DOM】, 不是【人看不看得到】。**
    //    而這個標籤是含稅保證唯一的持有人 ⇒ 看不到 = 沒有持有人。
    await searchWith({ searchAction: ok([HIT]) });
    const store = await screen.findByTestId('catalog-hit-price-store');
    const hidden = Array.from(store.querySelectorAll('*')).filter((el) => {
      const cls = el.getAttribute('class') ?? '';
      return (
        cls.includes('sr-only') ||
        cls.includes('hidden') ||
        el.hasAttribute('hidden') ||
        el.getAttribute('aria-hidden') === 'true'
      );
    });
    const hiddenText = hidden.map((el) => el.textContent ?? '').join('');
    expect(hiddenText, '「未稅」被藏進 sr-only / hidden ⇒ 讀得到而看不到').not.toContain('未稅');
    // 🔵 正對照:這把尺真的抓得到隱藏元素 —— 現造一個 sr-only 節點餵給同一段邏輯。
    const probe = document.createElement('div');
    probe.innerHTML = '<span class="sr-only">未稅</span>';
    const probeHidden = Array.from(probe.querySelectorAll('*'))
      .filter((el) => (el.getAttribute('class') ?? '').includes('sr-only'))
      .map((el) => el.textContent ?? '')
      .join('');
    expect(probeHidden, '正對照:這把尺抓不到 sr-only ⇒ 上面那格零判別力').toContain('未稅');
  });

  it('🔴 三態【至少有一態】—— action 直接拋的時候不得三個都不出現(codex R1 MF③)', async () => {
    // 上一版只有 finally 沒有 catch ⇒ 拋出去 ⇒ 沒結果、沒查無、沒 alert, 畫面停在原樣。
    // 📌 我證過「三態互斥」, 而沒有證「三態至少有一態」—— 那是兩個宣稱。
    await searchWith({
      searchAction: async () => {
        throw new Error('network down');
      },
    });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('不是料號打錯');
    expect(alert.textContent, '不得把 thrown 原文放上畫面').not.toContain('network down');
  });

  it('🔴 而拋的時候【舊結果不得留在畫面上】—— 否則他以為那是這一次查的', async () => {
    const { rerender } = render(<ManualOrderCatalogLookup searchAction={ok([HIT])} />);
    fireEvent.change(screen.getByLabelText('要查的料號'), { target: { value: 'SKU' } });
    fireEvent.click(screen.getByRole('button', { name: '查詢' }));
    await screen.findByTestId('catalog-hit-price-store');
    rerender(
      <ManualOrderCatalogLookup
        searchAction={async () => {
          throw new Error('boom');
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '查詢' }));
    await screen.findByRole('alert');
    expect(screen.queryByTestId('catalog-hit-price-store'), '舊那一列還在').toBeNull();
  });
});

describe('三態:查到 / 查無 / 失敗 —— 三句不同的話', () => {
  it('查無 ⇒ 那是合法答案, 要說「純手動」不是說失敗', async () => {
    await searchWith({ searchAction: ok([]) });
    expect(await screen.findByText(/查無這個料號/)).toBeTruthy();
  });

  it('🔴 失敗 ⇒ 與查無【不同句】, 而且是 alert', async () => {
    await searchWith({
      searchAction: async () => ({ ok: false as const, reason: 'error' as const, message: '商品查詢失敗' }),
    });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('商品查詢失敗');
    expect(screen.queryByText(/查無這個料號/), '失敗不得同時印查無').toBeNull();
  });

  it('🔴 denied 也走 alert(而它與 error 是兩則不同訊息, 由 action 那層給)', async () => {
    await searchWith({
      searchAction: async () => ({ ok: false as const, reason: 'denied' as const, message: '沒有權限查商品' }),
    });
    expect((await screen.findByRole('alert')).textContent).toContain('沒有權限');
  });
});

// 🛑🛑 **這一族的射程, 照 codex R1 must-fix ① 逐條寫出來 —— 它【不是】不變式的證明。**
//    它舉的兩種繞法, 兩種都能讓下面四格全綠而回寫已經發生:
//      · 把回寫藏進一支 **imported helper**(本檔只看得到 import 那一行)
//      · `form.elements` + `setAttribute`(不含 `querySelector` / `.value =` 那幾個字面)
//    📌 **⇒ 它是【最直白那幾種寫法的絆線】, 不是資料流保證。**
//       而它仍然值得留:那幾種正是「順手加一下」的人會寫的。
//    🔴 **真正的保證在別的地方**:`manual-order-lines.tsx` 那六道守門盯著【被寫的那一側】——
//       本檔就算想寫, 那六道也會在那一側紅。⇒ 兩邊各守一半, 而**兩邊都不是全稱的**。
//    ⚠️ **⇒ 所以 commit body 不得把本族寫成「證明了不回寫」** —— 我上一版就是那樣寫的。
describe('🔴 不回寫的【絆線】(不是證明) —— 丙 的整個前提', () => {
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('🔵 正對照:剝完註解還讀得到東西(不然下面幾格是因為讀不到而綠)', () => {
    expect(CODE.length).toBeGreaterThan(500);
    expect(CODE).toContain('useState');
  });

  it('🔴 沒有 defaultValue —— 本檔一個字都不該寫進別人的表單欄', () => {
    expect(CODE).not.toMatch(/\bdefaultValue=/);
  });

  it('🔴🔴 沒有引用任何 `manualOrderLineField` / `MANUAL_ORDER_LINE_*` —— 那是回寫的唯一路徑', () => {
    // 失敗情境:有人在這裡 document.querySelector 那些 name 再塞值 ⇒ 那就是【帶入】,
    //   而 manual-order-lines.tsx 那六道守門看不到這支檔。
    expect(CODE).not.toContain('manualOrderLineField');
    expect(CODE).not.toContain('MANUAL_ORDER_LINE_');
  });

  it('🔴 那句提示【點名區塊, 不用方向詞】(⟦b4-LOOKUPCOPYDIR⟧)', () => {
    // 🔬 病史:原文是「請自己填進**上面**那幾格」, 而要填的品項在本元件**下面**
    //    (`manual-order-form-body.tsx:220` 的碼註逐字「先查到資料, **再往下填**」)⇒ 指錯方向。
    // 🛑 而修法**不是**換成「下面」—— 同一句會出現兩個「下面」而它們指不同的東西。
    // ✅ 改成點名 `manual-order-lines.tsx:72` 那個 `<legend>` 的字面「品項」。
    // 🎯 **這一格守的不只是這次的錯字, 是「方向詞會在下次調版面時再次變成假的」。**
    expect(SRC).not.toMatch(/填進上面那幾格/);
    expect(SRC).not.toMatch(/請自己填進下面/); // 🔵 連「改成下面」那個修法也擋掉
    expect(SRC).toContain('請自己抄進「品項」那幾格');
    // 🟢 負對照:這把尺讀得到東西(否則上面三格對一個空字串全綠)
    expect(SRC.length).toBeGreaterThan(500);
  });

  it('🔴 沒有 DOM 直接操作(querySelector / getElementById / .value =)', () => {
    expect(CODE).not.toMatch(/querySelector|getElementById/);
    expect(CODE).not.toMatch(/\.value\s*=[^=]/);
  });

  it('🔴 import 名單釘死 —— 擋 codex 那條「把回寫藏進 imported helper」', () => {
    // 失敗情境:有人 import 一支 `fillLineFields(...)` 之類的 helper ⇒ 上面四格全綠, 而回寫已發生。
    // ⇒ 釘住「這支檔只准 import 這幾樣」比逐一禁字面窄得多, 而它擋得住【還沒被發明的那個名字】。
    // 🔴 `[1]` 在 `noUncheckedIndexedAccess` 下是 `string | undefined` ⇒ 過濾掉再比。
    //    (typecheck 紅在這裡, 而測試是綠的 —— 兩把尺看的不是同一件事。)
    const imports = (SRC.match(/^import[^\n]*from '([^']+)'/gm) ?? [])
      .map((l) => l.match(/from '([^']+)'/)?.[1])
      .filter((m): m is string => m !== undefined);
    const ALLOWED = ['react', '@/lib/orders/manual-order-catalog-actions', '@/lib/orders/manual-order-catalog'];
    expect(imports.length, '一個 import 都沒解析到 ⇒ 這把尺沒在動').toBeGreaterThan(1);
    expect(imports.filter((m) => !ALLOWED.includes(m)), '出現名單外的 import').toEqual([]);
  });
});
