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
  // 🔴🔴 `order_pending_refunds` 標 **false** —— 而它是本表最需要解釋的一格(線 `-c7` 2026-09-02 判)。
  //
  // **為什麼 false**:它的列只有一條產生路徑,而那條路徑的觸發訊號【就是 predicate 已經在問的那一個】。
  //   · 寫入端唯一:`20260901080000:495-496` `CREATE TRIGGER … AFTER UPDATE OF cancelled_at ON public.orders`
  //     ⇒ 只在 `cancelled_at` 由 NULL 變成非 NULL 的那一刻發火(`:377` 逐字「只在【由無變有】那一刻」)
  //   · 而 predicate `20260831155000:76` 已經逐字問 `orders.cancelled_at IS NOT NULL`
  //   ⇒ 📌 **有列 ⇒ `cancelled_at` 非 NULL ⇒ predicate 早就說「有問題」了。**
  //   ⇒ ⇒ 它與 `coupon_redemptions` 同族:**是【結果】不是【原因】。**
  //   🟢 而全 repo `INSERT INTO public.order_pending_refunds` 只有兩處
  //      (`20260901080000:432` 與它的修正版 `20260902030000:326`)⇒ 沒有第二條寫入路徑。
  //
  // 🛑 **判錯的話會怎樣(唯一會分岔的世界,而它是【量到的】不是理論)**:
  //   `20260809160000:100-101` 是一段 in-tree 的「復活食譜」——
  //   `UPDATE public.orders SET cancelled_at = NULL … WHERE cancelled_reason='payment_expired'`。
  //   跑完之後那張單活了,而本表的列還 live ⇒ **`cancelled_at` 回到 NULL 而欠款紀錄還在**
  //   ⇒ predicate 會說「沒問題」,而我們其實還欠客人錢 ⇒ 券可能被重新兌換。
  //   🔵 而那段是**註解裡的手動回滾指令,不是會自己跑的碼**(整段前綴 `--`)。
  //   ✅ 而那個世界的正解**已經寫在建表那支檔裡**(`20260901080000` 的 COMMENT,F4 那一段逐字):
  //      「**復活一張單時必須同時作廢本表對應的列。**」⇒ 📌 修法在【復活那一步】,不在 predicate。
  //
  // 🔴 **誰會先發現**:沒有任何機器會叫。**是值班的人** —— 因為這張表就是拿來照著退錢的,
  //   而 F4 那段自己寫著「值班會看到【這張活著的單欠著錢】」。
  //
  // 🔵 **而【改變】那一半**(本表的判準逐字是「一筆待退款**出現 / 改變**」——
  //   而上面整段只論證了【出現】;這一格是 `-0e` 2026-09-02 複審點出來的):
  //   那張表有 void 生命週期(`voided_at` / `void_reason`,就是另一支守門盯的那條 CHECK)。
  //   ✅ **而【改變】那半安全的理由與【出現】那半是【同一個】**:
  //      `cancelled_at` 一旦非 NULL 就不會自己變回去 ⇒ predicate 在那張單上**恆說失效**,
  //      **不論那一列是 live 還是已作廢。**⇒ 📌 作廢一列不會讓那張單重新變成「沒問題」。
  //
  // ⚠️ **而反面那個選項我沒有自己拍**:標 `true` 會關掉上面那個洞,
  //   **而它要求 predicate 真的提到這張表**(見本檔最後一格)⇒ 那是改 DB 函式 ⇒ 命中鐵則 12③
  //   ⇒ 🛑 **那是 Sean / 主視窗的板,不是我在凌晨補 CI 時順手做的決定。**
  //   🔵 而要改的話,**在 `20260831155000` 被貼進正式庫【之前】改比較便宜**
  //      —— 已 apply 的 migration 連註解都不能再動,那時就得另開一支。
  //      (⚠️ 刻意不寫「它現在還沒貼」:那句話會在它一被貼下去的那一刻靜靜變假,而沒有東西會叫。)
  order_pending_refunds: false,
  // 🔴🔴 `order_amount_requests` 標 **false**(2026-09-14 B 窗判;表來自
  //    `20260915050000_m4b_03_order_amount_requests.sql`,M-4b-03 改金額審核,不是本窗的片)。
  //
  // **它是什麼**:員工提案「這個品項的單價改成 X」、管理者核准或退回的**提案簿 + 稽核軌跡**。
  //   狀態四值 `pending / approved / rejected / superseded`。
  //
  // **為什麼 false**:本表的判準逐字是「這張表有列 ⇒ 那張單可能已經不算數」。
  //   · `pending` / `rejected` / `superseded` ⇒ 單子**一個字都沒變** ⇒ 顯然不是失效訊號。
  //   · `approved` ⇒ 金額真的改了 —— 而**改金額不是 predicate 在問的那件事**:
  //     它問的六格全是「錢退回去了 / 單子被作廢了」(`cancelled_at` · `order_cancellations` ·
  //     `order_refunds` · `order_manual_refunds` · 未付款 · 雙扣異常)。改單價**沒有錢流出去、單子也還在**。
  //   ⇒ 📌 它與 `coupon_redemptions` / `order_pending_refunds` 同族:**是【軌跡】不是【原因】。**
  //
  // 🛑 **而這裡有一個洞, 我沒有自己拍 —— 它不是本表帶進來的, 而它現在有名字了**:
  //   核准之後金額會變, 而**一張單的總額變小(極端是改成 0 元)有可能掉到券的門檻以下**,
  //   而這一族帳本**沒有任何一張**記這件事 ⇒ predicate 不會知道。
  //   🔴 **而它【不是】這張新表開的**:既有的 `admin_update_order_item_amount` 直接改價那條路
  //      早就在了, 而那條路連一張表都沒有 ⇒ 本閘的分母裡從來就沒有它。
  //      ⇒ 把本表標 `true` 只會蓋住**有走審核**的那一半, 另一半照樣沉默
  //      ⇒ 那會讓 predicate 看起來有在管金額, 而它只管了一半。**半道閘比沒有閘更會騙人。**
  //   ⇒ 要不要讓 predicate 開始問「金額變過」, 是改 DB 函式 ⇒ 命中鐵則 12③
  //      ⇒ **那是 Sean / 主視窗的板。已於 2026-09-14 回報主視窗, 不在這一顆裡做。**
  order_amount_requests: false,
  // 🔵 `shipment_order_ship_clearances` 標 **false**(2026-09-15 B 窗判;表來自
  //    `20260915230000_m4b_p01_ship_clearances_and_handover_confirm.sql`,P0-1 片 1a)。
  //    它是什麼:「這一箱、這張單, 出貨當下有資格出」的證明(叫車 / 標出貨 / 回填時寫, append-only)。
  //    判準「這張表有列 ⇒ 那張單可能已經不算數」⇒ **反方向**:有列代表出貨時單子還算數。
  //    沒有錢流出去、單子也沒被作廢 ⇒ 與 predicate 問的六格無關, 是出貨信資格的軌跡。
  shipment_order_ship_clearances: false,
  // 🔵 `order_returns` 標 **false**(2026-09-27 `-a0` 判;表來自 `20260927010000_m4b_order_returns.sql`,
  //    退貨收回第 1 片)。它是什麼:員工登記「客人要寄回哪些已出貨的品項」、之後確認收到。
  //    ① **不改訂單、不動錢**(計畫 docs/plans/2026-09-27-order-returns.md §三):三支退貨函式
  //       一個字都不寫 orders / 付款 / 退款表;錢要退, 是員工另外走既有退款流程
  //       ⇒ 真正讓單子「不算數」的是那筆退款, 而 `order_refunds` / `order_manual_refunds` 上面已經標 true。
  //    ② **時間上碰不到 predicate 唯一的呼叫端**:predicate 只在兌換券(結帳 / 付款結算)時問,
  //       而退貨只能退【已出貨】的數量 ⇒ 有退貨列的單, 兌換早就發生過了。
  //    ⇒ 與 `order_pending_refunds` 同族:它記的是之後的事, 不是讓單子失效的原因。
  //    ⚠️ Sean 08-26「退貨還券」是另一條路(第 4 片:收到退貨時把券次數退回), 不經過本 predicate。
  order_returns: false,
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
    //    答 true ⇒ 要同時改 `20260831155000_m4b_coupon_order_problem_predicate.sql`。
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
      join(MIG, '20260831155000_m4b_coupon_order_problem_predicate.sql'),
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
      join(MIG, '20260831155000_m4b_coupon_order_problem_predicate.sql'),
      'utf8',
    );
    expect(sql).toContain('public.payment_refunds');
    expect(sql).toContain('public.order_refund_effective_verdict');
    expect(found.has('payment_refunds')).toBe(false); // 證明它真的不在分母裡
  });
});
