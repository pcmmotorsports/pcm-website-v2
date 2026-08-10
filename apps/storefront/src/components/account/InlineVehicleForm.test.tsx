// @vitest-environment jsdom
// InlineVehicleForm smoke — V-1c++(Sean 07-16 實測回饋二輪):車型欄=品牌/車型雙下拉
// (與首頁同 combobox 原型、清單可捲無 8 筆截斷)為主、「改用自行輸入」fallback;
// 送出名稱=字典標準字面「品牌 車型」→ 首頁愛車 chips 可精確命中。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { InlineVehicleForm } from './InlineVehicleForm';
import type { MockMotoBrand } from '@/data/mock-moto-brands';

const BRANDS: MockMotoBrand[] = [
  {
    id: 'yamaha',
    name: 'Yamaha',
    models: [
      { id: 'r6', name: 'YZF-R6', years: [2018, 2019, 2020] },
      { id: 'r1', name: 'YZF-R1', years: [2020, 2021] },
    ],
  },
  { id: 'kawasaki', name: 'Kawasaki', models: [{ id: 'z900', name: 'Z900', years: [2021] }] },
];

afterEach(cleanup);

function renderForm(props: { vehicleBrands?: MockMotoBrand[]; veh?: Record<string, unknown> } = {}) {
  const onSubmit = vi.fn().mockResolvedValue({ ok: true as const });
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const utils = render(
    <InlineVehicleForm
      veh={props.veh ?? {}}
      onClose={onClose}
      onSaved={onSaved}
      onSubmit={onSubmit}
      vehicleBrands={props.vehicleBrands}
    />,
  );
  return { onSubmit, onClose, onSaved, ...utils };
}

function combo(label: string) {
  return screen.getByRole('combobox', { name: label }) as HTMLInputElement;
}

function pickByTyping(label: string, text: string) {
  const input = combo(label);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input); // 唯一精確命中 → 套用
  return input;
}

