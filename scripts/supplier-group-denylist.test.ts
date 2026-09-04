import { describe, expect, it, vi } from 'vitest';
import {
  DENIED_GROUPS,
  deniedGroupMessage,
  findDeniedGroup,
} from './supplier-group-denylist';
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
