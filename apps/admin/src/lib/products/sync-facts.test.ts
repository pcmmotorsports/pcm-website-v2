import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 🔴 **詳情頁那段警語所依賴的「事實」,釘在真相源上**(code-reviewer R3 F3;主視窗裁定折)。
 *
 * 病史:那段文案**已經連錯兩輪** ——
 *   · R1 MF5:寫「圖片與影音都會被蓋」,但影音由 `syncInstallResources` 逐家閘控。
 *   · R2 MF-a:改完之後「圖片每天都會被蓋」仍是全稱句,對 `extreme`(不排每日同步)為假。
 * 而兩輪的修法**都只是換句子 + 釘句子字面** ⇒ **測試守的是「字」不是「事實」**:
 * `extreme` 哪天被加進 matrix、或 images 加了旗標鎖,**全套照樣綠、文案靜默變假**。
 *
 * 🔴 依 `~/.claude/rules/00-work-rules.md` §4 機制優先律(Sean 2026-07-22 拍板):
 *    **發現 AI 犯錯,第一選擇是把防護做成機制;機制做不到才寫規則文字。**
 *    runtime 不能 import `.github/workflows/*.yml` 與 `scripts/*`(沒打包給 app),
 *    **但測試端可以讀檔** ⇒ 「做不到」不成立。
 *
 * ⚠️ **這支檔守的是「文案的前提還成立」,不是「文案字面沒被改」** ——
 *    後者由 `app/products/[id]/page.test.tsx` 的正向斷言守。兩者缺一不可:
 *    前者防事實漂移、後者防句子被刪。
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const WORKFLOW = path.join(REPO_ROOT, '.github/workflows/rpm-sync.yml');
const SUPPLIER_CONFIG = path.join(REPO_ROOT, 'scripts/supplier-config.ts');
const TRANSFORM = path.join(REPO_ROOT, 'scripts/rpm-transform.ts');
const MEDIA = path.join(REPO_ROOT, 'apps/admin/src/lib/products/product-media.ts');

function read(file: string): string {
  const src = readFileSync(file, 'utf8');
  // 🔴 前提斷言:檔真的讀到**而且不是被截斷的**。
  // ⚠️ **上一版的理由是假的**(R4 n3):我寫「路徑一漂就掃到空字串 ⇒ 下面全部恆綠」——
  //    `readFileSync` 對不存在的路徑是 **throw ENOENT**(實測 `e.code === 'ENOENT'`),**不會回空字串**
  //    ⇒ 路徑漂掉是**整支炸掉**,不是恆綠。**守門有用(擋「讀到但被截斷」),但我寫的理由是錯的。**
  //    這條留著的真正價值:檔案被清空/截短時會紅,而那才是會靜默降低判別力的情況。
  expect({ [path.relative(REPO_ROOT, file)]: src.length > 500 }).toEqual({
    [path.relative(REPO_ROOT, file)]: true,
  });
  return src;
}

/** `.github/workflows/rpm-sync.yml` 的 matrix 逐字取出(誰**真的**每天跑)。 */
function dailyMatrix(): string[] {
  const m = /supplier:\s*\[([^\]]+)\]/.exec(read(WORKFLOW));
  const captured = m?.[1];
  // 🔴 前提斷言:regex 真的抓到 matrix。抓不到就回空陣列 ⇒ 下面每一格都恆綠。
  expect({ 'matrix regex 命中': typeof captured === 'string' }).toEqual({
    'matrix regex 命中': true,
  });
  return (captured as string).split(',').map((x) => x.trim());
}

/** `scripts/supplier-config.ts` 的所有 `supplierSlug` 欄(設定檔說「哪些家存在」)。 */
function configuredSlugs(): string[] {
  return Array.from(read(SUPPLIER_CONFIG).matchAll(/supplierSlug:\s*'([^']+)'/g))
    .map((m) => m[1])
    .filter((v): v is string => typeof v === 'string');
}

/** 某一家的 `syncXxx` 旗標(以 `supplierSlug` 當錨,不用物件 key —— 兩者可能不同)。 */
function flagOf(slug: string, flag: string): boolean {
  const src = read(SUPPLIER_CONFIG);
  const at = src.indexOf(`supplierSlug: '${slug}'`);
  expect({ [`${slug} 存在於 config`]: at >= 0 }).toEqual({ [`${slug} 存在於 config`]: true });
  // 🔴 R4 n4:上一版用 `src.slice(at, at + 1500)` 固定視窗 ——
  //    **某家區塊若缺該旗標,會靜默抓到下一家的值**(目前被 `supplier-config.ts:74` 介面必填擋住
  //    ⇒ 不可達,但那是別人的介面在保護我,不是這裡自己守得住)。
  //    改成**切到下一個 `supplierSlug:` 為止**,視窗邊界由資料本身決定、不是我猜的字數。
  const next = src.indexOf("supplierSlug: '", at + 1);
  const seg = src.slice(at, next > at ? next : undefined);
  const captured = new RegExp(`${flag}:\\s*(true|false)`).exec(seg)?.[1];
  expect({ [`${slug}.${flag} 解析到`]: typeof captured === 'string' }).toEqual({
    [`${slug}.${flag} 解析到`]: true,
  });
  return captured === 'true';
}

