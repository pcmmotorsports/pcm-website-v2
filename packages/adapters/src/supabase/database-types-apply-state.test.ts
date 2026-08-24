import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// database-types-apply-state.test.ts — `#523` 第二段:釘住 `database.types.ts` 檔頭「整段」條目
// 宣稱的 apply 狀態,並且**在退場條件觸發時把紅逼出來**。
//
// 🔴🔴 **為什麼需要它**:⑬ 原本逐字寫著「整支函式在正式庫**還不存在**(`20260820021000` **未 apply**)」
//    —— 而它已經 apply 了。那句話產生的不是錯誤,是**沒有發生的那次比對**。
//
// ── 本檔兩層,分開讀 ──────────────────────────────────────────────────────────
//  第一層「宣稱不得說謊」:條目宣稱的 apply 狀態 vs `APPLIED.tsv`。**改一句真話就綠得了。**
//  第二層「退場條件不得靜默」(`it.fails`):主 migration 一旦 apply,該條目的退場條件就成立
//    ⇒ **它會紅,而唯一的綠路是真的去做那件事**(重 gen → 逐字比對 → 刪掉本段 → 檔頭計數減一)。
//    🔴 體例抄 `applied-migration-pairing.test.ts` 的「為什麼寫成 `it.fails`」那一段(**字面錨,不寫行號**),而**那條路被走完過一次**:
//       commit `e84bde7b`「#20 apply 後收尾 — 重 gen 型別、登帳、守門轉常設」。
//    ⚠️ **代價要講明**:第二層今天就是紅的,而讓它變綠需要正式庫 access + 重貼檔頭全部校正。
//       ⇒ 這是**刻意**的:第一層防「說謊」,第二層防「誠實地擺爛」。兩者不可互相替代。
//
// ── 🔴 掃哪幾個詞(**先列出來,因為字集比宣稱窄正是 `#676` 的形狀**)──────────
// 只掃兩個**封閉字集**,而**兩邊都不命中就紅**(不是靜默放行):
//   宣稱未套用 = 未 apply / 未apply / 尚未 apply / 尚未套用 / 還沒 apply / 未套用
//   宣稱已套用 = 已 apply / 已apply / 已套用 / APPLIED.tsv 命中
// 🔴 **有人用了別的寫法 ⇒ 本格【紅】**,訊息會請他改寫或擴字集。與姊妹閘
//    `database-types-manual-count.test.ts` 同體例:**不認得就吵,不靜默略過。**
// ⚠️ **「還不存在」刻意【不進】字集**(code-reviewer F7):它同時是「DB 裡沒有」與「本檔裡沒有」,
//    而 ⑬⑭ 的主題**正好**是「已 apply 但不在本檔裡」⇒ 收它會把一句正確的話判成歧義。
// 🔴 **掃描前先剝掉 `~~刪除線~~` 裡的字** —— 本 repo 的慣例是「過期的句子留痕不刪」
//    (數法:`grep -c '~~' packages/adapters/src/supabase/database.types.ts`,**不寫行號**:
//     行號會被同一顆 diff 自己推移,而寫的人不會回頭重量 —— 2026-08-23 已踩過)。
//    不剝的話:有人照慣例更正一條條目 ⇒ 這道閘**繼續紅**,而他做的是對的事。
//    ⚠️ `~~` 沒成對 ⇒ 正規式吃太多 ⇒ 措辭兩邊皆不命中 ⇒ **紅**(fail-closed,刻意)。
//
// ── ⚠️ 它守不到的(照實寫,免得被讀成「型別檔都被涵蓋了」)────────────────────
//  · **只涵蓋檔頭的「整段」條目**(現行分母 = 2 條,下面釘死字面)。
//    ①–⑫ 那種「參數 `| null`」校正**不在範圍** —— 它們的存在不取決於 apply 狀態。
//  · 🔴 **表 / view 形狀的手改【根本不在檔頭裡】⇒ 這道閘看不見它們。**
//    (`#841` 的 `paid_total` + `order_paid_totals_v`、`order_manual_refunds` 的作廢欄都是這一族。)
//    ⇒ **不得讀成「有這道閘 ⇒ 手改都被看著了」。**
//  · **不驗那一段型別內容對不對**(那要真的 gen 一次才知道)。
//  · `APPLIED.tsv` 是**自陳帳**,它與正式庫不符時本檔會跟著錯。
const TYPES_PATH = join(__dirname, 'database.types.ts');
const APPLIED_PATH = join(__dirname, '../../../../supabase/APPLIED.tsv');

