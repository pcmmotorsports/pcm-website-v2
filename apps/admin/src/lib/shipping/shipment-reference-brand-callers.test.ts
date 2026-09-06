import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ⟦ship-EPINOBRAND⟧ 的**呼叫端白名單** —— 誰可以把一個字串變成「箱號」。
//
// ══ 它守什麼(先讀這段)══════════════════════════════════════════════════
// 送新竹的 `epino` 吃的是**箱號**(`shipment_reference`), 而**訂單編號與箱號在字串上一模一樣** ——
// `20260729010000_m4b_e10_d0_display_id_expand.sql` 的 COMMENT 逐字說那是
// 「過渡狀態 —— N3c 會在收窗後把本約束收緊成**新格式 only**」
// ⇒ 🛑 **字串碰撞是設計上的【終局】, 不是今天的過渡 ⇒ 格式層【永遠】分不出來。**
//
// ✅ **型別層那一半已經做了**(`fc2ec85e2`):`ShipmentReference` 是 branded type,
//    而 `buildHctTransData` 只收打過標的(`hct-trans-data.ts` 逐字 `shipmentReference: ShipmentReference;`)。
// 🔴 **而殘的那一半就是本檔**:打標那支 `toShipmentReference` 從 `@pcm/domain` **全域匯出**
//    (`packages/domain/src/index.ts` 逐字 `export { toShipmentReference } from './shared/types';`)
//    ⇒ **誰都叫得到** ⇒ 有人寫 `toShipmentReference(detail.displayId)` 就繞過去了,
//    而 typecheck 全綠、格式閘也過(兩者字串同構)。
//    ⇒ 🎯 **那正是這條線記過的失敗形狀:「下一個人【照名字把它修好】」。**
//
// ══ 🛑🛑 天花板 —— 寫在這裡, 不要把本檔讀得比它做的多 ══════════════════
// · ✅ 擋得住:**新增**一個不在白名單上的呼叫端(= 上面那個現實路徑)。
// · ❌ 擋不住:白名單上那幾支**其中一支被改成餵訂單編號** —— 檔案還是同一支, 本檔全綠。
// · ❌ 擋不住:**還沒 `git add` 的新檔** —— `git grep` 只看得到 git 追蹤到的檔。
// · 🔴 **真正密的那一道**(讓 constructor 只有 repository 叫得到)要動共用型別的匯出面
//   ⇒ 命中鐵則 8(跨 3+ 檔 + 共用型別)⇒ 要 plan 等批。
//   **升級條件(主視窗 `-f8` 2026-09-06 裁)= 白名單外真的出現一處。** 在那之前不開那條 plan。
//
// ⚠️ **本檔比的是【檔案集合】, 不是命中次數** —— 理由是量到的:
//    `shipment-actions.ts` 今天有 **2** 個命中, 而其中一個在**註解**裡
//    (`:401` 那段解釋「它在這裡的角色是信任邊界上的驗證」)。
//    ⇒ 📌 `grep` 對「**提到**它」與「**呼叫**它」是同一件事(本 repo 記過這個坑)
//      ⇒ 拿次數當判準的話, **改一句註解就會紅**, 而它會被當成雜訊關掉。

const REPO = join(__dirname, '../../../../..');
const DEF_FILE = 'packages/domain/src/shared/types.ts';

/** 允許把字串變成箱號的檔 —— **每一支都要寫得出理由**。 */
const ALLOWED: readonly string[] = [
  // 讀 `shipments` 那一列之後打標 —— 這是這個型別存在的本意(4 個 mapper)。
  'apps/admin/src/lib/shipping/shipment-repository.ts',
  // 🔴 **唯一的非 repository 呼叫端, 而它是刻意的**:那支 action 收的是**使用者送來的**箱號,
  //    `toShipmentReference()` 在那裡的角色是**信任邊界上的驗證**(該檔 `:401` 那段註解逐字寫著)。
  //    ⇒ 它不是漏網, 是一個有理由的例外 —— 而寫在這裡是為了讓下一個人**看得到那個理由**。
  'apps/admin/src/lib/shipping/shipment-actions.ts',
];

/** 用 `git grep` 找呼叫端(排除定義檔與測試檔)。 */
function callerFiles(needle: string): string[] {
  let out = '';
  try {
    out = execFileSync(
      'git',
      ['grep', '-l', '--', needle, 'apps/*.ts', 'apps/*.tsx', 'packages/*.ts', 'packages/*.tsx'],
      { cwd: REPO, encoding: 'utf8' },
    );
  } catch {
    // 🔴 `git grep` 零命中時 **exit 1** ⇒ 那不是錯誤, 是「沒有」。
    //    ⚠️ 而它與「git 壞了」在這裡印同一個東西 ⇒ 所以下面有一格分母守門。
    return [];
  }
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && l !== DEF_FILE && !l.includes('.test.'));
}

describe('⟦ship-EPINOBRAND⟧ 誰可以把字串變成箱號 —— 量具自檢(排在目標斷言之前)', () => {
  it('前置:這棵樹真的是一個 git repo, 而白名單上那幾支檔真的存在', () => {
    expect(existsSync(join(REPO, '.git')), '不是 git repo ⇒ 下面每一格都會拿到空清單而全綠').toBe(true);
    for (const f of ALLOWED) {
      expect(existsSync(join(REPO, f)), `白名單上的 ${f} 不存在 ⇒ 這道守門的分母是假的`).toBe(true);
    }
    expect(existsSync(join(REPO, DEF_FILE)), `定義檔 ${DEF_FILE} 不見了 ⇒ 排除規則指向一個不存在的東西`).toBe(true);
  });

  it('🔵 正對照:這把尺對一個【已知一定在】的呼叫端要找得到', () => {
    // 拿白名單第一支當受測 —— 它若掉了, 代表尺沒接上(路徑錯 / pathspec 錯 / cwd 錯)。
    expect(
      callerFiles('toShipmentReference('),
      '連 repository 那支都沒撈到 ⇒ 這把尺沒接上, 下面的目標斷言什麼都沒證到',
    ).toContain(ALLOWED[0]);
  });

  it('🔵 負對照:一個【現造的】識別字必須回 0', () => {
    // 🔴 現造 = 不用任何寫過的字面(寫進檔案的量測紀錄會變成下一次的假命中)。
    expect(callerFiles('toShipmentRefQ7zNope(')).toEqual([]);
  });
});

describe('⟦ship-EPINOBRAND⟧ 誰可以把字串變成箱號 —— 目標斷言', () => {
  it('🔴 呼叫端只有白名單那幾支 —— 多一支就紅', () => {
    const found = callerFiles('toShipmentReference(').sort();
    const pinned = [...ALLOWED].sort();
    const extra = found.filter((f) => !pinned.includes(f));
    const gone = pinned.filter((f) => !found.includes(f));
    expect(
      extra,
      '有人在白名單外把字串變成【箱號】—— 而訂單編號與箱號在字串上一模一樣, ' +
        'typecheck 與格式閘【兩個都會放行】。⇒ 先確認那一處餵的到底是箱號還是訂單編號;' +
        '真的是箱號而且有理由 ⇒ 把它加進本檔 ALLOWED 並在旁邊寫下理由。' +
        '🔴 而白名單外真的出現一處 = ⟦ship-EPINOBRAND⟧ 的【升級條件】⇒ 回去開那條 plan。',
    ).toEqual([]);
    expect(
      gone,
      '白名單上這幾支不再呼叫它了 —— 確認是刻意退場之後, 把它從本檔 ALLOWED 移除(不要留著養一個假的分母)',
    ).toEqual([]);
  });
});
