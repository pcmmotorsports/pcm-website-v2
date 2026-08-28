/**
 * rpm-partial-report 的驗收。
 *
 * 🔴 **這支測試證的是【單元層】的「行為沒變」** —— 餵一個會 throw 的假 syncFn 時,
 *    流程與修前相同。**它證不到「真的連 DB 跑一次時相同」**(主視窗 2026-08-28 拍 `Q1=乙`)。
 *    缺的檢查 = 起拋棄式 PG 實跑一次。
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import {
  formatAtomicPartialWrite,
  runAtomicGroups,
  type AtomicPartialWrite,
} from './rpm-partial-report';

const G = (id: string) => ({ externalId: id });
const GROUPS = [G('a'), G('b'), G('c'), G('d')];

describe('runAtomicGroups:成功路徑【行為與修前逐字相同】', () => {
  it('🔴 全部成功 ⇒ 每一群都跑到、順序相同、report 一次都沒被叫', async () => {
    const seen: string[] = [];
    const report = vi.fn();
    await runAtomicGroups(GROUPS, 'gilles', async (g) => {
      seen.push(g.externalId);
    }, report);
    // 修前那個裸迴圈做的就是這件事:逐群、照順序、跑完。
    expect(seen).toEqual(['a', 'b', 'c', 'd']);
    // 🔴 這一格才證得了「catch 沒有偷偷改變正常流程」:成功路徑【零額外輸出】。
    expect(report).not.toHaveBeenCalled();
  });

  it('空清單 ⇒ 不跑、不報(而不是報一個 0/0/0)', async () => {
    const report = vi.fn();
    const syncOne = vi.fn();
    await runAtomicGroups([], 'gilles', syncOne, report);
    expect(syncOne).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });
});

describe('runAtomicGroups:失敗路徑【錯誤原封丟回、不包裝】', () => {
  const boom = new Error('sync_product_variant_group: variant row 含非白名單欄');

  it('🔴 丟回來的【就是同一顆錯誤物件】—— 型別、message、identity 全同', async () => {
    await expect(
      runAtomicGroups(GROUPS, 'gilles', async (g) => {
        if (g.externalId === 'b') throw boom;
      }, vi.fn()),
    ).rejects.toBe(boom); // 🔴 toBe 不是 toThrow:證的是【同一顆】,不是「有丟東西出來」
  });

  it('🔴 message 逐字相同(一個被包了一層的錯誤, 在「有沒有紅」上一樣, 而上游判讀不一樣)', async () => {
    const caught = await runAtomicGroups(GROUPS, 'gilles', async (g) => {
      if (g.externalId === 'b') throw boom;
    }, vi.fn()).catch((e: unknown) => e);
    expect((caught as Error).message).toBe(
      'sync_product_variant_group: variant row 含非白名單欄',
    );
  });

  it('🔴 失敗之後【不再往下跑】—— 這是修前的行為, 不得變成「跳過並繼續」', async () => {
    const seen: string[] = [];
    await runAtomicGroups(GROUPS, 'gilles', async (g) => {
      seen.push(g.externalId);
      if (g.externalId === 'b') throw boom;
    }, vi.fn()).catch(() => undefined);
    expect(seen).toEqual(['a', 'b']); // c / d 從來沒有被送出去
  });

  it('🔴 三份名單是【列舉】出來的, 不是算出來的', async () => {
    const report = vi.fn();
    await runAtomicGroups(GROUPS, 'gilles', async (g) => {
      if (g.externalId === 'b') throw boom;
    }, report).catch(() => undefined);
    expect(report).toHaveBeenCalledTimes(1);
    const r = report.mock.calls[0]![0] as AtomicPartialWrite;
    expect(r.total).toBe(4);
    expect(r.done).toEqual(['a']);
    expect(r.failed).toBe('b');
    expect(r.notRun).toEqual(['c', 'd']); // ← 名字, 不是數字 2
    expect(r.failedMessage).toBe('sync_product_variant_group: variant row 含非白名單欄');
    expect(r.supplierSlug).toBe('gilles');
  });

  it('第一群就失敗 ⇒ done 是空的、notRun 是其餘全部(邊界)', async () => {
    const report = vi.fn();
    await runAtomicGroups(GROUPS, 'gilles', async () => {
      throw boom;
    }, report).catch(() => undefined);
    const r = report.mock.calls[0]![0] as AtomicPartialWrite;
    expect(r.done).toEqual([]);
    expect(r.notRun).toEqual(['b', 'c', 'd']);
  });

  it('最後一群失敗 ⇒ notRun 是空的(邊界:不得變成 -1 或 undefined)', async () => {
    const report = vi.fn();
    await runAtomicGroups(GROUPS, 'gilles', async (g) => {
      if (g.externalId === 'd') throw boom;
    }, report).catch(() => undefined);
    const r = report.mock.calls[0]![0] as AtomicPartialWrite;
    expect(r.done).toEqual(['a', 'b', 'c']);
    expect(r.notRun).toEqual([]);
  });
});

describe('formatAtomicPartialWrite:那四個數與三份名單', () => {
  const base: AtomicPartialWrite = {
    supplierSlug: 'gilles',
    total: 4,
    done: ['a'],
    failed: 'b',
    failedMessage: '壞掉了',
    notRun: ['c', 'd'],
  };

  it('印出 N / M / K 與兩份名單', () => {
    const t = formatAtomicPartialWrite(base).join('\n');
    expect(t).toContain('成功 N        1');
    expect(t).toContain('失敗 M        1   b');
    expect(t).toContain('未執行 K      2');
    expect(t).toContain('已成功的群:a');
    expect(t).toContain('未執行的群:c d'); // ← 名字進得去畫面
    expect(t).toContain('壞掉了');
  });

  it('🔴 講清楚它【不是整批回捲】—— 這句是這片存在的理由', () => {
    expect(formatAtomicPartialWrite(base).join('\n')).toContain('不是整批回捲');
  });

  it('🔴 正向對照:數字對得上時【不得】出現自檢紅旗', () => {
    // 少了這一格,下一格的 toContain 可能只是「那句話永遠都在」。
    expect(formatAtomicPartialWrite(base).join('\n')).not.toContain('自檢失敗');
  });

  it('🔴 N+M+K 對不上分母 ⇒ 出聲(而它是【自檢】, 不是 K 的來源)', () => {
    // total 被餵成 99:K 仍然是 notRun.length=2(列舉的、沒有變),而自檢要紅。
    const t = formatAtomicPartialWrite({ ...base, total: 99 }).join('\n');
    expect(t).toContain('未執行 K      2'); // ← K 沒有跟著 total 動 ⇒ 它不是減出來的
    expect(t).toContain('自檢失敗');
    expect(t).toContain('N+M+K = 4 ≠ 總數 99');
  });

  it('空名單印「(無)」而不是空字串(否則那一行讀起來像資料掉了)', () => {
    const t = formatAtomicPartialWrite({ ...base, done: [], notRun: [] }).join('\n');
    expect(t).toContain('已成功的群:(無)');
    expect(t).toContain('未執行的群:(無)');
  });
});

/**
 * 🔴🔴 codex 2026-08-28 must-fix:上面每一格都只直測 helper ——
 * **就算 `rpm-import.ts` 根本沒有接上 `runAtomicGroups`,整套照樣全綠。**
 * 📌 那正是今天一整天在記的那個病(`guard-and-instrument-traps.md` ⑩-a):
 *    **尺沒有接上目標,而它印出一個乾淨的綠。**
 * ⇒ 這一節錨在【原始碼字面】,因為 `rpm-import.ts` 一被 import 就會跑 `main()`、測不進去。
 */