/** 條目行的縮排(與下面的正規式綁死,只寫一次;code-reviewer F9)。 */
const ENTRY_INDENT = ' '.repeat(3);
/** 🔴 圈號只到 ⑳ —— 第 21 條(㉑)會被**靜默吸進**第 20 條(F8,形狀同 F2)。到 ⑳ 前要擴這裡。 */
const ENTRY_RE = new RegExp(`^//${ENTRY_INDENT}([\\u2460-\\u2473])`);
/** 檔頭裡的分節線;`body` 不得越過它(F4:原本用魔術數 40,會把無關檔頭算進宣稱)。 */
const SECTION_BREAK = /^\/\/ ─/;

const CLAIM_NOT_APPLIED = ['未 apply', '未apply', '尚未 apply', '尚未套用', '還沒 apply', '未套用'];
const CLAIM_APPLIED = ['已 apply', '已apply', '已套用', 'APPLIED.tsv 命中'];

/**
 * 🔴 現行分母,釘字面(F1:只斷言「>0」的話,把還在說謊的那條整段刪掉會全綠)。
 * ~~**2026-08-23 起是空的** —— ⑬⑭ 兩條已退場(見 `database.types.ts` 檔頭那條刪除線)。~~
 * **2026-08-24 起又有一條**:⑬ `admin_create_manual_order`〔主migration=20260824020000〕。
 * 🔴 圈號重用 ⑬ 不是筆誤 —— 圈號數的是**還活著的條目**,退場的那兩條在留痕區被劃掉、不進解析。
 * ⚠️ **空不等於這道閘睡著了**:下面的前提格仍釘死總條目數;
 *    而任何人新增一條「整段」條目 ⇒ 名單對不上 ⇒ **紅**,逼他來這裡把它加進來並想清楚退場條件。
 */
const EXPECTED_WHOLE_SECTION_MARKS: string[] = ['⑬'];
/** 全部圈號條目數。F2:某條圈號被改寫 ⇒ 它不會消失,會**併進上一條**而總數少一。 */
const EXPECTED_TOTAL_ENTRIES = 13;

type Entry = { mark: string; body: string };

function parseEntries(src: string): Entry[] {
  const lines = src.split('\n');
  const starts: number[] = [];
  lines.forEach((l, i) => {
    if (ENTRY_RE.test(l)) starts.push(i);
  });
  return starts.map((s, k) => {
    let end = starts[k + 1] ?? lines.length;
    for (let i = s + 1; i < end; i++) {
      const line = lines[i] ?? '';
      if (SECTION_BREAK.test(line) || !line.startsWith('//')) {
        end = i;
        break;
      }
    }
    return { mark: ENTRY_RE.exec(lines[s] ?? '')?.[1] ?? '?', body: lines.slice(s, end).join('\n') };
  });
}

/** 剝掉刪除線內的字(見檔頭)。非貪婪;沒成對就吃到底 ⇒ 兩邊皆不命中 ⇒ 紅。 */
const stripStruck = (t: string) => t.replace(/~~[\s\S]*?~~/g, '');

const appliedIds = new Set(
  readFileSync(APPLIED_PATH, 'utf8')
    .split('\n')
    .map((l) => l.split('\t')[0]?.trim() ?? '')
    .filter((id) => /^20\d{12}$/.test(id)),
);

const allEntries = parseEntries(readFileSync(TYPES_PATH, 'utf8'));
const wholeSection = allEntries.filter((e) => e.body.includes('**整段**'));

