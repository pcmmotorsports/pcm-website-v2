// cancel-reason-reserved-literal-guard.test.ts — ⟦b4-CANCELKINDBYCONTENT⟧ 的**驗收訊號**
//
// 🔴🔴 **本檔防的是【做了而打壞】。「沒有人做」那一半【不在這裡】,在板上那一列。**
//    🛑 **兩者不能互相取代** —— 而把它們合成一句「都是在守那個洞」會讓人以為做一個就夠。
//    ⇒ 另一半:`docs/launch-todo.md` 的 `⟦b4-CANCELKINDBYCONTENT⟧`。
//
// ── 病 ────────────────────────────────────────────────
// `orders.cancelled_reason` 那一欄裝的是**中文散文**(七值映射:「依您要求取消」…),
// 而 `p_reason_code = 'other'` 那條路裝的是**員工當場打的原文**
// (現行定義 `20260830020000_m4b_e10_cancel_reason_neutral.sql:175` 逐字 `v_reason_txt := v_detail;`)。
// 🔴 而同一欄裡混著**一個機器碼** `payment_expired`(L3 自動失效寫的),
//    而 `orderCancelKindOf`(`order-cancel-reason.ts:82`)拿那個字面去判身分。
// ⇒ 🎯 **員工打 `payment_expired` ⇒ 客人的訂單頁對他陳述一個錯的取消原因。**
// 📌 **⇒ 那一欄「中文散文混一個機器碼」的形狀本身就是病灶。**
//
// ── 修法只能是【拒絕】, 不能是【改寫】────────────────────
// 🔵 軟理由:靜靜改寫會讓員工以為他填的字被存下來了。**而那是可以被權衡掉的。**
// 🔴 硬理由:`…cancel_reason_neutral.sql:31-32` 逐字 —— 冪等回放端拿 `orders.cancelled_reason`
//    跟【重算的映射】比,`IS DISTINCT FROM` 就 `RAISE`。⇒ **改寫 ⇒ 冪等重放會爆。**
// 📌 **⇒ 一個軟理由與一個硬理由指向同一個動作, 而只有硬的那個擋得住下一個人。**
//
// ── 🔴 為什麼用 `it.fails` 而不是留一格紅 ────────────────
// `.github/workflows/ci.yml:192` 跑 `pnpm test`, 而 vitest include 含 `scripts/**`
// ⇒ 留一格紅 ⇒ **CI 常態紅**。而 CI 今天本來就是 `failure`(2026-09-03 線【帳】實測)
// ⇒ 🛑 **多一條常態紅不會讓它從綠變紅, 它會讓【已經紅的 CI 更難修回綠】——
//       而一個修不回綠的 CI, 每多一條就更沒有人相信它會綠。**
//
// ── 🔴🔴 而 `it.fails` 自己有一個假綠, 本檔用「前置條件那一格」堵它 ──
// `it.fails` 的語意是「失敗才算通過」,而它**不區分失敗的原因**:
// ```
// 斷言不成立(= 洞還在)                      ⇒ ✅ 我們要的
// 🔴 檔案改名 / 錨撈不到 / 讀檔丟例外          ⇒ **也算失敗 ⇒ 也印綠**
// ```
// ⇒ 🎯 **那把尺會在【它自己壞掉】的時候印通過** —— fail-open 而畫面完全正常。
// ✅ ⇒ 所以下面第一格是**普通的 `it`**,只斷言前置條件(而且用**恰好的數**,不是 `> 0`)。
// 🎯 **⇒ 那一格紅 = 尺壞了;`it.fails` 那格變紅 = 洞補好了。兩種紅分得開。**
//
// 🧬 **而「分得開」不夠, 要有人讀得懂** —— 兩格的失敗訊息各自弄紅一次、**人眼看過**
//    (2026-09-03 實跑,結果記在本檔最下面)。理由:memory 記過
//    「我為了分辨兩種紅寫的訊息, 從來沒有被任何東西讀過 —— 修的是突變, 漏的是讀它的那一端」。

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { PAYMENT_EXPIRED_CANCEL_REASON } from '@pcm/domain';

