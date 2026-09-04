import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// anomaly-alert-key-contract.test.ts —— SQL 產出的 key 與 TS 讀取的 key 必須對得上。
//
// 🔴 **為什麼需要它(懲罰是【安靜】的)**:一支 SECDEF RPC 回 `jsonb`,TS 這一側用**字面 key** 去讀。
//    兩份字面**互不相認**,而 `PgAnomalyAlertReaderAdapter.ts` 對缺 key 是 **fail-soft**
//    (`if (v === undefined || v === null) return []`)——
//    ⇒ **一個 typo 的結果是「那一格永遠是空的」,而三綠不紅、測試不紅、畫面不報錯。**
//    ⚠️ 而那個 fail-soft **是刻意的、而且是對的**(`parseCount` 對照組刻意 fail-loud)
//    ⇒ 📌 **所以修法不是把它改成 fail-loud,是【在外面加一道對帳】。這一支就是那道。**
//    來源:板 `⟦b4-SQLKEY1⟧`(F-004 關卡1 R3 的 23 條 findings 裡**唯一會再發生**的那一條)。
//
// 🛑 **射程**:
//    · ⛔ ~~只對 `get_payment_anomaly_alert_summary` 這一支(另一支 `..._display_ids` 的 key 由它自己那條路徑保證)~~
//      🔵 **2026-08-31 起涵蓋【兩支】**(見下方 `TARGETS`)。舊句留著加刪除線 ——
//      grep「沒有涵蓋」的人第一個命中會是舊的, 而那正是 `CLAUDE.md` 記過的 `print-a4.css:96` 同型。
//    · 只答「TS 讀的每一個 key,SQL 都有產出」—— **不答反向**。
//      🔵 **不答反向是刻意的**:部署順序上 migration 先上、TS 後上 ⇒ 那個窗口裡 SQL **必然**多出 key
//      ⇒ 反向斷言會在**正常流程**中規律誤報,**而規律誤報會訓練人略過這道閘。**
//      ⚠️ **代價寫出來**:「SQL 產了而沒有人讀」的 key **沒有任何人在看** ⇒ 被 TS 拿掉的 key 會永遠留在 SQL 裡。
//      **那不是缺陷,是【已知未覆蓋】。**
//    · 🔴🔴 **它讀的是 repo 的 migration, 不是正式庫在跑的那一份**(R3 §1, must-fix)——
//      R3 量到 **17 支 pending**(migration 版本號 `comm` 帳本 `supabase/APPLIED.tsv` 第一欄)。
//      ⇒ **新 key + 新 migration + TS 讀它 ⇒ 這道閘全綠, 而正式站那一格【空到 apply 為止】。**
//      📌 **⇒ 那正是本檔宣稱要防的病, 而它站在 deploy 邊界的錯誤那一側。**
//      ✅ 下方補了一格「選中的那一代在不在帳本上」——
//      ⚠️ **而帳本是【自陳】不是 `pg_proc`**:它答「有沒有人記過 apply」,
//         答不出「正式庫那支函式真的是這一版」。
//    · 🔴 **同一個邊界的第二形狀(R3 指出)**:`PgAnomalyAlertReaderAdapter.ts:289` 的
//      `const d = (idRows[0]?.result ?? {})` —— `42883` / `to_regprocedure` 那條分支觸發時,
//      五個陣列**全部變 `[]` 而且永遠不會叫**, 而**本檔的不變量【完全滿足】。**
//    · 🔴 **純 `.sql` 的 commit 不會跑 vitest** ⇒ **本支對「只改 migration」那種 commit 是隱形的**
//      (`docs/phase-1-backlog.md` `#863` 今天仍 open:「所有掃 migration 的閘對純 SQL commit 一律隱形」)
//      ⇒ **它不是 commit 前的閘,是【下一次有人跑測試時】才會叫。**
//
// ⛔ ~~**而 `d` 那個物件(display_ids 那三支)【也是 fail-soft 而且無人守】** ——
//    `PgAnomalyAlertReaderAdapter.ts` 的 `parseDisplayIds` 同樣 `return []`。
//    ⚠️ 舊版射程註寫「由它自己那條路徑保證」—— **那句只成立一半**:
//    `20260819130000:304-321` 的 apply 期交叉斷言比對的是 **SQL 自己兩支函式**,
//    而 TS 那側是**第三份獨立字面**,沒有任何東西在對它。
//    ⇒ ~~**本支【沒有】涵蓋它。那是同一族的下一個缺口,不是已解決的事。**~~
//    🔵 **2026-08-31:那一格收了 —— 而【收的是「壞掉時會有人知道」, 不是修好一個 bug】**
//       (兩側今天實量:display_ids **5/5**、summary **7/7**, 本來就對得上)。
//    (`rf` / `em` 則不需要:它們走 `parseCount`,缺鍵 ⇒ `NaN` ⇒ throw = fail-**loud**。)
// 🔴 **而 R3 把同一把刀轉回本檔**:本檔斷言的 12 個 key 裡, **6 個本來就 fail-loud** ——
//    `r.open_count` … `r.pending_double_charge_candidate_count` 全走 `parseCount`(`:348-370`)。
//    ⇒ **真正 fail-soft 的只有 6 個**:`oldest_open_age_seconds` + `d` 那五個。
//    📌 **⇒ 本檔的實際覆蓋是它自己註解暗示的一半。**
//    ⚠️ 而 summary 那支**留在 TARGETS**:fail-loud 的 key 多守一層無害,
//       而拿掉它會讓下方那格封閉性檢查少一個成員。
// ⚠️ **而 `d` 也不是完全無人守**:`20260819130000:303-325` 有 apply 期 `RAISE EXCEPTION` 掃同五個 key。
//    那一發比的是 **SQL 自己兩支函式**, TS 那份字面不在它的分母裡
//    ⇒ 📌 **本檔的邊際價值精確地是「TS 那份字面打錯」, 不是「那一格會空掉」。**
const MIG_DIR = path.resolve(__dirname, '../../../../supabase/migrations');
const TS_FILE = path.resolve(__dirname, 'PgAnomalyAlertReaderAdapter.ts');
/**
 * 🔵 **2026-08-31 擴充:本支從【一支函式】變成【兩支】。**
 * 舊版檔頭逐字寫著 `d` 那個物件「**也是 fail-soft 而且無人守**…本支【沒有】涵蓋它。
 * 那是同一族的下一個缺口, 不是已解決的事」—— **這一次就是去收那一格。**
 * 📌 ⇒ 而它是被**那句話自己**帶進來的:寫的人把下一個缺口寫在讀的人一定會看到的地方,
 *    而不是寫在一份沒有人會打開的清單裡。
 * ⚠️ **兩側今天本來就對得上**(實量:display_ids **5/5**、summary **7/7** —— ⛔ ~~各 5 個~~,
 *    那句只對 display_ids 成立, 而同一段下面就寫著 `pin: 7`)⇒ **本次沒有修好任何東西**,
 *    修好的是「**在它壞掉的時候會有人知道**」。
 */
