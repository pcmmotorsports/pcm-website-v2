// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FullCancelForm, PartialCancelForm } from './cancel-order-forms';
import type { CancelItemView } from '../../lib/orders/cancel-view';
import { isCancelRequestToken } from '../../lib/orders/cancel-action-state';
import { CANCEL_REASON_CODES, CANCEL_REASON_LABEL } from '../../lib/orders/cancel-form';

// 🔴 action 是 `'use server'` 模組(拉 next/cache、next/navigation、supabase)——
//    本片測的是**表單形狀**,不是 action 行為 ⇒ mock 掉,否則 jsdom 載入即炸。
vi.mock('../../lib/orders/cancel-actions', () => ({ cancelOrderAction: vi.fn() }));

// cancel-order-forms.test.tsx — A13b D4 驗收①-⑥。
//
// 🔴 **突變清單(逐發字面 = 實跑過的那一行;十二發全紅、零存活)**。
//    ⚠️ **紅幾條逐發照實記**:共用 `CancelFormShell` ⇒ 一發打到共用處會同時紅兩支表單的斷言。
//    「只紅一條」不是本片的驗收標準,**「有紅、且紅的是該紅的那幾條」才是**。
//   N1  `mode='full'` → `mode='partial'`(只動整單那支)............... 紅 1
//   N2  🔴 hidden `cancel_mode` → `type='radio'`(值不動)............. 紅 4
//       **這發是本片核心**:它還原的正是 `E-011-STOP` 那個會誤送整單取消的舊形狀。
//   N2b 塞 `<button name='cancel_mode' value='full'>`................. 紅 4
//       R1 nit 1:第一版「沒有控制項的值是 full」漏了 `button` 選擇器 ⇒ 那條當時擋不到這發,
//       擋到它的是長度斷言。補上 `button` 之後這條才真的有份。
//   N3  整單那支塞一顆 `<input name={CANCEL_ITEM_FIELD}>`.............. 紅 2
//   N4  拿掉原因 `<option value=''>`.................................. 紅 3
//   N5  拿掉原因 select 的 `required`................................. 紅 2
//   N5b 原因下拉濾掉 `other` 一碼..................................... 紅 1
//       R1 nit 2:少一碼原本全綠,而員工只能選一個不對的原因、那筆還進 append-only 帳本。
//   N6  🔴🔴 token 凍住(模組層 `??=`)............................... 紅 3
//       D2b 移交過來的義務;補這條之前這半邊零守門。
//   N7  不過濾勾不動的品項(`filter(isItemSelectable)` → `filter(()=>true)`) 紅 1
//   N8  `itemNames?.get(…)` → `(itemNames as any)?.[…]`............... 紅 2
//       🔴 **N8 第一次跑只紅 1** —— 原型鏈那條當時是**恆真**的(斷言「畫面不含 function」,
//       而 React 本來就不會印那個字)。改成正面斷言 fallback 真的發生,它才紅得起來。
//   N9  🔴🔴 把 token 包進 `React.cache`.............................. 紅 1(**只有原始碼層那條**)
//       這發是 R1 must-fix 1 的實證:行為層在 jsdom **測不到**它(client build 的 `cache`
//       是純透傳)⇒ 補這條原始碼層守門之前,這發**全綠存活**。
//   N10 拿掉「一顆都勾不動就不渲染」.................................. 紅 1(R1 must-fix 6)
//
// 🔴 **R2(codex)之後補的五發 —— 每一發都是 codex 構造出來的實際繞法**:
//   N9b `import * as ReactNS from 'react'` + `ReactNS.cache(…)`............ 紅 1
//       v2 的守門只掃 `import {…} from 'react'` ⇒ 這發繞得過。改成「剝註解後 code 裡不准出現
//       `cache` 這個字」才擋得住雙引號 / default import / namespace / local helper 四種繞法。
//   N11 `<textarea type='hidden' name='cancel_mode'>full</textarea>`....... 紅 2
//       🔴 **這發打掉了原本三條核心斷言**:`getAttribute('type')` 回 'hidden'、`.value` 回文字內容
//       ⇒ 舊斷言全綠,而瀏覽器照樣送出 `cancel_mode=full`。
//       修法 = 斷言打在 `new FormData(form)`(真的會送出去的那份)+ 驗 `tagName === 'INPUT'`。
//   N12 `order_id` 改成可編輯文字欄................................... 紅 1
//       原本只驗值不驗型別 ⇒ 員工打進另一張單的 uuid 就會**取消錯單**。
//   N13 `cancel-actions.ts` 改成手拼 `?r=`............................ 紅 1
//       驗收⑤ 原本只掃表單檔,而**組 URL 的是 action 檔** ⇒ 守門畫在看不到問題的那個面。
//   N14 `isItemSelectable` 拿掉 `Number.isSafeInteger`................. 紅 1
//       🔴 **這發第一次跑是存活的** —— 我加了那道防禦卻**沒配只紅它的負測**。
//       加了守門沒加測試 = 那道守門從來沒有被證明過。
//   ⇒ 三個教訓:突變驗**測試自己有沒有判別力**(N8);**行為層測不到的那格要誠實改用
//     原始碼層守門並說明為什麼**(N9),不是當它不存在;**斷言要打在真的會送出去的那份資料上**(N11)。

