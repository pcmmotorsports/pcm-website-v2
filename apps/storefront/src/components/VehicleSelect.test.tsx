// @vitest-environment jsdom
// VehicleSelect smoke — V-1b 可打字三層 combobox(prefix 過濾/鍵盤選/blur 唯一精確命中/清空連動)。

import { useReducer, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  cascadeFilterReducer,
  makeInitialCascadeState,
  selectVehicleBrand,
  selectVehicleModel,
  selectVehicleYear,
  clearVehicle,
} from '@pcm/ui';
import { VehicleCombo, VehicleSelect } from './VehicleSelect';
import type { MockMotoBrand } from '@/data/mock-moto-brands';

const BRANDS: MockMotoBrand[] = [
  {
    id: 'yamaha',
    name: 'Yamaha',
    models: [
      { id: 'r6', name: 'R6', years: [2016, 2017] },
      { id: 'mt-09-sp', name: 'MT-09 SP', years: [2021, 2022] },
    ],
  },
  {
    id: 'kawasaki',
    name: 'Kawasaki',
    models: [
      { id: 'z900', name: 'Z900', years: [] },
      // 跨廠牌撞名(R1 nit):Yamaha 與 Kawasaki 都有 R6,消歧正是跨層搜尋存在的理由——
      // 少了這一維,反查廠牌的邏輯錯拿到「隨便一家有 R6 的廠牌」測試也會綠。
      { id: 'kawa-r6', name: 'R6', years: [2019] },
    ],
  },
] as MockMotoBrand[];

function Harness() {
  const [cascade, dispatch] = useReducer(cascadeFilterReducer, undefined, makeInitialCascadeState);
  const vehicle = cascade.vehicle;
  return (
    <VehicleSelect
      motoBrands={BRANDS}
      vehicle={vehicle}
      onPickBrand={(n) => dispatch(selectVehicleBrand(n))}
      onPickModel={(p) => {
        // 跨層選取(未選廠牌直接打車型)時 reducer 的 select-model 是 no-op,先立廠牌再立車型
        // (與 CascadeFilterTop.pickModel 同型)。
        if (p.brand !== vehicle?.brand) dispatch(selectVehicleBrand(p.brand));
        dispatch(selectVehicleModel(p.model));
      }}
      onPickYear={(y) => dispatch(selectVehicleYear(y))}
      onClearBrand={() => dispatch(clearVehicle())}
      onClearModel={() => vehicle && dispatch(selectVehicleBrand(vehicle.brand))}
      onClearYear={() => vehicle?.model != null && dispatch(selectVehicleModel(vehicle.model))}
    />
  );
}

afterEach(cleanup);

function combo(label: string) {
  return screen.getByRole('combobox', { name: label }) as HTMLInputElement;
}

