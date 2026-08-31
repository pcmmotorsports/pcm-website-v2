import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ══════════════════════════════════════════════════════════════════════════
// ⟦b4-PURCHTAX1⟧ · **含稅保證不住在合約裡** —— 本檔【釘住這個現況】, 不是修好它。
// ══════════════════════════════════════════════════════════════════════════
//
// 🛑🛑 **先講清楚它【不是】什麼**:
//    **它擋不到任何一塊錯的錢。** 員工在代購列打一個未稅價,這一族**一格都不會紅**。
//    它只做一件事:**讓這個缺口不會被靜靜地改掉或改壞。**
//    ⇒ 🔴 **`⟦b4-PURCHTAX1⟧` 仍然 open。** 看到「PURCHTAX1 有守門了」而把它劃掉的人,
//      劃掉的是一件沒有發生的事。
//
// ── 缺口本身(2026-08-30 線G 逐格開檔量)────────────────────────────────
//   `admin_create_manual_order` 直接收 `p_lines.unit_price`,只驗「非空、非負」,
//   **不查也不驗任何權威價格欄** ⇒ 含稅保證**不在 RPC 裡**,
//   而在**後台目錄只讀 `price_general`**(而它是含稅的,Sean 2026-08-29 拍板)。
//   ⇒ 代購品項(`variant_id` NULL)沒有商品可查 ⇒ **那個單價就是員工打的數字**。
//   ⇒ 打了未稅價 ⇒ 少收 5%,而 B1 的 `CHECK` **照樣全綠** —— 它只驗等式平不平,
//     **不驗那些數字的【單位】**。⇒ **錯的錢配一個綠。**
//   🔴 而 RPC 那層**型錄與代購一視同仁** ⇒ 型錄今天安全是那條 UI 路徑的**副作用**。
//
// ── 🔴🔴 第二件事:【四個窗都沒查過】的那一格 ─────────────────────────────
//    線C `-95` → `-c8` → `-b9` → 線G,**四個人讀的是同一支檔**
//    ⇒ **那是一份證據被讀了四次, 不是四份證據。**而他們共用同一個可能出錯的東西:
//    **那支檔是不是【正式庫現在正在跑的那一版】。**
//    當場量:最新 `20260829140000` **未 apply**;正式庫跑的是 `20260824020000`。
//    ✅ 這次結論沒變(兩版缺口相同)。🛑 **而下一次它會變, 那時沒有東西會提醒。**
//
// ── ⚠️ 射程(寫成「它證不到什麼」)──────────────────────────────────────
//    · 它讀的是**檔案字面**, 答不出正式庫裡那支函式的**實際定義**(本檔不連 DB)。
//    · `stripSql` **不是 SQL parser**:它不懂單引號字串與 dollar-quoted body 裡的 `--`,
//      也不處理巢狀 `/* */`(PostgreSQL 允許巢狀)。⇒ 見下面那道**每跑必驗的自檢**:
//      它每一發都對【當下這份內容】演一次「注入一句查價 ⇒ 尺必須看到」,
//      **所以就算剝壞了, 尺失效的那一發會當場紅, 不會安靜地放行。**(codex R1 must-fix ②)
//    · 例外放行只給【拒絕守門】那一種形狀, 而它**同時要求該行沒有 `SELECT` / `INTO`**
//      —— 否則把真查價與 `RAISE EXCEPTION` 排在同一行就繞過去了。(codex R1 must-fix ⑥)
//
// 🛑🛑 **而它擋的是【不小心】, 不是【故意】—— 這一段是 codex 兩輪逼出來的, 寫成邊界不是藉口**:
//    R1 七條、R2 六條, 而**兩輪的 findings 全部落在同一層**:
//    「用字串掃描去判斷 SQL 語意」這件事本身有天花板。R2 還構造得出來的三種:
//    ```
//      $msg$--$msg$; SELECT price_general…   同行的 dollar-quoted 假註解
//      $x$unit_price$x$ 出現在【參數區】     ⇒ fnBody 抓錯那一組 dollar quote
//      v := row.price_store; IF false THEN RAISE …   用 RAISE 遮掉真的查價
//    ```
//    ⇒ **那三種都要有人【刻意】那樣寫**。可以【不小心】發生的那幾種(大小寫、
//      註解裡的假定義、TS 字串裡的 `//`)**已折**, 各自帶正對照。
//    🔴🔴 **⇒ 本檔的準確宣稱, 一句話**:
//       **它擋得住手滑與順手改壞, 擋不住想繞的人。**
//
//    🛑 **而它的【退場條件】也寫死在這裡, 免得下一個人在同一層再折三輪**:
//       **哪天需要擋「想繞的人」, 那是「真的 parse SQL(新相依)」那一片, 不是加強這把尺。**
//       ⇒ 在同一層加第四第五個 pattern **買不到東西** —— R1 七條、R2 六條已經演過兩遍。
//       (輪次紀律:R2 仍 FAIL 而 findings 同層 ⇒ 依 `00-work-rules §5` 停下、整理決策給上游,
//        不自己開 R3;主視窗 2026-08-30 裁「甲」。)

