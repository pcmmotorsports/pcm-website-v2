import { describe, expect, it } from 'vitest';
import {
  RECIPIENT_NAME_REQUIRED,
  blankish,
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

  // 🔴🔴 **[2026-09-10] 補的一族 —— 它守的是一條【完全靜音】的路。**
  //    在此之前 `phone` 空 ⇒ 建箱層放行**而且一句話都不說**,
  //    而那條路的另一端(出貨明細單)當時是**阻印**的
  //    ⇒ 🎯 箱建得起來、紙永遠印不出來,中間沒有任何一個字提醒過他。
  it('🔴 沒有電話 ⇒ 有話要說(這一格在 2026-09-10 之前是完全靜音的)', () => {
    const msg = recipientWarning({ ...full, phone: '' });
    expect(msg, '空電話一句話都不說 ⇒ 那條路又靜音了').not.toBeNull();
    expect(msg, '措辭要與那張紙一致 —— 紙上印的就是「無電話」').toContain('無電話');
    expect(msg, '要說出後果, 不是只說「沒有」').toContain('聯絡不到');
    // ⚪ **不能多報**(2026-09-10 codex 唯讀審 nit):把地址那個條件寫成「地址空【或】電話空」,
    //    只缺電話時也會冒出「沒有收件地址」—— 而少了這一格, 那個突變【照樣全綠】。
    expect(msg, '只缺電話而它報了沒有地址 ⇒ 兩個條件黏在一起了').not.toContain('沒有收件地址');
  });

  it('⚪ 只缺地址 ⇒ 【不可以】順便報沒有電話(反方向的多報)', () => {
    const msg = recipientWarning({ ...full, line: '' });
    expect(msg).toContain('沒有收件地址');
    expect(msg, '只缺地址而它報了無電話 ⇒ 兩個條件黏在一起了').not.toContain('無電話');
  });

  // 🛑 這一格釘的是【它不擋】—— 空電話是業務允許的值(`create_order` RPC 逐字),
  //    有人把它接到 disabled 上就會退掉沒有電話的既有客人。
  it('🛑 沒有電話 ⇒ 仍然【建得出快照】(警告不是擋)', () => {
    expect(toRecipientSnapshot({ ...full, phone: '' })).not.toBeNull();
  });

  // 🔴 舊寫法是「第一個命中就 return」⇒ 兩格都空時**電話那句被地址那句吃掉**。
  //    ⚠️ 「他會不會因此漏補另一欄」不是這一格量得到的 —— 量得到的只有【那一句在不在】。
  it('🔴 地址與電話【都】空 ⇒ 兩句都要在', () => {
    const msg = recipientWarning({ ...full, phone: '', line: '' });
    expect(msg).not.toBeNull();
    expect(msg, '地址那句被吃掉了').toContain('沒有收件地址');
    expect(msg, '電話那句被吃掉了').toContain('無電話');
  });

  // ⚪ 而上面三格都是「該說的時候有沒有說」。這一格問相反的方向:
  //    只打空白也算沒有 —— 否則實作寫成 `=== ''` 會漏掉一個空白鍵。
  it('⚪ 只打了空白 ⇒ 也算沒有(電話與地址各一次)', () => {
    expect(recipientWarning({ ...full, phone: '   ' })).toContain('無電話');
    expect(recipientWarning({ ...full, line: '   ' })).toContain('沒有收件地址');
  });
});

describe('blankish — 畫面與警告共用的那一把尺', () => {
  // 🔴 **為什麼要有這一族**:彈窗要決定「印值還是印『無電話』」,
  //    而那個判斷必須與 `recipientWarning` 同一把尺 ——
  //    ⇒ 📌 兩把尺不一致的下場是「畫面印了值而警告說沒有」, 而那種不一致沒有東西會紅。
  it('空 / 空白 / null / undefined ⇒ 都算沒有', () => {
    for (const v of ['', '   ', null, undefined]) expect(blankish(v), JSON.stringify(v)).toBe(true);
  });

  it('⚪ 負對照:有值 ⇒ 不算沒有(否則它恆真, 畫面會整排印成「無電話」)', () => {
    for (const v of ['0912345678', '0', ' x ']) expect(blankish(v), v).toBe(false);
  });

  // 🔴 分母要含 `null` 與**看起來像空的非空值**(2026-09-10 codex 唯讀審 nit):
  //    少了 `null` ⇒「把電話條件改成排除 null」那個突變不會紅;
  //    少了 `'0'` ⇒「把 '0' 誤判成缺電話」那個突變不會紅。**兩個都是靜悄悄的錯。**
  it('🔴 而它與 `recipientWarning` 判的是同一件事(兩把尺不可以漂開)', () => {
    for (const v of ['', '   ', null, '0912345678', '0', ' x ']) {
      const warned = (recipientWarning({ ...full, phone: v }) ?? '').includes('無電話');
      expect(warned, `phone=${JSON.stringify(v)} 兩把尺答案不同`).toBe(blankish(v));
    }
  });
});

describe('字面', () => {
  it('拒絕訊息是單一來源(client 與 server 不各寫一份)', () => {
    expect(RECIPIENT_NAME_REQUIRED).toContain('沒有收件人姓名');
  });
});
