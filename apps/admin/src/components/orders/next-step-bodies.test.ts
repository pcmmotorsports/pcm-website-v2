// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// next-step-bodies.test.ts — P-e-2 守門:列表「下一步」彈窗的三支 body 在接線(P-e-3)之前【零寫入】。
//
// 🔴 守的是【程式碼裡的那一行 import】,不是執行行為 —— 理由同 `lib/audit/audit-ui-flag.test.ts` 檔尾那族:
//    「有沒有人寫下那條 import」是倉庫裡的一行字,靜態就量得到;而執行到真 action 要真 DB,jsdom 給不了。
// 🔴 定向突變(做的人自己跑):把任一支 body 的 `nextStepStubAction` 換成 `upsertItemProcurementAction` /
//    `recordItemReceiptAction` / `submitShipment` ⇒ 這裡要紅。沒紅過一次就別信它。
// ⚠️ 射程:只量 import。body 若把真 action 從別的 helper 轉手拿到(不直接 import)⇒ 本檔看不到。
//    那種寫法本身就是在繞守門,code review 抓。

const DIR = join(__dirname);
const BODIES = [
  'next-step-procurement-body.tsx',
  'next-step-receipt-body.tsx',
  // 出貨那支在 P-e-2b(ShipmentDialog 是 client 端直接呼叫 submitShipment,不是 form action,另一片)。
] as const;

/** 真的會寫入的那幾支 —— body 一支都不准碰。 */
const REAL_WRITE_IMPORTS = [
  'procurement-actions',
  'receipt-actions',
  'shipment-actions',
  'procurement-repository',
  'receipt-repository',
  'shipment-repository',
] as const;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('P-e-2 · 下一步彈窗 body 零寫入', () => {
  for (const file of BODIES) {
    const src = stripComments(readFileSync(join(DIR, file), 'utf8'));

    it(`${file}:只 import stub,不 import 任何會寫入的 action / repository`, () => {
      expect(src, '要傳 stub 才算「零寫入」,不傳 = 表單走預設的真 action').toContain(
        "from '../../lib/orders/next-step-stub-action'",
      );
      expect(src).toContain('action={nextStepStubAction}');
      for (const bad of REAL_WRITE_IMPORTS) {
        expect(src, `${file} 不准 import ${bad} —— 那是 P-e-3 的事,而且要 codex 審`).not.toMatch(
          new RegExp(`from ['"][^'"]*${bad}['"]`),
        );
      }
    });
  }

  // 🔴 對照組:這把尺要能印紅。stripComments 不能把整份 src 吃光(否則上面全是恆真)。
  it('負對照:一段寫著真 action import 的假 body 會被抓到', () => {
    const fake = stripComments(
      "import { upsertItemProcurementAction } from '../../lib/orders/procurement-actions';\n// 註解\n",
    );
    expect(fake).toMatch(/from ['"][^'"]*procurement-actions['"]/);
  });

  it('stub 本身只會 throw,不回任何 state', async () => {
    const mod = await import('../../lib/orders/next-step-stub-action');
    await expect(mod.nextStepStubAction(null, new FormData())).rejects.toThrow('P-e-3 未接線');
  });
});
