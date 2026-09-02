import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// workflow-status-surface-allowlist —— 釘住「品項狀態」這條軸還剩幾個面。
//
// ── 它守的是誰的什麼(先讀這段)────────────────────────────────────────
//
// 🔴 **Sean 2026-07-24 拍「A 案 + 三規則」,規則② 逐字**:
//    「已付款時下拉**只出現「已收」半邊、藏掉 4 個 `unpaid_*`**(**防人工誤改回未收**)」
//    出處(照抄未重打):memory `project_m3-first-real-charge-success-2026-07-24`。
//
// 🔴🔴 **那個下拉是 `order_items.workflow_status`,不是 `payment_status`** ——
//    同一條 memory 對 `payment_status` 逐字寫「**此欄後台 UI 故意不可改=金流紅線**」
//    (數法:`grep -c '此欄後台 UI 故意不可改' <該 memory>` ⇒ 1;`grep -c '僅唯讀供過濾'` ⇒ 1;
//     負對照 `grep -c 'zzz唯讀'` ⇒ 0)。
//    ⇒ **`payment_status` 不可手改在他拍板【那天就已經成立】,它不是規則② 的繼承者。**
//    📌 本檔第一版把靶押在 `payment_status` 上 ⇒ 那是一道**斷言一件早就為真的事**的守門,
//       它會永遠綠、而且讀起來像在保護規則②。`code-reviewer` R1 抓到,靶已換、檔名同步改。
//
// 🔴 **規則② 的舊實作已經不在了**:它在他拍板同一天做完並審過(同 memory 逐字
//    「已實作收工…改 6 檔;三綠 + full test 2867 pass + code-reviewer R1 PASS」),
//    2026-08-06 隨「九碼退場」A9w4c 後半刪除(`workflow-select-options.ts` /
//    `workflow-status-select.tsx` / `item-workflow-status-cell.tsx`)。
//    ⚠️ **「刪除」的射程**:那三支在**工作樹與 `dev` 上沒有**,而
//    `bash scripts/where-is.sh apps/admin/src/lib/orders/workflow-select-options.ts` 的第③格
//    回 **8 個 ref**(7 支 local 分支 + `origin/brand-rollout`;**2026-08-25 量,會變**)。
//    照 `lessons-learned §12-43` 要寫成「`dev` 上已刪、未收割 ref 上仍有」,不要寫成「不存在」。
//
// 🔴 **今天仍活著的風險面**(這才是本檔存在的理由):
//    `order-edit-form.tsx` 檔頭逐字「**order 層 RPC 的 `workflow_status` key 能力保留、UI 停送**」
//    ⇒ **RPC 還吃這個 key,只是沒有人送。** 而那 4 個 `unpaid_*` 詞彙仍在
//    `lib/audit/audit-field-label.ts`(`unpaid_confirmed` / `unpaid_shipped` /
//    `unpaid_unconfirmed` / `unpaid_instock`)。
//    ⇒ **有人重新開一個面把它送出去,規則② 就被推翻了,而不會有任何東西變紅。**
//
// ── 已經有人在守的兩條路(本檔【不重做】它們)──────────────────────────
//    · `workflow-form.test.ts` 字面錨「一律忽略」(送 `workflow_status` ⇒ 不進 patch)
//    · `order-list-view.test.ts` 字面錨 `?workflow_status=`(URL 帶了 ⇒ 整個被忽略)
//    ⇒ 那兩格守的是【已知面上的行為】;**本檔守的是【面的集合】有沒有長出第三個。** 兩者正交。
//
// ── 做法與它的邊界 ────────────────────────────────────────────────
// 🔴 **用「檔案 allowlist」而不是掃 `name=`**(`code-reviewer` R1 的建議,採納):
//    掃 `name=` 的版本對 `formData.get()` / 物件屬性 / `React.createElement` /
//    `{...spread}` 一律失明 —— R1 當場構造出一個**送得出去**而它全綠的例子
//    (`payment-action-state.ts` 回 `{name,value}` 陣列 → `payment-record-form.tsx` 展成 hidden input)。
//
// 🔴🔴 **兩條命名都要掃**(`code-reviewer` R2 must-fix 1):DB 側是 `workflow_status`,
//    domain / mapper 側是 **`workflowStatus`**。當場量:snake 命中 7 支 / camel 命中 2 支 /
//    **聯集 8 支**,而 `components/orders/order-detail.tsx` **只含 camel、零 snake**
//    ⇒ 只掃 snake 的版本對它**完全隱形**,有人在那裡開新面不會紅。
//
// 🔴 **分母用 `fs` 走目錄,不用 `git grep`** —— `git grep` 預設不搜**未追蹤**的檔,
//    而本檔要抓的正是**新增**。下面「量具自檢」有一格**真的寫一支暫存檔進來**驗這件事
//    (R2 must-fix 2:原本那格是恆真的,改成 git 為分母會印一樣的結果 ⇒ 零判別力)。
//
// ⚠️ **本檔【抓不到】的**(誠實邊界,不要讀得比它大):
//    ① allowlist 內的檔**就地改**(例如 `order-edit-form.tsx` 重新開始送)
//       ⇒ 那由上面那兩格既有行為測試接住。
//    ② `apps/admin/src` **以外**(`packages/*` / storefront)出現同款面。
//    ③ 它比對的是**字面**:組出來的字串(`'workflow' + '_status'`)、
//       或第三種命名(例如全大寫 `WORKFLOW_STATUS` 以外的變體)都繞得過去。