const REPO = join(__dirname, '..', '..', '..', '..', '..');
const MIG_DIR = join(REPO, 'supabase', 'migrations');
const FN_RE = /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+"?public"?\s*\.\s*"?admin_create_manual_order"?/i;

/** 權威價格欄:RPC 若真的去查價,一定會出現其中之一。 */
const PRICE_COLS = ['price_general', 'price_store', 'price_dealer', 'price_by_tier'] as const;

/**
 * 剝 SQL 註解。**單引號字串內的 `--` 不剝**(codex R1 must-fix ②:
 * 一個字串裡的 `--` 會把它後面的真碼一起吃掉 ⇒ 那是【假綠】)。
 * ⚠️ 巢狀 `/* *​/` 仍未處理 —— 而那個方向的失敗是**殘留假碼 ⇒ 假紅**,不是假綠。
 */
function stripSql(src: string): string {
  let out = '';
  let i = 0;
  let inStr = false;
  while (i < src.length) {
    const c = src[i]!;
    if (inStr) {
      out += c;
      if (c === "'") inStr = src[i + 1] === "'" ? (out += src[i++ + 1], true) : false;
      i += 1;
      continue;
    }
    if (c === "'") {
      inStr = true;
      out += c;
      i += 1;
      continue;
    }
    if (c === '-' && src[i + 1] === '-') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * 只取**那支函式自己的 body**,不是整支 migration
 * (codex R1 must-fix ⑤:同檔其他函式查價會造成假紅;而干擾也可能反過來)。
 * 取法:`CREATE … FUNCTION public.admin_create_manual_order` 之後第一個 dollar-quote 標籤
 * 到它的配對結尾。抓不到 ⇒ **回 `null`,由呼叫端判紅**,不悄悄退回整支檔。
 */
function fnBody(src: string): string | null {
  const m = FN_RE.exec(src);
  if (m === null) return null;
  const after = src.slice(m.index);
  const tag = /\$([A-Za-z_]*)\$/.exec(after);
  if (tag === null) return null;
  const open = tag.index + tag[0].length;
  const close = after.indexOf(tag[0], open);
  return close === -1 ? null : after.slice(open, close);
}

/** 定義過這支函式的 migration,依版本號排序。**大小寫、換行、加引號都要認得**(codex ③)。 */
function definingMigrations(): string[] {
  return readdirSync(MIG_DIR)
    .filter((f) => f.endsWith('.sql'))
    // R2 must-fix:**掃剝過註解的文字** —— 註解裡寫一句 `CREATE FUNCTION …` 也會被算成一支定義,
    //    而那會同時撐綠「≥2 支」並把 `fnBody` 導向錯的位置。
    .filter((f) => FN_RE.test(stripSql(readFileSync(join(MIG_DIR, f), 'utf8'))))
    .sort();
}

/** `APPLIED.tsv` 第一欄:**trim + 只收 14 位數字**(codex ④:前置空白 / BOM / 畸形列)。 */
function appliedVersions(): Set<string> {
  return new Set(
    readFileSync(join(REPO, 'supabase', 'APPLIED.tsv'), 'utf8')
      .replace(/^﻿/, '')
      .split('\n')
      .map((l) => (l.split('\t')[0] ?? '').trim())
      .filter((v) => /^\d{14}$/.test(v)),
  );
}

/** 這一行的價格欄名是不是住在【拒絕守門】裡(而不是在查價)。 */
const isRejectGuardLine = (line: string): boolean =>
  /RAISE\s+EXCEPTION|\?\|\s*ARRAY/i.test(line) && !/\bSELECT\b|\bINTO\b/i.test(line);

/** 這份 body 裡有沒有【真的在查價】。 */
function priceLookups(body: string): string[] {
  const bad: string[] = [];
  for (const col of PRICE_COLS) {
    for (const line of body.split('\n')) {
      // R2 must-fix:**大小寫不敏感** —— PostgreSQL 未加引號的 `PRICE_GENERAL` 等同小寫,
      //    而 `includes` 是敏感的 ⇒ 一個合法的大寫寫法會零命中。
      if (line.toLowerCase().includes(col) && !isRejectGuardLine(line)) {
        bad.push(`${col} @ ${line.trim().slice(0, 80)}`);
      }
    }
  }
  return bad;
}

describe('⟦b4-PURCHTAX1⟧ ① RPC 對單價【不查也不驗】—— 釘現況, 修好之後這一族要紅', () => {
  const migs = definingMigrations();

  it('🔴 正對照:定義它的 migration ≥ 2 支(尺只認一種寫法就會靜默少算)', () => {
    // 🔴 這一格是實測長出來的:第一版只認 `CREATE OR REPLACE`,而 `20260824020000:186`
    //    是**裸 `CREATE FUNCTION`**(第一次建)⇒ 只撈到 1 支 ⇒ 下面那族紅成
    //    「沒有任何一版已 apply」——**那個紅讀起來像重大發現, 而它是我的尺漏了一種寫法。**
    expect(migs.length, `撈到:${migs.join(' ') || '(空)'}`).toBeGreaterThanOrEqual(2);
  });

  for (const f of definingMigrations()) {
    it(`🔴 ${f}:函式 body 裡沒有任何查價`, () => {
      const raw = readFileSync(join(MIG_DIR, f), 'utf8');
      const body = fnBody(raw);
      expect(body, '抓不到函式 body ⇒ 這把尺沒接上,不是「沒有查價」').not.toBeNull();
      const clean = stripSql(body!);

      // 🔴🔴 **每跑必驗的自檢(codex must-fix ②)**:對【當下這份內容】注入一句查價,
      //    尺必須看到它。剝註解剝壞、或 `priceLookups` 退化 ⇒ **這一格當場紅**,
      //    ⇒ 下面那個 `toEqual([])` 就不會是一個「因為什麼都沒看到」的綠。
      expect(
        priceLookups(`${clean}\n  SELECT price_general INTO v_x FROM public.variants;`).length,
        '注入一句真的查價之後尺仍然看不到 ⇒ 尺失效',
      ).toBeGreaterThan(0);

      // 正對照二:剝完之後真碼還在(剝過頭的方向)。
      expect(clean, '剝完連 unit_price 都不見了 ⇒ 剝過頭').toContain('unit_price');

      expect(
        priceLookups(clean),
        '有人開始查價了(那是好事 ⇒ 回來把本族改成新的期望值),或洩漏了經銷價',
      ).toEqual([]);
    });
  }

  it('🔴 負對照:現造欄名零命中, 而同一把尺對真的在裡面的字必須命中', () => {
    const clean = stripSql(fnBody(readFileSync(join(MIG_DIR, migs[migs.length - 1]!), 'utf8'))!);
    expect(clean.includes('price_zzq8842_never')).toBe(false);
    expect(clean.includes('unit_price')).toBe(true);
  });

  it('🔴 拒絕守門的例外【不得】被拿來繞過(codex must-fix ⑥)', () => {
    // 把真的查價與 RAISE EXCEPTION 排在同一行 ⇒ 舊版例外會放行,新版必須看到它。
    expect(
      isRejectGuardLine("SELECT price_store INTO v FROM x; RAISE EXCEPTION 'x';"),
      '同一行混進 SELECT 仍被當成拒絕守門 ⇒ 例外可被繞過',
    ).toBe(false);
    // 正對照:真正的拒絕守門那一行要被放行,否則本族恆紅。
    expect(isRejectGuardLine("IF v_spec ?| ARRAY['price_store', 'cost'] THEN")).toBe(true);
  });
});

describe('⟦b4-PURCHTAX1⟧ ② 我們讀的那一版, 與正式庫在跑的那一版, 是兩件事', () => {
  it('🔴 至少有一支定義它的 migration【已經 apply】—— 而訊息把兩個名字都印出來', () => {
    // 🛑 **不斷言「最新的 == 已 apply 的」** —— 那會在 Sean 每次 apply 之前都紅,
    //    而**常態假紅會被學會忽略**。⇒ 它斷言的是「有地基」,而把**兩個名字放進訊息**:
    //    紅的那一刻,讀的人就看得到自己引的是哪一版。
    // ⛔ ~~上一版用 `expect({newest,live}).toEqual({newest,live})` 印它們~~
    //    **codex R1 must-fix ①:那是自己等於自己, 而 vitest 通過時不印任何東西**
    //    ⇒ 它宣稱的「讓兩個名字可見」**從來沒有發生過**。已刪。
    // 🔴🔴 **這一句貼在這裡, 不放檔頭射程節** —— 理由是線C `-b4` 2026-08-30 交的:
    //    **寫在射程節裡的句子是最不會被回頭驗的那一種** ⇒ 承重的話要貼在它修飾的那一行旁邊。
    //    ⇒ **本格答的是【帳本】, 不是正式庫。**
    //      「`APPLIED.tsv` 上寫著 apply 了」與「正式庫裡那支函式真的是那一版」
    //      **是兩個宣稱** —— 而本檔不連 DB, 答不出後者。
    //      (同族正本錨:`guard-and-instrument-traps.md` 的「帳本有那一列 ≠ 那件事被觀察過」。)
    const migs = definingMigrations();
    const applied = appliedVersions();
    const live = migs.filter((f) => applied.has(f.split('_')[0] ?? ''));
    expect(
      live.length,
      `最新=${migs[migs.length - 1] ?? '(無)'} · 已apply=${live.join(' ') || '(無)'} ` +
        '⇒ 引用行號前先看這兩個名字,不同代表你引的可能不是正式庫在跑的那一版',
    ).toBeGreaterThan(0);
  });

  it('🔴 負對照:現造版本號不得被判成 applied;而真的那一支必須在', () => {
    const applied = appliedVersions();
    expect(applied.has('zzz99999999')).toBe(false);
    expect(applied.has('99999999999999')).toBe(false);
    expect(applied.size, 'APPLIED.tsv 解析出 0 筆 ⇒ parser 壞了,不是「什麼都沒 apply」').toBeGreaterThan(0);
  });
});

describe('⟦b4-PURCHTAX1⟧ ③ 含稅保證住在 UI 那條路徑上 —— 而那是副作用不是保證', () => {
  const catalog = () => readFileSync(join(__dirname, 'manual-order-catalog.ts'), 'utf8');
  /** 只看碼,不看註解 —— 這支檔的註解裡就寫著 `price_store` 等字。 */
  const catalogCode = () => catalog().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  // ⛔ 標題原本是「仍然只讀 price_general」—— 🔴 **那句 2026-08-31 起不成立**
  //    (codex R2 must-fix ③:「下一位審查者會誤認舊含稅保證仍存在」)。
  //    ⇒ 現在目錄**同時讀** `price_general`(含稅)與 `price_store`(未稅)。
  it('🔴 單價的來源仍然只有 price_general —— 而目錄本身已經【也讀】price_store 了', () => {
    // ⛔ ~~"'id, sku, price_general, products(title)'"~~
    // 🔵 2026-08-31 Sean 批 `price_store` 進欄位表(⟦b4-SKULOOKUP⟧ Q2 逐字「甲 標未稅」)。
    expect(catalog(), '目錄的 select 不再指名 price_general').toContain(
      "'id, sku, price_general, price_store, products(title)'",
    );
    expect(catalog(), 'unitPrice 不再來自 price_general').toContain('unitPrice: row.price_general');
  });

  it('🔴🔴 「只讀」要被真的斷言 —— 保留舊字面而【另外新增】一條價格路徑, 上一版兩格全綠', () => {
    // codex R1 must-fix ⑦:`toContain` 只證明「舊的還在」,不證明「沒有新的」。
    const code = catalogCode();
    // ⛔ ~~for (const col of ['price_store', 'price_dealer', 'price_by_tier', 'cost'])~~
    // 🔴🔴 **`price_store` 2026-08-31 移出這張清單, 而這一格比隔壁那支檔的同款改動【重一階】**:
    //    本 describe 的標題逐字寫著「**含稅保證住在 UI 那條路徑上 —— 而那是副作用不是保證**」
    //    ⇒ 那個「副作用」就是【目錄只讀 price_general 一欄】。
    //    ⇒ ⇒ **我加了 price_store, 就是把那個副作用拿掉了。**
    //    🛑 **所以含稅保證從今天起【不是碼給的, 是人給的】** ——
    //       Sean 拍甲:經銷價標「未稅」, 由員工自己換算(而他知道代價:貼過去會少收 5%,
    //       畫面上不會有任何東西叫)。
    //    ⇒ 📌 **這一格不是「放寬一道守門」, 是【一個保證換了持有人】。寫在這裡, 不要讓它靜靜發生。**
    //    ✅ 而**判準沒有被刪, 它被換成更窄的那一句**:`price_store` 可以【被讀出來顯示】,
    //       但**不得成為單價的來源** —— 下面那兩格釘的就是這個。
    for (const col of ['price_dealer', 'price_by_tier', 'cost'] as const) {
      expect(code.includes(col), `目錄的【碼】裡出現了 ${col} ⇒ 另一條價格路徑`).toBe(false);
    }
    // 🔴 `price_store` 只能以「翻成 dealerPriceUntaxed」這一種形狀存在。
    //    識別字帶 `Untaxed` 是刻意的:呼叫端的自動完成裡就看得到稅基, 而註解看不到。
    expect(code, 'price_store 沒有被翻成帶稅基的識別字 ⇒ 下游會把它與含稅價混用').toContain(
      'dealerPriceUntaxed: row.price_store',
    );
    // 🔴🔴 **而含稅保證的最後一格:單價的來源仍然只有 price_general。**
    //    這一句紅 = 有人讓經銷價變成單價 ⇒ 那才是撞上 manual-order-catalog.ts:6-70 那道凍結。
    expect(code.includes('unitPrice: row.price_store'), '單價的來源變成經銷價了').toBe(false);
    expect(
      code.match(/price_store/g)?.length,
      'price_store 出現超過 2 次 ⇒ 它跑到欄名與 map 以外的地方了',
    ).toBe(2);

    // 🔴🔴 **codex R1 must-fix ①:上面那三格守的是【字面與次數】, 守不到【資料流】。**
    //    它舉的反例逐字:在 map 之後寫 `hit.unitPrice = hit.dealerPriceUntaxed`
    //    ⇒ `price_store` 仍恰 2 次、三格全綠, **而經銷價已經自動生效了**
    //    ⇒ ⇒ **而舊那張黑名單會紅。**
    //    📌 **⇒ 我用「更窄」換掉「更寬」時, 窄掉的那一半正好是這一格。**
    //       換判準不是免費的:新判準蓋得住的那一半很明顯, 蓋不住的那一半要自己去找。
    //    ✅ 補上真正的那一句:**`dealerPriceUntaxed` 不得流進任何「單價」識別字。**
    //       範圍是整個 orders lib, 不是單一檔 —— 因為那個賦值可以寫在任何一支檔裡。
    const ordersDir = __dirname;
    const files = readdirSync(ordersDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    // 🔵 分母守門:掃到 0 支檔 ⇒ 下面那個迴圈恆綠。
    expect(files.length, 'orders lib 掃到 0 支非測試檔 ⇒ 本格恆綠').toBeGreaterThan(5);
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(ordersDir, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      // 形狀:同一個 statement 裡, 帶 unitPrice/unit_price 的東西旁邊出現 dealerPriceUntaxed。
      // 🛑🛑 **射程, 照 codex R2 must-fix ① 逐條寫出來 —— 這一格【擋不住】下列每一種**:
      //    · 別名:`const p = hit.dealerPriceUntaxed; hit.unitPrice = p;`
      //    · 解構:`const { dealerPriceUntaxed: p } = hit;`
      //    · 跨 statement / 跨函式 / 跨檔傳遞
      //    · 呼叫端的 `.tsx`(本掃描只吃 orders lib 的 `.ts`)
      // 📌 **⇒ 所以它不是「資料流守門」, 它是【最直白那一種寫法的絆線】。**
      //    我原本在 commit body 裡把它講成前者 —— 那是誇大, 已改。
      // ✅ 而它仍然值得留:那個最直白的寫法**正是順手改的人會寫的那一種**。
      //    真正的資料流保證要靠型別(讓未稅價與含稅價是兩個不可互換的型別), 而那是另一片。
      if (/unit_?[Pp]rice[^;\n]*dealerPriceUntaxed/.test(src)) offenders.push(f);
    }
    expect(offenders, '有人把經銷價(未稅)接成單價 ⇒ 那是「生效」不是「顯示」').toEqual([]);
    // 🔵 正對照:同一把尺換成一個【確定存在】的形狀, 必須抓得到東西 ——
    //    不然上面那個空陣列與「正規式根本不匹配任何東西」印同一個綠。
    const positive = files.filter((f) =>
      /unitPrice[^\n]{0,40}row\.price_general/.test(
        readFileSync(join(ordersDir, f), 'utf8').replace(/\/\/[^\n]*/g, ''),
      ),
    );
    expect(positive.length, '正對照:找不到 unitPrice: row.price_general ⇒ 這把尺沒有在動').toBeGreaterThan(0);
    // 正對照兩發(R2 must-fix:TS 剝註解器不懂字串,`"https://x"` 裡的 `//` 會吃掉同行真碼
    //    ⇒ 只驗 `price_general` 還在【別行】仍會過)。
    //    ⇒ 改用**已知碼錨**逐個點名(⛔ ~~行數守恆~~ 實測作廢:這支檔 153 非空行裡
    //      只有 34 行是碼 —— **本 repo 的檔就是註解比碼多**, 那個門檻對它恆紅)。
    for (const anchor of [
      'MANUAL_ORDER_CATALOG_COLUMNS',
      'unitPrice: row.price_general',
      'export async function searchManualOrderCatalog',
    ]) {
      expect(code.includes(anchor), `剝完之後連 ${anchor} 都不見了 ⇒ 剝過頭,上面那些 false 不可信`).toBe(
        true,
      );
    }
  });

  it('🔴 負對照:同一把尺對一個現造字面必須查無', () => {
    expect(catalogCode().includes('price_zzq8842')).toBe(false);
  });
});
