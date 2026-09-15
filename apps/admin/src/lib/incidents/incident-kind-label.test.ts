import { describe, expect, it } from 'vitest';
import { INCIDENT_KIND_LABEL, incidentKindLabel, incidentSubjectIsOrder } from './incident-kind-label';

// incident-kind-label.test.ts — 標籤表兩個分支的守門(稽核 P2-7;adversarial-reviewer R1 nit 1)
// 🔴 page.test 裡 line_forward_failed 那列的 subjectId 本來就是 null ⇒ 把 KINDS_WITHOUT_ORDER 刪掉那格照樣綠。
//    ⇒ 這裡用「非 null 的 subject」單獨釘住那條分支。

describe('P2-7 incidentSubjectIsOrder', () => {
  it('🔴 line_forward_failed 就算帶了非 null 的 subject,也不當訂單連結', () => {
    expect(incidentSubjectIsOrder('line_forward_failed', '11111111-1111-1111-1111-111111111111')).toBe(false);
  });

  it('其餘種類有 subject ⇒ 是訂單;沒有 subject ⇒ 不是', () => {
    expect(incidentSubjectIsOrder('auto_cancel_failed', '11111111-1111-1111-1111-111111111111')).toBe(true);
    expect(incidentSubjectIsOrder('auto_cancel_failed', null)).toBe(false);
  });
});

describe('P2-7 incidentKindLabel', () => {
  it('認得的種類回中文', () => {
    expect(incidentKindLabel('auto_cancel_failed')).toBe(INCIDENT_KIND_LABEL['auto_cancel_failed']);
  });

  it('🔴 認不得的種類原樣印出來,不吞成空白(DB 先加了種類而標籤表還沒跟上時,員工仍看得到是什麼)', () => {
    expect(incidentKindLabel('zz_new_kind')).toBe('未知種類(zz_new_kind)');
  });

  it('🔴 原型鏈上的名字不能被當成認得的種類(用 Object.hasOwn,不是 in)', () => {
    expect(incidentKindLabel('toString')).toBe('未知種類(toString)');
  });
});