const ADMIN_SRC = join(__dirname, '..', '..');
/** 🔴 兩條命名都算(R2 must-fix 1)。少掃 camel 那條 ⇒ `order-detail.tsx` 這類檔隱形。 */
const AXES = ['workflow_status', 'workflowStatus'] as const;

/**
 * 🔴 **釘死的面**(2026-08-25 當場量,`dev` 與工作樹各自獨立算過、相同;產品碼、排除測試)。
 * 加一支 = 有人開了新的面 ⇒ **先讀本檔檔頭,再決定它該不該存在**。
 * 少一支 = 有面退場了 ⇒ 一樣回來改這裡,順便確認規則② 還有沒有人接。
 */
const ALLOWED = [
  'app/orders/page.tsx',
  'components/orders/order-detail.tsx',
  'components/orders/order-edit-form.tsx',
  'components/orders/order-filter-controls.tsx',
  'lib/audit/audit-field-label.ts',
  'lib/orders/order-actions.ts',
  'lib/orders/order-list-view.ts',
  'lib/orders/workflow-form.ts',
] as const;

type Src = { rel: string; text: string };

/** 走目錄收 admin 產品碼(排除測試、build 產物、node_modules)。 */
function collectSources(root: string): Src[] {
  const out: Src[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.next' || e.name === '.turbo') continue;
        walk(p);
        continue;
      }
      if (!/\.tsx?$/.test(e.name)) continue;
      // 🔴 測試檔排除:本檔自己的檔頭就寫著那兩個字,不排掉會抓到自己。
      if (/\.(test|spec)\.tsx?$/.test(e.name)) continue;
      out.push({ rel: relative(root, p).split('\\').join('/'), text: readFileSync(p, 'utf8') });
    }
  };
  walk(root);
  return out;
}

/** 含**任一**條軸字面的檔。 */
function surfaces(sources: Src[]): string[] {
  return sources.filter((s) => AXES.some((a) => s.text.includes(a))).map((s) => s.rel).sort();
}

const SOURCES = collectSources(ADMIN_SRC);

