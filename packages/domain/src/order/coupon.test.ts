// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { COUPON_REJECT_REASONS, type CouponRejectReason } from './coupon';
import { scanSql } from './sql-scan';

// 這一支守的是**一個沒有任何編譯器在看的接縫**:
//   TS 的 `CouponRejectReason` ←→ SQL 的 `public.coupon_reject_reason` ENUM
//
// 🔴 **為什麼需要它**:那兩邊各自都是合法的,而它們分岔的時候:
//   · `typecheck` 不會紅(TS 不認識 SQL)
//   · `lint` / `build` 不會紅
//   · 而 RPC 回一個 TS 不認得的 reason ⇒ 前端會走到「沒有對應文案」那一條路
//     ⇒ **客人看到的是一個空白或代碼, 而不是「還差 NT$50」。**
//
// ⚠️ **射程(照實寫)**:它比的是**那支 migration 檔的字面**,
//   **不是正式庫裡那個型別現在有哪幾個值** —— 後者要連正式庫讀 `pg_enum`。
//   ⇒ 而 `ALTER TYPE … ADD VALUE` 分兩種, **只有一種擋得到**:
//     ✅ **寫進 repo 的 migration** ⇒ 下面 `alterAddValueHits()` 會讓它紅(codex must-fix 補的)
//     🔴 **有人在 SQL Editor 手貼而沒進 repo** ⇒ **本檔看不到, 而它會安靜地全綠**
//        (本 repo 有前例:`APPLIED.tsv` 上就有「Sean 本人貼」的紀錄)

const MIGRATION = join(
  __dirname,
  '../../../../supabase/migrations/20260829150000_m4b_coupon_p1_tables.sql',
);

/**
 * 從 migration 裡把那個 ENUM 的值逐個抽出來。抽不到 ⇒ throw(**不 skip**)。
 *
 * 🔴 **先剝掉 `--` 行註解才做比對**(codex must-fix):那一段每個值後面都有中文註解,
 *    而**註解裡只要出現 `);`,非貪婪的 `\)\s*;` 就會提早收尾**
 *    ⇒ 之後新增的第八個值會落在括號外 ⇒ **抽到 7 個、全綠, 而 SQL 有 8 個。**
 */
function sqlEnumValues(): string[] {
  const raw = readFileSync(MIGRATION, 'utf8');
  const sql = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
  const m = /CREATE TYPE public\.coupon_reject_reason AS ENUM\s*\(([\s\S]*?)\)\s*;/.exec(sql);
  if (m === null) {
    throw new Error(
      `在 ${MIGRATION} 裡找不到 coupon_reject_reason 的 CREATE TYPE ⇒ 量具失效(不是產品壞了)`,
    );
  }
  return [...(m[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1] as string);
}

/**
 * 🔴 **全 repo 掃 `ALTER TYPE … ADD VALUE`**(codex must-fix)。
 *
 * 上面那支只讀**一支** migration ⇒ 之後有人用另一支 migration 加值, 它**永遠讀舊檔、安靜全綠**。
 * ⇒ 這裡把那條路變成**會紅**:掃到就丟出去, 逼下一個人回來把這道守門改對。
 * 🛑 而它仍然**答不出正式庫現在有哪幾個值** —— 那要連正式庫讀 `pg_enum`。
 */
function alterAddValueHits(): string[] {
  const dir = join(__dirname, '../../../../supabase/migrations');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) =>
      /ALTER\s+TYPE\s+public\.coupon_reject_reason\s+ADD\s+VALUE/i.test(
        readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, ''),
      ),
    );
}