const ITEM_A = '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a';
const ITEM_B = '4b4b4b4b-4b4b-4b4b-8b4b-4b4b4b4b4b4b';
const ORDER_ID = '9c9c9c9c-9c9c-4c9c-8c9c-9c9c9c9c9c9c';

// 🔴 **不在這裡另養一條 UUID 正規式**(R1 must-fix 2):第一版寫了一條與
//    `note-action-state.ts:42` 逐字相同的 —— 那正是那支檔案 `:62-64` 記著關卡2 抓過一次的漂移面。
//    真正要斷言的也不是「長得像 uuid」,而是「**這顆 token 過得了正式路徑的形狀閘**」。
//    漂移情境很具體:日後收緊 `isCancelRequestToken`(例如加 v4/variant 檢查)⇒ 產生器仍過我這條鬆的,
//    但解析器拒收 ⇒ **每一次取消都回 `invalid`**,而全樹零紅。
const isValidToken = isCancelRequestToken;

/**
 * 🔴 基準值刻意選過(memory `feedback_fixture-value-makes-guard-vacuous`):
 * `maxCancellable: 2` 非 0 且 **不等於** `quantity: 5` —— 相等的話「值 = id:max」那條
 * 與「值 = id:quantity」的壞實作**分不出來**。
 */
function itemView(over: Partial<CancelItemView> = {}): CancelItemView {
  return {
    orderItemId: ITEM_A,
    quantity: 5,
    instockQuantity: 0,
    cancelledQuantity: 0,
    maxCancellable: 2,
    ...over,
  };
}

afterEach(cleanup);

/**
 * 🔴🔴 **斷言要打在「真的會被送出去的那份資料」上**(R2 codex must-fix)。
 *
 * 原本只查 DOM 屬性,codex 構造出繞法:把 `cancel_mode` 換成
 * `<textarea name='cancel_mode' type='hidden'>full</textarea>` ——
 * `getAttribute('type')` 回 `'hidden'`、`.value` 回文字內容 `'full'` ⇒ 三條核心測試全綠,
 * 而瀏覽器**照樣把 `cancel_mode=full` 送出去**。
 * `new FormData(form)` 是使用者按下送出時真正發生的事,DOM 長什麼樣不影響它。
 * ⇒ 同族 memory `feedback_assertion-measures-the-wrong-thing` 的第五形狀(觀察點選錯)。
 */
function submitted(container: HTMLElement): FormData {
  const form = container.querySelector('form');
  if (form === null) throw new Error('沒有 form 可以送出');
  return new FormData(form);
}

