// 「訂單還算不算數」的落點清單 —— 一道會在【新落點出現時】自己叫的閘。
//
// ══ 🔴 為什麼是這道閘, 而不是一條規則 ═════════════════════════════════════
// 2026-08-31:`coupon_redeem_order_problem()` 這支 predicate 的落點數是
//   我自己掃 **4** → codex R1 **5** → codex R2 **7** → 我修完 **8**
// 📌 **四次成長, 而【零次】是我自己長出來的 —— 四次都來自外面。**
//   ⇒ 那不是「還差幾格」的形狀(差幾格的東西, 收斂時自己會先摸到底)
//   ⇒ 那是「**我不擁有這個領域, 所以我不知道分母**」的形狀。
//
// 🛑 而問題不是「今天漏了幾個」, 是:
//   **訂單那條線明天加了第九個扣款/退款來源時, 誰會知道要來改那支 predicate?**
//   ⇒ 寫一條規則(「加表時記得更新 predicate」)= 第 N 次「寫下來了而沒有人讀到」。
//   ✅ **這道閘就是那個答案**:新表一出現就紅, 而紅的意思是「有人要來分類它」。
//
// ⚠️ **它擋得住什麼 / 擋不住什麼(寫在這裡, 不要讓人以為它涵蓋一切)**
//   ✅ 擋得住:新建一張【直接 `REFERENCES public.orders(id)`】的表而沒有人分類
//   🔴 **① 經由別的表間接關聯的 —— 這一個是【量到的】, 不是理論**:
//      `payment_refunds` 走 `payment_charge_attempts.order_id` ⇒ **它不在本閘的 11 張分母裡**,
//      而 predicate 今天有問它。⇒ **本閘不會在它被改掉時叫。**
//   ⚠️ ② 既有表【新增一個欄位】而那個欄位才是失效訊號 —— 理論, 今天無實例
//   ⚠️ ③ 在 SQL Editor 手貼、沒有進 repo 的表 —— 理論(而 `APPLIED.tsv` 有前例)
//   📌 **①與②③要看得出差別**:①有實物可以指, ②③是我想得到的。
//      **把它們寫成同一種語氣, 會讓下一個人以為①也只是理論。**
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIG = join(__dirname, '..', 'supabase', 'migrations');

/** 掃出所有【直接】以 orders(id) 為外鍵的表。 */
function tablesReferencingOrders(): Set<string> {
  const out = new Set<string>();
  for (const f of readdirSync(MIG).filter((x) => x.endsWith('.sql'))) {
    const t = readFileSync(join(MIG, f), 'utf8');
    // 🔴 **`CREATE TABLE` 與 `public.x` 之間允許換行**(codex R4 must-fix):
    //    第一版寫成同一行才認 ⇒ 一支換行寫法的 migration **整張表掃不到**,
    //    而那正是本閘唯一的工作。📌 **一把只認一種書寫格式的尺, 它的分母是【格式】不是【事實】。**
    for (const m of t.matchAll(
      /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?public\.(\w+)\s*\(([\s\S]*?)\n\);/g,
    )) {
      const name = m[1];
      const body = m[2];
      if (name && body && /REFERENCES\s+public\.orders\s*\(\s*id\s*\)/.test(body)) out.add(name);
    }
  }
  return out;
}

/**
 * 每一張表都要被【分類】—— 不是「列在這裡就過」, 是「有人回答過它算不算失效訊號」。
 *
 * 🔴 `true`  = 這張表有列 ⇒ 那張單可能已經不算數 ⇒ **predicate 必須問它**
 * 🔵 `false` = 它記的是別的事(通知 / 備註 / 同意書 …)⇒ 與「還算不算數」無關
 */
