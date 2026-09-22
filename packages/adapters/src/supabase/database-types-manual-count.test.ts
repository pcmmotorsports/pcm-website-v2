import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// database-types-manual-count.test.ts — `#525`:釘住 `database.types.ts` 檔頭的**手動校正計數**。
//
// 🔴🔴 **為什麼需要它**:那支檔的檔頭逐字自稱
//    「**本行是計數的唯一權威**;下方各段一律寫『見檔頭計數』、不再各自複述數字」——
//    **而全樹零守門在釘它。** 2026-08-16 `#525` 加了第 11 個函式,
//    **那一刻檔頭的「十個函式、共二十六處」當場變成假的**,而**沒有任何東西會紅**。
//    ⇒ 這正是 house 的機制優先律:**發現 AI 會犯的錯,第一選擇是把防護做成機制,不是寫規則文字。**
//
// 🔴 **它守的是「宣稱 vs 事實」,不是格式** ——
//    重 gen 之後有人重貼檔頭卻漏了新增那條、或加了新校正忘了改數字,這格都會紅。
//
// ⚠️ **它守不到的**(照實寫,免得被讀成「校正都對」):
//    · **不驗那些校正本身是否正確**(那要對正式庫 gen 一次才知道)
//    · **不驗 `| null` 補得對不對** —— 只數「宣稱幾處」與「列了幾條」對不對得上
//    · 條目若改用本檔不認得的措辭 ⇒ **本格會紅**(刻意:不認得就吵,不靜默略過)
const TYPES_PATH = join(__dirname, 'database.types.ts');

/** 中文數字 → 阿拉伯(1–99;本檔只需要這個範圍)。**不認得回 null,由呼叫端擲錯。** */
function cjkNumber(raw: string): number | null {
  const digit: Record<string, number> = {
    一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  };
  if (raw in digit) return digit[raw] ?? null;
  if (raw === '十') return 10;
  const m = /^(.?)十(.?)$/.exec(raw);
  if (m) {
    const tens = m[1] === '' ? 1 : (digit[m[1] ?? ''] ?? null);
    const ones = m[2] === '' ? 0 : (digit[m[2] ?? ''] ?? null);
    if (tens === null || ones === null) return null;
    return tens * 10 + ones;
  }
  return null;
}