const TARGETS = [
  { fn: 'get_payment_anomaly_alert_summary', varName: 'r', pin: 7 },
  { fn: 'get_payment_anomaly_alert_display_ids', varName: 'd', pin: 5 },
  /**
   * ⟦b9-RLSHARDEN⟧ 甲片B(2026-09-02)。**分堆是開檔看的, 不是猜的**(本檔上面那句逐字要求):
   * adapter 對缺鍵的處理是 `brValue === undefined` ⇒ 落 `bypassRlsUnknown`, **它不 throw**
   * ⇒ 依本檔判準屬 **fail-soft** ⇒ 進 `TARGETS`, 不進 `FAIL_LOUD_RPCS`。
   * 🔵 而這道閘當場逼出一個真問題:我第一版 SQL 回三個 key 而 TS **只讀一個**
   *    ⇒ 另外兩個是「回了而沒有人看」的東西。已改成三個都讀(其中 `total_role_count`
   *    當合理性下界:不是正整數 ⇒ 走 Unknown)。
   */
  { fn: 'get_privileged_role_bypassrls_state', varName: 'br', pin: 3 },
] as const;

/** SQL 的行註解(`--`)在**每一把尺之前**先剝掉。
 *  🔴 **R2 兩個 Critical 都是它**:①一支 migration 只要在**註解**裡提到函式名, 就會被
 *     `latestDefinitionFile` 當成「最新一代」⇒ 真函式一個字都沒被讀 ⇒ **真 bug 在場而全綠**;
 *     ②`AS $tag$` 出現在註解結尾 ⇒ tag 抓錯 ⇒ 窗口變更長 ⇒ 抽到別支函式的 key。
 *  📌 **⇒ 兩次都是「那兩個字元在不在」答不出「它在哪個語境裡」**(同 repo
 *     `scripts/storefront-projection-leak-guard.test.ts` 為了這個換了四版實作)。
 *  ⚠️ **已知天花板:只剝行註解** —— 區塊註解與 dollar-quoted 字串裡的 `--` 沒有處理。
 */
function stripSqlLineComments(src: string): string {
  return src
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
}