describe('🔴 workflow_status 面的 allowlist —— 量具自檢(排在目標斷言之前)', () => {
  it('分母不是空的:走到的產品碼檔數 > 100', () => {
    expect(SOURCES.length).toBeGreaterThan(100);
  });

  // 🔴 R2 must-fix 2:上一版這一格是**恆真**的(`SOURCES.length >= ALLOWED.length`)——
  //    改用 git 當分母也會印一樣的結果 ⇒ 它量不到自己宣稱的那個性質。
  //    這一版**真的寫一支暫存檔進來**:它是未追蹤的,`git grep` 看不到它、而 `collectSources` 要看得到。
  //    ⚠️ 內容**刻意不含那兩條軸** ⇒ 萬一 `finally` 沒跑到、殘留一支檔,也不會誤觸目標斷言。
  it('🔴 走目錄真的看得到【未追蹤】的新檔(這是不用 git grep 的理由)', () => {
    // 🔴 **目錄名帶 pid**(2026-08-31)——⛔ ~~`__tmp_allowlist_probe__`(固定路徑)~~。
    //    成因:八個窗共用一棵工作樹, 而每個窗都會跑全套件
    //    ⇒ **兩份這支測試同時在跑** ⇒ A 的 `finally rmSync` 會刪掉 B 正在用的那支檔
    //    ⇒ B 的 `expect(seen.some(...))` 紅, 而**紅的是一個沒有壞掉的東西**。
    //    🔵 這與 `page-measure.test.tsx` 的 `OUT_DIR` 是【逐字相同】的修法(`af0110b4`)。
    // 🛑 **而這一格【不解】另一個病, 不要讀成它解了**:
    //    這支測試在【被別人掃描的那棵樹裡面】建檔又刪檔 ⇒ 任何同時在跑的
    //    `readdir → readFile` 掃描型守門仍會撞進那個窗口(2026-08-31 實錘:
    //    `markdown-in-jsx-text.test.ts` 因此 ENOENT 炸掉, 而它不是斷言紅、是工具自己死)。
    //    ⇒ **換個名字不會關掉那個窗口, 它是結構性的** ⇒ 那一族由掃描端容忍 ENOENT 解。
    const dir = join(ADMIN_SRC, 'lib', 'orders', `__tmp_allowlist_probe_${process.pid}__`);
    const file = join(dir, 'probe.tsx');
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, 'export const ZZZ_PROBE = 1;\n', 'utf8');
      const seen = collectSources(ADMIN_SRC);
      expect(
        seen.some((s) => s.rel.endsWith(`__tmp_allowlist_probe_${process.pid}__/probe.tsx`)),
      ).toBe(true);
      // 🔴 **pid 真的進去了**:少了這一格, 有人把樣板字串改回固定字面, 上面那格照樣綠
      //    (它自己也用同一個變數 ⇒ 兩邊一起錯就一起對)⇒ 這裡對【路徑本身】斷言。
      expect({ 目錄名帶pid: dir.includes(`_${process.pid}__`) }).toEqual({ 目錄名帶pid: true });
      expect(seen.length).toBe(SOURCES.length + 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(existsSync(dir)).toBe(false);
  });

  it('🔴 負對照:snake 與 camel 兩條軸各自都要被看見', () => {
    expect(surfaces([{ rel: 'a.tsx', text: "const k = 'workflow_status';" }])).toEqual(['a.tsx']);
    expect(surfaces([{ rel: 'b.tsx', text: 'const k = row.workflowStatus;' }])).toEqual(['b.tsx']);
  });

  it('🔴 負對照:不含任一條軸的檔不得誤報', () => {
    expect(surfaces([{ rel: 'a.ts', text: "const k = 'payment_status';" }])).toEqual([]);
  });

  // 🔴 nit 3:上一版只斷言「檔案還在」,而檔案不見那一路目標斷言本來就會紅 ⇒ 零額外判別力。
  //    這一版斷言的是【那個字還在該檔裡】—— 有人把字拿掉而忘了改名單,這一格才紅。
  it('🔴 allowlist 上的每一支都還【含著那條軸】(釘子會鏽)', () => {
    const byRel = new Map(SOURCES.map((s) => [s.rel, s.text]));
    const rotten = [...ALLOWED].filter((p) => {
      const t = byRel.get(p);
      return t === undefined || !AXES.some((a) => t.includes(a));
    });
    expect(rotten).toEqual([]);
  });
});

describe('🔴 workflow_status 面的 allowlist —— 目標斷言', () => {
  it('admin 產品碼裡提到這條軸的檔 = 釘死的那幾支', () => {
    const now = surfaces(SOURCES);
    const pinned: readonly string[] = ALLOWED;
    const added = now.filter((p) => !pinned.includes(p));
    const removed = pinned.filter((p) => !now.includes(p));
    // 🔴 nit 4:兩個方向都要給一句話。移除那一路更常見(七支裡多數只在【註解】裡出現,
    //    改一句過期註解就會紅)—— 而裸 array diff 不會告訴人下一步該做什麼。
    const msg =
      added.length > 0
        ? `新的 workflow_status 面:${added.join(', ')} —— 見本檔檔頭:這條軸押著 Sean 2026-07-24 規則②,新面請先確認它不會讓「未收」重新變成可選值`
        : removed.length > 0
          ? `這幾支不再提到那條軸:${removed.join(', ')} —— 多數面只在【註解】裡提它,改註解就會紅。確認是刻意退場後,把它從本檔 ALLOWED 移除`
          : 'ok';
    expect(msg).toBe('ok');
  });

  it('🔴 那句「UI 停送」的宣告還在(它沒了 = 有人打算重新送)', () => {
    const f = SOURCES.find((s) => s.rel === 'components/orders/order-edit-form.tsx');
    expect(f?.text).toContain('UI 停送');
  });

  // 🔴 nit 5:直接 readFileSync 的話,對方改名會丟 ENOENT,而訊息裡沒有本守門的名字。
  it('🔴 既有那兩道行為守門還在(本檔不重做它們,但它們不見了要有人知道)', () => {
    const pairs = [
      ['lib/orders/workflow-form.test.ts', '一律忽略'],
      ['lib/orders/order-list-view.test.ts', '?workflow_status='],
    ] as const;
    for (const [rel, anchor] of pairs) {
      const p = join(ADMIN_SRC, rel);
      expect(existsSync(p) ? 'ok' : `${rel} 不見了 —— 見 workflow-status-surface-allowlist 檔頭:它守的那條路現在沒人接`).toBe('ok');
      expect(readFileSync(p, 'utf8')).toContain(anchor);
    }
  });
});
