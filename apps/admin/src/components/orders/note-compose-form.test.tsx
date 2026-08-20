// @vitest-environment jsdom
// 🔴 釘非 UTC 時區(R1 MF3):CI 是 UTC,epoch 等值斷言在 UTC 下對「把 local 當 UTC 解析」的
//    突變恆真(兩邊同錯相消)。釘 Asia/Taipei 後該突變差 8 小時、必轉紅;test [3] 內含前提自斷言。
process.env.TZ = 'Asia/Taipei';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { noteFailure, type NoteActionState } from '../../lib/orders/note-action-state';

// M-4b E10 A10a-3 smoke test(plan §4;測試矩陣編號對照)。
// 🔴 mock 掉 server action 模組(transitively 拉 next/cache 與 session,jsdom 載不了);
//    action 的語意層在 note-actions.test.ts 測過,這裡只測表單接線。

const actionMock = vi.fn<(prev: NoteActionState, form: FormData) => Promise<NoteActionState>>();
vi.mock('../../lib/orders/note-actions', () => ({
  appendOrderNoteAction: (prev: NoteActionState, form: FormData) => actionMock(prev, form),
}));

import { NoteComposeForm } from './note-compose-form';

const ORDER_ID = '3f2f2c1e-0000-4000-8000-000000000001';
const TOKEN = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const TARGET = {
  id: 'cccccccc-1111-4222-8333-444444444444',
  seq: 2,
  noteType: 'internal' as const,
  typeLabel: '內部備註',
  excerpt: '原內容',
};

function tokenInput(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>('input[name="request_token"]');
  if (!el) throw new Error('request_token hidden input 不在');
  return el;
}