/**
 * #350d-2:兩支表單的 `return_to` 值。
 * 🔴 用**過得了 `parseOrderReturnTo` 的值**(`panel` 必須等於本單 —— 契約 §6-1)。
 *    隨手填 `/orders?panel=x` 的話,測試會綠但那個值在正式站上會被 fail-closed 掉,
 *    等於這幾格量的是一個真站不會出現的形狀。
 */
const RETURN_TO = `/orders?payment_status=paid&panel=${ORDER_ID}`;

describe('#350d-2 兩支表單都帶 return_to(C1 的那一跳)', () => {
  // 🔴🔴 **這一跳原本零守門**(R1 must-fix 2):`order-panel-wiring.test.ts` 那組數
  //    `input[name="return_to"]` 的 fixture 是 `items: []` ⇒ `buildOrderCancelView` 回
  //    `canCancel=false` ⇒ **取消表單根本沒渲染** ⇒ 刪掉那顆 hidden input,全套照樣綠,
  //    而正式站每次取消都靜默走 fallback、把面板關掉。
  //    突變:拿掉 `CancelFormShell` 那行 `<input name={ORDER_RETURN_TO_FIELD}>` ⇒ 兩格都紅。
  it.each([
    ['整單', <FullCancelForm returnTo={RETURN_TO} orderId={ORDER_ID} />],
    ['部分', <PartialCancelForm returnTo={RETURN_TO} orderId={ORDER_ID} items={[itemView()]} />],
  ])('%s那支:送出去的 FormData 帶著逐字相同的 return_to', (_label, ui) => {
    const { container } = render(ui);
    expect(submitted(container).getAll('return_to')).toEqual([RETURN_TO]);
  });

  it('🔴 是 hidden input(不是可編輯欄 —— 員工改得動就等於自己挑導頁目標)', () => {
    const { container } = render(<FullCancelForm returnTo={RETURN_TO} orderId={ORDER_ID} />);
    const els = Array.from(container.querySelectorAll('[name="return_to"]'));
    expect(els).toHaveLength(1);
    expect(els[0]?.tagName).toBe('INPUT');
    expect(els[0]?.getAttribute('type')).toBe('hidden');
  });
});

describe('D4 驗收① 兩支各自的 hidden cancel_mode', () => {
  // 🔴 每格都同時驗兩層:**送出去的 FormData**(真相)+ **DOM 是不是 `input[type=hidden]`**
  //    (擋掉「用別種標籤偽裝成 hidden」那族繞法)。
  function expectHiddenInput(container: HTMLElement, name: string) {
    const els = Array.from(container.querySelectorAll(`[name="${name}"]`));
    expect(els).toHaveLength(1);
    const el = els[0];
    // `noUncheckedIndexedAccess` 之下 `els[0]` 是 `Element | undefined` ⇒ 顯式收窄,
    // 不用 `!`(那會讓「陣列其實是空的」變成 runtime TypeError 而不是可讀的斷言失敗)。
    if (el === undefined) throw new Error(`找不到 name=${name} 的控制項`);
    expect(el.tagName).toBe('INPUT');
    expect(el.getAttribute('type')).toBe('hidden');
  }

  it('整單那支 = hidden full(FormData 與 DOM 兩層都驗)', () => {
    const { container } = render(<FullCancelForm returnTo={RETURN_TO} orderId={ORDER_ID} />);
    expect(submitted(container).getAll('cancel_mode')).toEqual(['full']);
    expectHiddenInput(container, 'cancel_mode');
  });

  it('部分那支 = hidden partial(FormData 與 DOM 兩層都驗)', () => {
    const { container } = render(<PartialCancelForm returnTo={RETURN_TO} orderId={ORDER_ID} items={[itemView()]} />);
    expect(submitted(container).getAll('cancel_mode')).toEqual(['partial']);
    expectHiddenInput(container, 'cancel_mode');
  });

  it('兩支都帶 order_id 與 request_token,且都是 hidden(不是可編輯欄)', () => {
    // 🔴 `order_id` 若變成可編輯文字欄,員工打進另一張單的 uuid 就會**取消錯單**
    //    —— R2 codex must-fix:原本只驗值、沒驗它不可編輯。
    for (const ui of [
      <FullCancelForm returnTo={RETURN_TO} key='f' orderId={ORDER_ID} />,
      <PartialCancelForm returnTo={RETURN_TO} key='p' orderId={ORDER_ID} items={[itemView()]} />,
    ]) {
      const { container } = render(ui);
      expect(submitted(container).get('order_id')).toBe(ORDER_ID);
      expectHiddenInput(container, 'order_id');
      expectHiddenInput(container, 'request_token');
      cleanup();
    }
  });
});

