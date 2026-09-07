import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SHIPMENT_BLOCK_CODES,
  SHIPMENT_BLOCK_COPY,
  parseShipmentError,
  type ShipmentBlockCode,
} from './shipment-error-view';

// shipment-error-view.test.ts — #351 ① 的守門。
//
// 🔴🔴 **第一版的守門是錯的,錯法值得記**(code-reviewer 2026-08-10 擊破):
//    我寫的是「migration 裡每個 P2B2x 碼,表裡都要有文案」,而那條斷言的正規式字母表
//    (`P2B2\d|P2B30`)**恰好等於碼表自己的字母表** ⇒ 它只發現得了「家族內漏抄」,
//    對**表以外的新碼**零判別力。實錘:`P2B02` 在本線三支 RPC 都是執行期 raise、不在表裡,
//    兩格照樣全綠(實跑 18 passed)。
//
// 🔴 **而且那條斷言的方向本來就錯了**:白話層是**刻意的子集**(檔頭整段在講為什麼),
//    不是「必須涵蓋全部」。要求全覆蓋正是逼出第一版那 8 條錯文案的壓力來源。
//    ⇒ 本檔改成守**表裡的每一條都站得住**:一碼一義 + 真的會在執行期丟出來。

const MIG_DIR = join(__dirname, '..', '..', '..', '..', '..', 'supabase', 'migrations');

function allMigrationSql(): string {
  return readdirSync(MIG_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(MIG_DIR, f), 'utf8'))
    .join('\n');
}

/** 某個碼在 migration 裡對應到的 constraint 名集合。 */
function constraintsOf(code: string): Set<string> {
  const out = new Set<string>();
  const re = new RegExp(`ERRCODE\\s*=\\s*'${code}'\\s*,\\s*CONSTRAINT\\s*=\\s*'([a-z0-9_]+)'`, 'g');
  for (const m of allMigrationSql().matchAll(re)) out.add(m[1]!);
  return out;
}

describe('#351 ① 守門 1:表裡的每一條都站得住', () => {
  /**
   * ⟦mail-ITEACHSHRINK⟧ **這個 `it.each` 的分母來自【被測物自己】** ——
   * 拿掉 `SHIPMENT_BLOCK_CODES` 的一項, 它**只是少跑一格, 全綠**(板列有實錘)。
   * ✅ 一格寫死的長度**兩個方向都擋得住**(2026-09-07 `-mail` 在 `receipt-repository` 實測:
   *    少一項 ⇒ 紅 1 · 多一項 ⇒ 紅 1 · 沒有這一格而少一項 ⇒ **rc=0 全綠**)。
   * 🔴 **`1` 必須寫死** —— 從 `SHIPMENT_BLOCK_CODES.length` 取就是拿它驗它自己, 那一格恆綠。
   * ⚠️ 它擋的是【項數】不是【成員】:換掉一項換成另一項, 長度不變 ⇒ 這一格不會叫。
   *
   * ⚠️ **它答什麼 / 答不出什麼**(2026-09-07 A 派補齊):
   *   **答**:`SHIPMENT_BLOCK_CODES` 的**項數變了**(增或刪, 兩個方向都會紅)。
   *   **答不出**:① **成員換掉**(A 換成 B, 長度不變)② 那些成員的**值對不對**
   *     ③ 那個常數與**正式庫的封閉集**對不對得上(那要另一把尺)。
   * 🟢 ⛔ ~~**一個會讓它假綠的世界**:有人**同時**刪一項、加一項 ⇒ 長度不變 ⇒ 它一聲都不吭~~
   *   🟢 **[2026-09-07 當天關掉了]** 這一格已從【釘長度】升級成【釘成員】
   *   ⇒ 換一項**會紅**(實測:各餵一發「刪一項 + 加一項」, 三支都紅在這一格)。
   * 🔴 **而【還沒關掉】的是這個, 寫成一個問句**:
   *   ❓ **「這份寫死的成員, 與【正式庫那一側的封閉集】現在還對得上嗎?」**
   *   🛑 這一格答不出它 —— 右邊是**測試裡的一份靜態清單**, 兩邊各自改, 它**不會叫**。
   *   ⏰ **什麼時候要回來讀這一段(綁時點, 不是綁心情)**:
   *     **有人改動 出貨阻擋碼那支 RAISE 那一側的定義(CHECK / enum / RAISE 的碼)的那一趟。**
   *     ⇒ 那一趟請當場回答上面那個問句;答不出來就別假設它還對。
   *   ✅ **關得掉它的形狀**:右邊換成一個**會自己長大的全集**
   *     (例 `Record<Union, …>` —— union 加一個成員, TypeScript 逼你補;
   *      做法見 `packages/adapters/src/email/SupabaseEmailOutboxAdapter.test.ts`)。
   * 🔵 **本檔有【兩處】`it.each(SHIPMENT_BLOCK_CODES)`, 而這一格只放一次** ——
   *    同一個常數放兩份 N = 兩個要維護的數字, 而它們會漂開。
   */
  it('⟦mail-ITEACHSHRINK⟧ SHIPMENT_BLOCK_CODES 成員逐一釘死 —— 增 / 刪 / 換都要有人看見', () => {
    /**
     * 🔴🔴 **[2026-09-07 從【釘長度】升級成【釘成員】]** —— 主視窗 B 裁。
     * ⛔ ~~`expect(SHIPMENT_BLOCK_CODES).toHaveLength(1);`~~
     *    🛑 那擋不住「**同時刪一項、加一項**」:長度不變 ⇒ 一聲都不吭, 而 `it.each` 的格數也不變。
     *    (那正是這一格自己「答不出什麼」那一段寫過的假綠世界 —— 現在把它關掉。)
     * 🔴 **右邊這份成員【寫死在測試裡】**, 與被測物是兩份東西 ⇒ 改任一邊都會紅。
     *    ⚠️ 代價:**加一個碼要改兩個地方** —— 而那正是要的(那是一次要被看見的改動)。
     * 🔵 排序後比 —— 順序不是這一格要守的東西。
     */
    expect([...SHIPMENT_BLOCK_CODES].sort()).toEqual([
      'P2B27',
    ]);
  });

  it.each(SHIPMENT_BLOCK_CODES)('%s 真的會被 RAISE 出來(不是我照碼名想像的)', (code) => {
    // 🔴 只認**帶 CONSTRAINT 的 RAISE 形狀** —— 那是函式體裡丟給呼叫端的樣子。
    //    (第一版把 migration **套用期**的 `DO $$` 閘也算進去,於是把一個員工永遠看不到的碼
    //     收進表裡、還配了一段編造的人話。)
    expect(constraintsOf(code).size, `${code} 在 migration 裡找不到帶 CONSTRAINT 的 RAISE`).toBeGreaterThan(0);
  });

  it('🔴 表裡的碼必須**一碼一義**(否則一句文案蓋不住)', () => {
    // 🔴 這格是第一版最大的錯的直接守門:`P2B26` 有 **24 個** constraint,
    //    我卻只寫了「物流方式不認得」一句 ⇒ 對 20+ 個成因是錯的。
    //    判準:該碼的所有 constraint 名要共享同一個語意錨(這裡用「都含同一個關鍵詞」近似)。
    //    ⚠️ 誠實邊界:這是**近似判準**,不是語意證明;它擋得住 P2B26 那種一碼 24 義,
    //    擋不住「兩個 constraint 名字像、語意其實不同」。真正的把關仍是人去讀 migration。
    for (const code of SHIPMENT_BLOCK_CODES) {
      const names = [...constraintsOf(code)];
      expect(names.length, `${code} 沒有 constraint`).toBeGreaterThan(0);
      const shared = names.every((n) => n.includes('exceeds_instock'));
      expect(shared, `${code} 的 constraint 語意不一致:${names.join(', ')}`).toBe(true);
    }
  });

  it('🔴 P2B26 這種共用碼**不得**進表(拿實際的反例當守門)', () => {
    // 它有 24 個 constraint;任何人把它加進表 = 一句文案對 20+ 個成因說謊。
    expect(constraintsOf('P2B26').size).toBeGreaterThan(5);
    expect(SHIPMENT_BLOCK_CODES as readonly string[]).not.toContain('P2B26');
  });

  it('🔴 P2B29 不得進表:它的訊息是 DB 產的**人話**,蓋掉它就是把唯一寫對的指示藏起來', () => {
    expect(allMigrationSql()).toContain('pcm_b2_shipping_human_error');
    expect(SHIPMENT_BLOCK_CODES as readonly string[]).not.toContain('P2B29');
  });
});

