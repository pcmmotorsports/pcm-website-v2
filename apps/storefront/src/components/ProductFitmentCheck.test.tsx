// @vitest-environment jsdom
//
// ProductFitmentCheck smoke — V-2b §7「是否適用我的車」保守比對。
// 驗:context dict 命中→✓ / 未列→✗ / 年份未定→qualified / 無 context→現選入口 /
//     愛車快選→比對 / 無 fitments→null。判定核心 checkFitment 另有 lib/fitment-match.test。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProductFitmentCheck } from './ProductFitmentCheck';
import { VEHICLE_CONTEXT_KEY } from '@/lib/vehicle-context';
import { slugify } from '@/lib/vehicle-taxonomy';
import type { UIFitment } from '@/data/mock-products';
import type { MockMotoBrand } from '@/data/mock-moto-brands';

const FITMENTS: UIFitment[] = [{ motoBrand: 'YAMAHA', modelCode: 'MT-09', yearStart: 2021, yearEnd: 2024 }];
const BRANDS: MockMotoBrand[] = [
  { id: 'yamaha', name: 'YAMAHA', models: [{ id: 'mt-09', name: 'MT-09', years: [2021, 2022, 2023, 2024] }] },
] as MockMotoBrand[];

function setContext(v: { brandName: string; modelName: string; year?: number }) {
  window.sessionStorage.setItem(
    VEHICLE_CONTEXT_KEY,
    JSON.stringify({
      brandId: slugify(v.brandName),
      modelId: slugify(v.modelName),
      year: v.year,
      label: `${v.brandName} ${v.modelName}`,
      brandName: v.brandName,
      modelName: v.modelName,
      savedAt: 1,
    }),
  );
}

afterEach(() => {
  cleanup();
  window.sessionStorage.removeItem(VEHICLE_CONTEXT_KEY);
});