describe('D4 驗收② 部分那支沒有任何能變成 full 的控制項', () => {
  // 🔴 這一組守的是 `E-011-STOP` 的事故面:舊形狀是單一 form + radio,
  //    React 19 form reset 競態 + 返回鍵的表單狀態復原會把 radio 勾回 `full`
  //    ⇒ 員工以為送部分取消、實際送整單取消。v3 的解法是「形狀上不存在那條路」。
  it('零 radio', () => {
    const { container } = render(<PartialCancelForm returnTo={RETURN_TO} orderId={ORDER_ID} items={[itemView()]} />);
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(0);
  });

  it('送出去的 cancel_mode 恰好一筆、值是 partial(不是 full)', () => {
    // 🔴 這條打在 FormData 上:不管畫面上長什麼樣,**真的會被送出去的**只有 partial 一筆。
    const { container } = render(<PartialCancelForm returnTo={RETURN_TO} orderId={ORDER_ID} items={[itemView()]} />);
    expect(submitted(container).getAll('cancel_mode')).toEqual(['partial']);
  });

  it('整份表單裡沒有任何控制項的值是 full', () => {
    // 🔴 選擇器要含 `button`(R1 nit 1):`<button name='cancel_mode' value='full'>` 送得出
    //    `cancel_mode=full`,而第一版的選擇器漏了它 —— 那時擋到它的是上面那條長度斷言,
    //    不是這條。兩條各自守不同的面,別讓這條看起來比實際能耐大。
    const { container } = render(<PartialCancelForm returnTo={RETURN_TO} orderId={ORDER_ID} items={[itemView()]} />);
    const values = Array.from(
      container.querySelectorAll('input, select, option, textarea, button'),
    ).map((el) => el.getAttribute('value'));
    expect(values).not.toContain('full');
  });
});

describe('D4 原因下拉的七碼完整性', () => {
  // 🔴 R1 nit 2:少渲染一碼(例如濾掉 `other`)⇒ 全綠,而員工只能選一個不對的原因,
  //    那筆還會進 append-only 帳本。碼的權威是 DB CHECK(`20260730130000:131-139`)。
  it('七個原因碼全部渲染成 option,且文案取自單一字典', () => {
    const { container } = render(<FullCancelForm returnTo={RETURN_TO} orderId={ORDER_ID} />);
    const options = Array.from(container.querySelectorAll('select[name="reason_code"] option'));
    // 空 placeholder + 七碼
    expect(options).toHaveLength(CANCEL_REASON_CODES.length + 1);
    for (const code of CANCEL_REASON_CODES) {
      const match = options.find((el) => el.getAttribute('value') === code);
      expect(match, `缺少原因碼 ${code}`).toBeDefined();
      expect(match?.textContent).toBe(CANCEL_REASON_LABEL[code]);
    }
  });
});

describe('D4 驗收③ 整單那支零品項欄', () => {
  it('沒有 cancel_item 欄', () => {
    const { container } = render(<FullCancelForm returnTo={RETURN_TO} orderId={ORDER_ID} />);
    expect(container.querySelectorAll('[name="cancel_item"]')).toHaveLength(0);
  });

  it('也沒有任何 checkbox', () => {
    const { container } = render(<FullCancelForm returnTo={RETURN_TO} orderId={ORDER_ID} />);
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  });
});