describe('CouponRejectReason 與 SQL 的 ENUM 不准漂', () => {
  const sqlValues = sqlEnumValues();

  it('量具自檢:真的從 SQL 抽到東西(空陣列會讓下面每一格恆真)', () => {
    expect(sqlValues.length).toBeGreaterThan(3);
  });

  it('🔴🔴 兩邊【逐字、同序】相同', () => {
    // 同序不是潔癖:比集合的話, diff 上看不出是哪一個被換掉。
    expect([...COUPON_REJECT_REASONS]).toEqual(sqlValues);
  });

  // 🛑 **下面兩格的射程**(codex must-fix 要求寫明):它們比的是**現造的陣列**,
  //    **沒有真的突變 SQL parser、也沒有突變 TS 的 union** ——
  //    它們證的只有一件事:上面那個 `toEqual` **不是兩個空陣列在互相通過**。
  //    ⇒ 真正守「union 多長一個而清單沒加」的是 `coupon.ts` 裡那個型別層 `_ExhaustiveCheck`
  //      (少一個值時 **tsc 會紅**, 不用等這支測試)。
  it('判別力演示:待比清單多一個 ⇒ toEqual 必須不成立', () => {
    expect([...COUPON_REJECT_REASONS]).not.toEqual([...sqlValues, 'zzq_eighth_reason']);
  });

  it('判別力演示:待比清單少一個 ⇒ toEqual 必須不成立(反方向)', () => {
    expect([...COUPON_REJECT_REASONS].slice(0, -1)).not.toEqual(sqlValues);
  });

  it('🔴 沒有任何 migration 在用 `ALTER TYPE … ADD VALUE` 加值', () => {
    // 有的話,上面那支只讀一支檔的 parser 就開始說謊了 ⇒ 讓它在這裡紅, 而不是安靜。
    expect(alterAddValueHits()).toEqual([]);
  });

  it('負對照:一個現造的值不在任何一邊', () => {
    expect(sqlValues).not.toContain('qx4m7-negctl-20260831');
    expect(COUPON_REJECT_REASONS as readonly string[]).not.toContain('qx4m7-negctl-20260831');
  });

  it('型別層:每一個執行期值都是合法的 CouponRejectReason', () => {
    // 這一格由 tsc 保證(`satisfies`),這裡只是把它變成一個看得見的斷言。
    const all: readonly CouponRejectReason[] = COUPON_REJECT_REASONS;
    expect(all).toHaveLength(7);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// 🔴🔴 券的扣點:`coupon_redeem_on_paid` 的【合法起點】—— 四處條件 + 一張判準表。
//
// 病(Sean 2026-09-08 拍 `A` = 分次付清補足尾款那張券要扣):
//   trigger 的 `WHEN` 與函式體的早退都寫 `OLD.payment_status = 'unpaid'`
//   ⇒ `partiallyPaid → paid` **不觸發 ⇒ 券不扣, 而且不出聲。**
//
// 🛑 **本組是兩發, 而第一發【必要而不充分】**:
//   ① 四處逐字相同 ⇒ 只證明它們【一致】
//   ② 四處的內容對得上一張【寫下來的判準】 ⇒ 才證明它們【對】
//   📌 為什麼要②:2026-09-01 有人把 `WHEN` 與函式體「一起收緊」過一次,
//      而**兩處被同步成同一個也是錯的條件** ⇒ 只驗①的守門對那一次**零判別力**。
//
// ⚠️⚠️ **射程 —— 這一段是【停在這裡的理由】, 不是免責聲明**(主視窗 A 2026-09-08 裁【A】):
//   🛑 **本組是【文字層】守門, 它證不出 `WHEN` 子句的語意。**
//   codex 對抗審查兩輪逐一構造出繞法, 而每補一維它就構造下一維:
//     · 把條件搬進 dollar-quoted 字串, 真條件收回 `unpaid`
//     · 把 `WHEN` 與早退兩處**互換**(極性各自都對, 位置錯)
//     · `WHEN` 後面加一個 `AND FALSE` ⇒ 永遠不觸發, 而四處字面完全正常
//     · enum 用 `RENAME VALUE` 或雙引號型別名 `ADD VALUE` ⇒ 值域抽取抓不到
//   📌 **那不是「再補一維就好」** —— 一個讀文字的尺, 對「這段 SQL 執行起來會怎樣」
//     **構造上答不出來**。⇒ **本組停在這裡, 而缺口明寫在這裡, 不假裝守到了。**
//   ✅ **唯一能證語意的尺**:在拋棄式 PG 上真的建那個 trigger, 餵四種轉移
//     (`unpaid` / `partiallyPaid` / `paid` / `refunded` → `paid`)看券扣了沒。
//     ⇒ **那是獨立的一片, 已落板列**(A 2026-09-08 逐字「落了才算存在」)。
//   ⚠️ 另一個既有射程照舊:比的是 repo 裡那兩支 migration 的**字面**,
//     **不是正式庫裡那支 trigger 現在長什麼樣**(後者要連正式庫讀 `pg_get_triggerdef`)。
// ─────────────────────────────────────────────────────────────────────────────

const REDEEM_FILES = [
  '20260901021000_m4b_coupon_p3b_create_order_redeem.sql',
  '20260901030000_m4b_zero_total_settle.sql',
] as const;

/** `payment_status` enum 的全部值:`CREATE TYPE` + 之後每一支 `ALTER TYPE … ADD VALUE`。 */
function paymentStatusValues(): string[] {
  const dir = join(__dirname, '../../../../supabase/migrations');
  const out: string[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    const code = readFileSync(join(dir, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/--[^\n]*/g, '');
    const created = /CREATE\s+TYPE\s+(?:public\.)?payment_status\s+AS\s+ENUM\s*\(([^)]*)\)/i.exec(code);
    if (created) for (const m of created[1]!.matchAll(/'([^']+)'/g)) out.push(m[1]!);
    for (const m of code.matchAll(/ALTER\s+TYPE\s+(?:public\.)?payment_status\s+ADD\s+VALUE(?:\s+IF\s+NOT\s+EXISTS)?\s+'([^']+)'/gi)) {
      out.push(m[1]!);
    }
  }
  return out;
}

/**
 * 那四處條件 —— 每一處回**三件事**:哪支檔、極性(`IN` / `NOT IN`)、狀態清單。
 *
 * 🔴🔴 **四個維度是 codex 對抗審查 2026-09-08 五條 must-fix 逐條補的, 每一個都有一發突變在演**:
 *   ① **極性**:⛔ ~~第一版把 `IN` 與 `NOT IN` 正規化掉、只比狀態清單~~
 *      ⇒ **只把一處早退的 `NOT IN` 改成 `IN`(語意整個反轉、合法付款不扣券)四格全綠。**
 *      📌 那是「一把尺, 而它把要比的維度抹平了」。
 *   ② **剝字面**:⛔ ~~第一版只剝註解~~ ⇒ 把合法清單搬進 dollar-quoted 字串、真條件收回
 *      `unpaid` ⇒ regex 仍數到四處、全綠。⇒ 用 `scanSql().code`(它連 `$tag$…$tag$` 一起剝)。
 *   ③ **位置**:每支檔必須**恰一處 `IN`(WHEN)+ 恰一處 `NOT IN`(早退)** —— 只數總數 4
 *      的話, 一支檔兩處 WHEN、另一支零處也是 4。
 *   ④ **完整值域**:⛔ ~~第一版只比「被排除的集合」~~ ⇒ 從 enum 宣告裡拿掉 `partiallyPaid`
 *      照樣綠(它從兩邊同時消失)。⇒ 改成比**全部 5 個值**。
 */
function legalPreviousStates(): { file: string; polarity: 'IN' | 'NOT IN'; states: string }[] {
  const dir = join(__dirname, '../../../../supabase/migrations');
  const out: { file: string; polarity: 'IN' | 'NOT IN'; states: string }[] = [];
  for (const f of REDEEM_FILES) {
    // 🔴 `scanSql().code` 剝掉註解**與 dollar-quoted 字串以外的字面**;
    //    這裡再自己剝一次單引號字串**不行**(狀態值本身就住在單引號裡)⇒ 只用 code。
    const code = scanSql(readFileSync(join(dir, f), 'utf8')).code;
    for (const m of code.matchAll(/OLD\.payment_status\s+(NOT\s+)?IN\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/gi)) {
      const states = [...m[2]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!).sort().join(',');
      out.push({ file: f, polarity: m[1] ? 'NOT IN' : 'IN', states });
    }
  }
  return out;
}

describe('券的扣點:合法起點四處一致, 而且對得上判準表', () => {
  it('🟢 量具自檢:兩支檔都讀得到, 而且真的抽到條件(空陣列會讓下面每一格恆真)', () => {
    const dir = join(__dirname, '../../../../supabase/migrations');
    for (const f of REDEEM_FILES) expect(readFileSync(join(dir, f), 'utf8').length).toBeGreaterThan(1000);
    expect(paymentStatusValues().length).toBeGreaterThan(3);
    expect(legalPreviousStates().length).toBeGreaterThan(0);
  });

  it('🔴 ①【必要】四處的合法起點逐字相同 —— 改一處等於沒改', () => {
    const sites = legalPreviousStates();
    expect(sites.length, '不是四處了。改條件請四處一起改, 並回去改函式體上方那張判準表。').toBe(4);
    const distinct = [...new Set(sites.map((x) => x.states))];
    expect(
      distinct,
      `四處不一致 ⇒ 有人只改了一部分:\n` +
        sites.map((x) => `  · ${x.file} [${x.polarity}] ⇒ ${x.states}`).join('\n'),
    ).toHaveLength(1);
  });

  it('🔴🔴 ①-b【極性】每支檔恰一處 `IN`(WHEN)+ 恰一處 `NOT IN`(早退)', () => {
    // 🛑 **只比狀態清單擋不住「把 NOT IN 改成 IN」** —— 那一改語意整個反轉:
    //    早退條件變成「起點合法就早退」⇒ **合法付款直接 return, 券一張都不扣。**
    //    而狀態清單一個字都沒變 ⇒ 上面那格是綠的。
    for (const f of REDEEM_FILES) {
      const mine = legalPreviousStates().filter((x) => x.file === f);
      expect(
        mine.map((x) => x.polarity).sort(),
        `${f} 的極性或處數不對(應恰一處 IN + 一處 NOT IN)。\n` +
          '· WHEN 子句是「起點合法【才】觸發」⇒ `IN`\n' +
          '· 函式體早退是「起點不合法【就】return」⇒ `NOT IN`\n' +
          '🛑 兩者反過來 = 券一張都不扣, 而狀態清單看起來完全正常。',
      ).toEqual(['IN', 'NOT IN']);
    }
  });

  it('🔴🔴 ②【充分那一半】合法起點恰為 unpaid + partiallyPaid, 而 enum 的【全部值】要對得上', () => {
    // 🛑 **只有這一格擋得住「兩處一起被改成同一個錯的條件」** —— ① 對那種改動是綠的。
    const legal = legalPreviousStates()[0]?.states;
    expect(
      legal,
      '合法起點變了。\n' +
        '· 這不是「改一行」—— 判準表在兩支 migration 的 `coupon_redeem_on_paid` 函式體上方\n' +
        '  (搜 `合法起點的【列舉】`), 那裡逐值寫了 5 個狀態各自該不該扣、以及為什麼。\n' +
        '· 🔴 而**列太窄的那一側是安靜的**:trigger 根本不觸發 ⇒ 沒有例外、沒有備註、沒有 warning\n' +
        '  ⇒ 券白送而零訊號。**不要以為「少列一個比較安全」。**',
    ).toBe('partiallyPaid,unpaid');

    // 🔴 比**完整值域**不是只比「被排除的」—— 後者在「某個值從 enum 與清單同時消失」時是綠的。
    expect(
      paymentStatusValues().sort(),
      'payment_status 的值域變了 ⇒ **那個新值變成 paid 的時候券該不該扣, 沒有人答過。**\n' +
        '請回去改那張判準表(它是逐值寫的), 答完再改這一行。',
    ).toEqual(['paid', 'partiallyPaid', 'partiallyRefunded', 'refunded', 'unpaid']);
  });

  it('🟢 負向對照:這把尺真的會對「只改一處」翻紅(否則 ① 證明不了什麼)', () => {
    // 🔴 本格不碰檔案 —— 它直接餵兩組不同的字串給同一個判準, 證明那個判準有判別力。
    const sameFour = ['a,b', 'a,b', 'a,b', 'a,b'];
    const onlyOneChanged = ['a,b', 'a,b', 'a,b', 'a'];
    expect([...new Set(sameFour)]).toHaveLength(1);
    expect([...new Set(onlyOneChanged)], '四處不一致竟然通過').not.toHaveLength(1);
  });
});