/** 🔴 只認條目自己標的**單一**主錨。同條目裡的其他編號是旁引(F3:`.some` 會被旁引頂成假綠)。 */
function primaryMigration(body: string): string[] {
  return [...body.matchAll(/〔主migration=(20\d{12})〕/g)].map((m) => m[1] ?? '');
}

describe('database.types.ts 檔頭「整段」條目:宣稱不得說謊', () => {
  it('🔴 前提:條目集合與 APPLIED.tsv 都是我以為的樣子(這格是其餘各格的分母)', () => {
    expect(allEntries.length, `圈號條目總數變了 ⇒ 可能有一條被改寫而【併進上一條】(F2)`).toBe(
      EXPECTED_TOTAL_ENTRIES,
    );
    expect(wholeSection.map((e) => e.mark), '「整段」條目的名單變了 ⇒ 有人新增/刪除,請人看過再改這裡').toEqual(
      EXPECTED_WHOLE_SECTION_MARKS,
    );
    expect(appliedIds.size, 'APPLIED.tsv 讀不到任何 migration 編號 ⇒ 路徑或格式變了').toBeGreaterThan(0);
  });

  it.each(wholeSection.map((e) => [e.mark, e] as const))('條目 %s:宣稱 = APPLIED.tsv', (mark, entry) => {
    const primary = primaryMigration(entry.body);
    expect(primary.length, `條目 ${mark} 要**恰好一個**〔主migration=…〕錨,現在有 ${primary.length} 個`).toBe(1);

    const live = stripStruck(entry.body);
    const saysNo = CLAIM_NOT_APPLIED.some((w) => live.includes(w));
    const saysYes = CLAIM_APPLIED.some((w) => live.includes(w));
    expect(
      saysNo || saysYes,
      `條目 ${mark} 沒有本檔認得的 apply 措辭。請改用字集內的寫法,或擴充字集並說明為什麼。`,
    ).toBe(true);
    expect(saysNo && saysYes, `條目 ${mark} 同時出現「已套用」與「未套用」措辭 ⇒ 有歧義,請人判`).toBe(false);

    const isApplied = appliedIds.has(primary[0] ?? '');
    if (saysNo) {
      expect(
        isApplied,
        `🔴 條目 ${mark} 宣稱主 migration ${primary[0]} 未套用,而 APPLIED.tsv 說它【已套用】。\n` +
          `   ⇒ **下一步**:把那句話改寫成事實(舊句留痕、不刪);真正的退場由本檔第二層那格逼。`,
      ).toBe(false);
    } else {
      expect(isApplied, `條目 ${mark} 宣稱已套用,而 APPLIED.tsv 裡找不到主 migration ${primary[0]}`).toBe(true);
    }
  });
});

describe('🔴 第二層:退場條件不得靜默', () => {
  // ── 為什麼寫成 `it.fails`(體例抄 `applied-migration-pairing.test.ts` 的同名段落)──────────
  // 普通斷言會**現在就紅**,擋住 commit;而 apply 是 Sean 的獨立停點,不是我或主視窗能代的。
  // 🔴 `it.fails` 讓這件事變成**「現在綠、apply 之後紅」**:
  //   · 尚未 apply(現在)→ 內層斷言失敗 → `it.fails` 通過 → 可以 commit
  //   · apply 之後 → 內層斷言成立 → **本格開始紅** → 逼下一個人回到這裡
  //     ⇒ 而那正是該重 gen `database.types.ts`、逐字比對、刪掉 ⑬ 那一段、檔頭計數減一的同一刻。
  // ⚠️ **這不是把紅藏起來** —— 它把紅挪到**有人能處理的那一刻**:現在紅沒有人修得了(要 Sean),
  //    apply 後紅的人手上剛好有全部材料。
  // 🔴 **極性**:內層斷言的是「**觸發條件成立了**」(= 已記進帳)。寫反(斷言「還沒記」)
  //    會變成一個**永遠綠的裝飾品** —— 2026-08-23 那次退場的註解逐字警告過這一點。
  // 🔴 **退場方式**:它紅的那一刻,把本 describe 連同 ⑬ 條目一起刪(前者是後者的守門,
  //    後者沒了它就沒有標的)—— 而 `EXPECTED_WHOLE_SECTION_MARKS` 那份名單會逼你真的改到這裡。
  it.fails('⑬ 20260824020000 一旦記進 APPLIED.tsv ⇒ 本格轉紅,唯一的綠路是真的走完退場', () => {
    expect(appliedIds.has('20260824020000')).toBe(true);
  });
});

