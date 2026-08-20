#!/usr/bin/env node
// ============================================================
// 全稱句守門 hook 的 PreToolUse 表演台(7 發,對照組焊在裡面)
// ============================================================
// 用法:node scripts/quantifier-hook.harness.js <新版hook> <舊版hook>
//   → exit code:新版不符期待的發數 = 0 時 0,否則 1
// 維護:W5(守門與工具)。
// 🔴 被測對象住在 repo 外面(~/.claude/hooks/),不會被本 repo 的任何守門碰到。
// 🔴 它量不到的:PostToolUse / Stop 兩個事件(Stop 另有一場「檔案還沒刷新」的競速,見 W5-068)。
// 🔴 進了版控【不代表】有守門:三綠不掃 .js。
// ============================================================
// 兩個世界表演台 —— 同一組輸入餵給 OLD 與 NEW,並排印。
// 🔴 每一發用【不同的 session_id】:否則「沒輸出」會分不清是「判定放行」還是「開火預算用光」。
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');

// 🔴 2026-08-20 修:路徑**不再寫死**。
//    實錘:我量測時檔名是 `quantifier-assertion.NEW.js`,交件時改成 `W5-060-…FIXED.js`
//    ⇒ 同一份 harness 在收件人手上 7/7 全部 parse-error ⇒ **一個正確的產物長得像壞掉的。**
//    通例:驗證腳本與被驗物之間的路徑耦合,要嘛跟著交件一起搬,要嘛**吃參數**。這裡選吃參數。
//    用法:node <harness> [NEW路徑] [OLD路徑]
const path = require('path');
// 🔴 進版控後改掉原本的預設值:它指向 ~/pcm-mailbox 的一份快照,在 repo 裡【不存在】
//    ⇒ 沒給參數時大聲死掉,勝過安靜地驗了一個不存在的檔。
const NEW = process.argv[2] || process.env.HOOK_NEW;
if (!NEW) {
  console.error('用法:node scripts/quantifier-hook.harness.js <NEW hook 路徑> [OLD hook 路徑]');
  process.exit(2);
}
const OLD =
  process.argv[3] ||
  process.env.HOOK_OLD ||
  process.env.HOME + '/.claude/hooks/quantifier-assertion.js.bak-20260820-w5';
for (const [k, p] of [['NEW', NEW], ['OLD', OLD]]) {
  if (!fs.existsSync(p)) {
    console.error(`✗ ${k} 找不到:${p}\n用法: node <harness> [NEW路徑] [OLD路徑]`);
    process.exit(2);
  }
}
// 🔴 把量到的座標印在數字旁邊 —— 表會被複製走,前後文不會。
console.log(`NEW = ${NEW}\nOLD = ${OLD}\n`);

// 讓本檔自己的內容不含連續的 "git commit" 字面 —— 否則跑它的那個 Bash call 會被現役 hook 讀到。
const GC = 'git ' + 'commit';

const DIRTY = '這一段有全稱句:所有的路徑我都掃過了,零命中。\n而同段落沒有任何數法。';
const CLEAN = '這一段也有全稱句:所有的路徑我都掃過了,零命中。\n數法:`grep -rn foo . | wc -l` ⇒ 0。';

// 舊檔:模擬「同路徑上一次留下的訊息」。
// 🔴 2026-08-20 全隊令:**不放 /tmp** —— 這兩支的內容是【專門設計成會被擋】的文字,
//    留在公共路徑上,誰 `-F` 指到就被擋,而且看不懂為什麼(W9e 2026-08-20 撞的就是這一族)。
//    ⇒ 放在 harness 自己旁邊,並且**檔內第一行署名**:撿到的人要知道那是誰的。
const OWNER =
  '[W5 hook 表演台的測試素材 —— 不是任何人的 commit 訊息。誤用會被全稱句守門擋下。]';
// 🔴 進版控後改掉素材落點:原本放在 harness 旁邊(信箱裡合理),而在 repo 裡它變成
//    「每跑一次就多兩支未追蹤檔」⇒ 會被 git add . 誤帶走。改成每次一個獨立暫存目錄,
//    既不撞名(本來要防的),也不在 repo 裡留東西。跑完刪。
const FIXDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'w5-hook-harness-'));
process.on('exit', () => { try { fs.rmSync(FIXDIR, { recursive: true, force: true }); } catch {} });
const STALE_DIRTY = path.join(FIXDIR, 'w5-fixture-stale-dirty.txt');
const STALE_CLEAN = path.join(FIXDIR, 'w5-fixture-stale-clean.txt');
fs.writeFileSync(STALE_DIRTY, OWNER + '\n\n' + DIRTY);
fs.writeFileSync(STALE_CLEAN, OWNER + '\n\n' + CLEAN);