describe('#20 片1b-2 — 詳情頁警語所依賴的事實(R3 F3)', () => {
  it('🔴 前提斷言:三個真相源都讀得到,而且解析器真的吐得出東西', () => {
    // 🔴 沒有這格,「事實沒漂」與「解析器根本沒解到東西」長得一模一樣
    //    （`feedback_absence-read-as-verified`：什麼都沒有 ≠ 檢查過了)。
    expect(dailyMatrix().length).toBeGreaterThanOrEqual(10);
    expect(configuredSlugs().length).toBeGreaterThanOrEqual(10);
    expect(dailyMatrix()).toContain('rpm');
  });

  it('🔴 文案前提①「有的供應商不排每日同步」—— 至少一家在 config 裡但不在 matrix', () => {
    // 文案逐字:「是否每天同步…依供應商而定(有的供應商是一次性匯入、不排每日)」。
    // 這一天所有家都被排進 matrix ⇒ 那句話變成廢話/誤導 ⇒ 這格要紅、逼人改文案。
    const notDaily = configuredSlugs().filter((s) => !dailyMatrix().includes(s));
    expect({ 不排每日的家數: notDaily.length > 0 }).toEqual({ 不排每日的家數: true });
    // 落筆當下:`extreme`(靜態 fixture)與 `__gated_canary__`(非真供應商)。
    expect(notDaily).toContain('extreme');
  });

  it('🔴 文案前提②「哪些欄位會被覆蓋依供應商而定」—— 每日同步的家裡至少一家旗標為 false', () => {
    // 文案逐字:「有的供應商的說明與手冊是凍結不動的」。
    // 若哪天 14 家全部 `syncInstallResources: true` ⇒ 那句話就假了。
    const frozen = dailyMatrix().filter((s) => !flagOf(s, 'syncInstallResources'));
    expect({ 每日同步中凍結安裝資源的家: frozen }).toEqual({ 每日同步中凍結安裝資源的家: ['rpm'] });
  });

  it('🔴 文案前提③「圖片一定會被寫」—— transform 對 images 是無條件寫入,不受旗標閘控', () => {
    // 🔴 **判別力已實測**(我一度想用「改 transform 超出範圍」把這格豁免掉,
    //    主視窗指出**我在同一輪的 F4 就改過那支檔跑突變** ⇒ 那是藉口不是誠實缺口):
    //    · 突變 A `images: [repImage],` → `images: repImage ? [repImage] : [],`
    //      ⇒ EXIT=1,訊息 `expected … to contain 'images: [repImage],'`
    //    · 突變 B 加一行 `...(ctx.syncDescription ? { images: [repImage] } : {}),`
    //      ⇒ EXIT=1,訊息 `expected … not to match /\.\.\.\([^)]*\?\s*\{\s*images\b/`
    //    兩發都還原(`cp` 非 `git checkout`)、還原後驗實作還在、失敗數 0→1→0。
    const src = read(TRANSFORM);
    // 無條件展開(`images: [repImage],`)而不是 `...(ctx.xxx ? { images } : {})`。
    expect(src).toContain('images: [repImage],');
    expect(src).not.toMatch(/\.\.\.\([^)]*\?\s*\{\s*images\b/);
  });

  it('🔴 F4:placeholder 字面兩份必須一致(transform 改路徑 ⇒ 這格紅,不是靜默失效)', () => {
    const RE = /const PLACEHOLDER_IMAGE = '([^']+)'/;
    const fromTransform = RE.exec(read(TRANSFORM))?.[1];
    const fromAdmin = RE.exec(read(MEDIA))?.[1];
    // 🔴 前提斷言:兩邊都真的抓到字面。抓不到就是 undefined === undefined ⇒ **恆綠**。
    expect({ transform: typeof fromTransform, admin: typeof fromAdmin }).toEqual({
      transform: 'string',
      admin: 'string',
    });
    // admin 這份是**抄的第二份**(`scripts/` 沒打包給 app、不能 import)⇒ 用這格當機械連結。
    expect({ admin: fromAdmin }).toEqual({ admin: fromTransform });
  });
});
