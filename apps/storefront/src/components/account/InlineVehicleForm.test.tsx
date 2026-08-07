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
  const utils = render(
    <InlineVehicleForm
      veh={props.veh ?? {}}
      onClose={vi.fn()}
      onSubmit={onSubmit}
      vehicleBrands={props.vehicleBrands}
    />,
  );
  return { onSubmit, ...utils };
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

  // R3 對抗審查(2026-08-07)釘現況、非規格:要改語意先問 Sean —— 主對話會另外拿去問。
  it('現況釘樁(非規格,要改先問 Sean):編輯態 name 恆非空 → 缺口②刻意未收,廠牌打字未選中切自行輸入不吃草稿', () => {
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
      "現況釘樁,非規格:veh.name 非空(每條編輯路徑)⇒ name.trim()===''守門恆假,缺口②等於沒收;要改語意先問 Sean",
    ).toBe('我的檔車');
  });

  it('已申報的不對稱(非規格,要改先問 Sean):選齊時 branch① 對編輯態 name 仍無條件覆蓋(HEAD 既有行為/V-1d 設計)', () => {
    renderForm({ vehicleBrands: BRANDS, veh: { id: 'v1', name: '我的檔車' } });
    fireEvent.click(screen.getByText(/改用清單選車/));
    pickByTyping('選擇廠牌', 'Yamaha');
    pickByTyping('選擇車型', 'YZF-R6');
    fireEvent.click(screen.getByText(/改用自行輸入/));
    expect(
      (screen.getByPlaceholderText('YAMAHA YZF-R6') as HTMLInputElement).value,
      '現況釘樁,非規格:branch①的覆蓋是 HEAD 既有行為/V-1d 刻意設計,與 branch③不覆蓋構成已申報的不對稱;要改語意先問 Sean',
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
