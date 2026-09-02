import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 🔴🔴 **這道守門【只】守一件事:`order-status-axes` 的直接匯入清冊有沒有變。**
 *
 * ⚠️⚠️ **它【不】證明「那條約束被守住了」** —— 第一版的標題與訊息都這樣宣稱過,
 * 而 2026-08-25 codex 對抗審查判 **NO-GO**,理由逐字:
 * > 它實際只守住「指定目錄內、特定副檔名、使用單引號 `from` 語法、直接匯入指定字串的
 * > 檔案路徑集合」。這和「回傳值沒有進入取消／上限判斷」**不是同一個事實**。
 * 🔴 **標題比判別句寬 ⇒ 它會被當成更大的規矩用。** 已照那條 finding 把宣稱收窄到本行。
 *
 * ── 它在守什麼(背景)──────────────────────────────────────────────
 * `order-status-axes.ts` 的 `quantitySummary?.[k] ?? 0` 把「摘要列不存在」當成 0。
 * 那**是語意正確的**(該列由 trigger 惰性建立),而該檔 `:244` 起寫下 house 裁定:
 * 「純顯示補 0 可接受、守門/上限/可否取消的判斷**絕不可補 0、必須 fail-closed**」
 * 並自承(`:255`)「共用這件事本身沒有守門」。
 * 📏 2026-08-25 量:非測試檔裡直接 import 它的恰為 2 支顯示元件。
 * ⇒ 本檔把那個**清冊**釘住,讓「有人新接進來」這件事**在發生的那一刻有人讀到下面那段話**。
 *
 * ══ ⚠️ **本守門【不】涵蓋的(全部列出,不要讀成「涵蓋以外都安全」)** ══════════
 * ```
 * ① 把算法【複製過去】而不 import        ② 動態 import() / barrel / re-export 二手匯入
 * ③ 白名單內的元件【從顯示改成守門用途】  ④ 白名單元件把值再傳給別的函式當守門依據
 * ⑤ apps/admin/src 以外的消費端(含 packages/)
 * ⑥ 目標模組自己改變回傳語意 —— 清冊不變, 而危險變了
 * ```
 * 🔴 ③④⑥ 是 codex 補的,**它們正好是「清冊沒變而事實變了」的那一類** ——
 *    也就是本守門**天生看不到**的那一類。**把自己加進白名單不等於你安全了。**
 *
 * ══ 🔴🔴 **一個【未關的洞】—— 不是已緩解,是沒關** ══════════════════════════
 *
 * codex R1 對抗審查逐字:
 * > 維護者會被迫修改硬編碼名單……**讓安全審查退化成消紅作業**。
 *
 * ```
 * 🔴 本守門【擋不住】的:
 *    ① 有人把邏輯【複製過去】而不 import
 *    ② 有人【順手把自己加進名單】—— 而本守門【沒有辦法分辨】
 *       「經過判斷後決定加入」與「為了消紅而加入」
 *    ⇒ 這兩件在 diff 上長得一模一樣。
 * ```
 * 🔴🔴 **本守門的價值是把【無聲的流失】換成【有聲的流失】,不是防止流失。**
 *
 * ⚠️ **失敗訊息裡那句「加進名單不等於你安全了」是【提醒】不是【機制】** ——
 *    照本 repo 的機制優先律,它**不算緩解**。這個洞現在是開著的,寫在這裡是為了
 *    讓下一個人**不要把「有這道閘」讀成「這條約束被守住了」**。
 *
 * 📌 而不收它會怎樣(1b 2026-08-25 裁決時的兩害相權):那條約束會回到
 *    **押在一句沒有機制的話上** —— 而「約束流失的那天,三綠全綠」。
 *    ⇒ **「會被繞過」不等於「零價值」。**
 */

const ADMIN_SRC = resolve(__dirname, '..', '..');
import { stripComments } from '../test-support/strip-comments';

const TARGET = 'order-status-axes';

// 🔴 §A①:先剝註解再比對 —— 這個 repo 的註解裡到處都是 import 範例與檔名字面。
// 🔴🔴 **2026-08-31:本檔原本自己寫了一支 regex 版,已改用共用的 parser 版。**
//    ⛔ ~~`src.replace(/\/\*[\s\S]*?\*\//g, …)`~~ —— 供給源是「`*/` 這兩個字元」不是「註解」
//    ⇒ 一個行註解裡的 `*/` 就能開假區塊,把中間的真程式碼從掃描裡拿掉。
// ✅ **共用版刻意也是【換等長空白、保留換行】** —— 因為下方 `importsModule` 的比對式帶 `m` 旗標、
//    用 `^[ \t]*(?:import|export)` 錨行首 ⇒ **它依賴行結構**;把註解「刪掉」會把後面的 import
//    併到上一行的碼後面 ⇒ 少認一個 importer,而那是【漏放】方向。
// 🛑 **只換剝法,沒換它在找什麼。**

