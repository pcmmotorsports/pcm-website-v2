import { describe, expect, it } from 'vitest';
import {
  EMAIL_LOG_COLUMNS,
  EMAIL_LOG_EMPTY_TEXT,
  KNOWN_EMAIL_STATUSES,
  emailEventLabel,
  emailStatusLabel,
  toEmailLogEntry,
  type EmailLogRow,
} from './email-log-view';

// email-log-view.test.ts — 片A 的語意層測試。
// 🔴 本族守的不是「字面好不好看」, 是**會讓這一片等於沒做的失效**:
//    ① `skipped_*` 那幾態顯示不出來 ⇒ 只看得到成功的 ⇒ 這一片等於沒做
//    ② 未知態被藏起來 ⇒ 新態上線那天安靜地消失一列, 而那與「這張單沒寄信」長得一樣
//    ③ (R1 補)`failed` 的雙義 ⇒ 該等的與該去重排的長得一樣
//    ④ (R1 補)撈的欄位被人加了 PII ⇒ 三綠全綠而客人信箱上了訂單頁

/** 測試用的一列。**只有要驗的欄位需要指定**, 其餘走這裡的預設。 */
function row(over: Partial<EmailLogRow> = {}): EmailLogRow {
  return {
    eventType: 'order_created',
    status: 'sent',
    attempts: 1,
    maxAttempts: 5,
    createdAt: '2026-09-02T03:00:00Z',
    sentAt: null,
    ...over,
  };
}