beforeEach(() => {
  actionMock.mockReset();
  actionMock.mockResolvedValue({ status: 'idle', requestToken: TOKEN });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** #350d-3:表單的 `return_to` 值(用過得了 parser 的形狀:站內 /orders 路徑)。 */
const RETURN_TO = '/orders?payment_status=paid';


describe('#350d-3 return_to 這一跳(表單 → action)', () => {
  // 🔴🔴 **這一跳最容易零守門**(取消線 R1 must-fix 2 的同型):元件收了 prop、action 讀了欄位,
  //    但**中間那顆 hidden input 沒有人數** ⇒ 刪掉它全套照樣綠,而正式站每次動作都靜默走
  //    fallback、把面板關掉。突變:拿掉那行 `<input name={ORDER_RETURN_TO_FIELD}>` ⇒ 這格紅。
  it('送出去的 FormData 帶著逐字相同的 return_to,而且是 hidden input', () => {
    const { container } = render(<NoteComposeForm returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={TOKEN} correctTarget={null} />);
    const form = container.querySelector('form');
    if (form === null) throw new Error('沒有 form 可以送出');
    expect(new FormData(form).getAll('return_to')).toEqual([RETURN_TO]);
    const els = Array.from(container.querySelectorAll('[name="return_to"]'));
    expect(els).toHaveLength(1);
    expect(els[0]?.tagName).toBe('INPUT');
    expect(els[0]?.getAttribute('type')).toBe('hidden');
  });
});

describe('NoteComposeForm — A10a-3', () => {
  it('[1] 預設 internal:無管道/時間欄;hidden token=serverToken、order_id 正確', () => {
    const { container } = render(
      <NoteComposeForm returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={TOKEN} correctTarget={null} />,
    );
    expect(tokenInput(container).value).toBe(TOKEN);
    expect(container.querySelector<HTMLInputElement>('input[name="order_id"]')?.value).toBe(ORDER_ID);
    expect(container.querySelector('select[name="channel"]')).toBeNull();
    expect(container.querySelector('input[type="datetime-local"]')).toBeNull();
    expect(container.querySelector('input[name="corrects_note_id"]')).toBeNull();
  });

  it('[2] 切聯絡紀錄:管道+時間出現且 required;切回 internal 消失', () => {
    const { container, getByLabelText } = render(
      <NoteComposeForm returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={TOKEN} correctTarget={null} />,
    );
    fireEvent.click(getByLabelText('客人聯繫'));
    const channel = container.querySelector<HTMLSelectElement>('select[name="channel"]');
    expect(channel?.required).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[type="datetime-local"]')?.required).toBe(true);
    fireEvent.click(getByLabelText('內部備註'));
    expect(container.querySelector('select[name="channel"]')).toBeNull();
  });

  it('[3] datetime 換算:hidden occurred_at 帶偏移且與員工指的那個台北時刻等值', () => {
    // 前提自斷言:本檔第 1 行的 TZ 釘住真的生效(否則 epoch 斷言無判別力 = MF3)
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Asia/Taipei');
    const { container, getByLabelText } = render(
      <NoteComposeForm returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={TOKEN} correctTarget={null} />,
    );
    fireEvent.click(getByLabelText('客人聯繫'));
    fireEvent.change(getByLabelText('聯絡時間(台北時間)'), {
      target: { value: '2026-08-02T14:30' },
    });
    const hidden = container.querySelector<HTMLInputElement>('input[name="occurred_at"]');
    // 帶偏移字面(債②:datetime-local 原始值會被解析器拒收)
    expect(hidden?.value).toMatch(/(Z|[+-]\d{2}:\d{2})$/);

    // 🔴🔴 `#655`(2026-08-18):**期望值從 `…06:30:00.000Z` 換成固定偏移字面。**
    //
    //   ⚠️ **這不是把期望值改成現況** —— 兩者**是同一個時刻**(台北 14:30 = UTC 06:30),
    //   換掉的是**產生它的方式**:舊實作 `new Date(local).toISOString()` 吃**裝置時區**,
    //   新實作 `toTaipeiIso()` 是純字串轉換 + 寫死 `+08:00`。
    //
    //   🔴 **而這一格為什麼抓不到舊的病 —— 值得記**:本檔第 1 行把 `TZ` 釘成 `Asia/Taipei`
    //   (上面 `:92` 還自斷言它生效)⇒ **測試被固定在【那個 bug 看不見的世界】裡**。
    //   在台北機器上舊實作是對的;在 UTC / 紐約機器上它差 8 / 12 小時,而**沒有任何一格會紅**。
    //
    //   ✅ **新期望值連那個世界一起擋掉**:`+08:00` 這種字面
    //   **`new Date(x).toISOString()` 在任何時區都產不出來**(它恆以 `Z` 結尾)
    //   ⇒ 只要有人把實作換回 `new Date(local)`,這一格**在任何 TZ 下都紅**。
    expect(hidden!.value, '換回 new Date(local) ⇒ 會變成 Z 結尾 ⇒ 此格紅(且不吃執行環境的 TZ)').toBe(
      '2026-08-02T14:30:00+08:00',
    );
    // 而它仍然必須是**同一個時刻**(換算對不對,與字面長相分開驗)
    expect(Date.parse(hidden!.value), '偏移寫錯 ⇒ 字面對而時刻錯').toBe(
      Date.parse('2026-08-02T06:30:00.000Z'),
    );
  });

  it('[4] 更正模式:不可撤回文案 + hidden corrects_note_id + 取消更正連結', () => {
    const { container, getByText } = render(
      <NoteComposeForm returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={TOKEN} correctTarget={TARGET} />,
    );
    expect(container.textContent).toContain('不可撤回');
    expect(container.querySelector<HTMLInputElement>('input[name="corrects_note_id"]')?.value).toBe(TARGET.id);
    expect(getByText('取消更正').getAttribute('href')).toBe(`/orders/${ORDER_ID}`);
  });

  it('[5] confirm 閘(債⑥):更正模式 confirm=false 擋下送出、true 放行;非更正不問', { timeout: 10000 }, async () => {
    // 🔴 觀察點 = action 呼叫次數,不是 submit 事件的 preventDefault ——
    //    React 19 接手 form action 時本來就會 preventDefault,事件層分不出「誰擋的」。
    const confirmSpy = vi.spyOn(window, 'confirm');
    const { container, rerender } = render(
      <NoteComposeForm returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={TOKEN} correctTarget={TARGET} />,
    );
    const form = container.querySelector('form')!;
    confirmSpy.mockReturnValue(false);
    fireEvent.submit(form);
    expect(confirmSpy.mock.calls.length).toBe(1);
    expect(confirmSpy.mock.calls[0]![0]).toContain('不可撤回');
    expect(confirmSpy.mock.calls[0]![0]).toContain(TARGET.excerpt);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(actionMock.mock.calls.length).toBe(0);
    confirmSpy.mockReturnValue(true);
    fireEvent.submit(form);
    // 🔴 本格這兩發 waitFor(本行 + `actionMock===2` 那發)【刻意不帶 timeout】,不是漏做:
    //    格預算現為 10000ms(見下方 deadline 沿革),下面 corrects_note_id 那發吃 7000 ⇒
    //    這兩發沿用庫預設 1000 各一 ⇒ 最壞 1000+7000+1000=9000 < 10000,留 1000 margin
    //    讓失敗訊息保持是「哪一發 waitFor 沒成真」而非退化成泛用 Test timed out。
    //    若這兩發哪天【自己】野外紅:先看是不是 corrects 那發的 7000 吃掉了預算(那要縮它、
    //    不是加這兩發);真要加這兩發,連格 timeout 一起抬並回頭讀下面停止規則。
    await waitFor(() => expect(actionMock.mock.calls.length).toBe(1));
    // 非更正模式:不問 confirm
    rerender(<NoteComposeForm returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={TOKEN} correctTarget={null} />);
    // 🔴🔴 **這一行是【等狀態真的翻過去】,不是放寬期望值** —— 拿掉它本格就是那個
    //    「全測偶爾紅一格、單跑永遠綠」的來源(2026-08-16 由 R2 對抗審查定位)。
    //    **病根**:`rerender` 之後 React 19 的 `useActionState` transition 還在飛
    //    (`note-compose-form.tsx` 錨點 `useActionState`),而上一行的 `waitFor` 只等到
    //    「action 被呼叫」⇒ 掛在 DOM 上的 `onSubmit` closure 裡的 `correctTarget`
    //    **可能還是舊的 TARGET** ⇒ 這一送出會多問一次 confirm ⇒ 下面那條得到 3 不是 2。
    //    ⚠️ 它要**多 worker 競爭**才輸得掉這個 race ⇒ 正好是「全測會紅、單跑不會」,
    //       而那個形狀會讓人以為是「環境問題」而不是測試裡的真 race。
    //       (2026-08-17 野生實例 bfbc2844 收窄了條件面:零並行下也輸過一次 ⇒ 不只多 worker。)
    //    ⇒ 等的東西挑 `corrects_note_id`:那顆 hidden 只在 `correctTarget` 非 null 時渲染
    //      (元件錨點 `NOTE_CORRECTS_FIELD`)⇒ 它消失 = 新的 props 真的 commit 進去了。
    //    🔴 deadline 沿革(每一次抬都留痕,別讓下一個人以為這是第一次):
    //      1000ms(testing-library 庫預設,從沒被人為這格選過)
    //        → 3000ms(9d353733;當時推導=≈3×唯一量到的越線點 1029ms)
    //        → 10000ms 格 + 7000ms waitFor(本次;3000 在 dev d86c3d50 野外被超 52ms=3052ms,
    //          load 61.73)。格 timeout 10000、本 waitFor 7000:另兩發 bare waitFor 各吃庫預設
    //          1000 ⇒ 最壞 1000+7000+1000=9000 < 10000,留 1000 margin ⇒ 失敗訊息保持
    //          「waitFor 這個條件沒成真」而非退化成泛用「Test timed out」。連格一起抬=前一版註解
    //          預寫的撤退動作(「若野外紅 ⇒ 連格 timeout 一起加」),不是慌時挑數字。
    //      🔴🔴 停止規則:如果它在 {timeout:10000} 之下【再紅一次】,答案【不是】改成 20000
    //        ——「再加一點」永遠是當下最便宜的動作,而它每次都成立一點點(在同一框架裡找更細的問題)。
    //        再紅=這格的設計錯了,要換做法:①換成不依賴牆鐘的確定性等待條件,或②移出四綠、
    //        隔離成獨立跑的一格。做這決定的人要看到這條:1000→3000→10000 已經發生過【兩次】。
    //      🔴 誠實邊界:1029ms 是在【當時機器狀態】量的,而 load 今晚在 6~88 擺盪 ⇒ 用倍率設
    //        deadline、分母浮動時倍率不保護任何東西。任何【固定】deadline 在無上界 load 下都證不了
    //        安全;10000 遠高於觀測 3052 是【緩解】不是【證明】。真根是症狀 A(load/冷快取 transform
    //        ×檔重,見 #618),不是這格寫錯——所以「再加」修的是錯的那一層。
    await waitFor(
      () => expect(container.querySelector('input[name="corrects_note_id"]')).toBeNull(),
      { timeout: 7000 },
    );
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(actionMock.mock.calls.length).toBe(2));
    expect(confirmSpy.mock.calls.length).toBe(2);
  });

  it('[6] 失敗 state:訊息顯示 + token 沿用 state 那把(R2-2)', async () => {
    actionMock.mockResolvedValue(noteFailure('INVALID_BODY', '員工打的字', 'ffffffff-0000-4000-8000-000000000009'));
    const { container, findByRole } = render(
      <NoteComposeForm returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={TOKEN} correctTarget={null} />,
    );
    fireEvent.submit(container.querySelector('form')!);
    const alert = await findByRole('alert');
    expect(alert.textContent).toContain('備註內容不能空白');
    expect(tokenInput(container).value).toBe('ffffffff-0000-4000-8000-000000000009');
  });

  it('[7] pending:送出中按鈕 disabled(disabled 按鈕吃不到後續 click;真雙擊窗口 jsdom 測不到,真保證=A6 token 冪等)', async () => {
    actionMock.mockImplementation(() => new Promise(() => {})); // 懸置
    const { container, getByRole } = render(
      <NoteComposeForm returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={TOKEN} correctTarget={null} />,
    );
    fireEvent.submit(container.querySelector('form')!);
    // pending 態=同一套 useActionState transition 家族(bfbc2844 量到該家族合法延遲
    // 可 >1000);本格只有這一發 waitFor、前置全同步 ⇒ 3000 距格預算 5000 餘裕足,安全帶。
    await waitFor(
      () => {
        expect(getByRole('button', { name: '送出中…' })).toHaveProperty('disabled', true);
      },
      { timeout: 3000 },
    );
    fireEvent.click(getByRole('button', { name: '送出中…' }));
    expect(actionMock.mock.calls.length).toBe(1);
  });

  it('[8] pageshow persisted → token 重產(債④);非 persisted 不換、值仍合法 uuid', () => {
    const { container } = render(
      <NoteComposeForm returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={TOKEN} correctTarget={null} />,
    );
    const persistedShow = new Event('pageshow');
    Object.defineProperty(persistedShow, 'persisted', { value: true });
    fireEvent(window, persistedShow);
    const regenerated = tokenInput(container).value;
    expect(regenerated).not.toBe(TOKEN);
    expect(regenerated).toMatch(/^[0-9a-f-]{36}$/);
    // 非 persisted(一般載入)不得換
    fireEvent(window, new Event('pageshow'));
    expect(tokenInput(container).value).toBe(regenerated);
  });

  it('[9] MF1:更正聯絡類備註 → radio 初值 = 原型別、管道/時間欄直接在場', () => {
    const { container, getByLabelText } = render(
      <NoteComposeForm returnTo={RETURN_TO}
        orderId={ORDER_ID}
        serverToken={TOKEN}
        correctTarget={{ ...TARGET, noteType: 'customer_notified', typeLabel: '客人聯繫 · 已告知' }}
      />,
    );
    // 🔴 二選一+勾選之後,「型別初值正確」要三格一起看 —— 少任一格都可能綠而錯:
    //    只看 radio ⇒ 勾選漏掉時仍綠(而送出的會是 contact_log = 把告知證據降級成一般聯絡)
    //    只看勾選   ⇒ radio 停在內部備註時仍綠(而管道/時間欄不會出現)
    //    只看 hidden⇒ 畫面沒反映初值時仍綠(員工看到的是「內部備註」而送出的是告知)
    expect((getByLabelText('客人聯繫') as HTMLInputElement).checked).toBe(true);
    expect((getByLabelText('這次有正式告知客人') as HTMLInputElement).checked).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[name="note_type"]')?.value).toBe(
      'customer_notified',
    );
    expect(container.querySelector('select[name="channel"]')).not.toBeNull();
  });

  it('[9b] 🔴 型別映射雙向:客人聯繫 ⇄ 勾選 ⇄ 內部備註,送出的 note_type 每一步都要對', () => {
    const { container, getByLabelText } = render(
      <NoteComposeForm returnTo={RETURN_TO} orderId={ORDER_ID} serverToken={TOKEN} correctTarget={null} />,
    );
    const sent = () => container.querySelector<HTMLInputElement>('input[name="note_type"]')?.value;
    // 🔴 值域三值一個都沒動(DB CHECK 的鏡像)——合的是畫面,不是資料。
    expect(sent()).toBe('internal');
    fireEvent.click(getByLabelText('客人聯繫'));
    expect(sent()).toBe('contact_log');
    fireEvent.click(getByLabelText('這次有正式告知客人'));
    expect(sent()).toBe('customer_notified');
    // 🔴 回頭路(負向):取消勾選必須降回 contact_log,不能卡在 customer_notified ——
    //    卡住的話員工以為只是聯絡一下,而寫進 append-only 的是一筆假的告知義務證據。
    fireEvent.click(getByLabelText('這次有正式告知客人'));
    expect(sent()).toBe('contact_log');
    fireEvent.click(getByLabelText('內部備註'));
    expect(sent()).toBe('internal');
    // 內部備註不得出現告知勾選(它不可能是告知)
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it('[10] MF2:correctionMissing → 警告顯示「會是新備註」、不進更正模式', () => {
    const { container } = render(
      <NoteComposeForm returnTo={RETURN_TO}
        orderId={ORDER_ID}
        serverToken={TOKEN}
        correctTarget={null}
        correctionMissing
      />,
    );
    expect(container.textContent).toContain('找不到指定要更正的備註');
    expect(container.textContent).toContain('新備註');
    expect(container.querySelector('input[name="corrects_note_id"]')).toBeNull();
  });
});
