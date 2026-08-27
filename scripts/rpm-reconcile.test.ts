// rpm-reconcile.test.ts — V1 變體級對賬純分類(classifyVariantOrphans)回歸鎖
//
// 背景(2026-07-05 雙跨模型審查 must-fix F1-F3):群(main_sku)還在、群內變體 sku 從來源消失 →
//   變體殘留 DB + 前台選項可見 + create_order 可下單凍結舊價(客人買到停產色)。
//   classifyVariantOrphans = 差集決策核心;安全 gate 對齊商品級 delist(源空硬 abort / >10% abort)。

import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { classifyVariantOrphans, computeSourceMissing, markSourceMissing, clearSourceMissing, type VariantOrphan } from './rpm-reconcile';

const tv = (sku: string, externalId: string): VariantOrphan => ({ sku, externalId });

describe('V1 classifyVariantOrphans(孤兒變體差集 + 安全 gate)', () => {
  it('群在、變體 sku 從來源消失 → 判孤兒(F1 核心情境:bonamici 某色停產)', () => {
    const target = [tv('PU_001-RED', 'PU_001'), tv('PU_001-BLK', 'PU_001')];
    const r = classifyVariantOrphans(target, new Set(['PU_001-RED']), new Set(['PU_001']), {
      allowLargeDelist: true, // 2 列中刪 1 = 50% 超閾、此測聚焦差集正確性、比例 gate 另測
    });
    expect(r.orphans).toEqual([tv('PU_001-BLK', 'PU_001')]);
    expect(r.aborted).toBe(false);
  });

  it('parent 群不在本次 source → 變體不判孤兒(交商品級 delist 路徑、RLS 連動隱藏)', () => {
    const target = [tv('GONE-01', 'GONE')]; // 整群從 source 消失
    const r = classifyVariantOrphans(target, new Set(['OTHER-01']), new Set(['OTHER']));
    expect(r.orphans).toEqual([]); // 不越權刪:群級軟下架已藏、復架時下一輪對賬收斂
    expect(r.targetInScope).toBe(0);
  });

  it('target 變體全在 source → 零孤兒(每日同步常態)', () => {
    const target = [tv('A-1', 'A'), tv('A-2', 'A')];
    const r = classifyVariantOrphans(target, new Set(['A-1', 'A-2']), new Set(['A']));
    expect(r.orphans).toEqual([]);
    expect(r.ratio).toBe(0);
    expect(r.aborted).toBe(false);
  });

  it('首載(target 空)→ 零孤兒、不 abort(試點首寫天然免疫)', () => {
    const r = classifyVariantOrphans([], new Set(['NEW-1']), new Set(['NEW']));
    expect(r.orphans).toEqual([]);
    expect(r.aborted).toBe(false);
  });

  it('🔴 source sku 集合空但 target 有列 → 硬 abort(疑 transform 失敗、絕不刪全部)', () => {
    const target = [tv('A-1', 'A')];
    const r = classifyVariantOrphans(target, new Set(), new Set(['A']));
    expect(r.aborted).toBe(true);
    expect(r.abortReason).toMatch(/絕不刪全部/);
  });

  it('🔴 孤兒比例 >10% → abort(疑來源變體殘缺);--allow-large-delist 顯式放行留 audit', () => {
    // 10 列中 2 孤兒 = 20% 超閾
    const target = Array.from({ length: 10 }, (_, i) => tv(`A-${i}`, 'A'));
    const srcSkus = new Set(Array.from({ length: 8 }, (_, i) => `A-${i}`)); // A-8/A-9 消失
    const blocked = classifyVariantOrphans(target, srcSkus, new Set(['A']));
    expect(blocked.aborted).toBe(true);
    expect(blocked.abortReason).toMatch(/--allow-large-delist/);

    const bypassed = classifyVariantOrphans(target, srcSkus, new Set(['A']), { allowLargeDelist: true });
    expect(bypassed.aborted).toBe(false);
    expect(bypassed.largeDeleteBypassed).toBe(true); // loud log + audit trail
    expect(bypassed.orphans).toHaveLength(2);
  });

  it('比例 ≤10% 日常汰換 → 不 abort、不標 bypass', () => {
    // 20 列刪 1 = 5%
    const target = Array.from({ length: 20 }, (_, i) => tv(`B-${i}`, 'B'));
    const srcSkus = new Set(Array.from({ length: 19 }, (_, i) => `B-${i}`));
    const r = classifyVariantOrphans(target, srcSkus, new Set(['B']));
    expect(r.aborted).toBe(false);
    expect(r.largeDeleteBypassed).toBe(false);
    expect(r.orphans).toEqual([tv('B-19', 'B')]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🔴 #20 片2b:同步不再下架,只標記 `source_missing_at`
// 規格 = docs/specs/2026-08-15-products-manual-listing-override-plan.md v5 §4 驗收 3/4。
// 這幾格釘的是「**動了哪一欄**」與「**沒動哪一欄**」—— 後者才是本片的重點:
// 漏改任一處,商品會被靜默下架,而畫面看起來一切正常、沒有任何守門會紅。
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 記錄 **每一個 builder 呼叫的方法名與完整參數** 的 mock;await 回 {data:[],error}。
 *
 * 🔴 關卡2 nit4/nit5:初版只記 `args[0]` ⇒ **過濾條件寫反也測得過**
 *   (`.is('source_missing_at', null)` 與 `.not('source_missing_at','is',null)` 在只看第一個參數時長得一樣)。
 *   ⇒ 改記完整 `[method, ...args]`,讓「方向」與「值」都進得了斷言。
 */
function makeUpdateRecorder(error: { code?: string; message?: string } | null = null) {
  const updates: Record<string, unknown>[] = [];
  const calls: unknown[][] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') {
        return (f: (v: unknown) => unknown) => Promise.resolve({ data: [], error }).then(f);
      }
      return (...args: unknown[]) => {
        if (prop === 'update') updates.push(args[0] as Record<string, unknown>);
        calls.push([String(prop), ...args]);
        return builder;
      };
    },
  });
  return { client: { from: () => builder } as unknown as SupabaseClient, updates, calls };
}

describe('🔴 #20 片2b:markSourceMissing / clearSourceMissing 動的是哪一欄', () => {
  it('🔴 驗收 3(負測):來源消失 → 寫 source_missing_at,**完全不碰 delisted_at**', async () => {
    const r = makeUpdateRecorder();
    await markSourceMissing(r.client, 'rpm', ['EXT-1'], '2026-08-15T00:00:00Z');
    expect(r.updates).toHaveLength(1);
    const payload = r.updates[0] ?? {};
    expect(payload).toEqual({ source_missing_at: '2026-08-15T00:00:00Z' });
    // 🔴 這一條才是本片的重點:payload 裡出現 delisted_at = 商品被靜默下架。
    expect(Object.keys(payload)).not.toContain('delisted_at');
  });

  it('驗收 3 正向對照:冪等過濾條件是 source_missing_at(只標記尚未標記的、保留「第一次消失」語意)', async () => {
    const r = makeUpdateRecorder();
    await markSourceMissing(r.client, 'rpm', ['EXT-1'], '2026-08-15T00:00:00Z');
    // 沒有這格,把 .is('source_missing_at', null) 誤刪也不會紅 —— 時戳會被每天覆寫成今天,
    // 「原廠什麼時候不見的」就永遠是「今天」。
    // 🔴 逐字比對**完整參數**(nit5):只看欄名的話,把方向寫反(改成 .not(...)) 一樣會過。
    expect(r.calls).toContainEqual(['is', 'source_missing_at', null]);
    expect(r.calls).toContainEqual(['eq', 'supplier_slug', 'rpm']);
    expect(r.calls).toContainEqual(['in', 'external_id', ['EXT-1']]);
    expect(r.calls.flat()).not.toContain('delisted_at');
  });

  it('🔴 驗收 4:來源重新出現 → source_missing_at 清回 null,一樣不碰 delisted_at', async () => {
    const r = makeUpdateRecorder();
    await clearSourceMissing(r.client, 'rpm', ['EXT-1']);
    expect(r.updates).toEqual([{ source_missing_at: null }]);
    expect(Object.keys(r.updates[0] ?? {})).not.toContain('delisted_at');
    // 🔴 完整條件(nit4):方向必須是「只清目前有標記的」,而且限定本供應商與本批 external_id。
    //    方向寫反(改成 .is(...,null))會把「還沒標記的」拿去清 —— 結果看起來一樣是 0 筆,但語意相反。
    expect(r.calls).toContainEqual(['not', 'source_missing_at', 'is', null]);
    expect(r.calls).toContainEqual(['eq', 'supplier_slug', 'rpm']);
    expect(r.calls).toContainEqual(['in', 'external_id', ['EXT-1']]);
  });

  it('🔴 跨 apply 停點閘:欄位還沒 apply(42703)→ 跳過並警告,不炸整批同步', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = makeUpdateRecorder({ code: '42703', message: 'column "source_missing_at" does not exist' });
    // Sean `Q-同步失敗策略=甲`:跳過那一步、大聲記錄,其餘照跑 ⇒ 這裡必須 resolve 0、不得 throw。
    await expect(markSourceMissing(r.client, 'rpm', ['EXT-1'], '2026-08-15T00:00:00Z')).resolves.toBe(0);
    await expect(clearSourceMissing(r.client, 'rpm', ['EXT-1'])).resolves.toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('正向對照:其他 DB 錯誤仍然 throw(閘只吞「欄位不存在」,不是吞掉所有錯)', async () => {
    // 🔴 沒有這格,把 isMissingColumn 寫成恆真也會綠 —— 那會讓真正的寫入失敗被靜默吞掉。
    const r = makeUpdateRecorder({ code: '23505', message: 'duplicate key value' });
    await expect(markSourceMissing(r.client, 'rpm', ['EXT-1'], '2026-08-15T00:00:00Z')).rejects.toThrow('markSourceMissing');
  });

  it('🔴 關卡2 must-fix 回歸:錯誤訊息「碰巧提到欄名」但不是欄位不存在 → 仍須 throw', async () => {
    // 初版判別寫成「訊息含 source_missing_at 就算欄未建」⇒ 這種錯誤會被靜默吞掉、cron 不報錯。
    // 真實形狀:權限錯誤 / 唯一鍵衝突 / 逾時訊息裡都可能出現欄名。
    for (const err of [
      { code: '42501', message: 'permission denied for column source_missing_at' },
      { code: '23505', message: 'duplicate key value violates unique constraint on source_missing_at idx' },
      { code: '57014', message: 'canceling statement due to statement timeout while updating source_missing_at' },
    ]) {
      const r = makeUpdateRecorder(err);
      await expect(markSourceMissing(r.client, 'rpm', ['EXT-1'], '2026-08-15T00:00:00Z')).rejects.toThrow('markSourceMissing');
      const c = makeUpdateRecorder(err);
      await expect(clearSourceMissing(c.client, 'rpm', ['EXT-1'])).rejects.toThrow('clearSourceMissing');
    }
  });

  it('正向對照:PGRST204(schema cache 沒這欄)也算「欄未建」,一樣 fail-soft', async () => {
    // 沒有這格,把判別窄成「只認 42703」會漏掉 PostgREST 那條路 —— apply 前的 cron 仍會整批紅。
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = makeUpdateRecorder({ code: 'PGRST204', message: "Could not find the 'source_missing_at' column" });
    await expect(markSourceMissing(r.client, 'rpm', ['EXT-1'], '2026-08-15T00:00:00Z')).resolves.toBe(0);
    warn.mockRestore();
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// 🔴 商品級 computeSourceMissing 的比例閘 —— 2026-08-27 補,因為它【本來一格都沒有】。
//
// 起因:`dna` 與 `gilles` 2026-08-27 被加進 `.github/workflows/rpm-sync.yml` 的每日同步 matrix,
//   下一次跑就是第一次。有人主張「`SOURCE_MISSING_RATIO_ABORT = 0.1` 擋著,不會批次動到商品」——
//   而查下去:`computeSourceMissing` 在測試裡**只被驗過 supplier scope**
//   (`rpm-pipeline-scope.test.ts:49`),**比例閘與空來源閘從來沒有任何一格**。
//   ⇒ 那句話當時是【讀出來】的,不是【跑出來】的。本段把它跑成真的。
//
// ⚠️ 三條【本段不證明】的事,寫在這裡免得下一個人外推:
//   ① **它不下架。** 片2b 起這份名單只寫 `source_missing_at`,商品維持上架可購買
//      (見本檔 `#20 片2b` 那個 describe)⇒ 這道閘防的是「批次誤標」,不是「批次下架」。
//   ② **「函式判 abort」≠「job 會停」。** 停不停在呼叫端:`rpm-import.ts` 寫入路徑會 throw,
//      而 dry-run 分支**只印報告、rc 仍為 0**(那是刻意的,註解寫在它旁邊)。
//   ③ **首灌時這道閘是啞的** —— `active.length === 0` ⇒ ratio 被設 0 ⇒ 永不 abort。
//      那時擋的是群數指紋 gate,不是本閘。W0 那格就是把這件事釘住。
// ─────────────────────────────────────────────────────────────────────────────

/** 分頁 + 記錄 filter 的 mock:除了回資料,還記下 .is()/.order()/.eq() 有沒有被套上。 */
function makePagedClient(active: string[]) {
  const filters: string[] = [];
  const client = {
    from() {
      const q: Record<string, unknown> = {};
      const chain = (name: string) => (...args: unknown[]) => {
        filters.push(`${name}(${args.map((a) => JSON.stringify(a)).join(',')})`);
        return q;
      };
      q.select = chain('select');
      q.eq = chain('eq');
      q.is = chain('is');
      q.order = chain('order');
      q.range = (from: number, to: number) =>
        Promise.resolve({ data: active.slice(from, to + 1).map((external_id) => ({ external_id })), error: null });
      return q;
    },
  } as unknown as SupabaseClient;
  return { client, filters };
}

/** gilles 首灌後的真實群數;用真數字才看得出 154/155 那一對邊界落在哪。 */
const N = 1545;
const ids = (n: number) => Array.from({ length: n }, (_, i) => `G-${String(i).padStart(5, '0')}`);

describe('🔴 computeSourceMissing 比例閘(SOURCE_MISSING_RATIO_ABORT = 0.1)', () => {
  it('W1 來源全在 → 不 abort、待標記 0、分母是 target 現存數', async () => {
    const { client } = makePagedClient(ids(N));
    const r = await computeSourceMissing(client, 'gilles', new Set(ids(N)));
    expect(r.aborted).toBe(false);
    expect(r.toMark).toHaveLength(0);
    expect(r.targetActive).toBe(N); // 🔴 分母被換成 source 數的話這格會紅
    expect(r.largeDelistBypassed).toBe(false);
  });

  it('W2 來源只剩 10% → abort,且【沒有】被標成 bypass', async () => {
    const { client } = makePagedClient(ids(N));
    const r = await computeSourceMissing(client, 'gilles', new Set(ids(N).slice(0, 155)));
    expect(r.aborted).toBe(true);
    expect(r.abortReason).toContain('超上限');
    expect(r.largeDelistBypassed).toBe(false); // 沒這條,「恆 bypass」那種壞法會活下來
  });

  it('W3 來源為空 → 硬 abort(疑 fetch 失敗、絕不標記全部)', async () => {
    const { client } = makePagedClient(ids(N));
    const r = await computeSourceMissing(client, 'gilles', new Set<string>());
    expect(r.aborted).toBe(true);
    expect(r.abortReason).toContain('不可 bypass');
  });

  it('🔴 W3b 來源為空 + --allow-large-delist → 仍須 abort(這條閘不吃旗標)', async () => {
    // 沒有這格,「不可 bypass」四個字就只被當【字串】驗過,沒被當【行為】驗過。
    const { client } = makePagedClient(ids(N));
    const r = await computeSourceMissing(client, 'gilles', new Set<string>(), { allowLargeDelist: true });
    expect(r.aborted).toBe(true);
    expect(r.largeDelistBypassed).toBe(false);
  });

  it('W4/W5 邊界成對:154/1545 = 9.97% 不擋,155/1545 = 10.03% 擋(嚴格大於)', async () => {
    // 只跑一發的話,「沒擋」與「閘壞了」長得一樣 ⇒ 這一對必須同時在。
    const under = await computeSourceMissing(makePagedClient(ids(N)).client, 'gilles', new Set(ids(N).slice(154)));
    const over = await computeSourceMissing(makePagedClient(ids(N)).client, 'gilles', new Set(ids(N).slice(155)));
    expect(under.toMark).toHaveLength(154);
    expect(under.aborted).toBe(false);
    expect(over.toMark).toHaveLength(155);
    expect(over.aborted).toBe(true);
  });

  it('W6 比例超限 + 顯式旗標 → 放行,但留下 largeDelistBypassed 供 audit', async () => {
    const { client } = makePagedClient(ids(N));
    const r = await computeSourceMissing(client, 'gilles', new Set(ids(N).slice(0, 155)), { allowLargeDelist: true });
    expect(r.aborted).toBe(false);
    expect(r.largeDelistBypassed).toBe(true);
  });

  it('🔴 W0 首灌(target 現存 0、來源滿的)→ 本閘【啞的】:ratio 恆 0、不 abort', async () => {
    // 這格不是在誇它安全,是在釘住一個限制:首灌那一發【不是這道閘擋的】,是群數指紋 gate。
    // 🔴 我第一版把來源也寫成空的 ⇒ 測試紅了,而紅得對:空來源那條閘【先觸發】、
    //    它不看 target 有沒有東西。首灌的真實形狀是「target 空、source 滿」,不是兩邊都空。
    const { client } = makePagedClient([]);
    const r = await computeSourceMissing(client, 'gilles', new Set(ids(N)));
    expect(r.targetActive).toBe(0);
    expect(r.ratio).toBe(0);
    expect(r.aborted).toBe(false);
    expect(r.toMark).toHaveLength(0);
  });

  it('🔴 W0b 兩邊都空 → 仍走「來源為空」硬 abort(它比 target 空優先)', async () => {
    const { client } = makePagedClient([]);
    const r = await computeSourceMissing(client, 'gilles', new Set<string>());
    expect(r.aborted).toBe(true);
    expect(r.abortReason).toContain('不可 bypass');
  });

  it('active-read 有套上 delisted_at IS NULL 與穩定排序(拿掉任一條都該紅)', async () => {
    // 少了 .is → 已下架的會被算進分母 ⇒ 比例被稀釋、閘變鬆。
    // 少了 .order → 分頁不穩定 ⇒ 讀出來的集合本身不可信。兩者都不會讓上面任何一格紅。
    const { client, filters } = makePagedClient(ids(3));
    await computeSourceMissing(client, 'gilles', new Set(ids(3)));
    expect(filters).toContain('is("delisted_at",null)');
    expect(filters).toContain('order("external_id")');
    expect(filters).toContain('eq("supplier_slug","gilles")');
  });

  it('分頁邊界:1000 的整數倍不會少讀也不會無限迴圈(READ_BATCH = 1000)', async () => {
    for (const n of [0, 999, 1000, 1545, 2000, 2001]) {
      const { client } = makePagedClient(ids(n));
      const r = await computeSourceMissing(client, 'gilles', new Set(ids(n)));
      expect(r.targetActive).toBe(n);
    }
  });
});
