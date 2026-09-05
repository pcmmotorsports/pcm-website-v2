import { describe, expect, it, vi } from 'vitest';
import {
  DENIED_GROUPS,
  deniedGroupMessage,
  findDeniedGroup,
} from './supplier-group-denylist';
import { readFileSync } from 'node:fs';
import { applyTitleGateSkip } from './title-shape-gate';
import { syncVariantGroupAtomic } from './rpm-load';

describe('不准上架名單', () => {
  it('🔴 在名單上 ⇒ 找得到那一筆', () => {
    const d = findDeniedGroup('rizoma', 'DM-PW101');
    expect(d).not.toBeNull();
    expect(d!.boardAnchor).toBe('⟦supply-RIZOMASPECWRONG⟧');
  });

  it('🔵 負對照:不在名單上 ⇒ null(證明它不是對誰都回非 null)', () => {
    expect(findDeniedGroup('rizoma', 'ZZQ-NOT-A-GROUP')).toBeNull();
    // 🔴 同群編號【別家】⇒ 也不該命中(名單認的是一對, 不是單一個 externalId)
    expect(findDeniedGroup('wrs', 'DM-PW101')).toBeNull();
  });

  it('🔴 訊息要印出【關閉條件】與【板列錨】—— 只說「不准」的閘會被繞過去', () => {
    const msg = deniedGroupMessage(DENIED_GROUPS[0]!);
    expect(msg).toContain('關閉條件');
    expect(msg).toContain('⟦supply-RIZOMASPECWRONG⟧');
    expect(msg).toContain('spec 與 sku 尾碼一致');
    expect(msg).toContain('不要改成「跳過這一群繼續跑」');
  });
});