describe('email-log-view', () => {
  describe('🔴🔴 撈哪幾欄 —— 這一格擋的是【PII 上訂單頁】', () => {
    // 🔴 **R1 must-fix #3 生出來的**:原本這條界線只有 repository 檔頭的一段註解守著
    //    ⇒ 下一個人加一欄 `recipient_email`, typecheck / lint / build / 全部測試**都是綠的**。
    //    📌 **一條寫在註解裡的規矩, 與沒有那條規矩, 在 CI 上印同一個綠。**
    it('🎯 逐字釘死 select 的欄位字串 —— 加任何一欄都要先撞到這條紅', () => {
      expect(EMAIL_LOG_COLUMNS).toBe('event_type,status,attempts,max_attempts,created_at,sent_at');
    });

    it('🟢 對照組:三個不該出現的欄位名, 一個都不在裡面(否則上面那格可能是恆真的)', () => {
      // 規格 §2「不要顯示的」那一節逐字點名這三欄。
      expect(EMAIL_LOG_COLUMNS).not.toContain('recipient_email');
      expect(EMAIL_LOG_COLUMNS).not.toContain('subject');
      expect(EMAIL_LOG_COLUMNS).not.toContain('payload');
    });

    it('🟢 對照組:而它確實含得下欄位名(證明上面那把 not.toContain 會動)', () => {
      expect(EMAIL_LOG_COLUMNS).toContain('event_type');
    });
  });

  describe('🔴 7 種態全部要有字面 —— 而值域是【量正式庫】來的', () => {
    // 🛑 這 7 種來自 2026-09-02 唯讀實查 `pg_get_constraintdef('email_outbox_status_check')`,
    //    **不是**讀 migration —— 建表那一支只有 6 種, 第七種在 20260830060000 被整個換掉。
    // 🔴🔴 **這一格是突變逼出來的, 而它擋的是【我自己的測試】的一個洞**:
    //    下面那個 `it.each(KNOWN_EMAIL_STATUSES)` 的**分母來自被測物自己** ——
    //    突變實測(把 'skipped_shipment_voided' 從封閉集拿掉)⇒ **一格都沒紅**,
    //    它只是少跑一格(16 ⇒ 15 passed), 而【測項總數變少】沒有人在看。
    //    📌 ⇒ 一個把分母交給被測物的測試, 對「被測物變小」完全失明。
    //    ✅ 所以這一格把封閉集【逐字釘死】。
    //
    // 🛑🛑 **而這條斷言的射程要寫清楚, 不要寫大**(R1 nit #7 訂正;舊字面留著讓人搜得到):
    //    ⛔ ~~「它紅的時候是【正式庫的值域變了】」~~ —— **那句話不成立。**
    //    ⇒ 本檔與正式庫**零連線** ⇒ 它只在**有人改了這個常數**的時候紅。
    //    ⇒ ⇒ 正式庫加了第八態而常數沒跟上時, 它是**恆綠**的。
    //    ✅ 正確的射程:**它證明常數沒有被改小/改順序, 不證明 DB 沒變。**
    //    🔵 而「DB 變大而這裡沒跟上」那一格由 fail-open 接住(印原始字串)——
    //       那是**已知天花板**, 不是被守住:畫面不會漏掉那一列, 但字面會是英文原始值。
    it('🔴 封閉集逐字釘死(7 種, 順序照正式庫 CHECK)', () => {
      expect([...KNOWN_EMAIL_STATUSES]).toEqual([
        'pending',
        'sending',
        'sent',
        'failed',
        'skipped_no_real_email',
        'skipped_order_ineligible',
        'skipped_shipment_voided',
      ]);
    });

    it.each(KNOWN_EMAIL_STATUSES)('%s ⇒ 有中文字面(不是 null)', (status) => {
      expect(emailStatusLabel(status)).not.toBeNull();
    });

    it('🔴 skipped_* 三態的字面要說得出「沒寄」—— 那是這一片存在的理由', () => {
      // 只顯示成功的 = 這一片等於沒做 ⇒ 這三格各釘一次
      expect(emailStatusLabel('skipped_no_real_email')).toContain('沒寄');
      expect(emailStatusLabel('skipped_order_ineligible')).toContain('沒寄');
      expect(emailStatusLabel('skipped_shipment_voided')).toContain('沒寄');
    });

    it('🟢 對照組:sent 的字面【不】含「沒寄」(否則上面三格是恆真的)', () => {
      expect(emailStatusLabel('sent')).not.toContain('沒寄');
    });
  });

  describe('🔴 failed 的雙義 —— R1 must-fix #1', () => {
    // 🎯 `20260830060000:178` 逐字:「終態界線不在 status 而在 attempts」。
    //    ⇒ 同一句「寄送失敗」可能是【等一下會再試】也可能是【已放棄】,
    //      而員工看不出差別就會做出**相反**的動作:一個該等、一個該去重排。
    //    ⛔ ~~原句寫「該去『信件』頁」~~ —— R3 must-fix:**那個頁名不存在**, 真名是
    //       「寄不出去的信」。UI 文案與 section 測試在 R2 都改了, **而這一句漏網** ——
    //       📌 一次「把某個字面改掉」的動作, 分母是【那個字面出現的所有地方】,
    //          而我當時的分母只有「會被看到的那幾處」。註解不會被看到, 所以它活下來了。
    // 🔵 判準抄同表鄰居 `lib/mail/dead-letter-read.ts:93`, 不自己發明第二套。
    it('🔴 次數燒完 ⇒ isDead 為 true', () => {
      expect(toEmailLogEntry(row({ status: 'failed', attempts: 5, maxAttempts: 5 })).isDead).toBe(true);
    });

    it('🟢 對照組:還沒燒完 ⇒ isDead 為 false(否則上面那格是恆真的)', () => {
      expect(toEmailLogEntry(row({ status: 'failed', attempts: 2, maxAttempts: 5 })).isDead).toBe(false);
    });

    it('🔵 邊界:超過上限也算放棄(用 >= 不是 ===, 免得一次多加了兩次就永遠不算死)', () => {
      expect(toEmailLogEntry(row({ status: 'failed', attempts: 6, maxAttempts: 5 })).isDead).toBe(true);
    });

    it('🔵 maxAttempts 要原樣帶出去 —— 畫面要印「試 N / M 次」', () => {
      const e = toEmailLogEntry(row({ attempts: 3, maxAttempts: 7 }));
      expect(e.attempts).toBe(3);
      expect(e.maxAttempts).toBe(7);
    });
  });

  describe('🔴🔴 未知態 fail-open —— 本片的承重點', () => {
    // 🎯 `-7d` 規格 §4 標的那一發:**餵一個現造帶時間戳的假 status ⇒ 必須印出那個字串本身**。
    //    那是 fail-open 的正對照, 不是「有顯示就算過」。
    const madeUp = `zz_not_a_real_status_${Date.now()}`;

    it('現造 status ⇒ label 回 null(而不是一句沒有資訊的「未知」)', () => {
      expect(emailStatusLabel(madeUp)).toBeNull();
    });

    it('🎯 而 entry 要把【那個字串本身】帶出去 ⇒ 顯示層印得出它', () => {
      const e = toEmailLogEntry(row({ status: madeUp }));
      expect(e.statusRaw).toBe(madeUp);
      expect(e.statusLabel).toBeNull();
      expect(e.isKnownStatus).toBe(false);
    });

    it('🟢 對照組:已知態 ⇒ isKnownStatus 為 true(否則上面那格是恆真的)', () => {
      const e = toEmailLogEntry(row({ status: 'sent', sentAt: '2026-09-02T03:00:01Z' }));
      expect(e.isKnownStatus).toBe(true);
      expect(e.statusLabel).toBe('已寄出');
    });

    it('🔴 event_type 也要 fail-open —— `-15` 正在加 order_cancelled', () => {
      expect(emailEventLabel('order_cancelled')).toBeNull();
      const e = toEmailLogEntry(row({ eventType: 'order_cancelled' }));
      expect(e.eventRaw).toBe('order_cancelled');
      expect(e.eventLabel).toBeNull();
    });

    it('🟢 對照組:兩個已知 event 有字面', () => {
      expect(emailEventLabel('order_created')).toBe('訂單成立通知');
      expect(emailEventLabel('order_shipped')).toBe('出貨通知');
    });
  });

  describe('🔴 空態那一句', () => {
    it('不是空字串 —— 空態整區消失時員工分不出「沒寄」與「這頁壞了」', () => {
      expect(EMAIL_LOG_EMPTY_TEXT.trim().length).toBeGreaterThan(0);
    });

    it('🎯 它要列出【不只一種】可能 —— 三類原因各出現一次', () => {
      // 🔴 R2 must-fix:空的原因至少三類, 而顯示層看不到任何一類的判斷依據。
      //    ① 還沒付款(訂單成立信只認 paid)
      //    ② cutoff 之前的舊單(email-sweep route 的兩個 cutoff)
      //    ③ 沒有可寄的信箱 ⇒ 落 pcm_shipped_email_unsendable, **outbox 零痕跡**
      expect(EMAIL_LOG_EMPTY_TEXT).toContain('還沒付款');
      expect(EMAIL_LOG_EMPTY_TEXT).toContain('舊單');
      expect(EMAIL_LOG_EMPTY_TEXT).toContain('信箱');
    });

    it('🔴🔴 它【不可以】對「這是正常還是異常」下宣稱 —— 兩個方向都會錯', () => {
      // 🛑 這一格是 R1 與 R2 兩輪各抓一次的同一個病, 兩個舊字面都釘在這裡:
      //    R1 抓 ⇒ ⛔「手動建立的單可能本來就不寄信」(那個機制不存在)
      //    R2 抓 ⇒ ⛔「系統只對已付款的單寄通知信」(出貨信那條路不看 payment_status,
      //              `20260822010000:254` 的 WHERE 一個 payment_status 述詞都沒有)
      // 📌 兩版都在【宣稱原因】, 而那個宣稱我證不出來。
      expect(EMAIL_LOG_EMPTY_TEXT).not.toContain('手動');
      expect(EMAIL_LOG_EMPTY_TEXT).not.toContain('只對已付款');
      // ✅ 而它要明說「不一定」—— 那是「不做宣稱」在文案上的形狀
      expect(EMAIL_LOG_EMPTY_TEXT).toContain('不一定');
    });

    it('🟢 對照組:它確實含得下那兩個被禁的字(證明上面的 not.toContain 會動)', () => {
      expect('手動 只對已付款').toContain('手動');
      expect('手動 只對已付款').toContain('只對已付款');
    });
  });
});