/** 找【最新一代】—— 不寫死檔名(寫死的話, 有人 `CREATE OR REPLACE` 出新一代 ⇒ 這支恆綠)。
 *  🔴 **三個條件缺一不可, 三個都是 R2 實跑打穿過的**:
 *    ① 先剝 `--` 註解 —— 否則**一行 rollback 註解**就能讓一支 decoy 檔冒充定義檔
 *    ② `^\s*CREATE` 行首錨 + `[^(\n]` —— 否則跨行也算命中
 *    ③ 函式名右界 `(?![a-z0-9_])` —— 否則 `..._display_ids_v2` 被當成本函式的下一代
 *       ⇒ **讀 v2 的 key, 而舊那支從此不再被檢查**(R2 實跑 ⇒ 5 passed rc=0)
 */
function latestDefinitionFile(FN: string): string {
  const re = new RegExp(`^\\s*CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION[^(\\n]*${FN}(?![a-z0-9_])`, 'im');
  const hits = readdirSync(MIG_DIR)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => re.test(stripSqlLineComments(readFileSync(path.join(MIG_DIR, f), 'utf8'))))
    .sort();
  // ⚠️ `.sort()` 是檔名字典序不是 apply 序:補一支戳記較小的 hotfix 反序 apply ⇒ 挑錯代。已知未修。
  if (hits.length === 0) throw new Error(`找不到任何 ${FN} 的定義 —— 這把尺沒有接上`);
  return path.join(MIG_DIR, hits[hits.length - 1]!);
}

/** 從 `jsonb_build_object(` 抓 key。
 *  🔴 **R2 打穿了「key 自己一行」那條排版慣例**:在函式體內插一段換行寫的
 *     `WHERE status IN (` + `'open_display_ids',` ⇒ 幽靈 key 補上缺口 ⇒ 全綠。
 *     ⛔ ~~狀態值在行內、key 自己一行~~ —— **那是排版慣例不是結構性質, 一次 formatter 就翻掉。**
 *  ✅ 改成**追括號深度**:只收 `jsonb_build_object(` 自己那一層的字面;
 *     `WHERE … IN (` 把深度推到 2 ⇒ 它產的幽靈 key 進不來。
 *  ⚠️ **已知天花板**:巢狀 `jsonb_build_object(` 的內層 key 抓不到(⛔ ~~本 repo 今天無此形狀~~ ⇒ 🔵 **R3 訂正:證據只支持【本函式無此形狀】**;
 *     全 repo 那個宣稱它自己標了「我的偵測不可靠, 沒有建立」)。
 */
function sqlKeys(file: string, FN: string): string[] {
  const lines = stripSqlLineComments(readFileSync(file, 'utf8')).split('\n');
  const anchor = new RegExp(`^\\s*CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION[^(\\n]*${FN}(?![a-z0-9_])`, 'i');
  const fnLine = lines.findIndex((l) => anchor.test(l));
  if (fnLine < 0) throw new Error(`${path.basename(file)} 找不到 ${FN} 的定義行 —— 這把尺沒有接上`);
  // tag 允許數字(`$fn2$` 在 PG 合法), 也允許同一行就接函式體
  const tagIdx = lines.findIndex((l, i) => i >= fnLine && /\bAS\s+\$[A-Za-z0-9_]*\$/.test(l));
  if (tagIdx < 0) throw new Error(`${path.basename(file)} 的 ${FN} 找不到 AS $tag$ —— 這把尺沒有接上`);
  const tag = /\bAS\s+(\$[A-Za-z0-9_]*\$)/.exec(lines[tagIdx]!)![1]!;
  const start = lines.findIndex((l, i) => i >= tagIdx && l.includes('jsonb_build_object('));
  if (start < 0) throw new Error(`${path.basename(file)} 找不到 jsonb_build_object( —— 這把尺沒有接上`);
  // 收尾 = tag 再次出現那一行(不要求同行有 `;` —— `$fn$` 與 `;` 分兩行在 PG 合法)
  const endRel = lines.slice(tagIdx + 1).findIndex((l) => l.includes(tag));
  if (endRel < 0) throw new Error(`${path.basename(file)} 的 ${FN} 找不到收尾 ${tag} —— 這把尺沒有接上`);
  const end = tagIdx + 1 + endRel;
  const out: string[] = [];
  let depth = 0;
  let seen = false;
  for (const l of lines.slice(start, end)) {
    if (!seen && l.includes('jsonb_build_object(')) {
      seen = true;
      depth = 1;
      continue;
    }
    if (!seen) continue;
    if (depth === 1) {
      const m = /^\s*'([a-z0-9_]{3,})',\s*$/.exec(l);
      if (m) out.push(m[1]!);
    }
    depth += (l.match(/\(/g) ?? []).length - (l.match(/\)/g) ?? []).length;
  }
  return [...new Set(out)];
}

