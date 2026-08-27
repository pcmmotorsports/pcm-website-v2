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


/**
 * `scripts/supplier-config.ts` 逐家的**區塊**(含它上方的前導註解),以物件鍵為錨。
 *
 * 🔴 **為什麼不用 `supplierSlug:` 當錨**(2026-08-27 當場量到、差點寫錯):
 *    每一家的前導註解寫在 `supplierSlug:` 的**上面**,而「這家不接每日排程」這種宣告
 *    就住在那段註解裡 ⇒ 以 `supplierSlug:` 切段會把**下一家的註解算進上一家**。
 *    實測:`不接每日排程` 唯一命中在 `:275`,那是 `extreme` 的前導註解 ——
 *    以 `supplierSlug:` 切會判成 **akrapovic 豁免、extreme 不豁免**,兩家都判反。
 *    📌 同族前科就在本檔 `flagOf` 的 `R4 n4`:**固定視窗會靜默抓到隔壁家的值。**
 *       這次不是視窗大小,是**錨點選錯邊**,而兩者印出來的東西同樣合理。
 *
 * ⚠️ **只認【前導】註解 —— 尾註會歸給下一家**(code-reviewer nit,實測:
 *    把「(extreme 不接每日排程)」放在 extreme 的 `},` 之後 ⇒ 豁免掉的是 `kspeed`)。
 *    上一版的 JSDoc 只講了錯配的一個方向, 讀起來像「錨選對了就沒事」。
 *
 * 🔴 **起點不是檔頭**(code-reviewer must-fix):原本 `prevEnd = 0` ⇒ 第一家(`rpm`)的區塊
 *    涵蓋整個檔頭 JSDoc 與 `SupplierConfig` 介面註解 ⇒ **任何人在檔頭寫下「不接每日排程」
 *    這句話, `rpm` 就會被判豁免, 而把 rpm 移出 matrix 之後【全綠】。**
 *    而檔頭正是下一個人記錄這條慣例最自然的位置。⇒ 起點錨在 `SUPPLIER_CONFIGS` 上。
 *
 * ⚠️ **鍵可能帶引號**:任何含 hyphen 的 slug(`'new-co'`)在 TS 裡**必須**加引號。
 *    上一版的 regex 只吃裸識別字 ⇒ 那一家會被**整段併進下一家**, 而紅會出現在下一家身上,
 *    **真正漏的那家從頭到尾沒被提過**。下面另有一格交叉尺(區塊數 vs slug 數)當第二道。
 */