describe('InlineVehicleForm — 車型字典雙下拉(V-1c++)', () => {
  // 🔴 Sean 2026-08-07 Q6=A(審查 F2 抓到我漏了這個消費端):Q4=B 起「打了查無的字、blur 也不清掉」,
  //    欄位沒傳 `emptyHint` 的話重新 focus 只剩自己那串字、無清單無提示 = 死路。
  //    ⚠️ 兩欄各驗一次 —— 只驗廠牌的話,車型欄漏傳照樣全綠。
  it('🔴 Q6=A:廠牌欄與車型欄零命中都給出路提示(兩欄各驗一次)', () => {
    renderForm({ vehicleBrands: BRANDS });
    const brand = combo('選擇廠牌');
    fireEvent.focus(brand);
    fireEvent.change(brand, { target: { value: 'zzzz' } });
    expect(screen.getByRole('status').textContent, '廠牌欄零命中無提示').toBe(
      '查無符合的廠牌，請調整關鍵字',
    );
    // 車型欄要先選定廠牌才啟用(disabled 會讓 showEmptyHint 短路 ⇒ 不先選就是恆真)
    pickByTyping('選擇廠牌', BRANDS[0]!.name);
    const model = combo('選擇車型');
    expect(model.disabled, '前提:車型欄要真的啟用,否則本斷言恆真').toBe(false);
    fireEvent.focus(model);
    fireEvent.change(model, { target: { value: 'zzzz' } });
    expect(screen.getByRole('status').textContent, '車型欄零命中無提示').toBe(
      '查無符合的車型，請調整關鍵字',
    );
  });

  // A6(選車引擎統一 B′):欄標與 aria 走 A 表「廠牌」;placeholder 由範例值(YAMAHA / YZF-R6)
  // 換成提示字 —— 範例值長得像已填好的值。原本這兩個 placeholder 零守門,改回去照樣全綠。
  it('A 表字面:欄標=廠牌、placeholder=提示字而非範例值', () => {
    renderForm({ vehicleBrands: BRANDS });
    expect(screen.getByText('廠牌')).toBeTruthy();
    expect(combo('選擇廠牌').placeholder).toBe('選擇或輸入廠牌');
    expect(combo('選擇車型').placeholder).toBe('選擇或輸入車型');
  });

  it('預設 dict 模式:品牌/車型雙下拉;選品牌解鎖車型;送出=標準字面「品牌 車型」', async () => {
    const { onSubmit } = renderForm({ vehicleBrands: BRANDS });
    expect(combo('選擇車型').disabled).toBe(true);
    pickByTyping('選擇廠牌', 'Yamaha');
    expect(combo('選擇車型').disabled).toBe(false);
    pickByTyping('選擇車型', 'YZF-R6');
    fireEvent.click(screen.getByText('儲存'));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ name: 'Yamaha YZF-R6' });
  });

  it('聚焦品牌 → 展開完整清單(可捲、無截斷);換品牌 → 車型連動清空', () => {
    renderForm({ vehicleBrands: BRANDS });
    fireEvent.focus(combo('選擇廠牌'));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Yamaha',
      'Kawasaki',
    ]);
    pickByTyping('選擇廠牌', 'Yamaha');
    pickByTyping('選擇車型', 'YZF-R6');
    pickByTyping('選擇廠牌', 'Kawasaki');
    expect(combo('選擇車型').value).toBe('');
  });

  it('dict 模式未選齊 → 送出擋下顯欄位錯、不打 server', () => {
    const { onSubmit } = renderForm({ vehicleBrands: BRANDS });
    fireEvent.click(screen.getByText('儲存'));
    // R2(I2):逗號同批改全形 —— 用**整串字面**斷言,原本的 /請選擇廠牌與車型/ 正規式
    //   剛好不含逗號 ⇒ 改回半形照樣綠(這正是這條要擋的)。
    expect(screen.getByText('請選擇廠牌與車型，或改用自行輸入')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('「改用自行輸入」→ 自由文字照打照存(字典沒有的車不擋);可切回清單選車', async () => {
    const { onSubmit } = renderForm({ vehicleBrands: BRANDS });
    fireEvent.click(screen.getByText(/改用自行輸入/));
    const free = screen.getByPlaceholderText('YAMAHA YZF-R6') as HTMLInputElement;
    fireEvent.change(free, { target: { value: '我的紅色小車' } });
    fireEvent.click(screen.getByText('儲存'));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ name: '我的紅色小車' });
    expect(screen.getByText(/改用清單選車/)).toBeTruthy();
  });

  // Q8=A(Sean 2026-08-07):切到自行輸入時,VehicleCombo 現在會透過 onDraftTextChange 回報
  // 「打了字但沒選中」的草稿,本元件接得住了 —— 沒選齊也不再無聲消失(缺口②已收)。
  it('Q8=A:廠牌打了字沒選中 → 改用自行輸入 → 帶著那串字過去', () => {
    renderForm({ vehicleBrands: BRANDS });
    const brand = combo('選擇廠牌');
    fireEvent.change(brand, { target: { value: 'kawa' } });
    fireEvent.blur(brand);
    fireEvent.click(screen.getByText(/改用自行輸入/));
    expect((screen.getByPlaceholderText('YAMAHA YZF-R6') as HTMLInputElement).value).toBe('kawa');
  });

  it('Q8=A:廠牌選定 + 車型打了字沒選中 → 改用自行輸入 → 帶入「廠牌 那串字」', () => {
    renderForm({ vehicleBrands: BRANDS });
    pickByTyping('選擇廠牌', 'Yamaha');
    const model = combo('選擇車型');
    fireEvent.change(model, { target: { value: 'zzz' } });
    fireEvent.blur(model);
    fireEvent.click(screen.getByText(/改用自行輸入/));
    expect((screen.getByPlaceholderText('YAMAHA YZF-R6') as HTMLInputElement).value).toBe(
      'Yamaha zzz',
    );
  });

  // 🔴 債③(2026-08-07):上一條測的是「車型欄還在啟用狀態」的殘字。這條測的是它的姊妹情境——
  //    車型欄的殘字**先留著、再把廠牌清空讓車型欄變 disabled**,殘字仍不得被組進車名。
  it('🔴 債③ 下游:停用欄位上的殘字不得被組進車名', () => {
    renderForm({ vehicleBrands: BRANDS });
    pickByTyping('選擇廠牌', 'Yamaha');
    const model = combo('選擇車型');
    fireEvent.change(model, { target: { value: 'zzz' } });
    fireEvent.blur(model);
    const brand = combo('選擇廠牌');
    fireEvent.change(brand, { target: { value: '' } });
    fireEvent.blur(brand);
    fireEvent.click(screen.getByText(/改用自行輸入/));
    expect(
      (screen.getByPlaceholderText('YAMAHA YZF-R6') as HTMLInputElement).value,
      "修好前這裡會是 'zzz' —— 一個灰掉的停用欄位上的殘字被存成客人的車名",
    ).toBe('');
  });

  it('兩欄都選齊 → 改用自行輸入帶入組合字面(仍走 vehicleLabel 格式)', () => {
    renderForm({ vehicleBrands: BRANDS });
    pickByTyping('選擇廠牌', 'Yamaha');
    pickByTyping('選擇車型', 'YZF-R6');
    fireEvent.click(screen.getByText(/改用自行輸入/));
    expect((screen.getByPlaceholderText('YAMAHA YZF-R6') as HTMLInputElement).value).toBe(
      'Yamaha YZF-R6',
    );
  });

  it('R2 回歸:自由輸入打好字 → 切回清單只選廠牌(未選齊)→ 再切回自行輸入 → 不得蓋掉原字', () => {
    renderForm({ vehicleBrands: BRANDS });
    fireEvent.click(screen.getByText(/改用自行輸入/));
    fireEvent.change(screen.getByPlaceholderText('YAMAHA YZF-R6'), {
      target: { value: '我的小雞' },
    });
    fireEvent.click(screen.getByText(/改用清單選車/));
    pickByTyping('選擇廠牌', 'Yamaha');
    fireEvent.click(screen.getByText(/改用自行輸入/));
    expect(
      (screen.getByPlaceholderText('YAMAHA YZF-R6') as HTMLInputElement).value,
      '未選齊時不得用部分選取蓋掉客人已打好的車名(R2 回歸)',
    ).toBe('我的小雞');
  });

  // 🔴 這兩條原本是 R3 對抗審查(2026-08-07)釘的「現況、非規格」樁,已於同日**轉正**:
  //    Sean 2026-08-07 傍晚拍 **Q10=A(維持現況)**⇒ 下面兩條描述的行為**就是規格**,不再是待決的現況。
  //    ⚠️ Q10=A **不等於**同根因的債③④⑤⑥消失 —— 那四條是「靜默丟/殘留」問題、與這裡的
  //    「誰蓋誰」覆蓋規則正交,補片照舊(6 掛載面全掃)。
  it('規格(Sean 08-07 拍 Q10=A):編輯態 name 恆非空 → 不吃清單那邊的草稿,廠牌打字未選中切自行輸入保留原車名', () => {
    renderForm({ vehicleBrands: BRANDS, veh: { id: 'v1', name: '我的檔車' } });
    expect((screen.getByPlaceholderText('YAMAHA YZF-R6') as HTMLInputElement).value).toBe(
      '我的檔車',
    );
    fireEvent.click(screen.getByText(/改用清單選車/));
    const brand = combo('選擇廠牌');
    fireEvent.change(brand, { target: { value: 'kawa' } });
    fireEvent.blur(brand);
    fireEvent.click(screen.getByText(/改用自行輸入/));
    expect(
      (screen.getByPlaceholderText('YAMAHA YZF-R6') as HTMLInputElement).value,
      "規格(Q10=A):veh.name 非空(每條編輯路徑)⇒ name.trim()==='' 守門恆假,清單那邊的草稿刻意不帶入;絕不覆蓋客人已打好的車名",
    ).toBe('我的檔車');
  });

  it('規格(Q10=A):選齊時 branch① 對編輯態 name 仍無條件覆蓋 —— 與上一條構成刻意保留的不對稱(V-1d 設計)', () => {
    renderForm({ vehicleBrands: BRANDS, veh: { id: 'v1', name: '我的檔車' } });
    fireEvent.click(screen.getByText(/改用清單選車/));
    pickByTyping('選擇廠牌', 'Yamaha');
    pickByTyping('選擇車型', 'YZF-R6');
    fireEvent.click(screen.getByText(/改用自行輸入/));
    expect(
      (screen.getByPlaceholderText('YAMAHA YZF-R6') as HTMLInputElement).value,
      '規格(Q10=A):branch① 的覆蓋是 V-1d「客人可改顯示名」的刻意設計,與 branch③ 不覆蓋構成 Sean 已拍板保留的不對稱',
    ).toBe('Yamaha YZF-R6');
  });

  it('V-1d:dict 模式送出=帶名稱字面對;free 模式送出=雙 null(REQUIRED-1 覆蓋殘留)', async () => {
    const { onSubmit } = renderForm({ vehicleBrands: BRANDS });
    pickByTyping('選擇廠牌', 'Yamaha');
    pickByTyping('選擇車型', 'YZF-R6');
    fireEvent.click(screen.getByText('儲存'));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      dictBrandName: 'Yamaha',
      dictModelName: 'YZF-R6',
    });
  });

  it('V-1d REQUIRED-1:dict 車編輯 → 切自行輸入改名 → 存 → dict 對雙 null(舊對不殘留)', async () => {
    const { onSubmit } = renderForm({
      vehicleBrands: BRANDS,
      veh: { id: 'v1', name: 'Yamaha YZF-R1', dictBrandName: 'Yamaha', dictModelName: 'YZF-R1' },
    });
    expect(combo('選擇廠牌').value).toBe('Yamaha'); // dict 欄優先回填
    fireEvent.click(screen.getByText(/改用自行輸入/));
    fireEvent.change(screen.getByPlaceholderText('YAMAHA YZF-R6'), {
      target: { value: '我的改裝 R1' },
    });
    fireEvent.click(screen.getByText('儲存'));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      name: '我的改裝 R1',
      dictBrandName: null,
      dictModelName: null,
    });
  });

  it('NIT-1:自由輸入=字典字面 → 切回清單選車時回填雙下拉(所見=所送)', () => {
    renderForm({ vehicleBrands: BRANDS });
    fireEvent.click(screen.getByText(/改用自行輸入/));
    fireEvent.change(screen.getByPlaceholderText('YAMAHA YZF-R6'), {
      target: { value: 'Kawasaki Z900' },
    });
    fireEvent.click(screen.getByText(/改用清單選車/));
    expect(combo('選擇廠牌').value).toBe('Kawasaki');
    expect(combo('選擇車型').value).toBe('Z900');
  });

  it('編輯模式:name=字典標準字面 → dict 回填雙下拉;自由文字 → 進自行輸入模式', () => {
    renderForm({ vehicleBrands: BRANDS, veh: { id: 'v1', name: 'Yamaha YZF-R1' } });
    expect(combo('選擇廠牌').value).toBe('Yamaha');
    expect(combo('選擇車型').value).toBe('YZF-R1');
    cleanup();
    renderForm({ vehicleBrands: BRANDS, veh: { id: 'v2', name: '我的紅色小車' } });
    expect((screen.getByPlaceholderText('YAMAHA YZF-R6') as HTMLInputElement).value).toBe(
      '我的紅色小車',
    );
  });

  it('缺字典(vehicleBrands 缺省)→ 退回純自由輸入、無切換鈕(行為同舊版)', () => {
    renderForm();
    expect(screen.getByPlaceholderText('YAMAHA YZF-R6')).toBeTruthy();
    expect(screen.queryByText(/改用清單選車/)).toBeNull();
    expect(screen.queryByRole('combobox', { name: '選擇廠牌' })).toBeNull();
  });
});

