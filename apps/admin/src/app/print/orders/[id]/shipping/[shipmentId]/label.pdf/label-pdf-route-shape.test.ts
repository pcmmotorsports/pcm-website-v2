// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// 這條 route 的**路徑形狀**守門。⟦ship-HCTLABELCAPTURE⟧ 片 D2。
//
// 🔴🔴 **它為什麼存在(P-2 的 codex R1 must-fix-1, 逐字量到的)**:
//    把 route 放在【動態段 + 副檔名】(`[shipmentId].pdf/`)時, Next 編出來的 regex 裡
//    **`.pdf` 整個消失** ⇒ 它與既有那張列印頁 `[shipmentId]` **regex 逐字相同 ⇒ 互相遮蔽**。
//    🛑 而那個世界裡 `pnpm build` **rc=0、完全安靜**, 三綠全綠 ——
//      📌 **沒有任何一格在問「這條網址打不打得到」。這一格就是那個問句。**
//
// ⚠️ **射程**:它讀的是 build 產物 `.next/routes-manifest.json`
//    ⇒ 它答得出「Next 編出來的 regex 長什麼樣」, **答不出「線上真的路由得到」**。
const ROUTE_DIR = join(__dirname);
const NEXT_DIR = join(ROUTE_DIR, '../../../../../../../../.next');
const MANIFEST = join(NEXT_DIR, 'routes-manifest.json');

const PAGE_LABEL = '/print/orders/[id]/shipping/[shipmentId]/label.pdf';
const PAGE_SHIPPING = '/print/orders/[id]/shipping/[shipmentId]/shipping.pdf';
const PAGE_HTML = '/print/orders/[id]/shipping/[shipmentId]';

describe('label.pdf 的路徑形狀(build 產物)', () => {
  it('前置:manifest 存在, 而且【不比這條 route 舊】', () => {
    expect(existsSync(MANIFEST), `${MANIFEST} 不存在 ⇒ 先跑 TURBO_FORCE=1 pnpm --filter @pcm/admin build`).toBe(true);
    // 🔴 這一族踩過:守門對著**舊產物**全綠 ⇒ 新鮮度要**硬斷言**, 不是 console.warn。
    //    (P-2 的 codex R1 must-fix-4 逐字:「warn 不會讓任何一格紅」。)
    const routeTs = join(ROUTE_DIR, 'route.ts');
    expect(existsSync(routeTs), '本檔的 route.ts 不見了 ⇒ 下面每一格的分母是假的').toBe(true);
    expect(
      statSync(MANIFEST).mtimeMs >= statSync(routeTs).mtimeMs,
      'routes-manifest 比 route.ts 舊 ⇒ 下面每一格拿的是上一次 build 的答案。' +
        '先跑 `TURBO_FORCE=1 pnpm --filter @pcm/admin build` 再看。',
    ).toBe(true);
  });

  it('三條路由的 regex 兩兩不同, 而 label.pdf 那一段真的活在它的 regex 裡', () => {
    const routes = (
      JSON.parse(readFileSync(MANIFEST, 'utf8')) as { dynamicRoutes: { page: string; regex: string }[] }
    ).dynamicRoutes;
    const one = (page: string) => {
      const hit = routes.filter((r) => r.page === page);
      // 🔴 訊息要涵蓋兩個世界, 因為它們印同一個 0:①這棵樹的 .next 比它舊(常見)②route 真的沒了(罕見)。
      expect(hit.length, `${page} 不在 routes-manifest 裡 —— 最常見的原因是【.next 比它舊】, 先重 build。`).toBe(1);
      return hit[0]!.regex;
    };
    const label = one(PAGE_LABEL);
    const shipping = one(PAGE_SHIPPING);
    const html = one(PAGE_HTML);
    expect(label, 'label.pdf 與既有列印頁的 regex 相同 ⇒ 它們互相遮蔽').not.toBe(html);
    expect(label, 'label.pdf 與 shipping.pdf 的 regex 相同 ⇒ 它們互相遮蔽').not.toBe(shipping);
    // 🔵 正對照:`label.pdf` 這一段真的活在 regex 裡(不是只是「兩條剛好不一樣」)。
    expect(label).toContain('label\\.pdf');
    // 🔵 負對照:一個**現造的**、這條 route 不該有的段, 必須不在裡面。
    expect(label).not.toContain('hct-label-sheet-v9');
  });
});