// ── 🔴 原本這裡有一個 `it.fails`「退場條件不得靜默」的 describe,**2026-08-23 拿掉** ──────
//  拿掉的理由不是它沒用,是**它的標的沒有了**:⑬⑭ 兩條當天走完了退場
//  (當場重 gen ⇒ 產物與本檔逐字相同 ⇒ 轉為常設事實、不再是要人重貼的債)。
//  ⚠️ **退場一個守門有兩種形狀**:刪掉它 / 把它換成一句永遠成立的話。
//     這裡走的是前者 —— 因為「沒有整段條目」這件事**已經由上面的名單釘住了**,
//     再寫一句「零債」只是同一個宣稱的第二份副本。
//  🔴 **下次有人新增「整段」條目時要把它加回來**:形狀抄
//     `applied-migration-pairing.test.ts` 的「為什麼寫成 `it.fails`」那一段,
//     極性是**內層斷言「觸發條件成立了」**(寫反會變成一個永遠綠的裝飾品,2026-08-23 踩過)。

describe('解析器與字集的自我對照', () => {
  it('正向對照:解析、整段過濾、字集三件都是活的', () => {
    const fake = [
      '//   ① `f_a` **整段**:〔主migration=20260101000000〕 未 apply。',
      '//   ② `f_b` **整段**:〔主migration=20260102000000〕 已 apply。',
      '//   ③ `f_c`(不是整段,應被濾掉)',
    ].join('\n');
    const parsed = parseEntries(fake);
    expect(parsed.map((e) => e.mark)).toEqual(['①', '②', '③']);
    expect(parsed.filter((e) => e.body.includes('**整段**')).map((e) => e.mark)).toEqual(['①', '②']);
    expect(primaryMigration(parsed[0]?.body ?? '')).toEqual(['20260101000000']);
    expect(CLAIM_NOT_APPLIED.some((w) => parsed[0]?.body.includes(w))).toBe(true);
    expect(CLAIM_APPLIED.some((w) => parsed[1]?.body.includes(w))).toBe(true);
  });

  it('刪除線:留痕的舊句不算宣稱,而【不剝】會誤判成兩邊都命中(負向對照)', () => {
    const struck = '//   ① `f` **整段**:~~〔主migration=20260101000000〕未 apply~~ 更正:它已 apply。';
    const live = stripStruck(struck);
    expect(CLAIM_NOT_APPLIED.some((w) => live.includes(w))).toBe(false);
    expect(CLAIM_APPLIED.some((w) => live.includes(w))).toBe(true);
    expect(CLAIM_NOT_APPLIED.some((w) => struck.includes(w))).toBe(true); // 不剝就會誤判 ⇒ 那一步承重
  });

  it('body 邊界:分節線之後的東西不算進條目(F4;原本吃固定 40 行會誤紅)', () => {
    const src = [
      '//   ① `f` **整段**:〔主migration=20260101000000〕 已 apply。',
      '// ─────────────',
      '// 這一行與 ① 無關,而它含「未套用」三個字',
    ].join('\n');
    const body = parseEntries(src)[0]?.body ?? '';
    expect(body.includes('未套用')).toBe(false);
  });

  it('主錨:同條目裡的旁引編號不得被拿來對帳(F3 的假綠)', () => {
    const body = '//   ① `f` **整段**:〔主migration=20260101000000〕 未 apply(旁引 `20260102000000`)。';
    expect(primaryMigration(body)).toEqual(['20260101000000']);
  });
});