/**
 * TS 這一側:`<varName>.<key>` / `<varName>['<key>']`。
 *
 * 🛑 **已知天花板(R1 逐個實跑, 照實列, 不寫成「應該不會」)**:
 *  · **解構讀不到**:`const { ghost_key } = d;` ⇒ 這把尺看不見 ⇒ **全綠**
 *  · **括號寫法讀不到**:`(d).ghost_ids`
 *  · **`d?.['x']` 讀不到**(R2 補;`[!?]?` 只吃一個字元, 這裡是 `?.` 後面接 `[`)
 *  · **prettier 折行讀不到**:`d\n  .ghost_ids`(R2 補;regex 不跨行)
 *  🔴 **這兩格是 R2 補的, 而 R1 版那張表逐字寫著「R1 逐個實跑, 照實列, 不寫成『應該不會』」**
 *     ⇒ 📌 **一張宣稱自己完整的射程表少列兩格, 比沒有表更貴** —— 讀的人會停止自己想。
 *  · 🔵 **反方向(假紅)**:`d.` 出現在**註解或字串**裡也會被算成 key
 *    (`\b` 對 CJK 成立 ⇒ 中文註解裡寫 `d.legacy_ids` 就會紅);
 *    而變數名 `r` 更容易撞 —— 同檔已有 `rows` / `idRows` / `refundRows` 三個陣列,
 *    任何 `r.some_pg_column` 都會假紅。
 *    ⚠️ **而本檔 `:18-19` 自己寫著「規律誤報會訓練人略過這道閘」** ⇒ **假紅在這裡不是安全的方向。**
 *    📌 **沒有修**:要真的修得先在這一層剝註解與字串, 而那是另一件事
 *       ⛔ ~~那是另一件事(同 repo … 換了四版實作)~~ ⇒ 🔵 **R3 訂正:第四版的解法
 *       (`ts.createSourceFile` token walk)【就在那支檔的 `:161`】** ⇒ 「另一件事」講過頭了。
 *       **誠實的句子是:有現成解法, 而今天零假陽性所以不接。**
 */
function tsKeys(varName: string): string[] {
  const src = readFileSync(TS_FILE, 'utf8');
  const v = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 🔵 `[a-z0-9_]` 與 `[!?]?` 兩處放寬 —— **而 R2 查出我原本寫的兩個理由都是假想**:
  //    ⛔ ~~同支 adapter `:342-346` 正在用 `signal1_overdue_count`~~ ⇒ 那是 `emailCount('…')`
  //       的**字串引數**, 本來就不在 `tsKeys` 射程內;
  //    ⛔ ~~同檔 `:339` 已有 `em![key]`~~ ⇒ `em` **不是 TARGET 的物件名**, 且 `key` 是變數。
  //    ✅ **放寬本身無害**(R2 實測前後同為 summary 7 / display_ids 5, 零新假陽性),
  //       **而理由是假的** ⇒ 📌 **一個【正確的改動】配上一個【編出來的理由】, 下一個人會照那個理由推出錯的結論。**
  const dot = [...src.matchAll(new RegExp(`\\b${v}[!?]?\\.([a-z0-9_]{3,})\\b`, 'g'))].map((m) => m[1]!);
  const brk = [...src.matchAll(new RegExp(`\\b${v}[!?]?\\[['"]([a-z0-9_]{3,})['"]\\]`, 'g'))].map(
    (m) => m[1]!,
  );
  return [...new Set([...dot, ...brk])];
}

// 🔴 **R1/R2 連續抓到的同一個洞:一個目標在 describe body 裡 throw ⇒ 【整檔】的格子一起消失。**
//    R1 版我把計算留在 describe body、只加了一個 `RAN` 計數 —— **而 R2 實跑證明那個補丁對它自己
//    寫明的情境完全不會叫**:把 display_ids 整支改名 ⇒ `Tests no tests`、rc=1、**紅 0 格**,
//    連「本檔自己的分母」那一格**也沒有跑**(collection 失敗 = 整檔死, 包含那個計數器自己)。
//    📌 **⇒ 一個放在【會一起死的地方】的計數器, 它保護不了自己。**
// ✅ **真正的修法是把計算搬進 `it()`** —— 那樣 throw 變成**那一格紅**, 其他目標照跑。
//    (`sqlKeys` 現在有四條 throw 路徑:找不到定義行 / 找不到 `AS $tag$` / 找不到收尾 / 找不到
//     `jsonb_build_object(` —— 全部都要是「紅一格」, 不是「整檔消失」。)
const RAN: string[] = [];

