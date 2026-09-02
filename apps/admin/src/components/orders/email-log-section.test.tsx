// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { EmailLogSection } from './email-log-section';
import { EMAIL_LOG_EMPTY_TEXT, type EmailLogRow } from '../../lib/orders/email-log-view';

// email-log-section.test.tsx — 片A 的**顯示層**測試。
// 🔴 而它與 `email-log-view.test.ts` 守的不是同一件事:
//    語意層證「函式回什麼」, 本檔證【那個字真的到得了畫面】——
//    而本片整個存在的理由就是「有東西沒到畫面上, 而空白被讀成沒發生」。

afterEach(cleanup);

const row = (over: Partial<EmailLogRow> = {}): EmailLogRow => ({
  eventType: 'order_created',
  status: 'sent',
  attempts: 1,
  maxAttempts: 5,
  createdAt: '2026-09-02T02:55:00.315Z',
  sentAt: '2026-09-02T02:55:00.929Z',
  ...over,
});

describe('EmailLogSection', () => {
  it('🟢 有寄過信的單 ⇒ 列出來(事件 + 狀態)', () => {
    render(<EmailLogSection data={{ status: 'ok', rows: [row(), row({ eventType: 'order_shipped' })] }} />);
    expect(screen.getByText('訂單成立通知')).toBeTruthy();
    expect(screen.getByText('出貨通知')).toBeTruthy();
    expect(screen.getAllByText('已寄出')).toHaveLength(2);
    expect(screen.getByText('2 筆紀錄')).toBeTruthy();
  });

  it('🔴 sent 那格不得把「沒寄」的態吃掉 —— skipped_* 要看得見', () => {
    render(
      <EmailLogSection
        data={{
          status: 'ok',
          rows: [
            row({ status: 'skipped_no_real_email', sentAt: null }),
            row({ status: 'skipped_shipment_voided', sentAt: null }),
          ],
        }}
      />,
    );
    // 只顯示成功的 ⇒ 這一片等於沒做
    expect(screen.getByText('沒寄(沒有真的信箱)')).toBeTruthy();
    expect(screen.getByText('沒寄(出貨單已作廢)')).toBeTruthy();
  });

  it('🎯🎯 **未知態:餵一個現造帶時間戳的假 status ⇒ 畫面上必須印出那個字串本身**', () => {
    // 🔴 這是 `-7d` 規格 §4 標的那一發, 而它是 fail-open 的**正對照**——
    //    不是「有顯示就算過」, 是【那個字串本身】要出現在 DOM 裡。
    //    ⇒ 白名單 switch 會讓這一列安靜消失, 而那與「這張單沒寄信」在畫面上長得一模一樣。
    const madeUp = `zz_not_a_real_status_${Date.now()}`;
    render(<EmailLogSection data={{ status: 'ok', rows: [row({ status: madeUp, sentAt: null })] }} />);
    expect(screen.getByText(`${madeUp}(未知狀態)`)).toBeTruthy();
    // 而它仍然算一筆 ⇒ 不會因為看不懂就從計數裡消失
    expect(screen.getByText('1 筆紀錄')).toBeTruthy();
  });

  it('🎯 未知 event_type 同理 ⇒ 印原始字串(`-15` 正在加 order_cancelled)', () => {
    render(<EmailLogSection data={{ status: 'ok', rows: [row({ eventType: 'order_cancelled' })] }} />);
    expect(screen.getByText('order_cancelled')).toBeTruthy();
  });

  it('🔴 沒寄過信 ⇒ 空態那一句要在, 而整區【不得消失】', () => {
    const { container } = render(<EmailLogSection data={{ status: 'ok', rows: [] }} />);
    expect(screen.getByText(EMAIL_LOG_EMPTY_TEXT)).toBeTruthy();
    // 區塊本體還在(員工分得出「沒寄」與「這頁壞了」的前提是這一區看得到)
    expect(container.querySelector('section')).toBeTruthy();
    expect(screen.getByText('通知信')).toBeTruthy();
    expect(screen.getByText('0 筆紀錄')).toBeTruthy();
  });

  it('🔴🔴 讀不到 ⇒ **不可**顯示「0 筆」或空態句 —— 讀不到不是沒寄過', () => {
    render(<EmailLogSection data={{ status: 'unreadable' }} />);
    expect(screen.getByText('筆數未知')).toBeTruthy();
    expect(screen.queryByText('0 筆紀錄')).toBeNull();
    expect(screen.queryByText(EMAIL_LOG_EMPTY_TEXT)).toBeNull();
    // 🟢 而它要明說「不是沒有寄過信」—— 這一句是這一格的整個重點
    expect(screen.getByText(/不知道有沒有/)).toBeTruthy();
  });

  it('🔵 試過多次才成功 ⇒ 顯示次數(1 次不顯示, 免得每一列都掛一個沒有資訊的數字)', () => {
    const { rerender } = render(<EmailLogSection data={{ status: 'ok', rows: [row({ attempts: 3 })] }} />);
    expect(screen.getByText('試 3 / 5 次')).toBeTruthy();
    rerender(<EmailLogSection data={{ status: 'ok', rows: [row({ attempts: 1 })] }} />);
    expect(screen.queryByText(/^試 1 /)).toBeNull();
  });

  describe('🔴 R1 must-fix #5:標題那個數不可以說「封」', () => {
    it('🎯 兩列都【沒寄出去】時, 標題不得出現「封」這個字', () => {
      // ⛔ 舊字面 `${rows.length} 封` ⇒ 這一發會印「2 封」
      //    ⇒ 而員工會對著電話那頭說「我們寄了兩封」—— 實際上一封都沒出去。
      render(
        <EmailLogSection
          data={{
            status: 'ok',
            rows: [
              row({ status: 'skipped_no_real_email', sentAt: null }),
              row({ status: 'skipped_shipment_voided', sentAt: null }),
            ],
          }}
        />,
      );
      expect(screen.getByText('2 筆紀錄')).toBeTruthy();
      expect(screen.queryByText('2 封')).toBeNull();
    });
  });

  describe('🔴 R1 must-fix #1:failed 的雙義要在畫面上分得出來', () => {
    it('🔴 次數燒完 ⇒ 要說得出「已放棄」而且指路去重排', () => {
      render(
        <EmailLogSection
          data={{ status: 'ok', rows: [row({ status: 'failed', attempts: 5, maxAttempts: 5, sentAt: null })] }}
        />,
      );
      expect(screen.getByText(/已放棄/)).toBeTruthy();
      expect(screen.queryByText(/自動再試/)).toBeNull();
    });

    it('🔴🔴 R2 must-fix:指路要用【側欄真的長那樣】的頁名, 而且要說是主管才按得到', () => {
      // ⛔ 舊字面「要到『信件』頁重排」—— 側欄與 h1 的字面都是「寄不出去的信」
      //    (`layout/nav-items.ts:71` / `app/settings/mail/page.tsx:59`)
      //    ⇒ 員工照舊字面走過去【找不到那個頁名】。
      // 🔴 而重排鈕只給 `is_manager === true`(那頁搜 `is_manager === true`)⇒ 非主管走過去也【按不到】。
      render(
        <EmailLogSection
          data={{ status: 'ok', rows: [row({ status: 'failed', attempts: 5, maxAttempts: 5, sentAt: null })] }}
        />,
      );
      expect(screen.getByText(/寄不出去的信/)).toBeTruthy();
      expect(screen.getByText(/主管/)).toBeTruthy();
      expect(screen.queryByText(/要到「信件」頁/)).toBeNull();
    });

    it('🟢 對照組:還沒燒完 ⇒ 要說「稍後會自動再試」(否則上面那格是恆真的)', () => {
      render(
        <EmailLogSection
          data={{ status: 'ok', rows: [row({ status: 'failed', attempts: 2, maxAttempts: 5, sentAt: null })] }}
        />,
      );
      expect(screen.getByText(/自動再試/)).toBeTruthy();
      expect(screen.queryByText(/已放棄/)).toBeNull();
    });

    it('🔵 而 sent 那一列兩句都不出現 —— 這段字只屬於 failed', () => {
      render(<EmailLogSection data={{ status: 'ok', rows: [row()] }} />);
      expect(screen.queryByText(/已放棄/)).toBeNull();
      expect(screen.queryByText(/自動再試/)).toBeNull();
    });
  });

  describe('🔵 R1 nit #12:skipped_* 不可以印「排入」', () => {
    it('🎯 它的 sent_at 是 null, 而「排入 X」讀起來像還在排隊 —— 與同列的「沒寄」打架', () => {
      render(
        <EmailLogSection
          data={{ status: 'ok', rows: [row({ status: 'skipped_no_real_email', sentAt: null })] }}
        />,
      );
      expect(screen.getByText(/^判定 /)).toBeTruthy();
      expect(screen.queryByText(/^排入 /)).toBeNull();
    });

    it('🟢 對照組:pending 那一列【要】印「排入」(否則上面那格是恆真的)', () => {
      render(<EmailLogSection data={{ status: 'ok', rows: [row({ status: 'pending', sentAt: null })] }} />);
      expect(screen.getByText(/^排入 /)).toBeTruthy();
      expect(screen.queryByText(/^判定 /)).toBeNull();
    });
  });
});