function configBlocks(): { key: string; block: string }[] {
  const src = read(SUPPLIER_CONFIG);
  // 裸識別字 `rpm: {` 與帶引號 `'new-co': {` 兩種都要吃。
  const keys = [...src.matchAll(/^ {2}'?([A-Za-z_][A-Za-z0-9_-]*)'?:\s*\{/gm)];
  const out: { key: string; block: string }[] = [];
  // 🔴 起點錨在登記表本身,不是檔案開頭(見上方 JSDoc 的 must-fix 那段)。
  const tableAt = src.indexOf('SUPPLIER_CONFIGS');
  expect({ '登記表錨點找得到': tableAt >= 0 }).toEqual({ '登記表錨點找得到': true });
  let prevEnd = tableAt;
  for (const m of keys) {
    const at = m.index ?? -1;
    const close = src.indexOf('\n  },', at);
    // 🔴 前提斷言:每一家都找得到自己的收尾。找不到就切出一段亂七八糟的東西,而下面每一格照樣跑。
    expect({ [`${m[1]} 區塊收尾`]: at >= 0 && close > at }).toEqual({
      [`${m[1]} 區塊收尾`]: true,
    });
    out.push({ key: m[1] as string, block: src.slice(prevEnd, close) });
    prevEnd = close + 5;
  }
  return out;
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
    // 若哪天每日同步的家全部 `syncInstallResources: true` ⇒ 那句話就假了。
    // 🔴 ~~原註寫「14 家」~~ ⇒ 2026-08-27 加入 dna+gilles 後是 16 家。**家數不再寫死** ——
    //    上一版把當下的家數寫進理由句,而 matrix 一長它就靜默變假,
    //    而**這一格紅的時候沒有人會去看註解對不對**(本次實測:紅的是下面那行的名單, 註解照樣是舊的)。
    // 🔴 dna+gilles 兩家 `syncInstallResources: false` 是**量到的**(pdf_urls/video_urls 兩欄來源全 0),
    //    不是保守猜 ⇒ 它們進 matrix 之後本格期望值**必然**從 ['rpm'] 變三家。
    //    數法:grep -n "syncInstallResources" scripts/supplier-config.ts
    // 🔴 codex K2 nit(2026-08-27):`frozen` 直接繼承 matrix 的**排列順序** ⇒
    //    只把 matrix 裡兩家對調(語意零改變)就會讓本格誤紅。**實際值那側 `.sort()`**, 比的是集合不是順序。
    //    ⚠️ 期望值那側是**人寫的字面**, 它「照字典序」是我排的、不是程式保證的
    //    ⇒ 補第四家時**要自己排進正確位置**, 否則同一種誤紅會從期望值那側回來。
    //    (code-reviewer 2026-08-27 nit:原註寫「兩側都排序」= 不成立, 已改成實況。)
    const frozen = dailyMatrix()
      .filter((s) => !flagOf(s, 'syncInstallResources'))
      .sort();
    expect({ 每日同步中凍結安裝資源的家: frozen }).toEqual({
      每日同步中凍結安裝資源的家: ['dna', 'gilles', 'rpm'],
    });
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

  it('🔴 #q2:每一家【活的】供應商都要在每日同步 matrix 裡,除非它自己明文說不接', () => {
    // 🔴 **這一格的來由是一次真的漏**(2026-08-27):`dna` 自 08-21 首灌、`gilles` 自 08-27 首灌,
    //    兩家都沒被加進 matrix ⇒ 顧客站價格與庫存凍在首灌快照,而來源每天更新。
    //    `dna` 因此凍了六天,而**沒有任何東西會叫** —— 兩支檔之間零對帳。
    //    ⚠️ 而病灶不是「沒人決定」:`supplier-config.ts` 那句「這家 2026-08-27 起排入每日班」
    //       寫在【解釋它的檔】,而沒有寫進【執行它的檔】。Sean 2026-08-27 拍板補這道對帳。
    //
    // 🔴 **分母不寫死**(否則第 18 家加進來它照樣綠 = 記錄現況而不是機制):
    //    · 「活的供應商」= 區塊裡 `writeAllowed: true`(`__gated_canary__` 是 false ⇒ 自動排除)
    //    · 「明文豁免」  = 區塊裡出現 `不接每日排程`(現行唯一一家:`extreme`,靜態一次性 fixture)
    //    ⇒ **豁免名單也不寫死** —— 下次有人刻意排除第二家,他在 config 寫那句話就好,
    //      **不必改這支測試**。📌 一道「每加一家就要改測試」的閘,會先被改成永遠通過。
    //
    // ⚠️ **兩個殘餘限制, 寫下來免得下一個人把這道閘讀得比實際強**(code-reviewer):
    //   ① 豁免判準是**中文子字串**, 而散文可以否定它 —— 實測把 extreme 那句改成
    //      「~~不接每日排程~~ 2026-09 起已改為接」而 matrix 不動 ⇒ **仍然全綠**。
    //      真正的解是在 `SupplierConfig` 加一個 `dailySync: false` 欄位(動型別 ⇒ 另一片)。
    //   ② 「第二家豁免不必改測試」成立, 而**取消 extreme 的豁免仍要改**下方
    //      `文案前提①` 的 `toContain('extreme')` ⇒ **這道機制的不寫死程度被隔壁那格封頂。**
    const blocks = configBlocks();
    // 🔴 **錨在欄位上**(code-reviewer important):原式 `/writeAllowed:\s*true/` 連**註解**都算 ——
    //    `__gated_canary__` 的前導註解現在寫的是 `writeAllowed=true`, **只差一個等號**;
    //    有人把它改成冒號(純註解編輯)⇒ canary 被判活 ⇒ 紅在 `['__gated_canary__']`,
    //    而它的註解逐字寫著「永不開寫、不入 rpm-sync.yml matrix」
    //    ⇒ **那是一個 finding 對而理由錯的紅, 照著改會把安全回歸靶弄壞。**
    const live = blocks.filter((b) => /^ {4}writeAllowed: true/m.test(b.block)).map((b) => b.key);
    const exempt = live.filter((k) => {
      const b = blocks.find((x) => x.key === k);
      return b !== undefined && b.block.includes('不接每日排程');
    });

    // 🔴 前提斷言三格 —— 沒有它們,「解析器什麼都沒抓到」與「完全對得上」印同一個綠。
    //    (`feedback_absence-read-as-verified`:什麼都沒有 ≠ 檢查過了。)
    // 🔴 **第二把尺**(code-reviewer important):區塊數要等於 `supplierSlug` 數。
    //    帶引號的鍵若被跳過, 那一家會整段併進下一家 ⇒ 兩數就會差開。
    //    ⚠️ 而每一塊還要**含著自己的 slug** —— 只比數量的話, 兩邊同時錯一格照樣相等。
    const slugCount = configuredSlugs().length;
    const 錯配 = blocks.filter((b) => !b.block.includes(`supplierSlug: '${b.key}'`)).map((b) => b.key);
    // ⚠️ **帶空白的鍵一律加引號** —— 本片今天在同一個坑踩了兩次。
    //    裸寫的失敗形狀是 `Test Files 1 failed` + `Tests  no tests`:
    //    **整支檔沒載進來, 而大家引用的 `Tests` 那行沒有任何紅。**
    expect({
      '解析到的家數夠多': blocks.length >= 15,
      '區塊數等於 slug 數': blocks.length === slugCount,
      '每塊都含自己的 slug': 錯配,
      '活的供應商非空': live.length > 0,
      '至少一家明文豁免': exempt.length > 0,
    }).toEqual({
      '解析到的家數夠多': true,
      '區塊數等於 slug 數': true,
      '每塊都含自己的 slug': [],
      '活的供應商非空': true,
      '至少一家明文豁免': true,
    });

    const expected = live.filter((k) => !exempt.includes(k)).sort();
    const actual = dailyMatrix().slice().sort();

    // 兩向差集都要空。分開列,因為兩個方向的意思完全不同:
    //   缺席 = 有一家在跑而沒人同步它的價格(客人看到舊價)
    //   多餘 = matrix 排了一家 config 裡不存在或不該跑的(job 會直接爆或白跑)
    // ⚠️ 鍵名帶空白 ⇒ 必須加引號。裸寫會 parse error, 而那個紅的形狀是
    //    `Test Files 1 failed` + `Tests  no tests` ——【檔紅而 0 格紅】,
    //    正是 CLAUDE.md 鐵則 11 記過的那一族:大家引用的 `Tests` 那行沒有任何紅。
    expect({
      '該在 rpm-sync.yml matrix 而不在': expected.filter((k) => !actual.includes(k)),
      '在 rpm-sync.yml matrix 而不該在': actual.filter((k) => !expected.includes(k)),
    }).toEqual({
      '該在 rpm-sync.yml matrix 而不在': [],
      '在 rpm-sync.yml matrix 而不該在': [],
    });
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
