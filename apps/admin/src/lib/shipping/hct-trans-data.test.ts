import type { ShipmentReference } from '@pcm/domain';
import { toShipmentReference } from '@pcm/domain';
import { describe, expect, it } from 'vitest';
import {
  HCT_DEFAULT_WEIGHT,
  HCT_INVOICE_TYPE,
  HCT_MAX,
  HCT_PRODUCT_KIND,
  addressAdvisories,
  buildHctTransData,
  phoneAdvisories,
} from './hct-trans-data';

// hct-trans-data.test.ts — ⟦ship-HCTAPI⟧ 片 A 的守門。
//
// ⚠️ **2026-09-09:codex 唯讀審查【沒有跑過本檔一格】—— 寫在這裡免得被讀成審過。**
//    那三輪(R1/R2/R3)都是 `-s read-only --disable apps`,而唯讀沙箱不給建暫存目錄
//    ⇒ Vitest 在**載入之前**就失敗,codex 每一輪都自己聲明「零測試執行,不能算通過」。
//    ⇒ 📌 **它審的是碼與它自己的記憶體探針,不是這些格子。** 測試是施工窗自己跑的。
//    🛑 下一個讀那三份報告的人:**「三輪審過」不等於「測試也審過」。**
//
// 🔴🔴 **這一片的正確性【完全靠這支檔】** —— 它零網路零 env 零 DB,
//    所以沒有任何「真的跑一次」可以幫它。⇒ 📌 **這裡漏掉的,線上沒有第二道會接。**
//
// 🔴 **而斷言【寫字面值, 不寫 import 來的常數】** —— 那是 2026-09-04 adversarial-reviewer
//    在同一條線上打出來的:畫面測試全部 `import` 常數去比 ⇒ **把常數的值改掉每一格照樣全綠**
//    ⇒ 🎯 測試問的是「產出的與常數一樣嗎」, 而**沒有人問「常數是他拍的那個值嗎」**。
//    ⇒ ✅ 所以下面 Sean 拍的那三個值**逐字寫死**, 而常數那一側另有一格釘它。

const RECIPIENT = { name: '王小明', phone: '0912345678', line: '新北市新莊區化成路 736 巷 18 號' };
// ⛔ ~~`displayId: 'PCM-2026-0001'`~~ —— 2026-09-06 ⟦ship-EPINOUNIQUE⟧ 當場核出來:
//    正式碼餵的是 6 碼**箱號**(`shipment-actions.ts` 逐字 `row.shipmentReference`),
//    而這支 fixture 一直餵**訂單**編號 ⇒ 📌 **fixture 供應了真實世界不會送的東西**(本 repo 記過)。
// 🔴🔴 **⟦ship-EPINOBRAND⟧:測試要【刻意構造非法的箱號】, 而型別擋著。**
//    ⇒ 這裡開一個具名的出口 `BAD()`, 而**不是**在每一格散寫 `as ShipmentReference`:
//      ① 一個具名函式讀起來就是「我在造一個不該存在的值」, 而 `as` 讀起來像「我知道我在做什麼」
//      ② lint 規則只要盯 `as ShipmentReference` 這個字面 ⇒ **正式碼零命中**才是那道保護的證據,
//        而測試散寫 `as` 會把那個 0 弄髒 ⇒ 📌 **把髒集中在一個看得見的地方。**
//    ⚠️ 它只該出現在「證明型別擋得住」的那幾格。
// 🔴 測試刻意造非法箱號:下面那一行【就是】那道保護要擋的形狀, 集中在一個具名出口,
//    是為了讓正式碼那邊的命中數維持在 0(見上面那段)。
// ⚠️ **`eslint-disable-next-line` 只管【緊接的那一行】** —— 我第一版把它放在兩行註解的上面
//    ⇒ 它去 disable 了一行註解 ⇒ lint 印 `Unused eslint-disable directive`, 而那個警告
//    正好是**唯一會告訴你「你的 disable 沒有蓋到東西」的訊號**。📌 它與碼之間不准夾任何一行。
// eslint-disable-next-line no-restricted-syntax
const BAD = (v: string) => v as unknown as ShipmentReference;

const BASE = { shipmentReference: toShipmentReference('B7K3MN'), recipient: RECIPIENT, itemCount: 1 };

