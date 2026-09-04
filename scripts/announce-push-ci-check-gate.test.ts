import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// announce-push-ci-check-gate.test.ts —— 守【`announce-and-push.sh` 裡那段呼叫 `ci-verdict.py` 的碼還在】。
//
// 🔴🔴 **標題刻意只寫到這裡**(code-reviewer 2026-09-04 抓:第一版標題寫「守『收割那一步真的在查上一發的 CI』」,
//    而本檔**只證那段字面還在腳本裡**)⇒ 📌 **檔名與標題也是一個宣稱, 而它比證據寬的時候沒有東西會紅。**
//
// 🔬 **為什麼需要它**:`⟦02-CIFAILRATE⟧` 自己標的天花板 ——
//    「那段呼叫**自己沒有守門** ⇒ 實跑突變:拿掉它, 全套測試全過」。
//    📌 **一段沒有守門的檢查, 被刪掉的那天不會有任何東西紅** —— 而刪它最可能的理由是
//    「它拖慢推送」, 那個理由在當下永遠成立。
//
// 🔵 **它守的東西【在前提成立時】買到多少**(2026-09-04 線 `-db` 量, `gh run list` 60 發):
//    台北 09-03 一個成因(`expected [ Array(1) ] to deeply equal []`)紅了 **7.2 小時**,
//    期間 15 發 CI ⇒ 紅 13 / 取消 2 / **綠 0**, **13 顆 head 被推到那個紅的 dev 上**。
//    而該檢查在**下一次推送**就會印紅 ⇒ 第 2 發距第 1 發紅只有 **8 分鐘**。
//    🛑🛑 **而那個「7.2 小時 ⇒ 8 分鐘」是【有前提的】, 不是無條件的**(code-reviewer 抓):
//       它的前提是「**push 真的都走這支腳本**」—— 而**被守的那支檔自己在 `:45-47` 記著**:
//       2026-09-04 主視窗自陳那一夜每一發 push 都是**手打**的 ⇒ **那天它一次都沒生效。**
//       ⇒ 📌 **「接上了」與「有在跑」是兩個宣稱, 而它們在 diff 上長得一樣。**
//
// 🟢 **而 `ci-verdict.py` 本身在真實失敗族群上驗過**(同日):8 發**已知紅** + 8 發**已知綠**的 sha
//    ⇒ **16/16 全對**(紅 rc=1 / 綠 rc=0)。
//
// ⚠️⚠️ **本檔【證不到】什麼(照實寫, 三條)**:
//    ① 證不到**推的人真的讀了那一行** —— 那是人的動作。
//    ② 證不到**那一行會被執行** —— 它只排掉「註解掉的」與「只是在講它的」;
//       若整段被包進一個永遠不成立的分支(`if false; then`), 本檔仍然綠。
//    ③ 🔴 **證不到那支腳本【有被跑】** —— 見上面那條前提, 反例就寫在被守的檔裡。

const SCRIPT = 'scripts/announce-and-push.sh';
const NEEDLE = 'python3 scripts/ci-verdict.py';

/**
 * 從 shell 原始碼裡挑出【會執行的】那幾行 `python3 scripts/ci-verdict.py`。
 *
 * 🔴🔴 **本函式是【被負對照直接餵】的那一支** —— code-reviewer 2026-09-04 抓到第一版的病:
 *    負對照當時餵的是 `stripShellComments`(一個 helper), 而**把 `scriptSource()` 裡的
 *    `stripShellComments(raw)` 換成 `raw` ⇒ 四格全綠** ⇒ 📌 **負對照守的是零件, 不是那把尺。**
 *    ⇒ ✅ 修法:把判斷抽成具名函式, **真測與負對照走【同一支】**。
 *
 * 🔴 **判「註解掉了沒」用 `#` 的位置, 不用「這一行有沒有 echo」** ——
 *    第一版用「排掉含 `echo` 的行」, 而它兩個方向都會錯:
 *    · **假綠**:`FROM_OK=1  # 舊的 python3 scripts/ci-verdict.py 已停用`(行尾註解)⇒ 被算成真呼叫
 *    · **假紅**:`echo "..." && python3 scripts/ci-verdict.py`(同一行既有 echo 又有真呼叫)⇒ 被排掉
 *    ⇒ 用 `#` 的位置一發消掉兩邊。
 * ⚠️ **而它仍然不完美**:`#` 出現在字串裡(`echo "a#b"`)會誤判。今天那支腳本沒有那種行,
 *    而**寫出來免得下一個人以為這是完整的 shell parser**。
 */