describe('VehicleSelect', () => {
  // A3(選車引擎統一 B′)字面守門:aria label 與 placeholder 逐字鎖 OD `vehicle-picker-design.html`
  // A 表定版。這支測試是本次「廠牌 / 選擇或輸入 X」統一唯一的直接證據 —— 少了它,字面被改回去全綠。
  it('A 表字面:aria=選擇廠牌/車型/年份、placeholder=選擇或輸入 X', () => {
    render(<Harness />);
    expect(combo('選擇廠牌').placeholder).toBe('選擇或輸入廠牌');
    // Sean 2026-08-06 拍板 B:車型欄改成與 CascadeFilterTop 一致 —— 未選廠牌(crossLayer=true,
    // 本測試在斷言前未做任何互動)時附例字。本條釘的是**新**字面,擋的是「有人改回舊字面」。
    expect(combo('選擇車型').placeholder).toBe('選擇或輸入車型，例:R6');
    expect(combo('選擇年份').placeholder).toBe('選擇或輸入年份');
    // 「品牌」保留給零件品牌,選車三欄不得再出現
    expect(screen.queryByRole('combobox', { name: '選擇品牌' })).toBeNull();
  });

  // MF6(R1):CascadeFilterTop 的 crossLayer=false 分支有測試釘住(CascadeFilterTop.test.tsx:207),
  // 本檔原本沒有對應的 —— VehicleSelect.tsx 那個 placeholder 三元式的 false 分支改成任意字串仍全綠,
  // (原註解寫死行號 :276,早已因後續片位移;行號會過期、grep `crossLayer ? '選擇或輸入車型` 才找得到)
  // 淨損一格覆蓋(原本釘該字面的那條被改去釘新字面時一併移走了)。
  it('已選廠牌後(crossLayer=false),車型欄 placeholder 落回無例字版', () => {
    render(<Harness />);
    const brand = combo('選擇廠牌');
    fireEvent.change(brand, { target: { value: 'yamaha' } });
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Yamaha' }));
    expect(combo('選擇車型').placeholder).toBe('選擇或輸入車型');
  });

  it('打字 prefix 過濾+點選=選定;下層解鎖', () => {
    render(<Harness />);
    const brand = combo('選擇廠牌');
    // A5:車型欄不再鎖廠牌(本片主體),未選廠牌時改跨層可搜尋——見下方新 describe。
    // 「下層解鎖」的判別力因此改交給年份欄:未選車型前年份欄恆鎖(disabled===true、
    // 與是否已選廠牌無關),留住原本那半的證據(年份欄真正的解鎖斷言見 :95 起選定車型後)。
    expect(combo('選擇年份').disabled).toBe(true);
    fireEvent.change(brand, { target: { value: 'ya' } });
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Yamaha' }));
    expect(brand.value).toBe('Yamaha');
    expect(combo('選擇車型').disabled).toBe(false);
  });

  // 🔴 **2026-08-07 Sean 拍板 Q4=B,本條守的不變量跟著換。**
  //    舊版守的是「非唯一 → **還原不猜**」——`value` 不動 **而且**把使用者打的字清掉。
  //    Sean 回報那是「打了字、滑開就無聲消失」⇒ 新的不變量是
  //    「**不套用,但也不丟字**」:零猜的部分一字未改(仍不 `onPick`、`value` 不動),
  //    改的只是草稿留在欄位裡。⇒ 這條分成兩半各自釘,別再混成一句。
  it('blur 唯一精確命中自動套用(全形/大小寫正規化)', () => {
    render(<Harness />);
    const brand = combo('選擇廠牌');
    fireEvent.change(brand, { target: { value: 'ＹＡＭＡＨＡ' } });
    fireEvent.blur(brand);
    expect(brand.value).toBe('Yamaha');
  });

  it('🔴 blur 非唯一命中 → 不套用(零猜)**但保留使用者打的字**(Q4=B;舊行為是清空)', () => {
    render(<Harness />);
    const brand = combo('選擇廠牌');
    fireEvent.change(brand, { target: { value: 'yamaha' } });
    fireEvent.blur(brand);
    const model = combo('選擇車型');
    fireEvent.change(model, { target: { value: 'r' } }); // R6 與 MT-09 SP 皆非精確 → 不套用
    fireEvent.blur(model);
    // ①不丟字(這是 Q4=B 改的那一半)
    expect(model.value, '打的字被清掉了 ⇒ 客人不知道自己輸入過什麼、也不知道還沒選到').toBe('r');
    // ②仍然零猜:年份欄的啟用與否綁在「車型有沒有真的被選定」上 ⇒ 沒選定就仍是 disabled。
    //   這條是「不丟字」與「不套用」的分界線 —— 少了它,哪天有人把不丟字做成「順便套用」也全綠。
    expect(combo('選擇年份').disabled, '車型沒被套用,年份欄卻開了 ⇒ 零猜鐵律被破').toBe(true);
  });

  // 🔴 Sean 2026-08-07 拍板 Q7=A:Q4=B 的「不丟字」**只適用還沒選到東西的欄位**。
  //    欄位已經選定了車 → blur 仍然照舊還原成已選那台(畫面=事實)。少了這條,
  //    畫面會顯示草稿、而年份欄與 PDP 適用判定仍走舊的 `value` = 畫面說一套系統算另一套。
  it('🔴 Q7=A:已選定的欄位 blur 非唯一 → 還原成已選那台(不留字)', () => {
    render(<Harness />);
    const brand = combo('選擇廠牌');
    fireEvent.change(brand, { target: { value: 'Yamaha' } });
    fireEvent.blur(brand);
    expect(brand.value, '前提:廠牌已真的選定').toBe('Yamaha');
    // 已選定的欄位再打一段非唯一的字
    fireEvent.change(brand, { target: { value: 'kawa' } });
    fireEvent.blur(brand);
    expect(brand.value, '已選定的欄位被草稿遮住 ⇒ 畫面與實際選定不一致').toBe('Yamaha');
    // 零猜同時仍成立:沒有偷偷把 Kawasaki 套上去。
    // ⚠️ 審查 F3:原本這裡量的是 `combo('選擇車型').disabled` —— 車型欄**從不傳 `disabled`**
    //    (跨層設計使然)⇒ 那個值恆為 false、對「廠牌有沒有被誤套用」零判別力。
    //    改量車型清單的內容:清單還是 Yamaha 的,才證明廠牌真的沒被換掉。
    fireEvent.focus(combo('選擇車型'));
    expect(screen.getByRole('option', { name: 'MT-09 SP' }), '車型清單不是 Yamaha 的').toBeDefined();
    expect(
      screen.queryByRole('option', { name: 'Z900' }),
      '車型清單跑出 Kawasaki 的車 ⇒ 廠牌被草稿誤套用了',
    ).toBeNull();
  });

  // 🔴 Sean 2026-08-07 拍板 Q6=A:留字之後點回欄位、零命中要有出路。
  //    `CascadeFilterTop` 與 `MobileVehicleSheet` 三欄本來就都傳 emptyHint,只有本元件沒跟上。
  //    ⚠️ 這條逐欄各驗一次 —— 只驗一欄的話,另外兩欄漏傳照樣全綠(補洞別數總數)。
  it('🔴 Q6=A:廠牌/車型/年份三欄零命中都給出路提示(逐欄各驗一次)', () => {
    render(<Harness />);
    const brand = combo('選擇廠牌');
    fireEvent.focus(brand);
    fireEvent.change(brand, { target: { value: 'zzzz' } });
    expect(screen.getByRole('status').textContent, '廠牌欄零命中無提示').toBe(
      '查無符合的廠牌，請調整關鍵字',
    );
    // 選定 Yamaha + MT-09 SP 讓年份欄開啟,並讓車型欄脫離跨層態
    fireEvent.change(brand, { target: { value: 'Yamaha' } });
    fireEvent.blur(brand);
    const model = combo('選擇車型');
    fireEvent.focus(model);
    fireEvent.change(model, { target: { value: 'zzzz' } });
    expect(screen.getByRole('status').textContent, '車型欄(非跨層)零命中無提示').toBe(
      '查無符合的車型，請調整關鍵字',
    );
    fireEvent.change(model, { target: { value: 'MT-09 SP' } });
    fireEvent.blur(model);
    const year = combo('選擇年份');
    expect(year.disabled, '前提:年份欄要真的開著,否則 showEmptyHint 被 disabled 短路=恆真').toBe(false);
    fireEvent.focus(year);
    fireEvent.change(year, { target: { value: '1999' } });
    expect(screen.getByRole('status').textContent, '年份欄零命中無提示').toBe(
      '查無符合的年份，請調整關鍵字',
    );
  });

  // 🔴 跨層殘留=**刻意保留**,不是漏做(D-273-STOP ⑦ item 5 的判斷,寫成守門免得日後被當 bug「修掉」)。
  //    情境:還沒選廠牌時直接在車型欄打字 → blur 留字 → 再去選廠牌。
  //    留著才是對的:客人打的「Z900」在選了 Kawasaki 之後**正好對得上**,清掉等於製造 Sean
  //    這次要消滅的那個「無聲消失」。而 Q7=A 不觸發,因為車型欄根本還沒選定任何值(沒有東西可還原)。
  //    出路由 Q6=A 的零命中提示提供,不會變成死路。
  it('🔴 跨層草稿在選定廠牌後刻意保留(不是漏做;清掉才會製造無聲消失)', () => {
    render(<Harness />);
    const model = combo('選擇車型');
    fireEvent.change(model, { target: { value: 'Z9' } }); // 跨層:尚未選廠牌
    fireEvent.blur(model);
    expect(model.value, '跨層草稿被清掉了').toBe('Z9');
    const brand = combo('選擇廠牌');
    fireEvent.change(brand, { target: { value: 'Kawasaki' } });
    fireEvent.blur(brand);
    expect(combo('選擇車型').value, '選了廠牌之後草稿被清掉 ⇒ 客人打的字無聲消失').toBe('Z9');
    // 且它現在對得上 Kawasaki 的 Z900 ⇒ 重新 focus 就能明選
    fireEvent.focus(combo('選擇車型'));
    expect(screen.getByRole('option', { name: 'Z900' }), 'Z9 應該篩得出 Z900').toBeDefined();
  });

  // 🔴 審查 F1 實錘(我把 Q7=A 的守門畫在 `commit()` 這個最窄的面,而不變量的面在別處)。
  //    `value` 會從**外部**變動、不經過 `commit()`:跨層在車型欄選一台別廠牌的車,
  //    `resolveModelPick` 會回填廠牌 ⇒ 廠牌欄的 `value` 被改掉、草稿卻還留著。
  //    修法=`value` 一變就丟草稿(畫在不變量面)。這條就是那個實測可達路徑。
  it('🔴 F1:廠牌草稿 + 跨層選別廠牌的車回填廠牌 → 草稿讓位給真值', () => {
    render(<Harness />);
    const brand = combo('選擇廠牌');
    fireEvent.change(brand, { target: { value: 'kawa' } }); // 非唯一、廠牌尚未選定 ⇒ Q4=B 留字
    fireEvent.blur(brand);
    expect(brand.value, '前提:Q4=B 的留字要成立,否則本條測不到東西').toBe('kawa');
    const model = combo('選擇車型');
    // 🔴 跨層的選項字面是「品牌 車型」label(`lib/vehicle-options.modelFieldOptions` 走
    //    `garage-chip.flattenVehicleModels`),**不是裸車型名**。第一版我打了裸 `Z900`
    //    ⇒ 沒有精確命中、`onPickModel` 根本沒被呼叫、廠牌從頭到尾是 null
    //    ⇒ 測試「紅」代表的是**前提沒成立**,不是抓到 bug。下面兩道前提斷言就是為了擋這個。
    fireEvent.change(model, { target: { value: 'Kawasaki Z900' } });
    fireEvent.blur(model);
    expect(combo('選擇車型').value, '前提①:跨層選車要真的選定,否則本條在測空氣').toBe('Z900');
    // 前提②:廠牌真的落進 cascade。⚠️ 不能用「年份欄開了」當前提 —— 本 fixture 的 Z900
    //    `years: []` ⇒ 年份欄恆 disabled(第一版我就踩了這個)。改量車型欄的 placeholder:
    //    它由 `crossLayer` 決定,而 `crossLayer` 只看 cascade 裡的廠牌、不看輸入框顯示什麼。
    expect(
      combo('選擇車型').placeholder,
      '前提②:車型欄還在跨層態 ⇒ 廠牌沒真的落進 cascade,本條在測空氣',
    ).toBe('選擇或輸入車型');
    expect(
      combo('選擇廠牌').value,
      '廠牌欄顯示 kawa、實際已選 Kawasaki ⇒ 畫面說一套系統算另一套',
    ).toBe('Kawasaki');
  });

  // 🔴 這條專門保住「唯一精確命中分支那個 `setText(null)`」的判別力。
  //    上面那道 `value` 變動就丟草稿的 effect,會順便提供「草稿被清掉」這個觀察 ⇒
  //    只要 `onPick` 有發生,拿掉分支內的 `setText(null)` 也照樣全綠(前一片實測過:全 357 檔皆綠)。
  //    唯一區分得出來的路徑=**打的字正規化後就等於已選值**:`exact === value` ⇒ 不 `onPick`、
  //    `value` 不變、effect 不跑,只有分支內那行能把欄位帶回字典字面。
  it('🔴 已選 Yamaha 再打全形ＹＡＭＡＨＡ → 回到字典字面(唯一命中分支自己的守門)', () => {
    render(<Harness />);
    const brand = combo('選擇廠牌');
    fireEvent.change(brand, { target: { value: 'Yamaha' } });
    fireEvent.blur(brand);
    expect(brand.value, '前提:已選定 Yamaha').toBe('Yamaha');
    fireEvent.change(brand, { target: { value: 'ＹＡＭＡＨＡ' } }); // 正規化後 === value ⇒ 不觸發 onPick
    fireEvent.blur(brand);
    expect(brand.value, '欄位停在全形草稿 ⇒ 唯一命中分支的 setText(null) 沒作用').toBe('Yamaha');
  });

  it('鍵盤 ArrowDown+Enter 選 highlight 項;年份選定', () => {
    render(<Harness />);
    const brand = combo('選擇廠牌');
    fireEvent.change(brand, { target: { value: 'yamaha' } });
    fireEvent.blur(brand);
    const model = combo('選擇車型');
    fireEvent.change(model, { target: { value: 'mt' } });
    fireEvent.keyDown(model, { key: 'Enter' });
    expect(model.value).toBe('MT-09 SP');
    const year = combo('選擇年份');
    fireEvent.focus(year);
    fireEvent.keyDown(year, { key: 'ArrowDown' });
    fireEvent.keyDown(year, { key: 'ArrowDown' });
    fireEvent.keyDown(year, { key: 'Enter' });
    expect(year.value).toBe('2022');
  });

  it('V-2h/nit-8:完整 combobox ARIA——開列表 aria-controls 指 listbox、方向鍵導航更新 aria-activedescendant', () => {
    render(<Harness />);
    const brand = combo('選擇廠牌');
    fireEvent.focus(brand);
    const listboxId = brand.getAttribute('aria-controls');
    expect(listboxId).toBeTruthy();
    expect(document.getElementById(listboxId!)?.getAttribute('role')).toBe('listbox');
    fireEvent.keyDown(brand, { key: 'ArrowDown' }); // hi 0→1(focus 起 hi=-1)
    const active = brand.getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
    expect(document.getElementById(active!)?.getAttribute('role')).toBe('option');
  });

  it('focus 未導航直接 Enter=不誤選首項;重選同值不 wipe 下層(R1 must-fix)', () => {
    render(<Harness />);
    const brand = combo('選擇廠牌');
    fireEvent.focus(brand);
    fireEvent.keyDown(brand, { key: 'Enter' }); // hi=-1 → commit(text null)=no-op
    expect(brand.value).toBe('');
    fireEvent.change(brand, { target: { value: 'yamaha' } });
    fireEvent.blur(brand);
    const model = combo('選擇車型');
    fireEvent.change(model, { target: { value: 'r6' } });
    fireEvent.blur(model);
    expect(model.value).toBe('R6');
    // 點開品牌欄再點已選同名 → 不 dispatch、model 不被 cascade reset 清掉
    fireEvent.focus(brand);
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Yamaha' }));
    expect(combo('選擇車型').value).toBe('R6');
  });

  it('清空 brand 欄 commit=全清;無年份車型 → 年份欄 disabled 顯「不限年份」', () => {
    render(<Harness />);
    const brand = combo('選擇廠牌');
    fireEvent.change(brand, { target: { value: 'kawasaki' } });
    fireEvent.blur(brand);
    const model = combo('選擇車型');
    fireEvent.change(model, { target: { value: 'z900' } });
    fireEvent.blur(model);
    const year = combo('選擇年份');
    expect(year.disabled).toBe(true);
    expect(year.placeholder).toBe('不限年份');
    fireEvent.change(brand, { target: { value: '' } });
    fireEvent.blur(brand);
    expect(brand.value).toBe('');
    // A5:disabled 恆 false、已無判別力(nit)——改守它真正要證的連動:
    // 清 brand = cascade 全清,車型欄的值也要跟著清空。
    expect(combo('選擇車型').value).toBe('');
  });

  it('V-2d④:點選選定後主動 blur 收鍵盤(rAF 後);鍵盤 Enter 選定不 blur=桌機流不變', async () => {
    render(<Harness />);
    const brand = combo('選擇廠牌');
    brand.focus();
    fireEvent.change(brand, { target: { value: 'ya' } });
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Yamaha' }));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(document.activeElement).not.toBe(brand); // 觸控/滑鼠選定 → focus 釋放=手機鍵盤收
    const model = combo('選擇車型');
    model.focus();
    fireEvent.change(model, { target: { value: 'r' } });
    fireEvent.keyDown(model, { key: 'ArrowDown' });
    fireEvent.keyDown(model, { key: 'Enter' });
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect((combo('選擇車型') as HTMLInputElement).value).toBe('R6');
    expect(document.activeElement).toBe(model); // Enter 路徑不 blur
  });
});