const MIGRATIONS = join(import.meta.dirname, '..', 'supabase', 'migrations');

/**
 * 🔴 **保留字集 = 那一欄裡【機器會拿去判身分】的字面。**
 *    今天恰好 1 個 —— 而那不是猜的,是量那一欄的**內容分佈**量到的:
 *    六個 reason_code ⇒ 中文文案 · `other` ⇒ 員工原文 · 這一個 ⇒ L3 寫入。
 *    ✅ 從 `@pcm/domain` 讀,不在本檔重打一份 —— 兩份會漂。
 */
const RESERVED = [PAYMENT_EXPIRED_CANCEL_REASON];

/** 員工原文直接進欄位的那一行 —— 病灶的錨。 */
const HOLE_ANCHOR = /v_reason_txt\s*:=\s*v_detail\s*;/g;

/** 找【最新一支】定義 `admin_cancel_order` 的 migration —— 修法會是一支新檔, 不可寫死檔名。 */
function latestCancelRpcSource(): { file: string; text: string } {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // 檔名前綴是版本號 ⇒ 字典序 = 時間序
  let found: { file: string; text: string } | null = null;
  for (const f of files) {
    const text = readFileSync(join(MIGRATIONS, f), 'utf8');
    if (/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.admin_cancel_order/i.test(text)) {
      found = { file: f, text };
    }
  }
  if (found === null) throw new Error('找不到任何定義 admin_cancel_order 的 migration');
  return found;
}

/** 那支 RPC 有沒有【拒絕】保留字面(剝掉 SQL 行註解 —— 註解裡提到不算擋住)。 */
function rejectsReserved(text: string): boolean {
  // 🔴 **兩種註解都要剝** —— code-reviewer 2026-09-03 抓到本檔第一版只剝了 `--`:
  //    真修法若把 `RAISE EXCEPTION` 寫在 `/* */` 裡(或無關的 RAISE 剛好落在 400 字視窗內),
  //    這把尺會回 true ⇒ `it.fails` 變紅 ⇒ **一個假的「洞補好了」訊號**。
  //    📌 而那是本 repo 記過的同一條:**註解會被 grep 數成碼**。
  const code = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*--.*$/gm, '');
  return RESERVED.every((lit) =>
    new RegExp(
      `RAISE\\s+EXCEPTION[\\s\\S]{0,400}${lit}|${lit}[\\s\\S]{0,400}RAISE\\s+EXCEPTION`,
      'i',
    ).test(code),
  );
}