for (const { fn, varName, pin } of TARGETS) {
  describe(`anomaly alert(${fn}):SQL 產出的 key 與 TS 讀的 key 要對得上`, () => {
    it('🔵 兩把尺都要撈得到東西(先證明尺接上了,再去斷言)', () => {
      const file = latestDefinitionFile(fn);
      const fromSql = sqlKeys(file, fn);
      const fromTs = tsKeys(varName);
      expect(
        fromSql.length,
        `SQL 側只抽到 ${fromSql.length} 個 key(讀的是 ${path.basename(file)},釘 ${pin})—— 尺窄掉了`,
      ).toBeGreaterThanOrEqual(pin);
      expect(
        fromTs.length,
        `TS 側(物件 \`${varName}\`)只抽到 ${fromTs.length} 個 key(釘 ${pin})—— 尺窄掉了,而它照樣會印綠`,
      ).toBeGreaterThanOrEqual(pin);
    });

    it('🔴 我讀的那一代, 帳本上要記著它已經 apply(擋住「閘綠而正式站那一格空到 apply 為止」)', () => {
      // R3 §1:本檔讀的是 **repo** 的 migration, 而正式站跑的是已 apply 的那些(R3 量到 17 支 pending)。
      // 🛑 **而帳本是【自陳】不是 `pg_proc`** —— 它答「有沒有人記過 apply」,
      //    答不出「正式庫那支函式真的是這一版」。這一格買的是**前者**, 不要讀成後者。
      const version = path.basename(latestDefinitionFile(fn)).split('_')[0]!;
      const ledger = readFileSync(path.resolve(MIG_DIR, '../APPLIED.tsv'), 'utf8');
      const versions = ledger
        .split('\n')
        .filter((l) => !l.startsWith('#') && l.trim() !== '')
        .map((l) => l.split('\t')[0]!);
      expect(versions.length, '帳本一列都沒讀到 ⇒ 這把尺沒有接上').toBeGreaterThan(50);
      expect(
        versions.includes(version),
        `${fn} 在 repo 的最新一代是 ${version}, 而 supabase/APPLIED.tsv 上沒有它。\n` +
          '⇒ 這道閘會對【還沒上正式庫的那一代】印綠, 而正式站那一格【空到 apply 為止】。',
      ).toBe(true);
    });

    it('🔴 TS 讀的每一個 key,SQL 都要產出(缺一個 ⇒ 那一格永遠是空的,而沒有東西會紅)', () => {
      const file = latestDefinitionFile(fn);
      const fromSql = sqlKeys(file, fn);
      const fromTs = tsKeys(varName);
      RAN.push(fn);
      const missing = fromTs.filter((k) => !fromSql.includes(k)).sort();
      expect(
        missing,
        `TS 讀了這幾個 key,而 ${path.basename(file)} 沒有產出:\n  ${missing.join('\n  ')}\n` +
          '⇒ 這幾格在正式站上會【永遠是空的】,而 fail-soft 讓它不 throw、不紅、畫面不報錯。',
      ).toEqual([]);
    });

    // ── 以下兩格由 `-eb`(線 DB 與金流)於 2026-08-31 合併時併入 ──────────────
    //    背景:本列被【三個人各做了一次】,而其中兩支建在【同一個檔案路徑】上
    //    ⇒ `add/add` 衝突。解法是以這一支(涵蓋兩支 RPC、三輪審查)為底,
    //      把另一支獨有的兩格加進來 —— 而不是二選一。
    it('🔴 反方向:SQL 產出的每一個 key,TS 都要有人讀 —— 症狀與上一格【一模一樣】', () => {
      // 🔴 上一格擋的是「TS 讀一個 SQL 沒產出的 key」。
      //    而【SQL 加了新 key,而 TS 沒有人去讀它】——**症狀相同:那一格永遠是空的**。
      // 📌 ⇒ 一個只驗單向的合約,在【多出來的那一側】是瞎的。
      const file = latestDefinitionFile(fn);
      const fromSql = sqlKeys(file, fn);
      const fromTs = tsKeys(varName);
      const unread = fromSql.filter((k) => !fromTs.includes(k)).sort();
      expect(
        unread,
        `${path.basename(file)} 產出了這幾個 key,而 TS 沒有任何人讀:\n  ${unread.join('\n  ')}\n` +
          '⇒ 新增一個 key 卻忘了接 TS,畫面上那一格【永遠是空的】——與上一格同一個症狀。',
      ).toEqual([]);
    });
  });
}