describe('🔴 接線守門:rpm-import.ts 真的用了這支,而且不是留著舊的裸迴圈', () => {
  const SRC = readFileSync(new URL('./rpm-import.ts', import.meta.url), 'utf8');

  it('正對照:讀得到那支檔而且不是空的(否則下面三格全是恆真)', () => {
    expect(SRC.length).toBeGreaterThan(1000);
    expect(SRC).toContain('syncVariantGroupAtomic'); // 已知一定在
  });

  it('有 import 這支模組', () => {
    expect(SRC).toContain("from './rpm-partial-report'");
  });

  it('有真的呼叫 runAtomicGroups', () => {
    expect(SRC).toContain('runAtomicGroups(');
  });

  it('🔴 舊的裸迴圈【不得】還留著(留著=兩條路,而只有一條有留痕)', () => {
    expect(SRC).not.toContain('for (const group of variantWork.atomicGroups)');
  });

  it('🔴 餵進去的必須是【那個真陣列】—— 不然 runAtomicGroups([], …) 三格照樣全綠(codex R2 must-fix)', () => {
    // 📌 「有呼叫它」與「餵對了東西給它」是兩個宣稱, 而上面三格只證了第一個。
    //    餵空陣列 ⇒ 一群都不會跑, 而字面斷言完全看不出來。
    expect(SRC).toContain('runAtomicGroups(variantWork.atomicGroups,');
  });

  it('🔴 供應商 slug 也要餵對(同族:餵一個字面常數也會全綠)', () => {
    expect(SRC).toContain('runAtomicGroups(variantWork.atomicGroups, config.supplierSlug,');
  });
});