// 🔴 2026-08-08(P-205-STOP ③「新增後不刷新」,兩處同形狀復現):成功後的收尾**交給父層**。
//    舊寫法 `router.refresh(); onClose();` 兩行都在本元件自己的 transition 裡,而 onClose 會讓
//    父層把本元件 unmount = 發出重讀指令的元件把自己拆掉。對照組:同頁「刪除」的 transition
//    掛在父層、元件續存,那條一直正常。
//    ⚠️ 本檔原本**完全沒有**收尾行為的斷言 ⇒ 只改 AddressForm 那半的話,這一半的突變殺不死。
// 突變:把 `onSaved()` 換回 `router.refresh(); onClose();` ⇒ 只紅這族
describe('存檔成功的收尾交給父層', () => {
  it('🔴 ok=true → 只呼叫 onSaved();本元件不得自己 close', async () => {
    const { onSaved, onClose } = renderForm({ vehicleBrands: BRANDS });
    pickByTyping('選擇廠牌', 'Yamaha');
    pickByTyping('選擇車型', 'YZF-R6');
    fireEvent.click(screen.getByText('儲存'));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ── #378:錯誤訊息隨輸入清除(2026-08-08 全站掃測 B 級;auth 四張已修、本張是剩下三張的第一張)──
//
// 三條判準沿用 auth 片(`LoginPage.tsx` 的 `clearErr` 註解):
// ① 動哪一欄清哪一欄 ② 頂部 formError 一律清 ③ checkbox 接不接看它有沒有自己的 fieldError。
//
// 🔴 本元件的特殊之處:`VehicleFieldErrors` **只有 `name` 一個鍵**
//    (`app/account/vehicle/actions.ts:24-26`),但「車型」這一欄有 **7 個入口**可以被動到:
//    自行輸入框 / 廠牌 onPick / 廠牌 onClear / 車型 onPick / 車型 onClear / 兩顆模式切換鈕。
//    ⇒ 每個入口各一格,**不是一格代表全部** —— 少掛一個入口的突變只會紅它自己那一格。
//
// 🔴 為什麼「清 fieldErrors」與「清 formError」要分格驗:兩者的前置**互斥**。
//    `submit` 的三條分支互相排斥(`result.fieldErrors` 那條清 formError、`result.formError` 那條清
//    fieldErrors、client 端組字 guard 也 `setFormError(null)`)⇒ 畫面上**不可能同時**有逐欄錯與頂部錯。
//    (與 LoginPage 拆兩格是同一個理由,不是湊格數。)
describe('#378 錯誤隨輸入清除', () => {
  /** dict 模式未選齊直接送出 ⇒ client 端組字 guard 顯逐欄錯(不打 server)。 */
  function showFieldErr() {
    const utils = renderForm({ vehicleBrands: BRANDS });
    fireEvent.click(screen.getByText('儲存'));
    expect(screen.getByText('請選擇廠牌與車型，或改用自行輸入')).toBeTruthy();
    return utils;
  }

  /** 選齊 → 送出 → server 回帳號層級錯 ⇒ 頂部通道有字。 */
  async function showFormErr() {
    const utils = renderForm({ vehicleBrands: BRANDS });
    utils.onSubmit.mockResolvedValue({ formError: '請重新登入' });
    pickByTyping('選擇廠牌', 'Yamaha');
    pickByTyping('選擇車型', 'YZF-R6');
    fireEvent.click(screen.getByText('儲存'));
    expect(await screen.findByText('請重新登入')).toBeTruthy();
    return utils;
  }

  it('自行輸入框:打字 → 清掉車型欄的錯', async () => {
    const { onSubmit } = renderForm({ vehicleBrands: BRANDS });
    // 🔴 錨點用「清單裡找不到你的車」而非 /改用自行輸入/ —— 後者同時命中錯誤字面
    //    「請選擇廠牌與車型，或改用自行輸入」,錯誤在場時 getByText 會 multiple match 直接炸。
    //    (本檔既有那幾格用寬 regex 沒事,只因為那時畫面上沒有錯。)
    fireEvent.click(screen.getByText(/清單裡找不到你的車/));
    const free = screen.getByPlaceholderText('YAMAHA YZF-R6') as HTMLInputElement;
    fireEvent.change(free, { target: { value: 'x' } });
    onSubmit.mockResolvedValue({ fieldErrors: { name: '請填寫車型' } });
    fireEvent.click(screen.getByText('儲存'));
    expect(await screen.findByText('請填寫車型')).toBeTruthy();

    fireEvent.change(free, { target: { value: 'xy' } });

    expect(screen.queryByText('請填寫車型')).toBeNull();
  });

  it('廠牌下拉 onPick:選了廠牌 → 清掉車型欄的錯', () => {
    showFieldErr();
    pickByTyping('選擇廠牌', 'Yamaha');
    expect(screen.queryByText('請選擇廠牌與車型，或改用自行輸入')).toBeNull();
  });

  it('車型下拉 onPick:選了車型 → 清掉車型欄的錯', () => {
    showFieldErr();
    pickByTyping('選擇廠牌', 'Yamaha');
    // 上一步已經清過一次 ⇒ 先讓錯**重新出現**,否則這一格是在驗上一格的行為(恆綠、零判別力)。
    fireEvent.click(screen.getByText('儲存'));
    expect(screen.getByText('請選擇廠牌與車型，或改用自行輸入')).toBeTruthy();

    pickByTyping('選擇車型', 'YZF-R6');

    expect(screen.queryByText('請選擇廠牌與車型，或改用自行輸入')).toBeNull();
  });

  it('廠牌下拉 onClear:清空已選廠牌 → 也清掉錯(清空是編輯動作,同 auth 把 Email 清空)', () => {
    const { onSubmit } = renderForm({ vehicleBrands: BRANDS });
    pickByTyping('選擇廠牌', 'Yamaha');
    fireEvent.click(screen.getByText('儲存')); // 只選了廠牌 ⇒ 未選齊 ⇒ 顯錯
    expect(screen.getByText('請選擇廠牌與車型，或改用自行輸入')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();

    const brand = combo('選擇廠牌');
    fireEvent.change(brand, { target: { value: '' } });
    fireEvent.blur(brand);

    expect(screen.queryByText('請選擇廠牌與車型，或改用自行輸入')).toBeNull();
  });

  // 🔴 這一格的錯**必須來自 server**,不能用 client 組字 guard 那條:
  //    guard 的錯只在「未選齊」時存在,而 `onClear` 的前提是那一欄**有值**。
  //    車型有值 ⇒ 廠牌一定也有值(廠牌 onPick/onClear 都會把車型清成 null,且車型欄
  //    `disabled={brandName === null}`)⇒ 「車型有值 + guard 錯在場」構造不出來。
  //    ⚠️ 第一版我就是這樣寫的,實跑紅了才發現這個不可能組合 —— 不是 flaky,是前提矛盾。
  it('車型下拉 onClear:清空已選車型 → 也清掉錯(錯來自 server,理由見上)', async () => {
    const { onSubmit } = renderForm({ vehicleBrands: BRANDS });
    onSubmit.mockResolvedValue({ fieldErrors: { name: '這台車已經在你的清單裡了' } });
    pickByTyping('選擇廠牌', 'Yamaha');
    pickByTyping('選擇車型', 'YZF-R6');
    fireEvent.click(screen.getByText('儲存'));
    expect(await screen.findByText('這台車已經在你的清單裡了')).toBeTruthy();

    const model = combo('選擇車型');
    fireEvent.change(model, { target: { value: '' } });
    fireEvent.blur(model);

    expect(screen.queryByText('這台車已經在你的清單裡了')).toBeNull();
  });

  it('「改用自行輸入」切換鈕 → 清掉錯(切換也是動車型欄)', () => {
    showFieldErr();
    fireEvent.click(screen.getByText(/清單裡找不到你的車/));
    expect(screen.queryByText('請選擇廠牌與車型，或改用自行輸入')).toBeNull();
  });

  it('「改用清單選車」切換鈕 → 清掉錯', async () => {
    const { onSubmit } = renderForm({ vehicleBrands: BRANDS });
    // 🔴 錨點用「清單裡找不到你的車」而非 /改用自行輸入/ —— 後者同時命中錯誤字面
    //    「請選擇廠牌與車型，或改用自行輸入」,錯誤在場時 getByText 會 multiple match 直接炸。
    //    (本檔既有那幾格用寬 regex 沒事,只因為那時畫面上沒有錯。)
    fireEvent.click(screen.getByText(/清單裡找不到你的車/));
    const free = screen.getByPlaceholderText('YAMAHA YZF-R6') as HTMLInputElement;
    fireEvent.change(free, { target: { value: 'x' } });
    onSubmit.mockResolvedValue({ fieldErrors: { name: '請填寫車型' } });
    fireEvent.click(screen.getByText('儲存'));
    expect(await screen.findByText('請填寫車型')).toBeTruthy();

    fireEvent.click(screen.getByText(/改用清單選車/));

    expect(screen.queryByText('請填寫車型')).toBeNull();
  });

  it('🔴 頂部帳號層級錯(請重新登入)也隨動車型欄清掉', async () => {
    await showFormErr();
    pickByTyping('選擇廠牌', 'Kawasaki');
    expect(screen.queryByText('請重新登入')).toBeNull();
  });

  // ── 對照組:沒有自己 fieldError 的欄位**不得**接清除(判準③)──────────────
  it('改年份不清車型欄的錯 —— 年份沒有自己的錯,改它不代表在修車型', () => {
    showFieldErr();
    fireEvent.change(screen.getByPlaceholderText('2022'), { target: { value: '2016' } });
    expect(screen.getByText('請選擇廠牌與車型，或改用自行輸入')).toBeTruthy();
  });

  it('勾「設為主要車輛」不清車型欄的錯(對照組=LoginPage 的「記住我」)', () => {
    showFieldErr();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByText('請選擇廠牌與車型，或改用自行輸入')).toBeTruthy();
  });

  it('改年份也不清頂部 formError(前置與上面兩格互斥,所以拆格)', async () => {
    await showFormErr();
    fireEvent.change(screen.getByPlaceholderText('2022'), { target: { value: '2016' } });
    expect(screen.getByText('請重新登入')).toBeTruthy();
  });
});