export function ciVerdictRunLines(src: string): string[] {
  return src.split('\n').filter((line) => {
    const at = line.indexOf(NEEDLE);
    if (at < 0) return false;
    const hash = line.indexOf('#');
    // 整行註解 或 行尾註解把它註解掉了 ⇒ 不算
    if (hash >= 0 && hash < at) return false;
    // 只是在「講」它(印給人看的提示訊息)⇒ 不算
    const echoAt = line.indexOf('echo');
    if (echoAt >= 0 && echoAt < at) return false;
    return true;
  });
}

function scriptSource(): string {
  const raw = readFileSync(SCRIPT, 'utf8');
  // 🔴 掃描器回空 ⇒ 底下每一格恆綠。這一行讓「我根本沒讀到檔」自己紅。
  // ⚠️ `length` 數的是 **UTF-16 code unit**(不是位元組)—— 本檔實測 9,742 而 `wc -c` 是 16,263。
  //    門檻 500 只是「不是空的」那一級, 餘裕約 19 倍。
  expect(raw.length, `${SCRIPT} 幾乎讀不到內容 ⇒ 本檔所有斷言失去判別力`).toBeGreaterThan(500);
  return raw;
}

describe('⟦02-CIFAILRATE⟧ `announce-and-push.sh` 必須還留著那段呼叫', () => {
  it('🟢 正向對照:掃描器真的讀到那支腳本(否則下面每一格都會恆綠)', () => {
    const src = scriptSource();
    expect(src).toContain('origin/dev'); // 與本檔要守的東西無關、而我確定在那支腳本裡
    expect(src.length).toBeGreaterThan(500);
  });

  it('🔴 那段呼叫還在 —— 而它【沒有被註解掉】、也不只是被印出來給人看', () => {
    const lines = ciVerdictRunLines(scriptSource());
    expect(
      lines.length,
      `${SCRIPT} 裡找不到一行【沒被註解、也不是 echo 訊息】的 \`${NEEDLE}\` ⇒ 收割不再查上一發的 CI`,
    ).toBeGreaterThan(0);
  });

  it('🔴 而【工具不在】那條路要出聲 —— 否則刪掉工具本身也是靜悄悄的', () => {
    expect(scriptSource()).toContain('沒有查上一發的 CI');
  });

  it('🔵 負對照:三種【不該算數】的形狀,走的是【同一支】判斷函式', () => {
    // ① 整行註解
    expect(ciVerdictRunLines(`# ${NEEDLE} "$FROM"`)).toHaveLength(0);
    // ② 行尾註解(第一版在這裡假綠)
    expect(ciVerdictRunLines(`FROM_OK=1  # 舊的 ${NEEDLE} 已停用`)).toHaveLength(0);
    // ③ 只是印出來給人看的提示訊息
    expect(ciVerdictRunLines(`  echo "想現在就看:${NEEDLE} $ACT"`)).toHaveLength(0);
    // 🟢 而一個【真的】會執行的形狀必須被算到 —— 否則上面三個 0 只證明它什麼都抓不到
    expect(ciVerdictRunLines(`  ${NEEDLE} "$FROM"`)).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 第二道:守【推前預告那一行帶了「兩端值」】(2026-09-04 線【帳號】`-account` 補)
//
// 🔬 **為什麼需要它**:同日的回饋路徑盤點量到 ——
//    `scripts/announce-and-push.sh:20-21` 同時算 `TIP` 與 `FROM` ⇒ **人漏不掉**,
//    而**上面那道閘守的是「`ci-verdict` 那段呼叫還在」, 不是「預告帶了兩端值」**
//    ⇒ 🔴 **有人把 `$FROM` 從 `:180` 那一行拿掉, 全套測試零紅。**
//
// 🔬 **它擋的是【同一種形狀】的失效**(同日, 收訊端是本窗):
//    一則預告寫成「`52c06f5f6` → **新頭**」—— 少了 `Y` ⇒ 收訊端**無法比對**,
//    而「沒有預告」與「預告少一端」在收訊端**是同一個空白**。
//
// 🔴🔴 **⛔ ~~而我第一版寫「它擋的是一個【已經發生過】的失效」~~ —— 那句話太寬, 我當天自己撤掉:**
//    **那一則預告是【在跨窗訊息裡手打的】, 不是這支腳本印的** ⇒ 🎯 **本檔【結構上抓不到那一發】。**
//    ⇒ 📌 **一道守門最容易被過度宣稱的地方, 是【促成它的那個事故】** ——
//    因為寫的人剛被那件事咬過, 而**「它防的形狀」與「它防得到那一次」讀起來一樣。**
//    ⚠️ 而**那一發到底有沒有走這支腳本, 本窗【未確認】**(我只看得到訊息, 看不到它怎麼產生的)。
//    ✅ **本檔真正守得住的**:**走這支腳本的那條路** —— 而手打的那條路, 這裡一個字都證不到。
//
// 🔴 **兩種紅要分得開**(本檔自己的教訓, 同日):
//    · `announceLines()` 回空 ⇒ **找不到預告那一行**(整段被改寫或刪掉)
//    · 回了行而缺一端   ⇒ **預告還在, 而它少了一端**
//    ⇒ 📌 合成一格的話, 修的人不知道要去找哪一種。
//
// ⚠️ **本段【證不到】什麼**:
//    ① 證不到那一行**會被執行**(與上面那道同一個限制)
//    ② 證不到**推的人真的把預告發出去** —— 腳本印在終端機, 送不送是人的動作
//    ③ 🔴🔴 證不到**兩端的值是對的** —— 它只證那一行【引用了那兩個變數】。
//       ⇒ **它擋得住「拿掉 `$FROM`」, 擋不住「`$FROM` 被填成一個錯的值」**(主視窗 `-94` 指出)。
//    ④ 🔴 證不到**手打的預告** —— 見上面那段撤回。**本檔的射程止於這支腳本。**
const ANNOUNCE_SCRIPT = 'scripts/announce-and-push.sh';
const ANNOUNCE_NEEDLE = 'origin/dev 會從';

/** 挑出【會執行的】預告行(整行註解與行尾註解都不算)。真測與負對照走同一支。 */
export function announceLines(src: string): string[] {
  return src.split('\n').filter((line) => {
    const at = line.indexOf(ANNOUNCE_NEEDLE);
    if (at < 0) return false;
    const hash = line.indexOf('#');
    return !(hash >= 0 && hash < at);
  });
}

/** 那一行有沒有【同時】引用兩端。缺哪一端要說得出來。 */
export function missingEndsOf(line: string): string[] {
  const missing: string[] = [];
  if (!line.includes('$FROM')) missing.push('$FROM(起點 X)');
  if (!line.includes('$TIP')) missing.push('$TIP(終點 Y)');
  return missing;
}

describe('推前預告必須帶【兩端值】—— 而缺一端與整段不見要分得開', () => {
  it('🟢 正向對照:掃描器真的讀到那支腳本(否則下面每一格都會恆綠)', () => {
    const src = readFileSync(ANNOUNCE_SCRIPT, 'utf8');
    expect(src.length).toBeGreaterThan(500);
    expect(src).toContain('git push origin');
  });

  it('🔴 紅法一:找得到【預告那一行】—— 空的意思是整段被改寫或刪掉了', () => {
    const lines = announceLines(readFileSync(ANNOUNCE_SCRIPT, 'utf8'));
    expect(
      lines.length,
      `${ANNOUNCE_SCRIPT} 裡找不到一行沒被註解的「${ANNOUNCE_NEEDLE}」⇒ 預告那一段不見了(不是少一端)`,
    ).toBeGreaterThan(0);
  });

  it('🔴 紅法二:每一行預告都【同時】帶起點與終點 —— 少哪一端要指名', () => {
    for (const line of announceLines(readFileSync(ANNOUNCE_SCRIPT, 'utf8'))) {
      expect(
        missingEndsOf(line),
        `預告那一行少了:${missingEndsOf(line).join(' / ')} ⇒ 收訊端無法比對, 而它與「沒收到預告」是同一個空白\n   該行:${line.trim()}`,
      ).toEqual([]);
    }
  });

  it('🔵 負對照:四種形狀走的是【同一支】判斷函式', () => {
    // ① 整行註解 ⇒ 不算預告行
    expect(announceLines(`# echo "   ${ANNOUNCE_NEEDLE} $FROM 走到 $TIP"`)).toHaveLength(0);
    // ② 行尾註解把它註解掉 ⇒ 不算
    expect(announceLines(`OK=1  # 舊的 ${ANNOUNCE_NEEDLE} $FROM 走到 $TIP`)).toHaveLength(0);
    // 🟢 ③ 一個【真的】會執行的形狀必須被算到 —— 否則上面兩個 0 什麼都不證明
    expect(announceLines(`  echo "   ${ANNOUNCE_NEEDLE} $FROM 走到 $TIP"`)).toHaveLength(1);
    // 🔴 ④ 而缺一端要被指名出來(這是本段真正要擋的那個突變)
    expect(missingEndsOf(`  echo "   ${ANNOUNCE_NEEDLE} 新頭"`)).toEqual([
      '$FROM(起點 X)',
      '$TIP(終點 Y)',
    ]);
    expect(missingEndsOf(`  echo "   ${ANNOUNCE_NEEDLE} $FROM 走到 新頭"`)).toEqual([
      '$TIP(終點 Y)',
    ]);
    // 🟢 而一個完整的形狀必須回空 —— 否則上面兩格只證明它什麼都說「缺」
    expect(missingEndsOf(`  echo "   ${ANNOUNCE_NEEDLE} $FROM 走到 $TIP"`)).toEqual([]);
  });
});
