import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONTACT_EMAIL,
  CONTACT_PHONE,
  LEGAL_NAME,
  LEGAL_NAME_EN,
  STORE_ADDRESS,
  TAX_ID,
} from '../../lib/site-config';

// 兩張紙的**抬頭**要逐字相同,而它們的來源【不一樣】:
//   後台 `print-masthead.tsx` = 四個硬寫的常數
//   顧客站 `statement-doc.tsx` = 從 `site-config.ts` 衍生(唯一真相)
// ⇒ **兩條路各自都可能被改**,而改完之後兩張紙上會印不同的公司資料 ——
//   那在 typecheck / lint / build / 任何 render 測試上**都沒有形狀**。
//
// 🔴 **為什麼不把後台那份也改成衍生**(那樣就不需要這一格):
//   `site-config.ts` 在 storefront 這個 app,admin 不 import 它 ⇒ 跨 app 依賴是另一件事,
//   而本線的派工明寫「要動 `apps/admin` ⇒ 停下來回報」。
//   📌 收斂點是 backlog `#248`(登記資料進後台)/ `#602`,不是在這裡再造一個常數。
//
// ⚠️ **射程**:它比的是**後台那支檔裡的字面**,不是後台實際渲染出來的 DOM。
//   有人把 `print-masthead.tsx` 的 JSX 改成不用那四個常數時,這一格**照樣是綠的**。

const ADMIN_MASTHEAD = join(
  __dirname,
  '../../../../../apps/admin/src/components/print/print-masthead.tsx',
);

/** 從後台那支檔撈出 `const NAME = '…';` 的字面(單引號、單行)。 */
function adminConst(name: string): string {
  const src = readFileSync(ADMIN_MASTHEAD, 'utf8');
  const m = src.match(new RegExp(`^const ${name} = '([^']*)';$`, 'm'));
  if (m === null) throw new Error(`後台那支檔裡找不到 const ${name} —— 它被改名或改了寫法`);
  return m[1]!;
}

// 顧客站這一側的三行 —— **與 `statement-doc.tsx` 用同一組算式**。
// ⚠️ 這是本格最弱的一環:算式在兩處各寫一次 ⇒ 有人只改元件那邊時這裡不會紅。
//    收斂的做法是把算式 export 出來,而那會為了測試改動元件的公開介面 ⇒ 現在不做,把限制寫在這裡。
const LINE1_REST = `　${LEGAL_NAME_EN}　統一編號 ${TAX_ID}`;
const LINE2 = `${STORE_ADDRESS.region}${STORE_ADDRESS.locality}${STORE_ADDRESS.street}`;
const LINE3 = `${CONTACT_PHONE.replace('-', ' ')}　${CONTACT_EMAIL}　LINE @pcmmoto`;

describe('紙上抬頭:顧客站 vs 後台', () => {
  it.each([
    ['ISSUER_NAME', LEGAL_NAME],
    ['ISSUER_LINE1_REST', LINE1_REST],
    ['ISSUER_LINE2', LINE2],
    ['ISSUER_LINE3', LINE3],
  ])('%s 逐字相同', (name, ours) => {
    expect(ours).toBe(adminConst(name));
  });

  it('🔴 全形空格 U+3000 還在(半形化了就只有並排看才看得出來)', () => {
    expect(LINE1_REST.startsWith('　')).toBe(true);
    expect(LINE3.split('　')).toHaveLength(3);
  });

  it('🔴 LTD 後面沒有句點(Sean 逐字「好啦～沒句點,抱歉」)', () => {
    expect(LEGAL_NAME_EN).toBe('PCM MOTOR PARTS LTD');
    expect(LINE1_REST).not.toContain('LTD.');
  });

  it('負對照:撈一個不存在的常數必須拋錯(證明 adminConst 不是回空字串)', () => {
    expect(() => adminConst('ZZZ_NOT_A_CONST')).toThrow(/找不到/);
  });
});