/** 🔴 **R3 §4(must-fix):`TARGETS` 是手寫黑名單, 而【沒有任何東西會提醒人加一列】。**
 *  在這支 adapter 多接一支 jsonb RPC ⇒ 這張表停在 2 ⇒ **覆蓋率單調衰減, 而它一直印綠。**
 *  ✅ 判別:從 **TS 那支檔自己**抽 `SELECT public.<fn>(`(零新 I/O, 它本來就讀那支檔),
 *     斷言那個集合 = `TARGETS` ∪ 一份**具名的** fail-loud 白名單。
 *     今天 **4 = 2 + 2**;第 5 支進來就紅, 而訊息告訴作者要放進哪一堆。
 *  🛑 **天花板(R3 指定寫在旁邊)**:它只封閉**這一支 adapter**。
 *     另一支新檔裡的新 fail-soft jsonb RPC **仍然隱形** —— 那一格屬於 `deploy-order-gate.sh`
 *     (R3 量:它只掃 `.rpc(` / `.from(`, `grep -c SELECT` ⇒ **0** ⇒ 全 repo **24** 支
 *      `client.query('SELECT public.…')` 對它是隱形的)。**已另開板列, 不在本檔解。**
 */
const FAIL_LOUD_RPCS = [
  /**
   * ⟦search-LOGSILENTZERO⟧(2026-09-04, 線 `-db`)。
   *
   * 🔵 **分堆是開檔看的, 不是猜的**(本檔上面那句逐字要求):
   *   `getSearchLogHealth` 對**三個欄位逐個驗型別**, 缺鍵 ⇒ `typeof undefined` 不符
   *   ⇒ `throw new AnomalyAlertReaderParseError` ⇒ **fail-loud** ⇒ 進這一堆。
   *   (`PgAnomalyAlertReaderAdapter.ts` 錨 `RPC_SEARCH_LOG_HEALTH` 那三個 if。)
   *
   * 🔴🔴 **而這一格【是我今天弄紅的】, 照實記** —— `3a848c58e` 在 adapter 加了這支呼叫,
   *   而**沒有把它登記進來** ⇒ 16 顆推前驗收當場紅。
   *   📌 **而我今天早些才報過**「這支合約測試 15 發紅」以及
   *     「掃描型守門不 import 被測檔 ⇒ `vitest related` 的分母裡結構上沒有它」
   *     ⇒ 🎯 **我知道那個機制, 而我照樣踩了它** —— 因為我改的是 adapter,
   *       而**這支檔不在我改的那一批裡, 也不會被 related 撈出來。**
   *   ⇒ ⇒ 🛑 **知道一個坑, 與在動手的當下想起它, 是兩件事。**
   */
  'get_search_log_health',
  // 這幾支走 `parseCount` / `parseBeginResult` ⇒ 缺鍵會 throw ⇒ 不需要本檔這種對帳。
  'get_order_refunds_stuck_summary',
  'get_email_outbox_deadman_counts',
  /**
   * 🔴🔴 **這三支是 2026-08-31 補登記的, 而【前兩支在補之前就已經漏著】。**
   *
   * 本檔上面那段自陳「今天 **4 = 2 + 2**;第 5 支進來就紅」—— 而實查:
   * ```
   * HEAD(ab6d31c3)的 adapter 已經呼叫 6 支 RPC, 而註冊表只有 4
   * ⇒ 📌 這一格【在我今天動它之前就是紅的】, 不是我弄紅的。
   * ⇒ 而它紅了多久沒有人知道 —— 一道紅著的守門與一道沒裝的守門,
   *   對「有沒有人在看」這件事印同一個答案。
   * ```
   * 🔵 **分堆依據是開檔看的, 不是猜的**(本檔上面那句逐字要求):三支都走 `parseCount`
   *   ⇒ 缺鍵直接 throw ⇒ 屬 fail-loud 那一堆:
   *     `PgAnomalyAlertReaderAdapter.ts:584`(shipped)· `:612`(orderCreated)· `:602`(heartbeat)
   * ⚠️ **而 heartbeat 那支是【混的】, 要寫清楚**:`abnormal_count` 走 `parseCount`(fail-loud),
   *   而五個原因陣列走 `collectHeartbeatJobNames` —— 那裡缺鍵會**安靜地變成空名單**(fail-soft)。
   *   ⇒ 📌 **後果不是漏報**(數量仍然對、仍然會叫), **是那封信裡沒有名字** ——
   *     而收信的人得自己去後台找。**這一格本檔守不到, 留在這裡當已知邊界。**
   */
  'get_shipped_email_gap_counts',
  'get_order_created_gap_counts',
  'get_cron_heartbeat_stale_counts',
  /**
   * 🔵 ⟦b9-ENUMWATCH⟧ 片 2(2026-09-01)。**分堆是開檔看的, 不是猜的**(本檔上面那句逐字要求):
   *   `PgAnomalyAlertReaderAdapter.getManualCustomerSearchSummary` 自己判形狀 ——
   *   回應不是物件 / 計數欄不是數字 ⇒ **`throw`**。
   *   ⛔ ~~「檔內**兩處** `throw new Error('get_manual_customer_search_summary:…')`」~~ **數錯了**
   *      (R2 must-fix F12:實查 `grep -c` ⇒ **3 處**;🔵 負對照現造字面 ⇒ 0)——
   *      而**那個數字現在連對象都沒了**:R2 F2 之後那三處改用同檔既有的 `parseCount`,
   *      它丟的是 branded 的 `AnomalyAlertReaderParseError`(訊息活得過 `sanitizeError`)。
   *   📌 **⇒ 一個寫在註解裡的計數, 它過期時沒有任何東西會紅。**
   *   ⇒ 缺鍵會炸, 不會安靜變成空的 ⇒ 屬 fail-loud 這一堆。
   * 🛑 **而它有一條【刻意的 fail-soft 路徑, 而那條不是缺鍵】**:
   *   那支 RPC **還沒被 apply** 時(`42883` 且 `to_regprocedure` 回 NULL)⇒ 回 `null` = 查不到。
   *   ⇒ 那是**部署窗口**, 不是「鍵不見了」—— 兩者在本檔的分堆上是不同的東西。
   */
  'get_manual_customer_search_summary',
  /**
   * 🔵 `⟦b4-SIG4ERRORS⟧` 那一片(`20260901060000` 已 apply)。
   *   **分堆是開檔看的, 不是猜的**(本檔上面那句逐字要求):
   * ```
   * PgAnomalyAlertReaderAdapter.ts 的 stuckNum(key) ⇒ parseCount(raw, key, 'get_order_created_stuck_count')
   * 而 parseCount:v === undefined ⇒ n = NaN ⇒ !Number.isFinite(NaN) ⇒ **throw**
   * ⇒ 缺鍵 = fail-loud ⇒ 屬這一堆
   * ```
   * 🛑 **而它有兩條【不是缺鍵】的 null 路徑, 兩條都不改變分堆**:
   *   ① `raw === null` ⇒ 直接回 `null` —— 那是 `oldest_stuck_minutes` 在【沒有卡住】時的 SQL NULL,
   *      **「沒有」不是「讀不到」**(同檔 `stuckNum` 註解逐字)。
   *   ② 兩顆 env 任一沒設 / 函式尚未 apply ⇒ `orderCreatedStuckRows` 留 `[]` ⇒ `ocs === undefined`
   *      ⇒ 兩格都回 `null` **而不是 0** —— 那是**部署窗口**, 與 `get_manual_customer_search_summary`
   *      那一格同型, 而**它們都不是「鍵不見了」**。
   * 📌 **⇒ 分堆問的是【鍵不見時會不會叫】, 不是【這支函式會不會回 null】。**
   *   ⇒ 兩者在本檔的分堆上是不同的東西, 而混起來會把一支 fail-loud 的錯歸進 fail-soft。
   */
  'get_order_created_stuck_count',
  /**
   * 🔵 `⟦b4-NORECIPIENTWINDOW⟧` 那一片(`20260903070000`, Sean 2026-09-03 本人已貼)。
   *   **分堆是開檔看的, 不是猜的**(本檔上面那句逐字要求):
   * ```
   * PgAnomalyAlertReaderAdapter.ts 的 unpaidCancelledCount(key)
   *   ⇒ parseCount(ucg![key], key, UNPAID_CANCELLED_FN)
   * 而 parseCount:v === undefined ⇒ n = NaN ⇒ !Number.isFinite(NaN) ⇒ **throw**
   * ⇒ 缺鍵 = fail-loud ⇒ 屬這一堆
   * ```
   * 🔴 **而我沒有停在讀碼** —— 同族的 `PgAnomalyAlertReaderAdapter.test.ts` 有一格
   *   `[U5] 缺鍵 ⇒ throw`, 它**真的餵一個少一把鍵的回應進去**。
   *   ⇒ 📌 **那一格才是這裡這個字串的來源**;沒有它, 這一行是一個【推論】被寫進一張註冊表。
   * 🛑 **而它有一條【不是缺鍵】的 null 路徑, 不改變分堆**:
   *   RPC 還沒 apply(`42883` 且 `to_regprocedure` 回 NULL)⇒ `unpaidCancelledGapUnknown`
   *   ⇒ 三格回 `null` = 查不到。那是**部署窗口**, 不是「鍵不見了」。
   *   ⇒ 🎯 同 `get_manual_customer_search_summary` 那格記過的那句:
   *     **分堆問的是【鍵不見時會不會叫】, 不是【這支函式會不會回 null】。**
   *
   * 🔬 **而「放錯堆會不會被抓到」我實測過**(主視窗指定):把它從這一堆移到 `TARGETS`
   *   (帶假的 `varName` / 空 `pin`)⇒ **三格紅**(兩把尺撈得到 · 帳本記著已 apply ·
   *   SQL 的每個 key 都有人讀)⇒ ✅ **這道閘不只擋「有沒有登記」, 也擋「隨手登記到錯的堆」。**
   * 🛑 **而我沒測到的那一格要寫出來**:若有人放進 `TARGETS` 而**把 varName 與 pin 都填對**,
   *   會不會過?**我沒有測。** ⇒ 📌 那是「認真地放錯」, 與我這一發的「隨手放錯」不同,
   *   而**它們在這句話裡很容易被讀成同一件事**。
   */
  'get_order_unpaid_cancelled_gap_counts',
] as const;