describe('⟦ship-HCTAPI⟧ 片 A · Sean 拍的三個值(字面寫死, 不從常數 import)', () => {
  /**
   * 🔴🔴 **重量那一格要釘【兩件事】, 而第二件才是重點。**
   * 他 2026-09-04 拍 `2`, 而他同天附的樣張五張標籤逐張印 **`重 5`**。
   * ⇒ 🛑 **下一個看到樣張的人會把 2「修正」成 5, 而他每一步都做對了。**
   * ⇒ ✅ 所以這一格同時斷言「是 2」與「**不是 5**」—— 後者讓那個修正**當場紅**,
   *    而紅的訊息會告訴他樣張上那個 5 是什麼。
   */
  it('🔴 重量 = 2 —— 而它【不是】樣張上那個 5', () => {
    const { fields } = buildHctTransData(BASE);
    expect(fields.eqamt, 'Sean 2026-09-04 逐字「你填入2吧」').toBe('2');
    expect(
      fields.eqamt,
      '樣張 PDF 五張標籤逐張印「重 5」—— 那是他【過去的實務】, 不是拍板值。改成 5 = 推翻一個拍板。',
    ).not.toBe('5');
  });

  it('🔴 傳票類別 = 11(元付)· 商品種類 = 001(一般)', () => {
    const { fields } = buildHctTransData(BASE);
    expect(fields.eprdct, 'Sean 逐字「商品種類 11元付、一般小物」的前半').toBe('11');
    expect(fields.eprdcl2, '同一句的後半:類型「一般」= 規格第 10 頁的 001').toBe('001');
  });

  /**
   * 🔵 **常數那一側也釘一格** —— 上面三格吃的是**產出**,
   * 而若有人改了常數**又同時**改了測試, 兩邊會一起走。這一格讓常數自己也有一個字面錨。
   */
  it('🔵 常數本身也是那三個字面(產出與常數各釘一半)', () => {
    expect(HCT_DEFAULT_WEIGHT).toBe('2');
    expect(HCT_INVOICE_TYPE).toBe('11');
    expect(HCT_PRODUCT_KIND).toBe('001');
  });
});

describe('⟦ship-HCTAPI⟧ 片 A · 截斷 —— 而截斷這件事要被看見', () => {
  /**
   * 🔴 **規格長度是量到的**(⛔ ~~PDF 第 10 頁:`ertel1` **15**~~ ——
   * **2026-09-09 換版訂正**:現行權威是 V15 第 12–13 頁,`ercsig` 40 / **`ertel1` 20** /
   * `eraddr` 100 / `epino` 30。那個 15 是 `ettel1`(**出貨人**電話)的值,被拿混了)。
   * 而我們這邊 `AddressInput` 那三欄**一個 `.max()` 都沒有** ⇒ 這一族是真的會發生。
   *
   * 🔵 **本格改讀 `HCT_MAX` 而不是寫死數字** —— 它測的是「有沒有截到那條線」這個**行為**,
   *    而**那條線的值本身**由 `hct-trans-data-pdf-conformance.test.ts` 的第 ⑥ 格對著規格表釘住。
   *    ⇒ 📌 兩件事分兩個檔管:**這裡問「有沒有照線切」,那裡問「線畫在哪」。**
   *    ⚠️ 代價寫出來:本格因此**擋不住「有人把 HCT_MAX 改壞」** —— 那道防線在另一支檔。
   */
  it('🔴 超長的三欄各自被截到規格長度, 而【每一欄都出現在 truncated 裡】', () => {
    const { fields, truncated } = buildHctTransData({
      ...BASE,
      recipient: { name: '名'.repeat(60), phone: '0'.repeat(30), line: '路'.repeat(200) },
    });
    expect(fields.ercsig.length).toBe(HCT_MAX.name);
    expect(fields.ertel1.length).toBe(HCT_MAX.phone);
    expect(fields.eraddr.length).toBe(HCT_MAX.address);
    // 🔴 承重:少了這一行, 一個「安靜截斷」的實作照樣通過上面三格。
    // ⚠️ 兩邊都要排序 —— 我第一版只排了實際值, 期望值照著【欄位在型別裡的順序】寫
    //    ⇒ 紅在一個與行為無關的地方。📌 一個沒有排序的集合比較, 綠不綠取決於實作的迭代順序。
    expect([...truncated].sort()).toEqual(['ercsig', 'eraddr', 'ertel1'].sort());
  });

  /**
   * 🔵 **負對照** —— 沒有這一格, 一個「永遠回滿一份 truncated 清單」的實作也會全綠。
   * 而它同時釘住:**沒超長時不得動那個值**(`clip` 回原字串, 不 trim、不正規化)。
   */
  it('🔵 負對照:沒超長 ⇒ truncated 是空的, 而每一欄逐字等於原值', () => {
    const { fields, truncated } = buildHctTransData(BASE);
    expect(truncated).toEqual([]);
    expect(fields.ercsig).toBe('王小明');
    expect(fields.ertel1).toBe('0912345678');
    expect(fields.eraddr).toBe('新北市新莊區化成路 736 巷 18 號');
    // ⛔ ~~`toBe('PCM-2026-0001')`~~ —— 受詞換了不是期望值放鬆:這一欄餵的一直是**箱號**,
    //    fixture 才是錯的那一邊(⟦ship-EPINOUNIQUE⟧ 2026-09-06)。
    expect(fields.epino).toBe('B7K3MN');
  });

  it('🔵 剛好等於上限 ⇒ 不算截斷(邊界是 <=, 不是 <)', () => {
    const { truncated } = buildHctTransData({
      ...BASE,
      recipient: { ...RECIPIENT, name: '名'.repeat(HCT_MAX.name) },
    });
    expect(truncated, '剛好 40 字被判成截斷 ⇒ 員工會看到一個不存在的警告').toEqual([]);
  });
});