/**
 * `from '…/<mod>'` 的匯入來源比對。
 * 🔴 **雙引號、以及路徑結尾必須釘死**,兩者都是 codex R1 抓到的漏(單引號版看不到
 *    `from "…"`;沒釘結尾則任何**檔名以 `order-status-axes` 結尾的別的模組**都會被誤算)。
 */
function importsModule(src: string, mod: string): boolean {
  // 🔴 codex R2:第二版只搜 `from '…'` 字面 ⇒ **一般字串裡的範例也會被誤判**
  //    (`const s = "from './order-status-axes'"` 會命中)。
  //    ⇒ 釘住「行首是 import / export 敘述」,把裸字串排除掉。
  return new RegExp(
    `^[ \\t]*(?:import|export)\\b[^;'"]*?from\\s+(['"])(?:[^'"]*/)?${mod}\\1`,
    'm',
  ).test(src);
}

const SOURCE_EXT = /\.(?:tsx?|jsx?|mjs|cjs)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE_EXT.test(name) && !name.includes('.test.')) out.push(full);
  }
  return out;
}

/** 「非測試檔裡直接匯入 `<mod>` 的那些檔」(repo 相對路徑,已排序)。 */
function importersOf(mod: string): string[] {
  return walk(ADMIN_SRC)
    .filter((f) => !new RegExp(`(?:^|[/\\\\])${mod}\\.[jt]sx?$`).test(f))
    .filter((f) => importsModule(stripComments(readFileSync(f, 'utf8'), f), mod))
    .map((f) => relative(ADMIN_SRC, f).split('\\').join('/'))
    .sort();
}

/** 🔴 這份名單是**顯示元件**。加進來之前,先讀上方「本守門不涵蓋的」那六條。 */
const ALLOWED_IMPORTERS = [
  'components/orders/order-detail-summary-cards.tsx',
  // 🔴 2026-08-27 線1 加入。**而我先做了上方要求的判斷,判斷寫在這裡,不是只加一行:**
  //   用途:焦點列從 `order-detail-summary-cards.tsx` 搬出來時,把 `goodsQuantityHeadline`
  //        一起帶走(Sean 拍乙)。它取 `qty.ordered` / `qty.instock` 兩個數字,
  //        印在「件數 已訂 / 到貨」那個 chip 上。
  //   ✅ **純顯示**:那兩個數字不餵任何守門 / 上限 / 可否取消的判斷。
  //   ✅ **null 態不補 0**:`qty === null ⇒ 印「未知」`(逐字搬家、一個字沒改)——
  //      那正是本守門在守的那條約束,而它在搬家之後仍然成立。
  //   ✅ 截斷閘(`detail.itemsTruncated ⇒ qty=null`)也逐字跟著搬。
  //   ⇒ 落在 `:244` house 裁定許可的「純顯示補 0」那一側,與 `order-export.ts` 同一類。
  //
  //   🔴🔴 **而加完之後這道閘【對本檔失去了什麼】,明寫**:
  //   名單多一個成員 ⇒ 它的射程沒有變寬也沒有變窄(它本來就只答「清冊有沒有變」),
  //   **變的是分母裡多了一支我自己寫的檔** —— 而上方那六條「不涵蓋」對它一樣成立:
  //     ③ 這支檔哪天拿 `qty` 去擋一顆按鈕 ⇒ 本閘**不會紅**
  //     ④ 它把值再傳給別的函式當守門依據 ⇒ 同上
  //     ⑥ `order-status-axes` 自己改回傳語意 ⇒ 清冊不變而危險變了
  //   🔴 **而本檔 `:41-42` 逐字寫著:「有人順手把自己加進名單 —— 本守門沒有辦法分辨」。**
  //      **我就是那個人。** ⇒ 第二道不是這道閘,是 `code-reviewer` 讀上面這段判斷。
  'components/orders/order-focal-row.tsx',
  'components/orders/orders-table.tsx',
  // 🔴 2026-08-26 線1 加入。**而我先做了上面那段要求的判斷,判斷寫在這裡,不是只加一行:**
  //   用途:`order-export.ts:101` 只取 `orderStatusView(order).label`,寫進 CSV 的「狀態」欄。
  //   ✅ 它**不餵任何守門/上限/可否取消的判斷** —— 那一欄是一段給人看的文字。
  //   ✅ 而該檔的**金額欄不經過這支**:單價/小計/訂單總額分別直接取
  //      `line.unitPrice.amount` / `line.lineTotal.amount` / `order.total.amount`
  //      ⇒ `?? 0` 那個顯示語意**碰不到任何一個錢的數字**。
  //   ⇒ 結論:落在該檔 `:244` house 裁定許可的「純顯示補 0」那一側。
  //
  //   ⚠️ **而我要自己講出殘餘風險,因為它正好是上面第 ③ 條**(白名單內的元件從顯示改成守門用途):
  //      那份 CSV 的**用途是對帳**,而一個「顯示語意」的狀態欄坐在對帳檔裡,
  //      **很容易在三個月後被某個人當成權威**。
  //      ⇒ 所以 `order-export.ts` 那一側也寫了同一段(兩邊都寫,因為讀的人只會讀到其中一邊)。
  //      🔴 **若哪天有人拿那一欄去做篩選、對帳判斷或自動化 ⇒ 這條判斷當場作廢,要重做。**
  'lib/orders/order-export.ts',
];