describe('咽喉點:syncVariantGroupAtomic', () => {
  /** 🔴 這顆假 client 若被呼叫到就是【擋失敗】—— 它同時是斷言的一半。 */
  const spyClient = () => {
    // 🔴 回 0 是因為下面兩格都餵【空的 variants】—— 那支函式會比對
    //    「RPC 回傳筆數 == variants.length」, 回 1 會讓負對照因為【別的理由】紅,
    //    而那個紅看起來跟「擋住了」一模一樣。(我第一版就是這樣, 照實留。)
    const rpc = vi.fn(async () => ({ data: 0, error: null }));
    return { client: { rpc } as never, rpc };
  };

  it('🔴 名單上的群 ⇒ throw, 而且【一次都沒碰 DB】', async () => {
    const { client, rpc } = spyClient();
    await expect(
      syncVariantGroupAtomic(client, 'rizoma', 'DM-PW101', [], []),
    ).rejects.toThrow('不准上架名單');
    // 🔴 這一格是承重的:throw 得晚一點(RPC 已經送出去)也會讓上一行過
    expect(rpc).not.toHaveBeenCalled();
  });

  it('🔵 負對照:不在名單上的群 ⇒ 走到 RPC(證明擋的是名單, 不是全擋)', async () => {
    const { client, rpc } = spyClient();
    await syncVariantGroupAtomic(client, 'rizoma', 'ZZQ-FINE-GROUP', [], []);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});


/**
 * 🔴🔴 **兩條寫入路徑各一發正對照**(主視窗 2026-09-04 要求)。
 *
 * `products` 有兩條路, 而**走哪一條是【資料】決定的**:
 * ```
 * 一般群              rpm-import.ts:647  upsertBatched(target, 'products', …)
 * transition hazard 群 rpm-import.ts:749  syncVariantGroupAtomic()
 * ```
 * ⇒ 主要那道擋移到**兩條路的共同上游**(`productRows` / `variantsByExternalId`),
 *   而 `syncVariantGroupAtomic` 裡那道 throw **留著當第二道**。
 *
 * 🛑 **上游那一道【沒有直接的單元測試入口】** —— 它是 `rpm-import.ts` 的 `main()` 中段,
 *    跑它要一整套來源資料 + 一個 DB。
 *    ⇒ 這裡測的是**它用的那個移除函式**(`applyTitleGateSkip`, 與 titleGate 同一支)
 *      在餵進名單上的群時, 真的把它從三個集合裡都拿掉。
 *    ⇒ 📌 **而「那一行有沒有被呼叫」這一格靠的是【讀原始碼】那一發**(下面最後一格),
 *      形狀抄 `title-shape-gate.test.ts` 那個「讀本檔原始碼釘住順序」的先例。
 */
describe('不准上架名單:兩條寫入路徑', () => {
  it('🔴 路徑 A(共同上游)· 名單上的群要從 productRows / variants 兩邊都消失', () => {
    const rows = [
      { external_id: 'DM-PW101' },
      { external_id: 'KEEP-ME' },
    ];
    const byExt = new Map<string, { sku: string }[]>([
      ['DM-PW101', [{ sku: 'a' }]],
      ['KEEP-ME', [{ sku: 'b' }]],
    ]);
    const flat = [...byExt.values()].flat();
    const denied = rows
      .map((p) => findDeniedGroup('rizoma', p.external_id))
      .filter((d): d is NonNullable<typeof d> => d !== null);
    expect(denied).toHaveLength(1);
    applyTitleGateSkip(rows, byExt, flat, denied.map((d) => d.externalId));
    expect(rows.map((r) => r.external_id), '名單上的群還留在 productRows ⇒ 它會被 upsert 上去')
      .toEqual(['KEEP-ME']);
    expect(byExt.has('DM-PW101'), '變體沒跟著拿掉 ⇒ 會變成孤兒').toBe(false);
    expect(flat).toHaveLength(1);
  });

  it('🔴 路徑 B(咽喉點)· 第二道擋仍在, 而且一次都沒碰 DB', async () => {
    const rpc = vi.fn(async () => ({ data: 0, error: null }));
    await expect(
      syncVariantGroupAtomic({ rpc } as never, 'rizoma', 'DM-PW201', [], []),
    ).rejects.toThrow('不准上架名單');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('🔴 而 rpm-import 真的【呼叫了】那道上游擋 —— 讀原始碼釘住(形狀抄 title-shape-gate)', () => {
    const raw = readFileSync(new URL('./rpm-import.ts', import.meta.url), 'utf8');
    /**
     * 🔴🔴 **先剝行註解 —— 這一步是承重的, 不是整潔。**
     *   我第一版沒剝 ⇒ 那格紅了, 而**紅的理由是【我自己剛寫的那句註解】**:
     *   我在解釋兩條路的註解裡逐字引用了 `upsertBatched(target, 'products', …)`
     *   ⇒ `indexOf` 找到的是註解那一處(第 437 行), 不是真的呼叫(第 682 行)
     *   ⇒ 📌 **順序斷言拿註解的位置去比, 結論當場翻面。**
     *   🎯 今天第四次「註解被當成碼」(前三次:`external_id` 掃描 · `echo "::error::"` ·
     *      `SET search_path` 閘)⇒ **凡是拿字面位置當判準的尺, 都要先剝註解。**
     */
    const src = raw
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n');
    expect(raw, '沒 import ⇒ 上面那格測的是一個沒有人在用的函式').toContain(
      "from './supplier-group-denylist'",
    );
    expect(src).toContain('findDeniedGroup(config.supplierSlug, p.external_id)');
    // 🔴🔴 順序:擋必須在 sourceExternalIds 之【後】——
    //    在它之前的話, 被擋掉的商品會被當成「來源已無此品」⇒ 悄悄下架, 而那比不擋更糟。
    const iSource = src.indexOf('const sourceExternalIds');
    const iDeny = src.indexOf('findDeniedGroup(config.supplierSlug');
    expect(iSource).toBeGreaterThan(0);
    expect(iDeny).toBeGreaterThan(iSource);
    // 而它必須在兩條寫入路徑之【前】
    const iUpsert = src.indexOf("upsertBatched(target, 'products'");
    const iAtomic = src.indexOf('syncVariantGroupAtomic(');
    expect(iDeny).toBeLessThan(iUpsert);
    expect(iDeny).toBeLessThan(iAtomic);
  });
});