// A5(2026-08-06):未選廠牌時車型欄跨層搜尋(打車型直達車款),選定同時回填廠牌。
// 用獨立 spy harness(而非上面共用的 reducer Harness)才能直接斷言 onPickModel 收到的物件字面,
// 不繞經 reducer 往返觀察間接效果。
function SpyHarness({
  onPick,
  initial = null,
}: {
  onPick: (pick: { brand: string; model: string }) => void;
  initial?: { brand: string; model?: string; year?: number } | null;
}) {
  const [vehicle, setVehicle] = useState(initial);
  return (
    <VehicleSelect
      motoBrands={BRANDS}
      vehicle={vehicle}
      onPickBrand={(name) => setVehicle({ brand: name })}
      onPickModel={(p) => {
        onPick(p);
        setVehicle({ brand: p.brand, model: p.model });
      }}
      onPickYear={() => {}}
      onClearBrand={() => setVehicle(null)}
      onClearModel={() => setVehicle((v) => (v ? { brand: v.brand } : v))}
      onClearYear={() => {}}
    />
  );
}

describe('VehicleSelect 跨層車型(A5:未選廠牌可直接打車型)', () => {
  it('未選廠牌時,車型欄選項為跨廠牌攤平的「品牌 車型」label', () => {
    render(<SpyHarness onPick={() => {}} />);
    const model = combo('選擇車型');
    expect(model.disabled).toBe(false); // 本片主體:車型欄不再鎖廠牌
    fireEvent.focus(model);
    expect(screen.getByRole('option', { name: 'Yamaha R6' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Kawasaki Z900' })).toBeTruthy();
  });

  it('未選廠牌時直接選跨廠牌車型 ⇒ onPickModel 同時收到正確 brand 與 model', () => {
    const picks: { brand: string; model: string }[] = [];
    render(<SpyHarness onPick={(p) => picks.push(p)} />);
    const model = combo('選擇車型');
    fireEvent.focus(model);
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Kawasaki Z900' }));
    expect(picks).toEqual([{ brand: 'Kawasaki', model: 'Z900' }]);
  });

  it('已選廠牌時,車型欄選項退回該廠牌自己的車型,onPickModel 的 brand=已選廠牌', () => {
    const picks: { brand: string; model: string }[] = [];
    render(<SpyHarness onPick={(p) => picks.push(p)} initial={{ brand: 'Yamaha' }} />);
    const model = combo('選擇車型');
    fireEvent.focus(model);
    expect(screen.getByRole('option', { name: 'R6' })).toBeTruthy(); // 非跨層:裸車型名
    expect(screen.queryByRole('option', { name: 'Kawasaki Z900' })).toBeNull();
    fireEvent.mouseDown(screen.getByRole('option', { name: 'R6' }));
    expect(picks).toEqual([{ brand: 'Yamaha', model: 'R6' }]);
  });

  it('跨廠牌撞名(兩廠牌都有 R6)⇒ 選 Kawasaki R6 反查到正確廠牌,不誤配到 Yamaha', () => {
    const picks: { brand: string; model: string }[] = [];
    render(<SpyHarness onPick={(p) => picks.push(p)} />);
    const model = combo('選擇車型');
    fireEvent.focus(model);
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Kawasaki R6' }));
    expect(picks).toEqual([{ brand: 'Kawasaki', model: 'R6' }]);
  });
});

// Q8=A(Sean 2026-08-07):`onDraftTextChange` 是把 `Combo` 內部 text state 回報給外層的
// 唯一出口(MobileVehicleSheet 的「清除」鈕、InlineVehicleForm 的「改用自行輸入」都靠它接住
// 客人打了但沒選中的字)。直接用 VehicleCombo(不透過 VehicleSelect)—— VehicleSelect 那三顆
// Combo 刻意不傳這個新 prop、零改動。
describe('VehicleCombo — onDraftTextChange(Q8=A)', () => {
  const OPTIONS = ['Yamaha', 'Kawasaki'];

  function DraftProbe({
    value,
    onDraftTextChange,
  }: {
    value: string | null;
    onDraftTextChange: (text: string) => void;
  }) {
    return (
      <VehicleCombo
        label="測試欄位"
        value={value}
        options={OPTIONS}
        placeholder="輸入"
        onPick={() => {}}
        onClear={() => {}}
        variant="form"
        onDraftTextChange={onDraftTextChange}
      />
    );
  }

  it('打字 → 收到那串字', () => {
    const onDraftTextChange = vi.fn();
    render(<DraftProbe value={null} onDraftTextChange={onDraftTextChange} />);
    fireEvent.change(combo('測試欄位'), { target: { value: 'kawa' } });
    expect(onDraftTextChange).toHaveBeenLastCalledWith('kawa');
  });

  it('點選選項 → 收到空字串(草稿被吃掉、回到已選值)', () => {
    const onDraftTextChange = vi.fn();
    render(<DraftProbe value={null} onDraftTextChange={onDraftTextChange} />);
    fireEvent.change(combo('測試欄位'), { target: { value: 'ya' } });
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Yamaha' }));
    expect(onDraftTextChange).toHaveBeenLastCalledWith('');
  });

  it('value 從外部變動(rerender 換 prop)→ 收到空字串', () => {
    const onDraftTextChange = vi.fn();
    const { rerender } = render(<DraftProbe value={null} onDraftTextChange={onDraftTextChange} />);
    fireEvent.change(combo('測試欄位'), { target: { value: 'kawa' } });
    expect(onDraftTextChange).toHaveBeenLastCalledWith('kawa');
    onDraftTextChange.mockClear();
    // 外部把 value 從 null 換成 Yamaha(不是本欄自己 commit 出來的)——`useEffect(..., [value])`
    // 那道守門要接手把過期草稿丟掉,而不是只靠 commit() 的路徑。
    rerender(<DraftProbe value="Yamaha" onDraftTextChange={onDraftTextChange} />);
    expect(onDraftTextChange).toHaveBeenLastCalledWith('');
  });

  it('blur 後非唯一命中且該欄未選定(Q4=B 留字)→ 最後收到的仍是那串字、不是空字串', () => {
    const onDraftTextChange = vi.fn();
    render(<DraftProbe value={null} onDraftTextChange={onDraftTextChange} />);
    const input = combo('測試欄位');
    // `ka` 只是 Kawasaki 的**子字串**;`uniqueExactMatch`(vehicle-match.ts:36-45)要的是
    // 正規化後**完全相等** ⇒ 對不上任何選項 = 非唯一精確命中 ⇒ 走 Q4=B 留字那條。
    fireEvent.change(input, { target: { value: 'ka' } });
    fireEvent.blur(input);
    expect(onDraftTextChange).toHaveBeenLastCalledWith('ka');
  });
});

// 債③(2026-08-07,Sean Q8=A 那族的第 3 條):`disabled` 轉 true 沒有丟草稿的守門(VehicleSelect.tsx:130-137
// 那道 effect 只看 `value`、看不到 `disabled`)。車庫表單選了廠牌 → 車型欄打字沒選中 → 把廠牌欄清空
// ⇒ 車型欄變 disabled 卻仍顯示那串字、父層的草稿也還握著它。
describe('債③ 停用欄位不得殘留草稿字', () => {
  function DisabledDebtHarness({ onDraft }: { onDraft: (s: string) => void }) {
    const [brandName, setBrandName] = useState<string | null>(null);
    const [modelName, setModelName] = useState<string | null>(null);
    const cur = brandName !== null ? BRANDS.find((b) => b.name === brandName) : undefined;
    return (
      <>
        <VehicleCombo
          label="選擇廠牌"
          value={brandName}
          options={BRANDS.map((b) => b.name)}
          placeholder="選擇或輸入廠牌"
          variant="form"
          onPick={(n) => {
            setBrandName(n);
            setModelName(null);
          }}
          onClear={() => {
            setBrandName(null);
            setModelName(null);
          }}
        />
        <VehicleCombo
          label="選擇車型"
          value={modelName}
          options={cur?.models.map((m) => m.name) ?? []}
          disabled={brandName === null}
          placeholder="選擇或輸入車型"
          variant="form"
          onPick={(n) => setModelName(n)}
          onClear={() => setModelName(null)}
          onDraftTextChange={onDraft}
        />
      </>
    );
  }

  it('🔴 停用轉態時丟掉草稿 —— 欄位清空、且父層收到空字串', () => {
    const onDraft = vi.fn();
    render(<DisabledDebtHarness onDraft={onDraft} />);
    const brand = combo('選擇廠牌');
    fireEvent.change(brand, { target: { value: 'Yamaha' } });
    fireEvent.blur(brand);
    const model = combo('選擇車型');
    expect(model.disabled, '前提:選了廠牌後車型欄要真的解鎖,否則本條在測空氣').toBe(false);
    fireEvent.change(model, { target: { value: 'ZZZ-不存在' } });
    fireEvent.blur(model);
    expect(
      model.value,
      '前提:Q4=B 留字要成立(非唯一/零命中不清空),否則本條測不到停用轉態這件事',
    ).toBe('ZZZ-不存在');
    fireEvent.change(brand, { target: { value: '' } });
    fireEvent.blur(brand);
    expect(combo('選擇車型').disabled, '前提:廠牌清空後車型欄要真的變 disabled').toBe(true);
    expect(
      combo('選擇車型').value,
      '車型欄停用了卻還顯示殘字 ⇒ 客人看到一個灰掉但沒被清空的欄位',
    ).toBe('');
    expect(
      onDraft,
      '父層(草稿回報)仍握著停用前的殘字 ⇒ 下游「改用自行輸入」會把它組進車名',
    ).toHaveBeenLastCalledWith('');
  });

  it('🔴 if (disabled) 的判別力:停用→啟用那一拍不得再回報一次', () => {
    const onDraft = vi.fn();
    render(<DisabledDebtHarness onDraft={onDraft} />);
    expect(combo('選擇車型').disabled, '前提:掛載時未選廠牌,車型欄要是停用態').toBe(true);
    const before = onDraft.mock.calls.length;
    const brand = combo('選擇廠牌');
    fireEvent.change(brand, { target: { value: 'Yamaha' } });
    fireEvent.blur(brand);
    expect(combo('選擇車型').disabled, '前提:選了廠牌後車型欄要真的解鎖,證明停用→啟用這個轉態發生了').toBe(
      false,
    );
    expect(
      onDraft.mock.calls.length - before,
      '停用→啟用這一拍不得多噴回報 —— 無條件版 `changeText(null)` 會在這裡多噴一次空字串,值與 before 分不開、只有次數分得開',
    ).toBe(0);
  });
});