describe('🔴 留痕本身失敗時,原本的錯誤照樣往上丟(codex must-fix)', () => {
  const boom = new Error('原本那顆');

  it('report 自己拋 ⇒ 丟出去的仍然是【原本那顆】,不是 reporter 的那顆', async () => {
    const caught = await runAtomicGroups(GROUPS, 'gilles', async () => {
      throw boom;
    }, () => {
      throw new Error('reporter 自己爆了');
    }).catch((e: unknown) => e);
    expect(caught).toBe(boom); // ← 沒有這一格, reporter 的錯會【取代】原錯而沒有人發現
  });

  it('錯誤物件連字串化都會拋 ⇒ 不會炸掉留痕,也不會換掉原錯', async () => {
    const nasty = { toString() { throw new Error('連 toString 都拋'); } };
    const report = vi.fn();
    const caught = await runAtomicGroups(GROUPS, 'gilles', async () => {
      throw nasty;
    }, report).catch((e: unknown) => e);
    expect(caught).toBe(nasty);
    expect(report).toHaveBeenCalledTimes(1);
    // ⚠️ 這個期望值 2026-08-28 改過一次:codex R2 指出 `e.message` 也可能是會拋的 getter,
    //    ⇒ safeMessage 的 fallback 文案從「連字串化都會拋」改成「連取訊息都會拋」(涵蓋兩條路)。
    //    🔴 **改的是【碼的文案】,不是把一個紅的期望值調成綠** —— 行為(降級、不換掉原錯)沒有放寬。
    expect((report.mock.calls[0]![0] as AtomicPartialWrite).failedMessage).toContain('連取訊息都會拋');
  });
});

/**
 * 🔴🔴 **「零行為改動」的證據**(主視窗 2026-08-28 條件 1:要證據不是那四個字)。
 * 做法:把**修前那個裸迴圈**照抄成 `beforeLoop`,與 `runAtomicGroups` 餵**同一組輸入**,逐字比。
 * ⚠️ 天花板:這是**單元層**的等價 —— 兩者都餵假的 `syncOne`。
 *    **沒有證「真的連 DB 跑一次時相同」**(主視窗拍 `Q1=乙`)。缺的檢查 = 起拋棄式 PG 實跑一次。
 */
async function beforeLoop<G extends { externalId: string }>(
  groups: readonly G[],
  syncOne: (g: G) => Promise<void>,
): Promise<void> {
  // 逐字照抄修前的形狀(git show HEAD:scripts/rpm-import.ts 的 atomic 迴圈)
  for (const group of groups) {
    await syncOne(group);
  }
}

describe('🔴 零行為改動:修前的裸迴圈 vs 修後,同一組輸入', () => {
  it('成功路徑:輸出【逐字、逐行、同順序】相同', async () => {
    const outA: string[] = [];
    const outB: string[] = [];
    await beforeLoop(GROUPS, async (g) => {
      outA.push(`  product_variants atomic:${g.externalId} 3/3`);
    });
    await runAtomicGroups(GROUPS, 'gilles', async (g) => {
      outB.push(`  product_variants atomic:${g.externalId} 3/3`);
    }, vi.fn());
    expect(outB).toEqual(outA);
    expect(outB.join('\n')).toBe(outA.join('\n')); // 逐字
  });

  it('失敗路徑:丟出去的是【同一顆】、message 逐字相同、跑到的群也相同', async () => {
    const boom = new Error('sync_product_variant_group: variant row 含非白名單欄');
    const seenA: string[] = [];
    const seenB: string[] = [];
    const eA = await beforeLoop(GROUPS, async (g) => {
      seenA.push(g.externalId);
      if (g.externalId === 'b') throw boom;
    }).catch((e: unknown) => e);
    const eB = await runAtomicGroups(GROUPS, 'gilles', async (g) => {
      seenB.push(g.externalId);
      if (g.externalId === 'b') throw boom;
    }, vi.fn()).catch((e: unknown) => e);
    expect((eB as Error).message).toBe((eA as Error).message); // message 逐字
    expect(eB).toBe(eA); // 同一顆物件
    expect(seenB).toEqual(seenA); // 停在同一群
  });
});