const WHY = [
  '🔴 `order-status-axes` 的 `?? 0` 是【顯示語意】(摘要列不存在 = 還沒訂貨)。',
  '你要接它之前先確認你問的不是【還能取消多少】——',
  '那類問題必須走明細側的 `| null` 原型、fail-closed,不得補 0。',
  '',
  '⚠️ 而把自己加進 ALLOWED_IMPORTERS【不等於你安全了】:',
  '   本守門只看得到【直接 import】。複製算法、barrel/re-export、',
  '   或你把值再傳給別的函式當守門依據 —— 它全部看不到。',
  '   ⇒ 這份名單只證明「你是被看見的那個」,不證明「你接它是對的」。',
].join('\n  ');

describe('order-status-axes 直接 import／re-export 來源清冊(只守清冊本身,不宣稱守住那條約束)', () => {
  it('🔴 非測試檔的直接匯入者恰為那份名單 —— 多一個就要有人來讀那條約束', () => {
    expect(importersOf(TARGET), WHY).toEqual(ALLOWED_IMPORTERS);
  });

  it('🟢 量具自檢:用固定 fixture 證明這把尺【兩種引號都讀得到、且釘得住路徑結尾】', () => {
    // 🔴🔴 **本格改過兩次,兩次都是因為它自己恆綠 —— 寫下來因為那正是本檔在防的病。**
    //   第一版:拿 `form-fields` 當正對照,而它實測 0 支 ⇒ 尺整個壞掉也照樣綠。
    //   第二版:改數 `order-list-view`(24 支)。codex R1 指出仍不對 ——
    //     「只證明量具對【另一個名稱】仍能數到十支,不能證明它對 TARGET、
    //      雙引號、或所有匯入語法有效」,而且該模組重構到 9 支就會誤紅。
    //   ⇒ 現在改成**固定 fixture**:直接餵字串給 `importsModule()`,不依賴任何真實檔案。
    const yes = [
      `import { x } from '../../lib/orders/${TARGET}';`,
      `import { x } from "../../lib/orders/${TARGET}";`,
      `export { x } from './${TARGET}';`,
    ];
    const no = [
      `import { x } from '../../lib/orders/legacy-${TARGET}-v1';`, // 結尾不同 ⇒ 不得命中
      `// import { x } from './${TARGET}';`, // 註解 ⇒ 由 stripComments 擋掉
      `import { x } from './order-list-view';`,
      // 🔴 codex R2 補:**裸字串裡的範例不得命中**(第二版會誤判成真的匯入)
      `const doc = "from './${TARGET}'";`,
      `const msg = \`請改成 from '../../lib/orders/${TARGET}'\`;`,
    ];
    expect(
      yes.map((s) => importsModule(stripComments(s), TARGET)),
      '🔴 該命中的沒命中 ⇒ 這把尺漏掉某種匯入寫法,上面那格的綠不算數',
    ).toEqual([true, true, true]);
    expect(
      no.map((s) => importsModule(stripComments(s), TARGET)),
      '🔴 不該命中的命中了 ⇒ 這把尺會誤擋,上面那格的紅不算數',
    ).toEqual([false, false, false, false, false]);
  });
});