describe('database.types.ts 檔頭的手動校正計數 = 實際條目', () => {
  const src = readFileSync(TYPES_PATH, 'utf8');

  /**
   * 檔頭那一行:「本體另有**十二個函式、共二十八處**手動校正」。
   *
   * 🔴 **先剝掉 `~~刪除線~~`,而那一步是 2026-08-24 夜補的**(codex R1 nit;姊妹閘
   *    `database-types-apply-state.test.ts` 早就有 `stripStruck`,**本檔漏了**)。
   *    失敗情境:有人照本 repo 慣例把整行劃掉、在下面重寫一行新的
   *    ⇒ 本正規式取**第一個**命中 = 那句**已經死掉的**話 ⇒ **釘住一個死數字而且全綠。**
   * ⚠️ 剝完若整行不見 ⇒ `header` 為 `null` ⇒ 下面前提格紅(fail-closed,刻意)。
   * ✅ **兩個世界當場表演過**(2026-08-24 夜):在檔頭插一行
   *    `~~本體另有**九個函式、共九處**手動校正~~` ⇒ 未剝時取到「九/九」⇒ 紅;
   *    剝了之後仍取到「十二/二十八」⇒ 綠。**尺是活的。**
   */
  const headerSrc = src.replace(/~~[\s\S]*?~~/g, '');
  const header = /本體另有\*\*(.+?)個函式、共(.+?)處\*\*手動校正/.exec(headerSrc);

  /** 圈號條目:`//   ① …` ~ `//   ㉟ …`
   * 🔴 **2026-09-06 擴到 ㉟** —— **同一夜兩條線各自撞到、各自寫了一段,兩段都留**
   *    (📌 這件事本身就是那一夜的教訓:兩個窗同時取到同一個編號 ⇒ `docs/patterns/traps-inbox/db-20260906n-…md`):
   *    · 線【資料】`-db`:本檔上一版逐字寫過「圈號只到 ⑳ ⇒ 第 21 條會被【靜默吸進】第 20 條」,
   *      而補條目那一刻它就到期了。🔬 症狀是量到的:擴之前那一發,`⑳` 那一條被判「錨有 2 個」。
   *    · 線【信】`mail`:字集由 `[①-⑳]` 延到 `[①-⑳㉑-㉟]`(理由與 apply-state 那支同一段:
   *      第 21 條對舊字集是隱形的)。
   *    ⚠️ Unicode 上 `⑳`=U+2473 而 `㉑`=U+3251 —— **不連續**,所以要寫成兩段而不是一段。*/
  // 2026-09-22 窗 shop-6:字集延到 ㊿ —— ㉟ 用完了(apply-state 那支同一段)。
  const entries = [...src.matchAll(/^\/\/ {3}([①-⑳㉑-㉟㊱-㊿])\s*(.*)$/gm)];

  it('🔴 前提:檔頭那一行與圈號條目都找得到(找不到 = 本守門瞎了,不是通過)', () => {
    // 🔴 **沒有這一格,下面每一格都會因為「兩邊都是 0」而恆真** ——
    //    那正是本檔要防的那類病的鏡像。
    expect(header, '檔頭計數那一行不見了(被重 gen 沖掉?)').not.toBeNull();
    expect(entries.length, '一條圈號條目都找不到 ⇒ 正規式與檔案格式已脫節').toBeGreaterThan(0);
  });

  it('函式數:檔頭宣稱 = 圈號條目數', () => {
    const claimed = cjkNumber(header?.[1] ?? '');
    expect(claimed, `檔頭的函式數「${header?.[1]}」不是本檔認得的中文數字`).not.toBeNull();
    expect(claimed).toBe(entries.length);
  });

  it('🔴 校正處數:檔頭宣稱 = 逐條加總(措辭不認得就紅,不靜默略過)', () => {
    let sum = 0;
    for (const [, mark, rest] of entries) {
      // 每條的形狀只有兩種:`…**N處**(…` 或 `…**整段**(…`
      if (/\*\*整段\*\*/.test(rest ?? '')) {
        sum += 1;
        continue;
      }
      // 🔴🔴 **2026-09-18 修:原本是 `/\*?\*?(.)處\*?\*?/` —— `(.)` 只吃【一個字元】。**
      //    ⛔ ~~`const m = /\*?\*?(.)處\*?\*?/.exec(rest ?? '');`~~
      //    🔬 實測:`**十五處**` 被抽成 `'五'` ⇒ **少算 10 而兩邊都不會叫**
      //      (檔頭總數是人寫的, 人也會照著錯的加)。在本檔加入第一條兩位數條目那一刻才會現形。
      //    ⇒ 📌 **這把尺在「只有個位數」的世界裡看起來一直是對的** —— 那正是它最危險的地方。
      const m = /\*?\*?([一二兩三四五六七八九十]+)處\*?\*?/.exec(rest ?? '');
      const n = m ? cjkNumber(m[1] ?? '') : null;
      // 🔴 **不認得 ⇒ 擲錯,不是跳過** —— 跳過會讓總數少算而**兩邊剛好都變小**,
      //    那就是一個看起來正常的錯數字(本檔存在的理由本身)。
      expect(n, `條目 ${mark} 的校正處數措辭本檔不認得:「${(rest ?? '').slice(0, 40)}」`).not.toBeNull();
      sum += n ?? 0;
    }
    const claimed = cjkNumber(header?.[2] ?? '');
    expect(claimed, `檔頭的處數「${header?.[2]}」不是本檔認得的中文數字`).not.toBeNull();
    expect(sum).toBe(claimed);
  });

  // 🔴🔴 **⑲ 那一條宣稱「三處」, 而上面那一格【只數旁白, 不看型別】**(codex 2026-09-05 R1 nit)。
  //    ⇒ 刪掉 Row / Insert / Update 其中一處而旁白照樣寫「三處」⇒ **上面全綠。**
  //    ⇒ 📌 所以這一格是**另一把尺**:它去型別本體數那個欄名到底出現幾次。
  //    ⚠️ 射程:它只認得**這一個欄名**。其他手動校正沒有這道保險 —— 那是已知缺口, 不是漏寫
  //      (要做成通則得先有一份「條目 → 它改了哪些識別字」的對照, 而那份今天不存在)。
  // 🔵 **2026-09-06 ⟦mail-PROVMSGIDUI⟧ 把 ⑳ 的欄名也加進來**(R1 opus nit)——
  //    ⑳ 宣稱「三處」而上面那一格同樣只數旁白 ⇒ 刪掉 Row / Insert / Update 任一處照樣全綠。
  //    📌 這一格的射程仍然是「**它只認得【被列進下面那個陣列】的欄名**」——
  //       加一個欄名進去是一個陣列元素, 而**沒被加進來的手動校正照舊沒有這道保險**。
  it('🔴 ⑲ 說「六處」、⑳ 說「三處」⇒ 這三個欄名在型別本體裡各要真的有三處', () => {
    const src = readFileSync(TYPES_PATH, 'utf8');
    const body = src.slice(src.indexOf('export type Database'));
    for (const col of [
      'sent_tracking_number',
      'sent_tracking_recorded',
      'provider_message_id',
    ]) {
      const hits = body.match(new RegExp(col, 'g')) ?? [];
      expect(hits.length, `型別本體裡 ${col} 有 ${hits.length} 處, 而條目宣稱各三處`).toBe(3);
    }
    // 🔵 負對照:一個不存在的欄名要數到 0 ⇒ 證明這把尺不是恆真。
    expect((body.match(/zzz_not_a_column/g) ?? []).length).toBe(0);
  });

  it('正向對照:中文數字解析本身是活的(否則上面兩格可能因為恆 null 而互相遷就)', () => {
    expect(cjkNumber('三')).toBe(3);
    expect(cjkNumber('十')).toBe(10);
    expect(cjkNumber('十一')).toBe(11);
    expect(cjkNumber('二十七')).toBe(27);
    expect(cjkNumber('兩')).toBe(2);
    // 負向:不認得的要回 null,不能瞎猜一個數字
    expect(cjkNumber('壹佰')).toBeNull();
    expect(cjkNumber('')).toBeNull();
  });

  // ──────────────────────────────────────────────────────────────────────
  // 🔴🔴 **2026-09-18 新增:檔頭清單 ↔ `scripts/regen-types-merge.py` 的 `TARGETS` 對帳。**
  //
  // **為什麼需要它**:2026-09-17 實查 —— 檔頭列了 **20 個函式名**,而 `TARGETS` 只有 **10 個**
  //    ⇒ 另外 10 個名字的校正**重 gen 時不會被貼回去,也不會有任何東西叫**。
  //    上面那幾格數的是「檔頭宣稱 vs 檔頭條目」—— **兩邊都在同一個檔裡** ⇒ 它們**看不到**
  //    「這條校正到底有沒有人在保護」。這一格是**跨檔**的那把尺。
  //
  // ⚠️ **它守不到的**(照實寫):
  //    · 不驗 `TARGETS` 裡那些名字**貼回去得對不對** —— 那要對正式庫 gen 一次
  //    · 🔴 **不驗「根本沒被記進檔頭」的校正** —— 2026-09-18 實測到一條:
  //      `admin_soft_delete_order_note.p_reason` 的 `| null` 是真校正,而它**檔頭與 `TARGETS`
  //      兩邊都沒有** ⇒ 本格對它**完全瞎**。要守那個形狀得換一把尺(產物與 repo 的 `Args` 逐行比)。
  //      📌 **本格守的是「記了但沒進 TARGETS」,不是「根本沒記」。**
  const MERGER_PATH = join(__dirname, '..', '..', '..', '..', 'scripts', 'regen-types-merge.py');

  /** 從型別檔檔頭抽編號條目的函式名。**純函式** —— 為了讓下面的負對照餵得進動過手腳的輸入。 */
  function headerFnNames(typesSrc: string): string[] {
    return [...typesSrc.matchAll(/^\/\/ {3}[①-⑳㉑-㉟㊱-㊿] `([a-z_][a-z0-9_]*)/gm)].map((m) => m[1] ?? '');
  }

  /** 從合併器抽 `TARGETS` 的名字。**純函式**,同上。 */
  function mergerTargets(pySrc: string): string[] {
    const block = /TARGETS = \[([\s\S]*?)\]/.exec(pySrc);
    if (!block) return [];
    return [...(block[1] ?? '').matchAll(/'([a-z_][a-z0-9_]*)'/g)].map((m) => m[1] ?? '');
  }

  /**
   * 對帳本體。回傳兩個方向的差集。
   * 🔵 `email_outbox` **刻意排除** —— 它是**表**不是函式,合併器結構上處理不了
   *    (放進 `TARGETS` 只會得到一個 STOP)。理由與退場條件見那份 plan §4-3。
   */
  function reconcile(typesSrc: string, pySrc: string): {
    inHeaderNotInTargets: string[];
    inTargetsNotInHeader: string[];
  } {
    const EXCLUDED = new Set(['email_outbox']);
    const header = new Set(headerFnNames(typesSrc).filter((n) => !EXCLUDED.has(n)));
    const targets = new Set(mergerTargets(pySrc));
    return {
      inHeaderNotInTargets: [...header].filter((n) => !targets.has(n)).sort(),
      inTargetsNotInHeader: [...targets].filter((n) => !header.has(n)).sort(),
    };
  }

  it('🔴 前提:兩邊都抽得到東西(抽到 0 個 ⇒ 下面那格會因為空集合相等而恆真)', () => {
    const py = readFileSync(MERGER_PATH, 'utf8');
    expect(headerFnNames(src).length, '檔頭一個函式名都抽不到 ⇒ 正規式與檔案格式脫節').toBeGreaterThan(0);
    expect(mergerTargets(py).length, 'TARGETS 一個名字都抽不到 ⇒ 正規式與腳本格式脫節').toBeGreaterThan(0);
  });

  it('🔴 檔頭清單 ↔ TARGETS 零差集(有校正卻沒人保護 = 重 gen 那天會靜靜不見)', () => {
    const py = readFileSync(MERGER_PATH, 'utf8');
    const r = reconcile(src, py);
    expect(
      r.inHeaderNotInTargets,
      `這幾支檔頭記了校正、而 TARGETS 沒有 ⇒ 重 gen 會把它們的校正沖掉:${r.inHeaderNotInTargets.join(', ')}`,
    ).toEqual([]);
    expect(
      r.inTargetsNotInHeader,
      `這幾支在 TARGETS 裡、而檔頭沒有對應條目 ⇒ 檔頭漏記或名字打錯:${r.inTargetsNotInHeader.join(', ')}`,
    ).toEqual([]);
  });

  it('🔵 負對照:動過手腳的輸入【必須】紅,而且要講得出是哪一支', () => {
    const py = readFileSync(MERGER_PATH, 'utf8');

    // 負① 從 TARGETS 抽掉一支 ⇒ 要被指名
    const pyMinus = py.replace("    'admin_cancel_order',\n", '');
    expect(pyMinus, 'TARGETS 裡找不到 admin_cancel_order ⇒ 這個負對照本身失效了').not.toBe(py);
    expect(reconcile(src, pyMinus).inHeaderNotInTargets).toEqual(['admin_cancel_order']);

    // 負② 檔頭加一條假的 ⇒ 要被指名
    const srcPlus = `${src}\n//   ㉖ \`zzz_fake_rpc\` 一處(假的, 只活在這個測試裡)\n`;
    expect(reconcile(srcPlus, py).inHeaderNotInTargets).toEqual(['zzz_fake_rpc']);

    // 負③ TARGETS 多一支檔頭沒有的 ⇒ 要從另一個方向被指名
    const pyPlus = py.replace('TARGETS = [\n', "TARGETS = [\n    'zzz_orphan_target',\n");
    expect(reconcile(src, pyPlus).inTargetsNotInHeader).toEqual(['zzz_orphan_target']);

    // 🔵 正對照:原樣進去要兩邊都空 —— 否則上面三格可能只是「永遠有差」
    expect(reconcile(src, py)).toEqual({ inHeaderNotInTargets: [], inTargetsNotInHeader: [] });
  });
});