describe('D4 驗收④ 原因 select 有空 placeholder + required', () => {
  // 🔴 沒有空 placeholder 時瀏覽器**自動選第一個** ⇒「重選原因」根本沒發生,
  //    而表單照樣送得出去、帶著員工沒看過的原因(plan §2-3 逐字)。
  it.each([
    ['整單', <FullCancelForm returnTo={RETURN_TO} key='f' orderId={ORDER_ID} />],
    ['部分', <PartialCancelForm returnTo={RETURN_TO} key='p' orderId={ORDER_ID} items={[itemView()]} />],
  ])('%s 那支:select required 且第一個 option 是空值 placeholder', (_label, ui) => {
    const { container } = render(ui);
    const select = container.querySelector('select[name="reason_code"]');
    expect(select).not.toBeNull();
    expect(select).toHaveProperty('required', true);
    const first = select!.querySelector('option');
    expect(first).toHaveProperty('value', '');
    expect(first?.textContent).toContain('請選擇');
  });
});

describe('D4 驗收⑥ token 每次 render 都是新鑄的一顆合法 uuid', () => {
  // 🔴🔴 **這條是 D2b 刪掉舊 state 族時搶救出來的義務**(`cancel-action-state.ts:73-79`)。
  //    產生點若落進 `unstable_cache` / `React.cache`,token 會被凍住 ⇒ 兩個人拿到同一把
  //    ⇒ 第二個人送出時直接撞冪等格。補這條之前,這半邊**從來沒有測試守過**。
  function tokenOf(ui: React.ReactElement): string {
    const { container } = render(ui);
    const value = container.querySelector('[name="request_token"]')?.getAttribute('value') ?? '';
    cleanup();
    return value;
  }

  it('兩次獨立 render 拿到兩顆不同的合法 uuid(整單)', () => {
    const a = tokenOf(<FullCancelForm returnTo={RETURN_TO} orderId={ORDER_ID} />);
    const b = tokenOf(<FullCancelForm returnTo={RETURN_TO} orderId={ORDER_ID} />);
    expect(isValidToken(a)).toBe(true);
    expect(isValidToken(b)).toBe(true);
    expect(a).not.toBe(b);
  });

  it('兩次獨立 render 拿到兩顆不同的合法 uuid(部分)', () => {
    const a = tokenOf(<PartialCancelForm returnTo={RETURN_TO} orderId={ORDER_ID} items={[itemView()]} />);
    const b = tokenOf(<PartialCancelForm returnTo={RETURN_TO} orderId={ORDER_ID} items={[itemView()]} />);
    expect(isValidToken(a)).toBe(true);
    expect(isValidToken(b)).toBe(true);
    expect(a).not.toBe(b);
  });

  it('🔴 同一頁兩支表單也是兩顆不同的 token(`React.cache` 在真 server 上的症狀)', () => {
    // `React.cache` 是 per-request memo ⇒ 真 server 上同一次請求裡兩支表單會共用一顆。
    // ⚠️ 誠實邊界:**這條在 jsdom 測不出那個症狀**(client build 的 `cache` 是純透傳,
    //    實跑證過 —— 包起來 17 測全綠)。它擋的是「把 token 提到模組層/共用變數」那一族;
    //    `React.cache` / `unstable_cache` 那一格由下面的原始碼層守門接手。
    const { container } = render(
      <>
        <FullCancelForm returnTo={RETURN_TO} orderId={ORDER_ID} />
        <PartialCancelForm returnTo={RETURN_TO} orderId={ORDER_ID} items={[itemView()]} />
      </>,
    );
    const tokens = Array.from(container.querySelectorAll('[name="request_token"]')).map((el) =>
      el.getAttribute('value'),
    );
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).not.toBe(tokens[1]);
  });

  it('🔴 原始碼層:本元件不得 import 任何快取層', () => {
    // 🔴 **這條是原始碼層守門,判別力比行為層低 —— 但這一格行為層真的做不到**(R1 must-fix 1):
    //    `react` 的 client build 裡 `cache` 是純透傳
    //    (`react@19.2.6/cjs/react.development.js:917-921`),jsdom 測試走的就是那支
    //    ⇒ 包成 `cache(generateCancelRequestToken)()` 之後 **17 測全綠**(我實跑過)。
    //    plan D4 驗收⑥ 逐字點名這兩個快取層,不能因為測不到就當它不存在。
    // ⚠️ 它擋的是「本檔自己」,擋不住呼叫端把整棵樹包起來(D6 接線時看)。
    // 🔴 **先剝註解再比對整份 code**(R2 codex must-fix 打掉前兩版):
    //    v1 用 `/\bcache\s*\(/` 掃全文 ⇒ 命中我**自己註解裡**的示範字串 = 假紅。
    //    v2 只掃 `import … from '…';` 敘述 ⇒ codex 立刻構造出四種繞法:
    //      `import * as React from 'react'` 再 `React.cache(…)`、default import、雙引號、
    //      以及自己包一支 local cache helper。
    //    v3 = 剝掉註解之後,**code 裡不准出現 `cache` 這個字**(含 `unstable_cache`)。
    //    夠嚴、也不會被措辭繞過;要用到這個字的人會先撞到這條、被迫來讀為什麼。
    // ⚠️ **誠實邊界**:這仍是文字層守門,擋不住「呼叫端把整棵樹包進快取層」,也擋不住
    //    改用別的機制凍結(例如自己 memo 一顆模組層變數 —— 那一格由 N6 突變的行為層守門接手)。
    const stripComments = (s: string) =>
      s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const code = stripComments(readFileSync(join(__dirname, 'cancel-order-forms.tsx'), 'utf8'));
    expect(code).not.toMatch(/\bcache\b/i);
    expect(code).not.toMatch(/next\/cache/);
  });
});

