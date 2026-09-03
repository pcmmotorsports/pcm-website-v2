// checkout-messages.test — 釘的不是措辭,是【每一句話在它自己那一格是不是真的】。
//
// 🔴 這一支存在的理由與 `⟦b4-MONEYLINE⟧` 那一族相同:
//    這幾句客人看得到的話, 在測試檔裡出現 **0 次** ⇒ **改它、或把它改回去, 都不會有東西紅。**
//    ⇒ 改文案而不同時補守門 = 把「下一次改回去」的成本也一起降到零。
//
// 🛑 **射程**:本檔驗【字面帶了哪些事實】與【兩個呼叫端沒有各自複製一份】。
//    它**不驗**畫面上真的長這樣(那要真瀏覽器), 也**不驗**那兩條路真的走得到。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  CART_LINE_MISSING_VARIANT_MESSAGE,
  CART_LINES_INVALID_MESSAGE,
  cartLineMissingVariantMessage,
} from './checkout-messages';

const REPO = join(__dirname, '..', '..', '..');
// 🔴 具名常數, 不用陣列索引取值 —— `noUncheckedIndexedAccess` 之下 `arr[0]` 是 `string | undefined`,
//    而 `readFileSync` 不吃 undefined。**typecheck 抓到的, 不是我先想到的。**
const HOOK_FILE = join(REPO, 'src/hooks/useChargePayment.tsx');
const ACTION_FILE = join(REPO, 'src/app/checkout/charge-actions.ts');
const CALLERS = [HOOK_FILE, ACTION_FILE];

describe('🔴 兩個呼叫端不得各自複製一份字面', () => {
  it('兩支檔各自 import 那個常數,而都沒有自己寫一份字面', () => {
    // 🔴 **2026-09-03 這一格的期望值改過一次(Sean 拍 `Q15 = 甲`)**,而**它守的東西沒變**:
    //    ⛔ ~~hook 端要 import `CART_LINE_MISSING_VARIANT_MESSAGE`~~
    //    ⇒ hook 現在 import 的是**能指名商品的那支函式** `cartLineMissingVariantMessage`
    //      (它自己在 `checkout-messages.ts` 裡用那個常數當退路)。
    //    🛑 **而本格真正在守的是下面那一行** —— 「呼叫端不得自己寫一份字面」。
    //       那一行**一個字都沒改**, 所以這不是把守門改鬆, 是換了 import 的名字。
    const want: Array<[string, string]> = [
      [HOOK_FILE, 'cartLineMissingVariantMessage'],
      [ACTION_FILE, 'CART_LINES_INVALID_MESSAGE'],
    ];
    for (const [f, konst] of want) {
      const src = readFileSync(f, 'utf8');
      expect(src, `${f} 沒有 import ${konst}`).toContain(konst);
      // 🔴 這一格是本片的本體:那句話原本【寫死在兩個地方】, 而板上只點名了其中一個。
      // 🔴 **禁的字面收窄成兩句共有的那一段**(code-reviewer nit 4):
      //    ⛔ ~~禁 `購物車有商品缺少規格資訊`~~ ⇒ 那只涵蓋**退路那一句**;
      //    主世界那句是「商品缺少規格資訊,無法結帳」⇒ 呼叫端硬寫一份**新**字面不會紅。
      //    ✅ 改禁 `缺少規格資訊`(兩句共有);兩支呼叫端現在都零命中, 不會誤紅。
      expect(src, `${f} 又自己寫了一份字面`).not.toContain('缺少規格資訊');
    }
  });

  it('🔵 負對照:這把尺讀得到檔案內容(不是每次都回空字串)', () => {
    const src = readFileSync(HOOK_FILE, 'utf8');
    expect(src.length).toBeGreaterThan(500);
    expect(src).not.toContain('zzq7419nosuchtoken');
  });
});

describe('🛑 這兩句【刻意維持原字面】—— 而它是被審出來的,不是沒改到', () => {
  it('字面就是原本那一句(改它之前先讀本檔檔頭)', () => {
    expect(CART_LINE_MISSING_VARIANT_MESSAGE).toBe('購物車有商品缺少規格資訊,請返回購物車重新確認');
    expect(CART_LINES_INVALID_MESSAGE).toBe(CART_LINE_MISSING_VARIANT_MESSAGE);
  });

  it('🔴 不得在這裡貼「這一次沒有送出付款請求」—— 八句裡只有兩句帶 = 客人讀成區別訊號', () => {
    // codex R3 + Fable 各自抓到:同一顆 alert 上有八句零扣款訊息, 而改之前它們【一致沉默】。
    // ⇒ 只給其中兩句加那句話, 那個不對稱是【改動造出來的】。
    for (const m of [CART_LINE_MISSING_VARIANT_MESSAGE, CART_LINES_INVALID_MESSAGE]) {
      expect(m).not.toContain('沒有送出付款請求');
      expect(m).not.toContain('沒有被扣款');
    }
  });

  it('🔴 不得在這裡叫客人「移除」—— 那是產品決定, 等 Sean 拍板', () => {
    // 訊息說「那件商品」而 CartView 對零變體那一列不渲染任何標記
    // ⇒ 客人只能猜著刪 ⇒ 可能刪掉他本來要買的那一件。
    expect(CART_LINE_MISSING_VARIANT_MESSAGE).not.toContain('移除');
  });
});

describe('🔴 那句話要【指名是哪一件】+ 給一條出路(Sean 2026-09-03 拍 Q15 = 甲)', () => {
  it('叫得出名字 ⇒ 逐件列出, 不截斷', () => {
    const msg = cartLineMissingVariantMessage(['碳纖維車台護蓋', 'Akrapovič 全段排氣']);
    expect(msg).toContain('碳纖維車台護蓋');
    expect(msg).toContain('Akrapovič 全段排氣');
    expect(msg).toContain('2 件');
  });

  it('🔵 負對照:叫不出名字 ⇒ 退回不指名的版本, **不印空名字**', () => {
    const msg = cartLineMissingVariantMessage([]);
    expect(msg).toContain('購物車有商品缺少規格資訊');
    // 🔴 少了這行, 一個回 `「」` 或 `undefined` 的實作照樣過。
    expect(msg).not.toMatch(/:\s*。|「」|undefined/);
  });

  it('🔴 兩個世界都要有出路, 而字面沿用站上既有的「聯繫客服 LINE」不自創', () => {
    for (const msg of [cartLineMissingVariantMessage(['某商品']), cartLineMissingVariantMessage([])]) {
      expect(msg, '每一個世界都要給他一件做得到的事').toContain('聯繫客服 LINE');
    }
  });

  it('🛑 不得叫客人「移除」—— 那是產品決定, Sean 沒有拍那一個動詞', () => {
    // 🔴 前一次修法就是卡在這裡(codex R3 + Fable 兩輪各判一次):
    //    「移除」= 叫他放棄一件他本來想買的東西。本片只做結構, 不替他決定動詞。
    expect(cartLineMissingVariantMessage(['某商品'])).not.toContain('移除');
  });
});