describe('⟦b4-CANCELKINDBYCONTENT⟧ · 員工打的字不得撞上保留字面', () => {
  it('🟢 前置條件 —— 這一格紅代表【尺壞了】, 不代表洞補好了', () => {
    const { file, text } = latestCancelRpcSource();
    expect(file, '撈到的不是 migration 檔名 ⇒ 掃描邏輯壞了').toMatch(/^\d{14}_.*\.sql$/);

    // 🔴 **恰好的數, 不是 `> 0`** —— `> 0` 在「錨變多了」時仍然綠, 而那代表病灶長出第二處。
    const hits = text.match(HOLE_ANCHOR)?.length ?? 0;
    expect(
      hits,
      [
        `${file}:錨 \`v_reason_txt := v_detail;\` 命中 ${hits} 次, 預期【恰好 1 次】。`,
        '🔴 這一格紅 = **這把尺壞了**(檔案改名 / 錨改寫 / 病灶多出一處), **不是**洞補好了。',
        '⇒ 洞補好的訊號是下面那格 `it.fails` 變紅, 不是這一格。',
        '✅ 出路:先確認病灶還在不在、在幾處, 再決定要改錨還是改射程。',
      ].join('\n'),
    ).toBe(1);

    expect(RESERVED.length, '保留字集是空的 ⇒ 下面那格恆綠').toBeGreaterThan(0);
    // 🔵 負對照:合法的中文取消原因不得混進保留字集 —— 太寬的尺產出的是假指控。
    for (const legit of ['依您要求取消', '商品供貨中斷,已為您取消', '交期無法配合,已為您取消']) {
      expect(RESERVED, `「${legit}」是七值映射的正常文案, 不該在保留字集裡`).not.toContain(legit);
    }
  });

  // 🔴🔴 **指示寫在【標題】裡, 不是寫在訊息裡 —— 這一格是實測出來的**(2026-09-03):
  //    `it.fails` 在【內層斷言開始通過】時, vitest 只印 `Error: Expect test to fail` ——
  //    **我原本寫在 expect 訊息裡的六行, 一個字都不會出現。**
  //    ⇒ 🎯 **所以修好那 475 行的人, 唯一讀得到的是這行標題。** 指示必須住在這裡。
  //    📌 而抓到它的不是更仔細, 是【把兩格各弄紅一次, 用人眼讀它印出來的字】。
  it.fails(
    '🔴 洞還在。這一格變紅 = 那 475 行修好了 ⇒ 請把 it.fails 翻成正常的 it(不要 skip、不要刪)',
    () => {
    const { file, text } = latestCancelRpcSource();
    expect(
      rejectsReserved(text),
      [
        `${file}:員工原文(p_reason_code='other')仍可被打成保留字面 ${RESERVED.join(', ')}。`,
        '',
        '🔴🔴 **你看到這一格紅, 代表那 475 行修好了 —— 而你要做的是把 `it.fails` 翻成正常的 `it`。**',
        '   🛑 **不是 skip 它**, 也不是把它刪掉:翻成正常斷言之後, 它才會在【未來有人把那道拒絕拿掉】時再叫一次。',
        '',
        '⚠️ 而修法只能是【拒絕】(RAISE EXCEPTION), 不能是【靜靜改寫】——',
        '   冪等回放端拿這一欄跟重算的映射比(cancel_reason_neutral.sql:31-32), 改寫會讓重放 RAISE。',
        ].join('\n'),
      ).toBe(true);
    },
  );
});

// ── 🧬 突變紀錄(2026-09-03 實跑, 每發都還原並 `diff -q` 驗逐字相同)──────────
//  ① 在現行 migration 的 `v_reason_txt := v_detail;` 之後手動插一段 `RAISE EXCEPTION`
//     ⇒ (紅版時)3/3 全綠 ⇒ **證明本尺不是恆紅, 它釘的是不變式**
//  ② 前置條件那格:把 `HOLE_ANCHOR` 改成撈不到的字面 ⇒ **那一格紅, 而 `it.fails` 仍綠**
//     ⇒ 🎯 **兩種紅真的分得開**(而不是「尺壞了」被 `it.fails` 吞成綠)
//  ③ 兩格各弄紅一次、**人眼讀印出來的字** ⇒ 🔴 **而這一發抓到一個真的缺陷**:
//     `it.fails` 那格變紅時, vitest **只印 `Error: Expect test to fail`** ——
//     我原本寫在 `expect` 訊息裡的六行**一個字都沒出現**。
//     ⇒ ✅ 修法:把指示搬進**標題**(唯一會被印出來的地方), 並重跑突變①確認讀得到:
//        `× 🔴 洞還在。這一格變紅 = 那 475 行修好了 ⇒ 請把 it.fails 翻成正常的 it(不要 skip、不要刪)`
//     ⇒ 📌 **而前置條件那格相反 —— 它的訊息會完整印出來**(實測 ② 印了全部四行)。
//        🎯 **同一支檔裡兩格的訊息, 一格讀得到一格讀不到 —— 而那差別只有跑一次才看得見。**
//  ④ **[code-reviewer 抓到 nit 之後補的]** 尺原本只剝 `--`, 沒剝 `/* */`
//     ⇒ 修完之後**重跑①**(改了尺, 先前的突變證據當場作廢):真修法 ⇒ `it.fails` 仍然變紅 ✅
//     ⇒ ✅ 而**新增一發負對照**:把那段 `RAISE EXCEPTION` 藏進 `/* */` 裡
//        ⇒ **仍然綠**(= 尺不再把註解讀成「擋住了」)⇒ 🎯 **假的「洞補好了」訊號被堵住。**