describe('D4 品項欄的形狀與過濾', () => {
  it('checkbox 的值 = `<order_item_id>:<可取消量>`(對齊解析器)', () => {
    const { container } = render(
      <PartialCancelForm returnTo={RETURN_TO} orderId={ORDER_ID} items={[itemView({ maxCancellable: 2 })]} />,
    );
    const box = container.querySelector('input[name="cancel_item"]');
    // 🔴 值取的是「可取消量 2」而不是「買的量 5」—— 兩者刻意不同,壞實作分得出來。
    expect(box).toHaveProperty('value', `${ITEM_A}:2`);
  });

  it('勾不動的品項不列出來,而且一顆都勾不動時整支表單不渲染', () => {
    // 🔴 後半是 R1 must-fix 6:空 fieldset 配一顆按得下去的送出鈕 ⇒ 按下去必然 `{ok:false}`
    //    (部分取消要求至少一筆,`cancel-form.ts:208`)⇒ `order_cancel_invalid` + 原因欄不保留。
    const { container } = render(
      <PartialCancelForm returnTo={RETURN_TO}
        orderId={ORDER_ID}
        items={[
          itemView({ orderItemId: ITEM_A, maxCancellable: null }),
          itemView({ orderItemId: ITEM_B, maxCancellable: 0 }),
        ]}
      />,
    );
    expect(container.querySelectorAll('input[name="cancel_item"]')).toHaveLength(0);
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('button[type="submit"]')).toBeNull();
  });

  it('🔴 非正整數的可取消量不列出來(小數 / Infinity)', () => {
    // 🔴 **這條是突變抓出來的漏網**:我在 `isItemSelectable` 加了 `Number.isSafeInteger`,
    //    卻**沒配一條只紅它的負測** ⇒ 拿掉那道防禦時 N14 突變**全綠存活**。
    //    加了守門沒加測試 = 守門沒有被證明過(同族 memory `feedback_guard-checks-existence-not-effect`)。
    // 失敗情境:`1.5` 通得過 `> 0` ⇒ 表單組出 `<uuid>:1.5` ⇒ 解析器的 `/^[0-9]+$/` 必拒
    //    ⇒ 整份 `{ok:false}`、原因欄不保留要重填。
    const { container } = render(
      <PartialCancelForm returnTo={RETURN_TO}
        orderId={ORDER_ID}
        items={[
          itemView({ orderItemId: ITEM_A, maxCancellable: 1.5 }),
          itemView({ orderItemId: ITEM_B, maxCancellable: Number.POSITIVE_INFINITY }),
        ]}
      />,
    );
    expect(container.querySelectorAll('input[name="cancel_item"]')).toHaveLength(0);
  });

  it('有品名就顯示品名,沒有就退回 id 尾八碼', () => {
    const { container } = render(
      <PartialCancelForm returnTo={RETURN_TO}
        orderId={ORDER_ID}
        items={[itemView({ orderItemId: ITEM_A }), itemView({ orderItemId: ITEM_B })]}
        itemNames={new Map([[ITEM_A, '下導流']])}
      />,
    );
    expect(container.textContent).toContain('下導流');
    expect(container.textContent).toContain(`…${ITEM_B.slice(-8)}`);
  });

  it('🔴 品名查表不得取到原型鏈屬性(id 剛好叫 constructor 時仍走 fallback)', () => {
    // memory `reference_js-index-lookup-hits-prototype-chain`:`obj['constructor']` 是 truthy
    // ⇒ 物件索引版**不會**走 `??` 的 fallback,會把原型鏈上的東西當品名畫出去。用 `Map` 沒有這回事。
    //
    // 🔴 **這條的第一版是恆真的**(N8 突變實測零紅):原本斷言「畫面不含 function / Object」——
    //    而 React 對函式 child 本來就不會印出那些字 ⇒ 壞實作照樣綠。
    //    改成**正面斷言 fallback 真的發生了**,壞實作才紅得起來
    //    (同族 memory `feedback_negative-test-observation-supplied-by-another-mechanism`)。
    const { container } = render(
      <PartialCancelForm returnTo={RETURN_TO}
        orderId={ORDER_ID}
        items={[itemView({ orderItemId: 'constructor' })]}
        itemNames={new Map()}
      />,
    );
    expect(container.textContent).toContain(`…${'constructor'.slice(-8)}`);
  });
});

