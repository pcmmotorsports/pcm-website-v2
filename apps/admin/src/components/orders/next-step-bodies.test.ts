// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
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
  'next-step-shipment-body.tsx',
] as const;

/** 真的會寫入的那幾支【模組】—— body 一支都不准 import。 */
const REAL_WRITE_IMPORTS = [
  'procurement-actions',
  'receipt-actions',
  'procurement-repository',
  // ⛔ `'receipt-repository'` 2026-09-14 移出這份:到貨 body 要它的 `listOrderItemReceipts`(讀,給稿彈窗 8 的
  //    「已登的到貨(撤銷在這裡)」摺疊)—— 與下面 `shipment-actions` 同一個處理:改量【名字】,
  //    那支的寫入識別字(`recordItemReceipt` / `deleteItemReceipt`)進 REAL_WRITE_NAMES,body 裡一次都不准出現。
  'shipment-repository',
] as const;
/**
 * `shipment-actions` **不在上面那份**:出貨 body 要它的 `fetchShipmentCandidates`(讀,`:237` 直接回
 * `loadShipmentCandidates`)。所以那一支改量【名字】:會寫入的那幾個識別字在 body 裡一次都不准出現。
 */
const REAL_WRITE_NAMES = ['submitShipment', 'upsertItemProcurementAction', 'recordItemReceiptAction', 'recordItemReceipt', 'deleteItemReceipt', 'undoItemReceiptAction'] as const;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('P-e-3 · 下一步彈窗 body 【已接線】—— 走明細頁同一支 action,沒有第二條寫入路', () => {
  // 🏁🏁 **P-e-3(2026-09-13,Sean 批 P-e 甲):這一族從「零寫入」反向成「只准走既有那一支」。**
  //    P-e-2 版守的是「body 只 import stub、不 import 真 action」;接線 = 把 stub prop 拿掉 ⇒
  //    表單走它們的**預設** = 明細頁那支 action。所以現在要守的變成兩件:
  //      ① stub 不得再被任何 body import(它已刪檔;哪天有人為了「先擋一下」把它加回來 ⇒ 這裡紅)
  //      ② body **仍然不准直接 import 真 action** —— 真 action 是表單元件的預設值,body 不該自己再指一次。
  //         兩處各指一次 = 哪天明細頁換 action、列表沒跟上 ⇒ 「從彈窗送出」與「從明細送出」進不同支
  //         —— 那正是 codex 那一輪要抓的破口(plan §5 逐字)。
  for (const file of BODIES) {
    const src = stripComments(readFileSync(join(DIR, file), 'utf8'));

    it(`${file}:不 import stub、也不自己指真 action(讓表單元件的預設值當唯一來源)`, () => {
      expect(src, 'stub 又被接回來了 ⇒ 列表彈窗送出會炸「未接線」').not.toContain('next-step-stub-action');
      expect(src, 'body 自己傳 action= / submit: ⇒ 與明細頁分岔的第二條路').not.toMatch(
        /action=\{|submit:\s*[A-Za-z]/,
      );
      for (const bad of REAL_WRITE_IMPORTS) {
        expect(src, `${file} 不准直接 import ${bad} —— 真 action 是表單元件的預設,不在 body 指第二次`).not.toMatch(
          new RegExp(`from ['"][^'"]*${bad}['"]`),
        );
      }
      for (const name of REAL_WRITE_NAMES) {
        expect(src, `${file} 裡不准出現 ${name}`).not.toContain(name);
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

  it('🔴 stub 檔已經不存在(接線完成的物證;它回來 = 有人又把寫入路擋掉了)', () => {
    expect(existsSync(join(DIR, '../../lib/orders/next-step-stub-action.ts'))).toBe(false);
  });

  // 🔴🔴 **payload 同源守門(plan §7-2)**:「從彈窗送出 vs 從明細頁送出,進同一支 action、同一組參數」。
  //    靜態那一半在這裡:三支 body 都**只**渲染明細頁那三份表單元件(同一份元件 ⇒ 同一組 hidden 欄位 ⇒ 同一組參數)。
  it('🔴 三支 body 各自只渲染明細頁那份表單元件,不自己組 <form>', () => {
    const map: Record<string, string> = {
      'next-step-procurement-body.tsx': '<ItemProcurementForm',
      'next-step-receipt-body.tsx': '<ReceiptRecordForm',
      'next-step-shipment-body.tsx': 'useShipmentLauncher(',
    };
    for (const [file, marker] of Object.entries(map)) {
      const src = stripComments(readFileSync(join(DIR, file), 'utf8'));
      expect(src, `${file} 沒有走明細頁那份元件`).toContain(marker);
      expect(src, `${file} 自己組了 <form> ⇒ 欄位會與明細頁分岔`).not.toMatch(/<form\b/);
    }
  });
});

// B9:到貨表的欄寬字面在兩支檔各寫一次(server 端表頭 import 不了 'use client' 檔的函式),這裡釘住一致。
describe('B9 · 到貨表表頭與表格列的 gridTemplateColumns 同一串', () => {
  it('兩支檔都有、而且一樣(含多單版「單號」那一欄的版本)', () => {
    const head = readFileSync(join(DIR, 'next-step-receipt-body.tsx'), 'utf8');
    const form = readFileSync(join(DIR, 'receipt-record-form.tsx'), 'utf8');
    for (const cols of ['auto 1fr 1fr 2fr auto auto auto', '1fr 1fr 2fr auto auto auto']) {
      expect(head, `表頭少了 '${cols}'`).toContain(`'${cols}'`);
      expect(form, `表格列少了 '${cols}'`).toContain(`'${cols}'`);
    }
  });
});