describe('#351 ① 守門 2:文案品質(Sean 抱怨的正是這件事)', () => {
  it.each(SHIPMENT_BLOCK_CODES)('%s 的兩句都不是空的', (code) => {
    const c = SHIPMENT_BLOCK_COPY[code as ShipmentBlockCode];
    expect(c.what.length).toBeGreaterThan(5);
    expect(c.next.length).toBeGreaterThan(5);
  });

  it('🔴 人話裡不得出現代碼 / 表名 / 欄名(那些收進「詳細」)', () => {
    for (const code of SHIPMENT_BLOCK_CODES) {
      const c = SHIPMENT_BLOCK_COPY[code as ShipmentBlockCode];
      const joined = `${c.what}${c.next}`;
      expect(joined, `${code} 的人話裡出現了代碼`).not.toMatch(/P2B\d\d/);
      expect(joined, `${code} 的人話裡出現了表名/欄名`).not.toMatch(/pcm_b2_|shipment_items|order_item/);
    }
  });

  it('🔴 P2B27 的公式與 migration 逐字一致(員工靠它算該調成多少)', () => {
    // migration `20260807180000:230`:instock − shipped − pending(pending 含本箱)。
    const what = SHIPMENT_BLOCK_COPY.P2B27.what;
    expect(what).toContain('已到貨');
    expect(what).toContain('已出貨');
    expect(what).toContain('還沒出貨的箱');
  });
});

describe('#351 ① 守門 3:不覆蓋的碼一律原文照吐', () => {
  it('表裡的碼 → 給文案,且原文照樣帶著', () => {
    const parsed = parseShipmentError('P2B27', 'DB 原文含數字');
    expect(parsed.copy?.what).toContain('可出貨');
    expect(parsed.raw).toBe('DB 原文含數字');
  });

  it.each(['P2B26', 'P2B29', 'P2B02', 'P2B20', '23505'])(
    '🔴 不覆蓋的碼 %s → copy=null 且**原文不得被吃掉**',
    (code) => {
      const parsed = parseShipmentError(code, '原文');
      expect(parsed.copy).toBeNull();
      expect(parsed.raw).toBe('原文');
    },
  );

  it('code=null(傳輸層失敗 / 本層自己的拒絕)→ 原文照吐', () => {
    expect(parseShipmentError(null, '斷線了').copy).toBeNull();
    expect(parseShipmentError(null, '斷線了').raw).toBe('斷線了');
  });
});