describe('⟦ship-HCTAPI⟧ 片 A · 件數 —— 錯的輸入不得被夾成合法值', () => {
  /**
   * 🔴 規格逐字「必要欄位(**最小為 1**)」。
   * 🛑 **而我刻意不夾** —— `itemCount = 0` 不是「這箱沒東西」, 是**呼叫端算錯了**。
   *    夾到 1 會讓一個錯的輸入變成一個**合法的請求**, 而那正是最難查的那種:
   *    🎯 **新竹會收下它, 而錯誤在司機拿到箱子的那一刻才顯形。**
   */
  it.each([0, -1, 1.5, Number.NaN])('🔴 件數 %s ⇒ 丟例外, 不夾到 1', (n) => {
    expect(() => buildHctTransData({ ...BASE, itemCount: n })).toThrow(/件數必須是/);
  });

  it('🔵 正對照:件數 3 ⇒ 逐字 "3"(證明上面那幾格不是因為它永遠丟例外)', () => {
    expect(buildHctTransData({ ...BASE, itemCount: 3 }).fields.ejamt).toBe('3');
  });
});

describe('⟦ship-HCTAPI⟧ 片 A · 本檔【不做】的事', () => {
  /**
   * 🔴🔴 **這一格守的是【爆炸半徑】, 不是行為。**
   * 片 A 的整個存在理由是「零網路零 env 零 DB」⇒ 而那是一個**會被人順手破壞**的性質:
   * 下一個人要接線時, 最自然的動作就是在這裡加一支 `fetch`。
   * ⇒ 📌 那一刻這一片就不再是「用單元測試驗得完」的東西了, **而沒有東西會叫。**
   *
   * 🛑 **先去註解再掃** —— 本檔的註解裡大量提到 `fetch` / `env` / 送出,
   *    而**掃原始檔會恆紅, 恆紅的閘會被關掉**(2026-09-04 同一條線上學到的)。
   */
  it('🔴 本檔不得出現網路 / env / DB 呼叫(去註解之後掃)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(fileURLToPath(new URL('./hct-trans-data.ts', import.meta.url)), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    for (const bad of ['fetch(', 'process.env', 'axios', 'supabase', 'createClient']) {
      expect(code, `片 A 出現 ${bad} ⇒ 它不再是「零網路零 env 零 DB」, 而那是它整片的前提`).not.toContain(bad);
    }
    // 🟢 正對照:去註解之後碼還在(否則上面每一格都是恆綠的)。
    expect(code, 'stripComments 把整支檔吃光了 ⇒ 上面那幾個 not.toContain 什麼都證不到').toContain(
      'export function buildHctTransData',
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ⟦ship-EPINOUNIQUE⟧ 2026-09-06 —— `epino` 的格式閘
//
// 🛑 **這一族守的是一個【看起來像在修 bug】的改動。**
//    那個參數以前叫 `displayId`、docstring 寫「我方單號, 形如 `PCM-2026-0001`」、
//    而**四支測試 fixture 也都餵訂單編號** —— 只有正式碼餵的是 6 碼箱號。
//    ⇒ 下一個人「照名字把它修好」= 真的傳訂單 `displayId` 進來, 而那會壞在**新竹那一側**:
//      官方 `API服務說明 ver 2.0` P.8 逐字 `訂單編號 -> 同一個 ESDATE 不可重複`,
//      而**一張訂單可以有很多箱** ⇒ 同一天第二箱撞線;更糟的分支是
//      `新竹貨號+訂單編號 -> 當日重複上傳, 視同更正` ⇒ **第一箱的託運資料被蓋掉, 而我們畫面上兩箱都在。**
//    ⇒ 📌 **註解擋不住那個改動** —— 它讀起來就是在修一個名字不對的東西。
//    ⛔ ~~所以擋它的是一道會 throw 的閘~~ —— **那句是假的**(codex R2:同一段裡的假保護字面沒清乾淨):
//      下面 `:173` 那一格**故意證明了新式訂單編號會通過這道閘**。
//      ✅ **格式閘只擋畸形值**;擋「傳錯來源」的是 `shipment-actions.test.ts` 那一格,
//        而**那一格是源碼層、也擋得住的只有【天真的那一種改法】**(射程寫在它自己的檔頭)。
//
// ✅ **「不可重複」那條線的一半今天由 DB 守著, 而本片不需要新的 migration**:
//    `shipments_reference_unique UNIQUE (shipment_reference)`
//    (`supabase/migrations/20260805170000_m4b_e10_b2_s1a1_shipments.sql:100`, 並有 `:319` 後檢查點名它)
//    ⛔ ~~⇒ 全域唯一, 比新竹要的「同日不可重複」嚴~~ —— **那句寫寬了**(codex R1 MF4 / R2 再指一次:
//      我在檔頭沒清乾淨):UNIQUE 擋的是**兩列**共用箱號;**同一列**在人工把 `unknown` 推回 `draft`
//      之後**可以再送一次** ⇒ 同一天同一個 `epino` 兩發。🔵 而那是**對的行為**(同一箱更正它自己),
//      不是本片要擋的東西。而「100 天不可重複」管的是新竹配的 `edelno`, 不在我們手上。
describe('⟦ship-EPINOUNIQUE⟧ epino 的格式閘', () => {
  // ⛔ ~~🔴 餵【訂單編號】進來要當場 throw —— 那是這道閘存在的全部理由~~
  //    🔴🔴 **那一格是假的, 而它綠**(codex R1 抓到, 我開檔複驗):它餵 `'PCM-2026-0001'`,
  //    那是**舊格式**訂單編號;而 `20260729010000_m4b_e10_d0_display_id_expand.sql:76-79`
  //    把 `orders_display_id_format` 放寬成**也接受 6 碼**, `20260730120100` 讓建單真的改用它
  //    ⇒ 🛑 **今天的新訂單編號與箱號在字串上完全一樣** ⇒ 這道閘分不出來。
  //    ⇒ 📌 **fixture 供應了真實世界不再送的東西** —— 我今晚才把這個坑寫進 traps, 然後自己踩了。
  it('🟡 舊格式訂單編號會被擋 —— 而**這只涵蓋舊格式**, 不要讀成「訂單編號都擋得住」', () => {
    expect(() => buildHctTransData({ ...BASE, shipmentReference: BAD('PCM-2026-0001') })).toThrow(
      /\[epino\/shipment_reference\]/,
    );
  });

  it('🛑 誠實的負對照:一個【合法的新式訂單編號】會【通過】這道閘 —— 這一格釘住它做不到什麼', async () => {
    // 🔴 這一格**故意斷言它通過**。那不是漏洞被接受了, 是**把射程釘死**:
    //    下一個人若以為「格式閘擋得住傳錯訂單編號」, 這一格會當場告訴他不是。
    //    ✅ 真正擋那件事的是【值的來源】—— `shipment-actions.test.ts` 那一格釘住
    //      正式碼從 DB 的 row 拿這個值。
    const looksLikeOrderId = 'C4Q9PZ';
    // 🔵 **「它是合法的新式訂單編號」從【我說的】升成【量到的】**(code-reviewer R3):
    //    去讀那支放寬 CHECK 的 migration, 拿它第二條 regex 當場驗這個字串。
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const sql = readFileSync(
      join(__dirname, '../../../../../supabase/migrations/20260729010000_m4b_e10_d0_display_id_expand.sql'),
      'utf8',
    );
    const m = sql.match(/display_id ~ '(\^\[23456789[^']+\$)'/);
    expect(m, '那支 migration 裡找不到 6 碼那條 regex ⇒ 本格的前提沒被驗到').not.toBeNull();
    expect(
      new RegExp(m![1]!).test(looksLikeOrderId),
      `${looksLikeOrderId} 不是合法的新式訂單編號 ⇒ 本格在證別的事`,
    ).toBe(true);
    expect(buildHctTransData({ ...BASE, shipmentReference: BAD(looksLikeOrderId) }).fields.epino).toBe(
      looksLikeOrderId,
    );
  });

  it('🟢 分母自檢:合法的 6 碼箱號要過(否則上面那格只是「什麼都擋」)', () => {
    expect(buildHctTransData({ ...BASE, shipmentReference: toShipmentReference('B7K3MN') }).fields.epino).toBe('B7K3MN');
  });

  it('🔴 逐項負對照:長度對而字母表不對 / 字母表對而長度不對, 兩種都要擋', () => {
    // 🔵 這一格在問「它擋的是不是【那個格式】」, 而不只是「擋掉了一個長字串」。
    //    `0` `O` `1` `I` `L` `A` `E` `U` 是建表 CHECK 刻意排除的(人眼易混與粗話規避)。
    // ⛔ ~~舊版只逐值測了 `0` `O` `L` 三個, 而註解宣稱「逐項」~~(codex R2 nit)
    //    ✅ 現在**八個排除字元一個一個測**, 宣稱與覆蓋對得起來。
    const excluded = [...'0O1ILAEU'].map((c) => `B7K3M${c}`);
    for (const bad of [...excluded, 'B7K3M', 'B7K3MNN', 'b7k3mn', '', 'X'.repeat(200)]) {
      expect(() => buildHctTransData({ ...BASE, shipmentReference: BAD(bad) }), bad).toThrow(
        /\[epino\/shipment_reference\]/,
      );
    }
  });

  // ⛔ ~~🎯 業務理由釘樁:同一張訂單的兩箱, 送出去的是兩個不同的 epino~~ —— **已刪**(codex R1)。
  //    它只是把兩個**我自己手打的不同字串**餵進一個純函式再斷言它們不同
  //    ⇒ 🛑 **在「有人改成傳訂單 displayId」那個世界裡它照樣全綠** ⇒ 零判別力。
  //    📌 「業務理由釘樁」六個字不會讓一格產生判別力 —— 我今晚第二次寫出這種格子。
  //    ✅ 真正釘那件事的在 `shipment-actions.test.ts`(值的來源), 不在這裡。
});

// 🔴 兩份 regex(TS 一份、DB CHECK 一份)刻意不共用 —— 而「刻意」只有在有這一格時才成立。
//    沒有它, 兩份各自漂移是**無聲的**(codex R1 nit)。
describe('⟦ship-EPINOUNIQUE⟧ TS 的箱號 regex 與 DB CHECK 逐字相同', () => {
  it('🔴 掃【全部】migration 找 shipment_reference 的 CHECK 字面, 與 TS 那一行比', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(__dirname, '../../../../../supabase/migrations');
    // ⛔ ~~只讀 `20260805170000` 那一支、而且取【第一個】match~~(codex R2 must-fix):
    //    ① 後來的 migration 改掉那條 CHECK ⇒ 這一格照樣讀舊的 ⇒ **假綠**
    //    ② 同一支檔裡若有註解先提到舊 regex, `match` 取第一個命中 ⇒ **也是假綠**
    // ✅ 改成:掃**全部** migration、收集**每一個**命中, 然後要求它們**彼此逐字相同**
    //    —— 有兩種不同的字面就是漂移, 不管它住在哪一支檔。
    const found: { file: string; re: string }[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
      const sql = readFileSync(join(dir, f), 'utf8');
      for (const m of sql.matchAll(/shipment_reference\s*~\s*'(\^[^']+\$)'/g)) {
        found.push({ file: f, re: m[1]! });
      }
    }
    // 🔵 分母自檢:一個都沒找到 ⇒ 下面每一句都是在比空氣。
    expect(found.length, `全部 migration 裡找不到 shipment_reference 的 CHECK 字面(掃了 ${dir})`).toBeGreaterThan(0);
    // ⛔ ~~要求【全部歷史】命中彼此相同~~(code-reviewer R3):①未來一次**合法**的收緊
    //    (`ALTER ... DROP/ADD CONSTRAINT`)會讓它紅到**只能靠改測試才修得好** ⇒ 下一個人會刪掉它
    //    ②`DROP CONSTRAINT` 它完全看不見。
    // ✅ 改成:**檔名排序取最後一個命中**當「現行那一份」—— 那才是 TS 要對齊的東西。
    // 🛑 而 `DROP CONSTRAINT` 那個盲區**沒有修掉**:本格看不到「那條 CHECK 被拿掉了」。已知缺口。
    const current = found[found.length - 1]!;

    // TS 那一份 —— 讀**原始碼字面**不 import 常數(import 進來比的是同一個物件等於它自己)。
    const ts = readFileSync(join(__dirname, 'hct-trans-data.ts'), 'utf8');
    const all = [...ts.matchAll(/const SHIPMENT_REFERENCE_RE = \/([^/]+)\/;/g)];
    expect(all, 'hct-trans-data.ts 裡那個 regex 不是恰好一個 ⇒ 本格零判別力').toHaveLength(1);
    expect(
      all[0]![1],
      `TS 與 DB 的箱號格式漂移了:TS=${all[0]![1]} · SQL=${current.re}(來自 ${current.file})`,
    ).toBe(current.re);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ⟦ship-EPINOBRAND⟧ 2026-09-06 —— **型別層的負對照, 而它跑在【真的 tsc】上**
//
// 🔴🔴 **為什麼不是一個普通的 `it()`**:vitest **不看型別** ——
//    一支型別完全錯的檔在 vitest 裡照樣全綠。⇒ 一個「用 vitest 驗型別擋得住」的守門是假的。
// ✅ **`@ts-expect-error` 是 typecheck 層的斷言**:它要求下一行**必須**有型別錯誤;
//    沒有錯誤時 `tsc` 自己會紅(`Unused '@ts-expect-error' directive`)。
//    ⇒ 📌 **它跑在每一發 `pnpm typecheck` 裡, 而不是只在有人想到要跑 selftest 的時候。**
//
// 🎯 **它釘的那個世界**:有人把 `row.displayId`(型別是 `string`)塞進這一欄 ——
//    那正是 codex R2 給的那個繞法在 branded type 下會撞到的地方。
describe('⟦ship-EPINOBRAND⟧ 型別層負對照(由 tsc 執行, 非 vitest)', () => {
  it('🟢 分母自檢:下面那一段真的被編譯器看過(本格只證明這支檔在 typecheck 的範圍裡)', () => {
    // 🔵 這一格**故意什麼都不斷言型別** —— 型別那半由上面那個 `@ts-expect-error` 在 tsc 裡執行。
    //    本格存在的理由只有一個:如果哪天這支檔被移出 tsconfig 的範圍,
    //    那個 `@ts-expect-error` 會**無聲地不再被檢查**, 而 vitest 這一格至少還會告訴你檔還在跑。
    expect(typeof buildHctTransData).toBe('function');
  });
});

// 🔴 **這一段在【模組層】, 不在 `it()` 裡** —— 型別檢查不需要執行, 而放進 `it()` 反而
//    會讓人以為「跑了測試才算數」。它在 tsc 掃到這支檔的當下就成立或不成立。
{
  const orderDisplayIdFromDb: string = 'C4Q9PZ'; // 一個合法的【訂單】編號 —— 型別是 string
  // @ts-expect-error ⟦ship-EPINOBRAND⟧ 負對照:一個普通 string 不得被當成 ShipmentReference。
  //   這一行【必須】是型別錯誤 —— 不是的話 tsc 會用 `Unused '@ts-expect-error' directive` 叫,
  //   而那句話的意思是:**那個 brand 已經不擋東西了。**
  const leak: ShipmentReference = orderDisplayIdFromDb;
  void leak;
}

/**
 * ⟦ship-HCTFIELDRULES⟧ **V15 第 11 頁的電話與地址規則**(Sean 2026-09-09 拍甲)。
 *
 * 🔴🔴 **這一族真正要守的是【分界】,不是「有沒有檢查」** ——
 *    電話那三條**證得出來 ⇒ 擋**;地址那兩條**判不準 ⇒ 只提醒**。
 *    ⇒ 📌 哪天有人把地址那兩條升級成硬閘,下面那兩格負對照會紅。
 *      **而那正是這一族存在的理由** —— 硬擋會擋到正常單,而正常單被擋的代價比被拒更重。
 */
describe('⟦ship-HCTFIELDRULES⟧ 電話:抓得出來的幾條, 只提醒不擋', () => {
  it.each([
    ['+886912345678', '國碼'],
    ['886912345678', '國碼'],
    ['0912345678#12', '分機'],
    ['02-2345-6789 分機 12', '分機'],
    ['02-2345-6789 ext.12', '英文字'],
    ['912345678', '0 開頭'],
    ['2-2345-6789', '0 開頭'],
  ])('%s ⇒ 報「%s」', (phone, hint) => {
    const out = phoneAdvisories(phone);
    expect(out.length, `${phone} 應該被抓到`).toBeGreaterThan(0);
    expect(out.join(' ')).toContain(hint);
  });

  // 🟢 負對照:少了它, 一個 `() => ['錯']` 的實作會通過上面每一格。
  it.each(['0912345678', '0288888888', '02-2345-6789', '0912 345 678', '(02)2345-6789'])(
    '🟢 負對照:%s 是合法的 ⇒ 零違反',
    (phone) => {
      expect(phoneAdvisories(phone)).toEqual([]);
    },
  );

  /**
   * 🔵 **`+886…` 同時命中①與③, 而只報①** —— 兩句話講同一件事會讓員工以為要改兩個地方。
   * ⚠️ 這一格釘的是**訊息的數量**, 不是判準本身 —— 判準改了它不會紅。
   */
  it('🔵 帶國碼時只報一句(不與「0 開頭」重複報)', () => {
    expect(phoneAdvisories('+886912345678')).toHaveLength(1);
  });

  /**
   * 🛑 **空字串不在這裡報** —— `AddressInput` 已經擋空與純空白
   *    (`packages/schemas/src/address.test.ts` 那兩格),在這裡再報一次會出現兩句話。
   */
  it('🛑 空字串不由本函式負責 ⇒ 零違反(它在 schema 那一層被擋)', () => {
    expect(phoneAdvisories('')).toEqual([]);
    expect(phoneAdvisories('   ')).toEqual([]);
  });
});

describe('⟦ship-HCTFIELDRULES⟧ 地址:判不準的兩條, 只提醒', () => {
  it('有「大樓／大廈」⇒ 出一句提醒', () => {
    expect(addressAdvisories('台北市中正區某某大樓 5 樓').join(' ')).toContain('大樓');
    expect(addressAdvisories('新北市板橋區某某大廈').length).toBeGreaterThan(0);
  });

  it('有兩個以上連續英文字母 ⇒ 出一句提醒', () => {
    expect(addressAdvisories('台中市西屯區 No.201 文心路').join(' ')).toContain('英文');
  });

  /**
   * 🟢🟢 **負對照 —— 而這一格是本族最重要的一格。**
   * `5F` / `B1` 是**合法的樓層寫法**,單一個英文字母不報。
   * ⇒ 📌 少了它,一道「看到英文就叫」的規則會對**大多數正常地址**出聲,
   *   而一個天天出聲的提醒等於沒有提醒。
   */
  it.each([
    '台中市西屯區文心路二段 201 號',
    '台北市信義區信義路五段 7 號 5F',
    '新北市新莊區化成路 736 巷 18 號 B1',
  ])('🟢 負對照:%s ⇒ 零提醒', (line) => {
    expect(addressAdvisories(line)).toEqual([]);
  });
});

describe('⟦ship-HCTFIELDRULES⟧ buildHctTransData 把電話與地址都收進 advisories', () => {
  /**
   * 🔴🔴 **本族最承重的一格:`BuildHctTransDataResult` 上【不准有會擋的桶】。**
   *    2026-09-09 先做了 `violations`(擋)、當天被 Sean 改拍成提醒而整支刪除 ——
   *    成因是後台改不動既有訂單的收件人電話 ⇒ 擋下來員工無事可做。
   *    ⇒ 📌 這一格讓「有人把會擋的桶加回來」當場紅,而**紅的訊息會告訴他先解那個缺口**。
   */
  it('🔴 回傳形狀上只有 advisories 一個桶(沒有會擋的那個)', () => {
    const built = buildHctTransData(BASE);
    expect(Object.keys(built).sort()).toEqual(['advisories', 'fields', 'truncated']);
  });
  /* 🛑 **上面那一格的射程,寫出來免得它被讀寬**(codex 2026-09-09 nit,附反例):
       它抓得到「無條件多一個可列舉欄位」,抓不到
         ① 只在有問題時才出現的欄位 —— `...(built.advisories.length ? { violations: [...] } : {})`
            ⇒ 乾淨的 `BASE` 仍然只有三個鍵 ⇒ **這一格照樣綠**
         ② 只加型別不加值
         ③ 直接在 action 裡硬擋(那根本不經過本函式)
       ⇒ 📌 **它擋的是「順手加回來」,不是「決心加回來」。** 真正的防線是
         `shipment-submit-hct-action.ts` 那段訃聞註解裡寫的那個前提:先解掉
         「後台改不動既有訂單收件人電話」那個缺口,再談要不要擋。 */

  it('🟡 電話問題與地址問題都進同一個 advisories 桶', () => {
    const built = buildHctTransData({
      ...BASE,
      recipient: { name: '王小明', phone: '+886912345678', line: '台北市中正區某某大樓' },
    });
    const joined = built.advisories.join(' ');
    expect(joined).toContain('國碼');
    expect(joined).toContain('大樓');
  });

  /**
   * 🔴 **每一句都要講「送出去會怎樣」** —— 員工改不了這支電話,他能做的判斷只有
   *    「要不要照樣送」⇒ 那他需要知道的是後果,不是「哪裡不對」。
   * ⛔ ~~舊字面「不可帶國碼 …請只留主號」~~ 是在叫他做一件他做不到的事。
   */
  /**
   * ⛔ ~~`not.toContain('請')`~~ —— **codex nit,兩個方向都錯**:
   *    合理的「…可能被退,**請**確認是否仍要送出」會紅;
   *    而違規的「…**先修改電話再送出**」照樣綠。📌 **它測的是一個字,不是那句話在要求什麼。**
   * ✅ 改成兩件都測得到的:①每一句都講後果 ②不出現那幾個**叫人去改資料**的祈使語。
   *    🛑 那份清單是**列舉不是定義** —— 它擋得住今天已知的寫法,擋不住一個新發明的說法。
   */
  it('🔴 電話與地址的提醒都要講「可能被退」, 而且不叫員工去改一個改不到的東西', () => {
    const ORDERS = ['先修改', '請先改', '請改成', '請確認拿掉', '請只留'];
    const all = [
      ...phoneAdvisories('+886912345678'),
      ...phoneAdvisories('0912345678#12'),
      ...phoneAdvisories('912345678'),
      ...addressAdvisories('台北市中正區某某大樓'),
      ...addressAdvisories('台中市西屯區 No.201'),
    ];
    expect(all.length).toBeGreaterThan(0);
    for (const line of all) {
      expect(line, `這句沒有講後果:${line}`).toContain('可能被退');
      for (const order of ORDERS) {
        expect(line, `這句在叫員工改一個改不到的東西:${line}`).not.toContain(order);
      }
    }
  });

  it('🟢 負對照:乾淨的輸入 ⇒ advisories 是空的', () => {
    expect(buildHctTransData(BASE).advisories).toEqual([]);
  });
});

/**
 * ⟦ship-HCTFIELDRULES⟧ **codex 2026-09-09 唯讀審查的 nit,逐個釘住實測輸入。**
 * 🔵 這幾格的價值不是「規則更嚴」,是**把審查員實跑出來的那幾個輸入留在檔裡** ——
 *    下一個改正則的人會先看到它們,而不是自己再撞一次。
 */
describe('⟦ship-HCTFIELDRULES⟧ codex 實測輸入(誤傷與漏網)', () => {
  /**
   * 🔴🔴 **換路之後,這一格的期望值【反過來】了 —— 而那是刻意的。**
   *    ⛔ ~~`0912345678 Text` ⇒ 零提醒~~(舊判準要猜「這是不是分機」,而 Text 不是)
   *    ✅ 新判準是「電話欄裡不該有英文字」⇒ **它會出聲,而理由是真的**:
   *      那一欄有兩個英文字母,新竹只收數字。📌 **從「我推的分類」換成「我量得到的事實」。**
   */
  it('🔴 `0912345678 Text` 會出聲, 而理由是「有英文字」不是「分機」', () => {
    const out = phoneAdvisories('0912345678 Text').join(' ');
    expect(out).toContain('英文字');
    expect(out, '不准宣稱那是分機 —— 那是推的').not.toContain('分機');
  });

  it('🔴 全形零 `０912345678` 是合法的 —— NFKC 之後才判', () => {
    expect(phoneAdvisories('０９１２３４５６７８')).toEqual([]);
  });

  it('🔴 全形井號 `＃` 也算分機(NFKC 折成 #)', () => {
    expect(phoneAdvisories('0912345678＃12').join(' ')).toContain('分機');
  });

  /**
   * 🟢 正對照:邊界沒有把真的 ext 放掉。
   * 🔴 **後兩格是 codex R2 must-fix 的實測輸入** —— 我第一版用 `\bext\b`,
   *    而 `ext12` / `ext.12` 的右邊沒有詞界 ⇒ **真的分機從那個洞漏出去、第一次按就直接送單。**
   *    📌 修一個誤判、開一個漏網,兩件事同一行。
   */
  /**
   * 🔴 **列舉法追不完 —— 這一串是三輪 codex 各給我一個的漏網,現在由一條規則全包。**
   *    `\bext\b` 漏 `ext12` · `(?<![A-Za-z])ext` 誤報 `extra` ·
   *    `(?<![A-Za-z])ext(?![A-Za-z])` 漏 `extension1` / `extn12`。
   *    ⇒ ✅ 現行判準「電話欄裡有連續兩個英文字母」⇒ **每一種寫法都命中,不必猜。**
   */
  it.each([
    '0912345678 ext 12',
    '02-23456789 ext12',
    '02-23456789ext.12',
    '087123456 extension1',
    '02-23456789 extn12',
    '0912345678 extra',
  ])('🟢 %s 都會出聲(不論它是哪一種寫法)', (phone) => {
    expect(phoneAdvisories(phone).length, phone).toBeGreaterThan(0);
  });

  // 🔵 單一個 `x` 接數字 —— `{2,}` 抓不到它, 由分機那條接住。
  it('🔵 `0912345678x12` 由分機那條抓到(單一字母)', () => {
    expect(phoneAdvisories('0912345678x12').join(' ')).toContain('分機');
  });

  /**
   * 🛑 **`0886123456` 是 0 開頭的合法號碼,不是國碼** ——
   *    判準看的是「去掉符號之後是不是 886 開頭」,而它是 0886 ⇒ 不報。**這一格是刻意的。**
   */
  it('🛑 `0886123456` 不報國碼(它是 0 開頭)', () => {
    expect(phoneAdvisories('0886123456')).toEqual([]);
  });

  /**
   * 🔴🔴 **codex 2026-09-09 must-fix 的兩個可複現輸入。**
   *    兩者舊版都會撞到截短確認(16/17 字 > 舊上限 15), 而 15→20 之後**不再撞**
   *    ⇒ 📌 少了這兩條規則, 它們會**第一次按就直接送出去** —— 上限修對反而放行了壞資料。
   */
  it.each([
    ['00 886 912345678', '國碼'],
    ['02-23456789 x1234', '分機'],
    ['02-23456789 轉12', '分機'],
    ['087123456 extension1', '英文字'],
    ['02-23456789 extn12', '英文字'],
  ])('🔴 %s 要抓到「%s」(15→20 之後它們不再被截短攔住)', (phone, hint) => {
    expect(phoneAdvisories(phone).join(' '), phone).toContain(hint);
  });

  // 🔴 地址也要 NFKC:全形英文不折的話會整段漏過去(codex nit)。
  it('🔴 全形英文的地址也要報', () => {
    expect(addressAdvisories('測試路1號 Ｎｏ．２').join(' ')).toContain('英文');
  });

  /**
   * 🔴 **前導空白 + 號碼 ⇒ 送出去的不可以是一串空白**(codex nit,可複現)。
   *    不 trim 的話 20 格空白會先佔滿 `HCT_MAX.phone` ⇒ 號碼整段被截掉。
   */
  it('🔴 前導空白不得把號碼擠掉 —— 送出去的是號碼不是空白', () => {
    const { fields } = buildHctTransData({
      ...BASE,
      recipient: { ...RECIPIENT, phone: `${' '.repeat(20)}0912345678` },
    });
    expect(fields.ertel1).toBe('0912345678');
    expect(fields.ertel1.trim(), '送出一串空白 = 新竹打不通而我們以為送對了').not.toBe('');
  });
});
