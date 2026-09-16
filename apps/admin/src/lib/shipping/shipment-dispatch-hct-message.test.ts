// shipment-dispatch-hct-message.test.ts — 叫車回「我們看不懂」那一句的字面守門(2026-09-16)。
//
// 🔴🔴 **為什麼這一格要存在**:2026-09-16 Sean 真的撞到一次 —— 他按叫車, 新竹回 `rtn_code_120000004`,
//    畫面印「新竹的回答我們看不懂(…)—— 這【不代表車沒叫到】。這一箱先不標出貨, **請人確認**。」
//    ⇒ 📌 **三句都對, 而沒有一句告訴他【確認什麼、找誰確認】** ⇒ 他只能乾瞪眼。
//    ⇒ 🎯 那句話後來補上了「打給誰、報哪個號碼、問什麼」。**而它零測試覆蓋** ——
//      有人哪天把它「簡化」回去, 不會有任何東西叫。
//
// 🔵 **為什麼是字面層(讀原始碼)而不是跑那支 action**:
//    那支 action 要 mock 授權 + HCT client + 佔位寫入一整套, 而**本格要守的只有一件事:那句話有沒有把人送到下一步**。
//    ⇒ 行為面由 action 自己的守門顧;本格顧的是**「那句話被改壞而沒有人發現」**那一種。
// ⚠️ **它擋不住什麼**:字在原始碼裡 ≠ 員工看得到(渲染那一段由 `shipment-pick.tsx` 負責)。

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SRC = readFileSync(new URL('./shipment-dispatch-hct-action.ts', import.meta.url), 'utf8');

/**
 * 只取那一段的訊息字面 —— 其餘分支的話不在本格管轄內。
 *
 * 🔴🔴 **要先剝掉註解, 而這一行是被自己咬到才加的(2026-09-16)。**
 *    那段碼上方的註解裡**逐字引用了舊句子「請人確認」**(它在解釋為什麼要改掉)
 *    ⇒ 下面那格「不准退回『請人確認』」**當場紅**, 而碼本身是對的。
 *    ⇒ 📌 這個 repo 記過同一條:**grep 的分母是整支檔的全部字元, 註解與字串都算。**
 *      `cancel-shipment-warning.test.ts` 的 `stripComments` 就是為了同一件事而存在, 本格照抄那個做法。
 * ⚠️ 代價講明:剝掉註解之後, **註解裡寫的東西本格一概看不到** ——
 *    那正是要的(本格守的是【員工看得到的那句話】, 不是我們寫給彼此的話)。
 */
function unknownMessage(): string {
  const at = SRC.indexOf("plan.kind === 'all_unknown'");
  expect(at, "找不到 all_unknown 那個分支 ⇒ 分支改名或被拿掉了, 本格失去分母").toBeGreaterThan(-1);
  const block = SRC.slice(at, SRC.indexOf('};', at));
  expect(block.length, 'all_unknown 分支切出來是空的').toBeGreaterThan(0);
  // 行註解整行換成等長空白 —— 用刪除會讓行號對不上, 而出錯時我們要指得回原始碼。
  const stripped = block.replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
  // 🟢 正對照:剝完之後那句話的主體必須還在, 否則我剝掉的是**碼**不是註解。
  expect(stripped, '剝註解把訊息本身也剝掉了 ⇒ 下面每一格都會變成恆真').toMatch(/message:/);
  return stripped;
}

describe('叫車「看不懂」那一句:誠實之後要接一個做得到的動作', () => {
  it('🔴🔴 要告訴他【打給誰、報哪個號碼、問什麼】—— 三樣缺一不可', () => {
    const m = unknownMessage();
    expect(m, '沒叫他打電話 ⇒ 他不知道下一步').toMatch(/打電話給新竹/);
    expect(m, '沒把貨號帶進句子 ⇒ 他要自己去別的地方找號碼').toMatch(/報貨號 \$\{edelno\}/);
    expect(m, '沒告訴他要問什麼 ⇒ 他打過去也不知道怎麼開口').toMatch(/有沒有派到車/);
  });

  it('🔴 電話號碼旁邊必須標明【沒有確認過還有沒有效】', () => {
    const m = unknownMessage();
    expect(m, '沒有那支電話').toMatch(/02-2837-1122/);
    // 🔵 那支號碼取自 `docs/reference/hct-logistics-api-reference.md`,
    //    而該檔第 8 節「未確認清單」逐字列著「聯絡電話…是否仍有效」。
    //    🔴 把一個沒驗過的號碼印得像確定的事實, 正是今天這條線一直在抓的那一族。
    expect(m, '把一個未驗證的號碼印得像事實').toMatch(/沒有確認過/);
  });

  it('🔴 不准退回沒有受詞的「請人確認」—— 那正是卡住他的那四個字', () => {
    const m = unknownMessage();
    expect(m, '「請人確認」沒有受詞:確認什麼?找誰?').not.toMatch(/請人確認/);
  });

  it('🔵 而「不代表車沒叫到」要留著 —— 不把不確定寫成失敗', () => {
    const m = unknownMessage();
    expect(m, '寫成失敗的話, 他會以為要重按 ⇒ 可能叫兩次車').toMatch(/不代表車沒叫到/);
  });

  it('🔵 「先不要標出貨」要留著(那句本來就在, 而且是對的)', () => {
    expect(unknownMessage()).toMatch(/先不要標出貨|先不標出貨/);
  });
});
