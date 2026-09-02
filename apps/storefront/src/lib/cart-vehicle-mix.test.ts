// cart-vehicle-mix.test.ts — 判準的守門。
//
// 🔴 **本檔最重要的一格是「沒選車的人」那一格** —— 它守的不是一個 bug,
//   是一個**被否決掉的實作方向**:若有人日後把判準改回「≠ 目前選的車」,
//   那一格會紅。⇒ 那是這一片存在的理由,不是附帶測試。

import { describe, it, expect } from 'vitest';
import { cartVehicleMix, type CartVehicleMixLine } from './cart-vehicle-mix';

const r6: CartVehicleMixLine['vehicle'] = { kind: 'dict', brand: 'Yamaha', model: 'YZF-R6', source: 'picker' };
const duc: CartVehicleMixLine['vehicle'] = { kind: 'dict', brand: 'Ducati', model: 'Panigale V4', source: 'picker' };
const r6y: CartVehicleMixLine['vehicle'] = { kind: 'dict', brand: 'Yamaha', model: 'YZF-R6', year: 2019, source: 'picker' };

describe('cartVehicleMix', () => {
  it('🟢 正對照:兩台不同的車 ⇒ 出聲, 而 labels 兩個都列出來', () => {
    const got = cartVehicleMix([{ vehicle: r6 }, { vehicle: duc }]);
    expect(got.shouldNotice).toBe(true);
    // 🎯 印集合不只印筆數:「有 2 個」與「是這 2 個」是兩個宣稱
    expect(got.labels).toEqual(['Yamaha YZF-R6', 'Ducati Panigale V4']);
  });

  it('🔵 負對照:全部同一台車 ⇒ 不出聲', () => {
    expect(cartVehicleMix([{ vehicle: r6 }, { vehicle: r6 }]).shouldNotice).toBe(false);
  });

  it('🔴🔴 沒有任何一件填車(= 多數客人)⇒ 不出聲 —— 這一格守的是被否決的那個實作方向', () => {
    // 判準若寫成「這件的車 ≠ 目前選的車」, 沒選車時 null ≠ 任何車 ⇒ 每一件都叫 ⇒ 購物車一片紅。
    // 本函式的簽章裡**根本沒有「目前選的車」**, 所以那個世界構造不出來。
    const got = cartVehicleMix([{}, {}, {}]);
    expect(got.shouldNotice).toBe(false);
    expect(got.labels).toEqual([]);
  });

  it('🔴 一件有車一件沒填 ⇒ 不出聲(相異值只有 1, 沒填的那件不算第二台車)', () => {
    expect(cartVehicleMix([{ vehicle: r6 }, {}]).shouldNotice).toBe(false);
  });

  // 🔴 **本格 2026-09-03 反轉(code-reviewer R1 F2)。**
  //   ~~原版:「同車不同年份 ⇒ 算兩台(年份是 fitment 的一部分, 不可併)」~~ —— **那是錯的,
  //   而它被我釘成了規格 ⇒ 沒有東西會紅。**可達路徑:頂部「整車套用」寫下的車沒有年份
  //   (picker 選到車型即 commit,`CartVehicleField.tsx:172`),客人再替某一列補 2019
  //   ⇒ 橫幅對**同一台 R6** 說「2 台車的東西」。
  it('🔴 同一台車、一列有年份一列沒有 ⇒ 算【一台】(這是頂部整車套用 + 逐列補年份的日常路徑)', () => {
    const got = cartVehicleMix([{ vehicle: r6 }, { vehicle: r6y }]);
    expect(got.shouldNotice).toBe(false);
    expect(got.labels.length).toBe(1);
  });

  it('🛑 代價明寫:真的有 R6 兩個年份兩台車的客人, 本橫幅【不會】替他分開(少報優於誤報)', () => {
    // 🎯 這一格不是在慶祝一個限制, 是讓它有座標:哪天要改成分年份, 改的人會先撞到這句話。
    const r6a = { ...r6, year: 2019 } as const;
    const r6b = { ...r6, year: 2021 } as const;
    expect(cartVehicleMix([{ vehicle: r6a }, { vehicle: r6b }]).shouldNotice).toBe(false);
  });

  it('🔴🔴 已知誤報(R1 F1):車庫預填的車進了分母 ⇒ 對只選過一台車的人也會出聲', () => {
    // `CartView.tsx:97-114` 對每一列 `if (!l.item.vehicle) setItemVehicle(l.item, gv)`
    // ⇒ 客人手選 MT-09、另一列被自動補成車庫裡的 MT-09 SP ⇒ 相異值 2 ⇒ 出聲。
    // 🛑 **這一格釘的是【現況為真】, 不是【現況為對】** —— 它讓這個誤報在 CI 上看得見;
    //    修它要在 CartItemVehicle 上多一個「誰填的」欄(動 CartContext, 超出本 plan 批准範圍)。
    //    ⇒ 修好的那天, 這一格會紅, 而紅的時候請把它改成 `toBe(false)`, 不要刪掉它。
    const manual = { kind: 'dict', brand: 'Yamaha', model: 'MT-09', source: 'search' } as const;
    const prefilled = { kind: 'dict', brand: 'Yamaha', model: 'MT-09 SP', source: 'garage' } as const;
    expect(cartVehicleMix([{ vehicle: manual }, { vehicle: prefilled }]).shouldNotice).toBe(true);
  });

  it("🔴 kind:'free' 不進分母 —— 自由輸入的字面不等於車, 數它會多報", () => {
    const free: CartVehicleMixLine = { vehicle: { kind: 'free', raw: 'ducati', source: 'freetext' } };
    const got = cartVehicleMix([{ vehicle: r6 }, free]);
    expect(got.shouldNotice).toBe(false);
    expect(got.labels).toEqual(['Yamaha YZF-R6']);
  });

  it('🛑 已經有列亮著紅膠囊 ⇒ 不疊第二層(那一句比本橫幅更具體)', () => {
    const got = cartVehicleMix([{ vehicle: r6, fitStatus: 'no-match' }, { vehicle: duc }]);
    expect(got.shouldNotice).toBe(false);
    // 🟢 而 labels 仍然算出來 —— 抑制的是「要不要出聲」, 不是「算不算得出來」
    expect(got.labels.length).toBe(2);
  });

  it('🟢 fitStatus 是其他值時不抑制(只有 no-match 才算「已經在講了」)', () => {
    const got = cartVehicleMix([{ vehicle: r6, fitStatus: 'match' }, { vehicle: duc, fitStatus: null }]);
    expect(got.shouldNotice).toBe(true);
  });

  it('🔵 空購物車 ⇒ 不出聲(尺對空輸入不亂報)', () => {
    expect(cartVehicleMix([])).toEqual({ labels: [], shouldNotice: false });
  });
});
