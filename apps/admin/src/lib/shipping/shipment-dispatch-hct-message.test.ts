// shipment-dispatch-hct-message.test.ts — 叫車「結果不確定」那一句的守門(2026-09-16;2026-09-27 改成看真的輸出)。
//
// 🔴🔴 **為什麼這一格要存在**:2026-09-16 Sean 真的撞到一次 —— 他按叫車, 新竹回 `rtn_code_120000004`,
//    畫面印「新竹的回答我們看不懂(…)—— 這【不代表車沒叫到】。這一箱先不標出貨, **請人確認**。」
//    ⇒ 📌 **三句都對, 而沒有一句告訴他【確認什麼、找誰確認】** ⇒ 他只能乾瞪眼。
//    ⇒ 🎯 那句話後來補上了「打給誰、報哪個號碼、問什麼」。**而它零測試覆蓋** ——
//      有人哪天把它「簡化」回去, 不會有任何東西叫。
//
// 🔵 2026-09-27 起直接呼叫 `uncertainDispatchMessage` 看輸出(它搬出了 'use server' 檔, 才能被 import)。
// ⚠️ **它擋不住什麼**:回傳的字 ≠ 員工看得到(渲染那一段由 `shipment-pick.tsx` 負責)。

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { uncertainDispatchMessage } from './hct-dispatch-flow';

// 🔵 2026-09-27 白話改寫(主視窗派工):那句話搬進 `uncertainDispatchMessage`, 三個「結果不確定」分支共用。
//    ⇒ 本格改成**直接呼叫它、看真的輸出**;原始碼層只剩一格:確認 all_unknown 那個分支真的用它。
const SRC = readFileSync(new URL('./shipment-dispatch-hct-action.ts', import.meta.url), 'utf8');
const EDELNO = '8947081964';
const m = uncertainDispatchMessage(EDELNO, '系統看不懂新竹的回覆', 'rtn_code_120000004');

describe('叫車「結果不確定」那一句:誠實之後要接一個做得到的動作', () => {
  it('前提:all_unknown 那個分支用的就是這一句', () => {
    const at = SRC.indexOf("plan.kind === 'all_unknown'");
    expect(at, '找不到 all_unknown 那個分支').toBeGreaterThan(-1);
    expect(SRC.slice(at, SRC.indexOf('};', at))).toMatch(/uncertainDispatchMessage\(edelno,/);
  });

  it('🔴🔴 要告訴他【打給誰、報哪個號碼、問什麼】—— 三樣缺一不可', () => {
    expect(m, '沒叫他打電話 ⇒ 他不知道下一步').toMatch(/打電話給新竹/);
    expect(m, '沒把貨號帶進句子 ⇒ 他要自己去別的地方找號碼').toContain(`貨號 ${EDELNO}`);
    expect(m, '沒告訴他要問什麼 ⇒ 他打過去也不知道怎麼開口').toMatch(/有沒有派到車/);
  });

  it('🔴 電話號碼旁邊必須標明【尚未確認是否仍有效】', () => {
    // 🔵 那支號碼取自 `docs/reference/hct-logistics-api-reference.md`, 該檔第 8 節列為未確認。
    expect(m, '沒有那支電話').toMatch(/02-2837-1122/);
    expect(m, '把一個未驗證的號碼印得像事實').toMatch(/尚未確認是否仍有效/);
  });

  it('🔴 不准退回沒有受詞的「請人確認」', () => {
    expect(m).not.toMatch(/請人確認/);
  });

  it('🔵 「不代表車沒叫到」與「不要再按一次叫車」要留著 —— 不把不確定寫成失敗', () => {
    expect(m, '寫成失敗的話, 他會以為要重按 ⇒ 可能叫兩次車').toMatch(/不代表車沒叫到/);
    expect(m).toMatch(/不要再按一次叫車/);
    expect(m).toMatch(/兩台車/);
  });

  it('🔵 貨已經被收走的出口:到訂單那一箱「其他操作」→「填單號並標記出貨」, 單號帶進句子', () => {
    expect(m).toMatch(/如果貨已經被收走/);
    expect(m).toMatch(/「其他操作」/);
    expect(m).toMatch(/「填單號並標記出貨」/);
    expect(m).toContain(`單號填 ${EDELNO}`);
  });

  it('🔵 工程代碼只放句尾括號(給客服查), 沒有代碼就不留空括號', () => {
    expect(m.endsWith('（rtn_code_120000004）')).toBe(true);
    expect(uncertainDispatchMessage(EDELNO, 'x', null)).not.toMatch(/（）/);
  });
});
