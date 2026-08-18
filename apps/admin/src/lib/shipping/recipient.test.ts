import { describe, expect, it } from 'vitest';
import {
  RECIPIENT_NAME_REQUIRED,
  recipientWarning,
  toRecipientSnapshot,
} from './recipient';

// recipient.test.ts — `#503` 甲的判定層。
//
// 🔴 **本檔存在的理由(關卡2 codex must-fix)**:上一版把這個判定寫在彈窗裡,而我為它寫的守門
//    是「click 一顆已經 disabled 的按鈕、然後斷言 action 沒被呼叫」——
//    **那格恆綠**:對 disabled 的按鈕發事件根本進不到 handler
//    (同檔另一族早就記過這個坑:`shipping-selection.tsx` 的「突變 M5」那段)。
//    ⇒ 判定抽成純函式,**直接打它**;彈窗與 server action 兩邊都用這一支。

const full = { name: '陳彥廷', phone: '0912345678', line: '台北市中山區…' };

describe('toRecipientSnapshot — 只擋姓名', () => {
  it('三欄齊全 ⇒ 原值回傳(不 trim:出貨單要對得起訂單上的字)', () => {
    expect(toRecipientSnapshot({ ...full, name: ' 陳彥廷 ' })).toEqual({
      name: ' 陳彥廷 ',
      phone: '0912345678',
      line: '台北市中山區…',
    });
  });

  it.each([null, '', '   ', '\t\n'])('姓名是 %p ⇒ null(不得建箱)', (name) => {
    expect(toRecipientSnapshot({ ...full, name })).toBeNull();
  });

  // 🔴🔴 **這兩格是本檔最重要的**:backlog `#503` 原文的修法寫「三鍵皆非空白」,
  //    而 `phone` 空是**業務允許**的值(`create_order` RPC 逐字「空電話業務允許、欄 DEFAULT ''」),
  //    `line` 空則是**分不出來**的(自取現在只是自由文字)。
  //    ⇒ 少了這兩格,下一個人「順手把它們也加進判斷」不會有任何東西紅,而那會退掉合法資料。
  it('🔴 只有電話空 ⇒ 照樣建得了箱(空電話是業務允許的值)', () => {
    expect(toRecipientSnapshot({ ...full, phone: '' })).not.toBeNull();
    expect(toRecipientSnapshot({ ...full, phone: null })).not.toBeNull();
  });

  it('🔴 只有地址空 ⇒ 照樣建得了箱(自取/站到站;這一格是警告不是擋)', () => {
    expect(toRecipientSnapshot({ ...full, line: '' })).not.toBeNull();
    expect(toRecipientSnapshot({ ...full, line: null })).not.toBeNull();
  });

  it('🔴 全空 ⇒ null —— 這就是 `#503` 通報的那個狀態(出貨單上沒有收件人)', () => {
    expect(toRecipientSnapshot({ name: '', phone: '', line: '' })).toBeNull();
  });
});

describe('recipientWarning — 不擋,只讓他先看見', () => {
  it('沒有地址 ⇒ 有話要說,而且那句話要講出「照建得了」', () => {
    const msg = recipientWarning({ ...full, line: null });
    expect(msg).not.toBeNull();
    expect(msg, '寫成擋人的口氣會讓員工以為自己不能建箱').toContain('可以照建');
  });

  it('地址齊全 ⇒ 沒話要說(否則畫面會長期掛一則沒有意義的警告)', () => {
    expect(recipientWarning(full)).toBeNull();
  });
});

describe('字面', () => {
  it('拒絕訊息是單一來源(client 與 server 不各寫一份)', () => {
    expect(RECIPIENT_NAME_REQUIRED).toContain('沒有收件人姓名');
  });
});