describe('D4 驗收⑤ URL 只准經三支建構器組', () => {
  // 🔴 這條是**約束、不是型別保證**(窄 R3 F1):`ORDER_CANCELLED_RESULT_CODE` 與
  //    `toOrderCancelResultCode` 為了 banner 與 D5 必須公開匯出,手拼 `?r=…` 編得過。
  //    ⇒ 驗收放在這裡:本檔不得出現任何手拼的 `?r=`。
  it('取消線零手拼 `?r=`(表單檔 + action 檔一起掃)', () => {
    // 🔴 **只掃表單檔是掃錯地方**(R2 codex must-fix):組 URL 的是 `cancel-actions.ts`,
    //    表單檔本來就不碰 URL ⇒ 那條守門對「真正會出事的檔」全盲,
    //    action 那四處改成手拼照樣全綠。同族 memory `feedback_guard-drawn-at-narrowest-surface-not-invariant`
    //    ——守門要畫在「不變量成立的面」,不是「我剛好在看的那個檔」。
    const stripComments = (s: string) =>
      s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const read = (rel: string) => stripComments(readFileSync(join(__dirname, rel), 'utf8'));

    expect(read('cancel-order-forms.tsx')).not.toContain('?r=');

    // action 檔:不得手拼,且三支建構器都要真的被呼叫到。
    const actions = read('../../lib/orders/cancel-actions.ts');
    expect(actions).not.toMatch(/\?r=/);
    for (const builder of ['notSentResultQuery', 'sentResultQuery', 'cancelledResultQuery']) {
      expect(actions, `${builder} 沒有被呼叫`).toMatch(new RegExp(`${builder}\\(`));
    }
  });
});