const CLASSIFIED: Record<string, boolean> = {
  // ── 失效訊號:predicate 有問 ────────────────────────────────
  order_cancellations: true, //  部分取消(它不寫 orders.cancelled_at)
  order_refunds: true, //         卡片退款帳(狀態取有效終局)
  order_manual_refunds: true, //  人工退款帳
  order_payments: true, //        收款/沖銷帳(比淨額)
  payment_double_charge_anomalies: true, // Dashboard 雙扣退款
  // ── 不是失效訊號 ──────────────────────────────────────────
  coupon_redemptions: false, //   券兌換紀錄本身 —— 它是【結果】不是原因
  email_outbox: false, //         寄信佇列
  order_legal_consents: false, // 結帳當下的同意紀錄
  order_notes: false, //          客服備註
  pending_invoices: false, //     發票佇列
  // 🔴 payment_charge_attempts 標 false 是【有理由】的, 不是漏掉:
  //    一張單有 attempt 不代表它失效(每一張刷卡的單都有);真正的訊號在它底下的
  //    `payment_refunds`, 而 predicate 是**經由這張表 JOIN 過去**問它的。
  payment_charge_attempts: false,
};

describe('訂單失效落點:新表出現時要有人分類', () => {
  const found = tablesReferencingOrders();

  it('量具自檢:真的掃到東西了(空集合會讓下面每一格恆綠)', () => {
    expect(found.size).toBeGreaterThan(5);
  });

  it('🟢 負對照:一個現造的表名【不】在掃描結果裡', () => {
    expect(found.has('zzq_no_such_ledger_9137')).toBe(false);
  });

  it('🔴 每一張參照 orders(id) 的表都要被分類過', () => {
    const unclassified = [...found].filter((t) => !(t in CLASSIFIED)).sort();
    // 🛑 這一格紅的時候, **不要直接把名字加進 CLASSIFIED** ——
    //    先回答:「這張表有列, 代表那張單可能不算數了嗎?」
    //    答 true ⇒ 要同時改 `20260831150000_m4b_coupon_order_problem_predicate.sql`。
    expect(unclassified, `這些表沒有被分類 —— 先決定它們算不算失效訊號:${unclassified.join(', ')}`).toEqual(
      [],
    );
  });

  it('🔴 被標成【失效訊號】的表, predicate 必須真的提到它', () => {
    // 🔴 **先剝 SQL 註解再比**(codex R4 must-fix):第一版用 `sql.includes()`
    //    ⇒ 把真正那個分支【註解掉】而註解裡還留著表名 ⇒ **本閘照樣綠**。
    // 📌 今天第二次同族(券那邊 grep `printButton: false` 命中我自己寫的註解)——
    //    **一把讀原始碼字面的尺, 它的分母包含所有在講這件事的字, 而註解最會講。**
    const raw = readFileSync(
      join(MIG, '20260831150000_m4b_coupon_order_problem_predicate.sql'),
      'utf8',
    );
    const sql = raw.replace(/^\s*--.*$/gm, '').replace(/(^|[^:])--.*$/gm, '$1');
    // 🟢 正對照:剝完之後函式本體還在(剝過頭的話下面那格會恆綠)
    expect(sql).toContain('CREATE FUNCTION public.coupon_redeem_order_problem');
    const missing = Object.entries(CLASSIFIED)
      .filter(([, isSignal]) => isSignal)
      .map(([t]) => t)
      .filter((t) => !sql.includes(`public.${t}`))
      .sort();
    expect(missing, `這些表被標成失效訊號, 而 predicate 沒有問它們:${missing.join(', ')}`).toEqual([]);
  });

  it('📎 記錄:predicate 另外問了兩個【不在這張分母裡】的落點', () => {
    // 🔴 這一格不是斷言, 是**把本閘的盲區寫在它自己的報表上**:
    //    `payment_refunds` 經 `payment_charge_attempts` 間接關聯、
    //    `order_refund_effective_verdict` 是 view 不是表 ⇒ 兩者都掃不到。
    //    ⇒ 它們今天有被 predicate 問到, 而**本閘不會在它們消失時叫**。
    const sql = readFileSync(
      join(MIG, '20260831150000_m4b_coupon_order_problem_predicate.sql'),
      'utf8',
    );
    expect(sql).toContain('public.payment_refunds');
    expect(sql).toContain('public.order_refund_effective_verdict');
    expect(found.has('payment_refunds')).toBe(false); // 證明它真的不在分母裡
  });
});