const HD = (p, body) => `cat > ${p} <<'XEOF'\n${body}\nXEOF\n`;

const CASES = [
  {
    id: 'W1 該紅  heredoc 髒(本次命令自己寫的)',
    expect: 'deny',
    cmd: HD('/tmp/hookfix-w1.txt', DIRTY) + `&& ${GC} -F /tmp/hookfix-w1.txt`,
  },
  {
    id: 'W2 該綠  heredoc 有全稱句但附了數法',
    expect: 'pass',
    cmd: HD('/tmp/hookfix-w2.txt', CLEAN) + `&& ${GC} -F /tmp/hookfix-w2.txt`,
  },
  {
    id: 'W3 該綠  散文裡【引用】指令,外面沒有真的 commit',
    expect: 'pass',
    cmd:
      HD(
        '/tmp/hookfix-w3.md',
        `我要解釋一個坑。我原本寫的是:\n${GC} -F ${STALE_DIRTY}\n而它會讀到上一次的檔。`
      ) + `&& mv /tmp/hookfix-w3.md /tmp/hookfix-w3-done.md`,
  },
  {
    id: 'W4 該紅  -F 指向【前一個 call 寫好】的髒檔(讀檔路徑仍要有效)',
    expect: 'deny',
    cmd: `${GC} -F ${STALE_DIRTY}`,
  },
  {
    id: 'W5 該吵  -F 的檔由本次命令產生,而不是 heredoc(printf)⇒ 解析不出',
    expect: 'unchecked',
    cmd: `printf '%s' "$MSG" > /tmp/hookfix-w5.txt && ${GC} -F /tmp/hookfix-w5.txt`,
  },
  {
    id: 'W6 病灶  heredoc 乾淨、而【同路徑舊檔是髒的】',
    expect: 'pass',
    cmd: HD(STALE_DIRTY, CLEAN) + `&& ${GC} -F ${STALE_DIRTY}`,
  },
  {
    id: 'W7 反向病灶 heredoc 髒、而【同路徑舊檔是乾淨的】⇒ 舊版靜靜放行',
    expect: 'deny',
    cmd: HD(STALE_CLEAN, DIRTY) + `&& ${GC} -F ${STALE_CLEAN}`,
  },
];

function verdict(out) {
  if (!out.trim()) return 'pass(靜默)';
  let j;
  try {
    j = JSON.parse(out);
  } catch {
    return 'parse-error';
  }
  const h = j.hookSpecificOutput || {};
  if (h.permissionDecision === 'deny') return 'deny';
  if (h.additionalContext && /沒有檢查到/.test(h.additionalContext)) return 'unchecked';
  if (h.additionalContext) return 'context';
  return 'pass(空)';
}

function run(script, c, tag) {
  const payload = JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    session_id: `hookfix-${tag}-${c.id.slice(0, 2)}-${Math.floor(process.hrtime()[1])}`,
    tool_input: { command: c.cmd },
  });
  try {
    return execFileSync('node', [script], { input: payload, encoding: 'utf8' });
  } catch (e) {
    return `EXEC-ERROR ${e.message}`;
  }
}

let fail = 0;
console.log('案例'.padEnd(52) + '│ 期待      │ OLD        │ NEW');
console.log('─'.repeat(52) + '┼───────────┼────────────┼──────────');
for (const c of CASES) {
  const o = verdict(run(OLD, c, 'old'));
  const n = verdict(run(NEW, c, 'new'));
  const ok = n.startsWith(c.expect);
  if (!ok) fail += 1;
  console.log(
    c.id.padEnd(50) + ' │ ' + c.expect.padEnd(9) + ' │ ' + o.padEnd(10) + ' │ ' + n + (ok ? '  ✅' : '  ❌')
  );
}
console.log('\nNEW 不符期待的發數 = ' + fail);
process.exit(fail === 0 ? 0 : 1);