describe('屬性名與錯誤訊息字面(`-eb` 2026-08-31 併入)', () => {
  // 🔴 這一格與 key 對不對得上【無關】,它擋的是另一件事:
  //    `parseDisplayIds(d.open_display_ids, 'refunding_stuck_display_ids')`
  //    ⇒ 編譯過、跑得過,而它壞掉時吐的訊息會讓接手的人去查【另一個】欄位。
  // 🛑 射程:只涵蓋 `parseDisplayIds` / `parseDisplayIdPairs` 這一族的呼叫
  //    ——它們是 `d.X` 與字面 `'X'` 成對出現的那種寫法。走 `parseCount` 的不在內。
  it('🔴 `parseDisplayIds(d.A, \'B\')` 兩個字面必須一致 —— 不一致的話那句話會指向錯的欄', () => {
    const src = readFileSync(TS_FILE, 'utf8');
    const re =
      /parseDisplayIds?\s*\(\s*d\.([a-z_]+)\s*,\s*'([a-z_]+)'|parseDisplayIdPairs\s*\(\s*d\.([a-z_]+)\s*,\s*'([a-z_]+)'/g;
    const pairs: Array<[string, string]> = [];
    for (const m of src.matchAll(re)) {
      const prop = m[1] ?? m[3];
      const literal = m[2] ?? m[4];
      // 🔴 兩個都拿不到 ⇒ regex 與這裡的取值對不上 ⇒ **拋, 不要靜靜地放行**
      if (prop === undefined || literal === undefined) throw new Error(`抽取器與 regex 對不上:${m[0]}`);
      pairs.push([prop, literal]);
    }
    // 🔵 前置:抽得到東西 —— 否則下面那個迴圈跑 0 次而它印綠
    expect(pairs.length, '一組都沒抽到 ⇒ 這把尺沒有接上(或那一族呼叫被改寫了)').toBeGreaterThanOrEqual(5);
    const bad = pairs.filter(([prop, literal]) => prop !== literal);
    expect(bad, `這幾組的屬性名與訊息字面不一樣:${JSON.stringify(bad)}`).toEqual([]);
  });
});

describe('本檔自己的分母', () => {
  it('🔴 TARGETS 沒有漏掉這支 adapter 裡的任何一支 RPC(擋住「覆蓋率單調衰減而它印綠」)', () => {
    const src = readFileSync(TS_FILE, 'utf8');
    const called = [...src.matchAll(/SELECT\s+public\.([a-z0-9_]+)\s*\(/g)].map((m) => m[1]!);
    const seen = [...new Set(called)].sort();
    expect(seen.length, 'TS 檔裡一支 RPC 都沒抽到 ⇒ 這把尺沒有接上').toBeGreaterThan(0);
    expect(
      seen,
      `這支 adapter 呼叫的 RPC 與【TARGETS ∪ FAIL_LOUD】對不上。\n` +
        '⇒ 多出來的那支要嘛加進 TARGETS(它 fail-soft, 缺鍵 = 那一格永遠空的),\n' +
        '   要嘛加進 FAIL_LOUD_RPCS(它缺鍵會 throw)——**而「哪一堆」要開檔看, 不要用猜的。**',
    ).toEqual([...TARGETS.map((t) => t.fn), ...FAIL_LOUD_RPCS].sort());
  });


  it('🔴 每一個 TARGET 都真的跑到那一格(擋住「一個目標炸掉而另一個安靜消失」)', () => {
    expect(
      [...RAN].sort(),
      `我餵了 ${TARGETS.length} 個 TARGET, 而實際跑到主判定的是 ${RAN.length} 個。\n` +
        '⚠️ **而它在 `--shard` / `.only` / vitest retry 底下會假紅**(RAN 會重複或缺項;R3 nit)。\n' +
        '⚠️ **而這一格只在【檔案 collection 成功】時才有意義** —— 一個 import 期就炸的檔,\n' +
        '   連本格都不會跑。真正保護 collection 的是「把計算搬進 it()」那一步, 不是這個計數器。',
    ).toEqual(TARGETS.map((t) => t.fn).sort());
  });
});