describe('ProductFitmentCheck（§7）', () => {
  it('context dict 命中(年份區間內)→ ✓ 適用', () => {
    setContext({ brandName: 'YAMAHA', modelName: 'MT-09', year: 2022 });
    render(<ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} />);
    expect(screen.getByText(/適用你的 2022 YAMAHA MT-09/)).toBeTruthy();
    expect(screen.getByText('✓')).toBeTruthy();
  });

  it('context dict 年份不合 → ✗ 未列 + 聯絡', () => {
    setContext({ brandName: 'YAMAHA', modelName: 'MT-09', year: 2019 });
    render(<ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} />);
    expect(screen.getByText(/未列於適用清單/)).toBeTruthy();
    expect(screen.getByText('✗')).toBeTruthy();
    expect(screen.getByText(/聯絡我們確認/)).toBeTruthy();
  });

  it('context dict 年份未定 + 受限 fitment → qualified(禁 bare ✓)', () => {
    setContext({ brandName: 'YAMAHA', modelName: 'MT-09' });
    render(<ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} />);
    // 🔴 R3-F2:用**整串含逗號**的字面斷言。原本的 /有年份限制/ 正規式切在逗號後面 ⇒
    //   有人把這句「補成全形」照樣全綠,而它屬計畫 §2.6 明列凍結、不得動的既有文案。
    //   (與 R2-I2 帳號那條同型切口:不是沒測試,是測試切在逗號旁邊。)
    expect(screen.getByText('此商品適用 YAMAHA MT-09,但有年份限制')).toBeTruthy();
    expect(screen.getByText(/請確認你的年份/)).toBeTruthy();
  });

  it('無 context → 現選入口(確認是否適用你的車)', () => {
    render(<ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} />);
    expect(screen.getByText('確認是否適用你的車')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: '選擇廠牌' })).toBeTruthy();
  });

  it('愛車快選 dict 命中 → 套用並比對(✓)', () => {
    render(
      <ProductFitmentCheck
        fitments={FITMENTS}
        motoBrands={BRANDS}
        garage={[{ id: 'g1', name: 'MT-09', year: '2022', dictBrandName: 'YAMAHA', dictModelName: 'MT-09', isPrimary: false }]}
      />,
    );
    fireEvent.click(screen.getByText('2022 MT-09'));
    expect(screen.getByText(/適用你的 2022 YAMAHA MT-09/)).toBeTruthy();
  });

  // A10b:PDP 自刻 chips 退場,換全站唯一的 GarageChips(設計稿 C4 After 行內密度)。
  // 🔴 沒有這條,把它換回自刻 JSX 上面那條行為測試照樣綠 ——「4 份收斂成 1 份」本身沒有守門。
  it('用的是統一的 GarageChips 行內密度,不是 PDP 自刻的那份', () => {
    const { container } = render(
      <ProductFitmentCheck
        fitments={FITMENTS}
        motoBrands={BRANDS}
        garage={[{ id: 'g1', name: 'MT-09', year: '2022', dictBrandName: 'YAMAHA', dictModelName: 'MT-09', isPrimary: false }]}
      />,
    );
    expect(container.querySelector('.cat-garage--inline')).not.toBeNull();
    expect(container.querySelector('.pfc-garage')).toBeNull(); // 自刻家族退場
    expect(container.querySelector('.cat-garage-toggle')).toBeNull(); // 行內密度恆展開
    expect(screen.getByText('點一下直接套用')).toBeTruthy(); // A 表條 6 副註推廣到此
  });

  // 🔴 §7 正確性紅線:換 chips 殼時最容易順手把整段重寫。
  //    ⚠️ 測試名只講它真的驗到的:**match 一態 + 壞連結提示**。
  //    其餘三態的正面守門在本檔上方三條既有測試(no-match `:48` / qualified `:56` / match `:41`)。
  //    🔴 `undetermined`(「已記下你的車款」)**全檔零正面守門,而且是刻意的** ——
  //    `checkFitment` 只在 `kind:'free'` 或 brandName/modelName 不齊時回它
  //    (`lib/fitment-match.ts:35,37`),而本元件的 `chosen` 恆是 `kind:'dict'` + 兩個非空字典字面
  //    (四個賦值點:URL 解析、鏡讀入、URL 變更、commit —— 全部走 truthy 守門或字典選項)
  //    ⇒ 這一態在本元件**不可構造**,那段 JSX 是防禦性渲染。
  //    2026-08-05 實測:把「已記下你的車款」改成別的字,全套 storefront 測試照樣全綠。
  //    **不為它補測試**(構造不出來的測試只能靠 cast 造假狀態);寫在這裡讓下一個人不必重新推。
  it('換殼後 match 態文案與壞連結提示逐字仍在(§7 紅線)', () => {
    setContext({ brandName: 'YAMAHA', modelName: 'MT-09', year: 2022 });
    render(<ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} />);
    expect(screen.getByText(/適用你的 2022 YAMAHA MT-09/)).toBeTruthy();
    expect(screen.getByText('清除車輛')).toBeTruthy(); // Q28②:「更改車款」已改字面(行為亦不同,見專屬測試)
    cleanup();

    render(<ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} urlVehicle="invalid" />);
    expect(screen.getByText('先前的車款連結已失效,請重新選擇你的車。')).toBeTruthy();
  });

  it('無 fitments → 整段不渲染', () => {
    const { container } = render(<ProductFitmentCheck fitments={[]} motoBrands={BRANDS} />);
    expect(container.firstChild).toBeNull();
  });

  // ── V-2c:URL `?vehicle=` 恆第一真相、優先於 context 鏡(修「回上一頁換車後 PDP 顯舊車」)──

  it('V-2c:urlVehicle 優先於過期鏡 → 判 URL 車款、掛載回寫同步鏡', () => {
    setContext({ brandName: 'APRILIA', modelName: 'DORSODURO 750' }); // 過期鏡=舊車
    render(
      <ProductFitmentCheck
        fitments={FITMENTS}
        motoBrands={BRANDS}
        urlVehicle={{ brandName: 'YAMAHA', modelName: 'MT-09', year: 2022 }}
      />,
    );
    expect(screen.getByText(/適用你的 2022 YAMAHA MT-09/)).toBeTruthy(); // 顯 URL 車、非鏡的舊車
    const raw = window.sessionStorage.getItem(VEHICLE_CONTEXT_KEY);
    const ctx = JSON.parse(raw!) as { brandName?: string; modelName?: string; year?: number };
    expect(ctx.brandName).toBe('YAMAHA'); // 鏡已同步=addToCart 帶入同源、不再分家
    expect(ctx.modelName).toBe('MT-09');
    expect(ctx.year).toBe(2022);
  });

  it('V-2d③:picker 預設收合殼——入口鈕存在、點擊加 pfc-picker-open(展開=CSS ≤1023 生效;§7 邏輯零動)', () => {
    const { container } = render(<ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} />);
    const picker = container.querySelector('.pfc-picker')!;
    expect(picker.classList.contains('pfc-picker-open')).toBe(false);
    fireEvent.click(screen.getByText('選擇車款,確認是否適用'));
    expect(container.querySelector('.pfc-picker')!.classList.contains('pfc-picker-open')).toBe(true);
    expect(screen.getByRole('combobox', { name: '選擇廠牌' })).toBeTruthy(); // 選單仍在(桌機恆顯)
  });

  it('V-2c:urlVehicle brand-only → 不判定(現選入口、零猜)、鏡同步蓋掉過期鏡', () => {
    setContext({ brandName: 'APRILIA', modelName: 'DORSODURO 750' });
    render(
      <ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} urlVehicle={{ brandName: 'YAMAHA' }} />,
    );
    expect(screen.getByText('確認是否適用你的車')).toBeTruthy();
    const ctx = JSON.parse(window.sessionStorage.getItem(VEHICLE_CONTEXT_KEY)!) as {
      brandName?: string;
      modelName?: string;
    };
    expect(ctx.brandName).toBe('YAMAHA');
    expect(ctx.modelName).toBeUndefined();
  });

  // ── V-2h/MF-2:URL 車款三態 —— 'invalid'(參數在但對不到 taxonomy)不讀舊鏡、顯重新選車 ──

  it('V-2h/MF-2:urlVehicle="invalid" → 不讀過期鏡、不顯舊車判定、顯重新選車入口 + 失效提示', () => {
    setContext({ brandName: 'APRILIA', modelName: 'DORSODURO 750', year: 2015 }); // 過期鏡=舊車
    render(<ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} urlVehicle="invalid" />);
    expect(screen.queryByText(/DORSODURO 750/)).toBeNull(); // 舊車判定不出現(不讀過期鏡)
    expect(screen.queryByText(/已記下你的車款/)).toBeNull(); // 亦無 undetermined 判定訊息
    expect(screen.getByText('確認是否適用你的車')).toBeTruthy(); // 現選入口
    expect(screen.getByText(/先前的車款連結已失效/)).toBeTruthy(); // 失效提示
  });

  it('V-2h/MF-2:urlVehicle=null(無參數)→ 照舊讀鏡顯車(對照:只 invalid 才不讀)', () => {
    setContext({ brandName: 'YAMAHA', modelName: 'MT-09', year: 2022 });
    render(<ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} urlVehicle={null} />);
    expect(screen.getByText(/適用你的 2022 YAMAHA MT-09/)).toBeTruthy();
    expect(screen.queryByText(/先前的車款連結已失效/)).toBeNull(); // 無失效提示
  });

  // ── V-2h/MF-3:同頁 URL 車款變更反應式重判 + 選車回寫 URL ──

  it('V-2h/MF-3:同頁 URL 車款變更(rerender)→ 重新判定(修 mount-only 留舊值)', () => {
    const { rerender } = render(
      <ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} urlVehicle={{ brandName: 'YAMAHA', modelName: 'MT-09', year: 2022 }} />,
    );
    expect(screen.getByText(/適用你的 2022 YAMAHA MT-09/)).toBeTruthy(); // 2022 在 2021-2024 → match
    rerender(
      <ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} urlVehicle={{ brandName: 'YAMAHA', modelName: 'MT-09', year: 2019 }} />,
    );
    expect(screen.getByText(/未列於適用清單/)).toBeTruthy(); // 2019 不合 → 重判 no-match
  });

  it('V-2h/MF-3:同頁 URL 車款被清除(→ null)→ 清判定顯現選入口、不回填舊鏡', () => {
    setContext({ brandName: 'HONDA', modelName: 'CB650R' }); // 鏡有別車
    const { rerender } = render(
      <ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} urlVehicle={{ brandName: 'YAMAHA', modelName: 'MT-09', year: 2022 }} />,
    );
    expect(screen.getByText(/適用你的 2022 YAMAHA MT-09/)).toBeTruthy();
    rerender(<ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} urlVehicle={null} />);
    expect(screen.getByText('確認是否適用你的車')).toBeTruthy(); // 現選入口
    expect(screen.queryByText(/CB650R/)).toBeNull(); // 不回填舊鏡的 HONDA
  });

  it('V-2h/MF-3:愛車快選 commit → onPersistVehicle 帶 taxonomy id param(round-trip 消歧)', () => {
    const onPersist = vi.fn();
    render(
      <ProductFitmentCheck
        fitments={FITMENTS}
        motoBrands={BRANDS}
        garage={[{ id: 'g1', name: 'MT-09', year: '2022', dictBrandName: 'YAMAHA', dictModelName: 'MT-09', isPrimary: false }]}
        onPersistVehicle={onPersist}
      />,
    );
    fireEvent.click(screen.getByText('2022 MT-09'));
    expect(onPersist).toHaveBeenCalledWith('yamaha:mt-09:2022'); // taxonomy id 空間、非 slugify(name)
  });

  it('V-2h/MF-3:onPersistVehicle 用 taxonomy id、碰撞序號存活(非 slugify(name) 丟序號=MF-1 教訓)', () => {
    const onPersist = vi.fn();
    // 「MT 09」(空白)slugify → 'mt-09' 與「MT-09」撞、taxonomy id 加序號 'mt-09-2';param 必用 id 非 slugify
    const COLLIDE = [
      {
        id: 'yamaha',
        name: 'YAMAHA',
        models: [
          { id: 'mt-09', name: 'MT-09', years: [2022] },
          { id: 'mt-09-2', name: 'MT 09', years: [2022] },
        ],
      },
    ] as MockMotoBrand[];
    render(
      <ProductFitmentCheck
        fitments={[{ motoBrand: 'YAMAHA', modelCode: 'MT 09', yearStart: 2022 }]}
        motoBrands={COLLIDE}
        garage={[{ id: 'g1', name: 'MT 09', year: '2022', dictBrandName: 'YAMAHA', dictModelName: 'MT 09', isPrimary: false }]}
        onPersistVehicle={onPersist}
      />,
    );
    fireEvent.click(screen.getByText('2022 MT 09'));
    expect(onPersist).toHaveBeenCalledWith('yamaha:mt-09-2:2022'); // 序號存活;slugify 會塌成 mt-09
  });

  // ── Q27(D-218-A):qualified 態年份欄修活 —— 結果框+picker 同時顯示、picker 用 chosen 回填 ──

  it('Q27 A1/A2:qualified 態 ⇒ 結果框與 picker 同時顯示、picker 用 chosen 回填(年份欄可用)', () => {
    setContext({ brandName: 'YAMAHA', modelName: 'MT-09' }); // 無年份 → qualified
    render(<ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} />);
    expect(screen.getByText('此商品適用 YAMAHA MT-09,但有年份限制')).toBeTruthy(); // 結果框仍在
    const brand = screen.getByRole('combobox', { name: '選擇廠牌' }) as HTMLInputElement;
    const model = screen.getByRole('combobox', { name: '選擇車型' }) as HTMLInputElement;
    const year = screen.getByRole('combobox', { name: '選擇年份' }) as HTMLInputElement;
    expect(brand.value).toBe('YAMAHA'); // 回填,不是空的
    expect(model.value).toBe('MT-09');
    expect(year.disabled).toBe(false); // 年份欄可用(沒回填的話會是 disabled)
  });

  it('Q27 A4:qualified 態 picker label 換句、手機強制展開(不用點擊)', () => {
    setContext({ brandName: 'YAMAHA', modelName: 'MT-09' });
    const { container } = render(<ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} />);
    expect(screen.getByText('選一下年份，就能給你確定的答案')).toBeTruthy();
    expect(container.querySelector('.pfc-picker')!.classList.contains('pfc-picker-open')).toBe(true);
  });

  it('Q27 A3:qualified → 補年份(範圍內)→ 判定變 match、picker 收起(onPickYear 首次可達)', () => {
    setContext({ brandName: 'YAMAHA', modelName: 'MT-09' });
    render(<ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} />);
    const year = screen.getByRole('combobox', { name: '選擇年份' });
    fireEvent.change(year, { target: { value: '2022' } });
    fireEvent.mouseDown(screen.getByRole('option', { name: '2022' }));
    expect(screen.getByText(/適用你的 2022 YAMAHA MT-09/)).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: '選擇年份' })).toBeNull(); // picker 收起
  });

  it('Q27 A3:qualified → 補年份(範圍外)→ 判定變 no-match、picker 收起', () => {
    const brandsWithOldYear: MockMotoBrand[] = [
      { id: 'yamaha', name: 'YAMAHA', models: [{ id: 'mt-09', name: 'MT-09', years: [2019, 2021, 2022, 2023, 2024] }] },
    ] as MockMotoBrand[];
    setContext({ brandName: 'YAMAHA', modelName: 'MT-09' });
    render(<ProductFitmentCheck fitments={FITMENTS} motoBrands={brandsWithOldYear} />);
    const year = screen.getByRole('combobox', { name: '選擇年份' });
    fireEvent.change(year, { target: { value: '2019' } });
    fireEvent.mouseDown(screen.getByRole('option', { name: '2019' }));
    expect(screen.getByText(/未列於適用清單/)).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: '選擇年份' })).toBeNull();
  });

  it('🔴 Q27 A2 selTouched:qualified 態清除廠牌 ⇒ 真的清空(不被回填立刻填回)', () => {
    setContext({ brandName: 'YAMAHA', modelName: 'MT-09' });
    render(<ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} />);
    const brand = screen.getByRole('combobox', { name: '選擇廠牌' }) as HTMLInputElement;
    expect(brand.value).toBe('YAMAHA'); // 前提:確實回填了
    fireEvent.change(brand, { target: { value: '' } });
    fireEvent.blur(brand);
    expect(brand.value, '清空後被回填立刻填回 ⇒ selTouched 沒生效').toBe('');
  });

  it('Q27 反向:match/no-match 態不與 picker 同時顯示(只有 qualified 才會)', () => {
    setContext({ brandName: 'YAMAHA', modelName: 'MT-09', year: 2022 }); // match
    const { container: c1 } = render(<ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} />);
    expect(c1.querySelector('.pfc-picker')).toBeNull();
    cleanup();

    setContext({ brandName: 'YAMAHA', modelName: 'MT-09', year: 2019 }); // no-match
    const { container: c2 } = render(<ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} />);
    expect(c2.querySelector('.pfc-picker')).toBeNull();
  });

  // ── Q28②(memory `project_site-redesign-content-pages-decisions.md:105` + `D-221-A` ①-2)──

  it('Q28②:結果框鈕改「清除車輛」、點下去清 vehicle-context 且 chosen 被清掉', () => {
    setContext({ brandName: 'YAMAHA', modelName: 'MT-09', year: 2022 }); // match 態
    render(<ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} />);
    expect(screen.queryByText('更改車款')).toBeNull(); // 舊字面不在
    fireEvent.click(screen.getByText('清除車輛'));
    expect(window.sessionStorage.getItem(VEHICLE_CONTEXT_KEY)).toBeNull(); // context 被清
    expect(screen.queryByText(/適用你的 2022 YAMAHA MT-09/)).toBeNull(); // 結果框消失(chosen 被清)
    expect(screen.getByText('確認是否適用你的車')).toBeTruthy(); // 回到現選入口
  });

  // 🔴 D-222-A ① 裁 A 補的兩格。理由:本站 **URL 才是真相源**
  //    (`products-url-state.tsx:325` 逐字「鏡恆跟隨 URL 真相」)⇒ 只清鏡不清 URL,
  //    mount initializer 會把車寫回來 = 狀態根本沒被清過,只是畫面暫時看不到。
  it('🔴 Q28②:「清除車輛」必須以 null 呼叫 onPersistVehicle(= 清 URL 參數)', () => {
    const onPersistVehicle = vi.fn();
    setContext({ brandName: 'YAMAHA', modelName: 'MT-09', year: 2022 });
    render(<ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} onPersistVehicle={onPersistVehicle} />);
    fireEvent.click(screen.getByText('清除車輛'));
    // `null` 是 prop 契約的「清除」語意;傳別的值或不傳 = URL 沒清 = 重載車會回來。
    expect(onPersistVehicle).toHaveBeenCalledWith(null);
  });

  it('🔴 Q28②:清除後「重載」(URL 已無車輛參數)⇒ 車不得回來', () => {
    setContext({ brandName: 'YAMAHA', modelName: 'MT-09', year: 2022 });
    render(<ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} onPersistVehicle={vi.fn()} />);
    fireEvent.click(screen.getByText('清除車輛'));
    cleanup();

    // 模擬重載:URL 已被上一步清掉(urlVehicle 不傳),重新 mount 走 initializer + mount effect。
    // 🔴 **這條擋不住什麼,要講清楚**(實跑突變確認,不是推測):
    //    拿掉 `onPersistVehicle?.(null)` ⇒ 本條**照樣綠**;拿掉 `clearVehicleContext()` ⇒ 本條才紅。
    //    ⇒ 它守的是**鏡**那一半,不是 URL 那一半 —— 單元測試裡 URL 不是真的,
    //    「重載後 URL 還帶著車」這個情境**在 jsdom 構造不出來**。
    //    URL 那一半由上一條(`toHaveBeenCalledWith(null)`)在**接縫**上守,真正的端到端要真瀏覽器。
    render(<ProductFitmentCheck fitments={FITMENTS} motoBrands={BRANDS} />);
    expect(screen.queryByText(/適用你的 2022 YAMAHA MT-09/)).toBeNull();
    expect(screen.getByText('確認是否適用你的車')).toBeTruthy();
  });
});
