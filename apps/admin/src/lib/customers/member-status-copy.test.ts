import { describe, expect, it } from 'vitest';
import {
  codeFromRpc,
  codeFromRpcError,
  deleteBlockedText,
  memberActionResult,
  parseMemberReason,
} from './member-status-copy';

// 後台停用 / 恢復 / 刪除會員的結果對照(20260926100000;計畫第九節)。
describe('會員停用 / 刪除的結果對照', () => {
  it('🔴 沒收到資料庫回應(沒有 SQLSTATE)⇒ unknown, 不說「沒有完成」', () => {
    for (const action of ['disable', 'enable', 'delete'] as const) {
      expect(codeFromRpcError(action, { code: '' })).toBe('unknown');
      expect(codeFromRpcError(action, null)).toBe('unknown');
      const r = memberActionResult(action, 'unknown');
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/無法確認這次(操作|刪除)是否完成/);
      expect(r.message).not.toMatch(/沒有完成/);
    }
  });

  it('資料庫明確拒絕 ⇒ error;刪除遇到外鍵擋下 ⇒ 有新的紀錄', () => {
    expect(codeFromRpcError('disable', { code: 'P0001' })).toBe('error');
    expect(codeFromRpcError('delete', { code: '23503' })).toBe('HAS_RECORDS');
    expect(codeFromRpcError('disable', { code: '23503' })).toBe('error');
    // Fable 第 4 片 R1 必修 1:連線類可能在 COMMIT 之後才斷 ⇒ 不確定;函式不存在(migration 沒貼)⇒ 確定沒執行
    expect(codeFromRpcError('disable', { code: '08006' })).toBe('unknown');
    expect(codeFromRpcError('delete', { code: '57P01' })).toBe('unknown');
    expect(codeFromRpcError('enable', { code: 'PGRST002' })).toBe('unknown');
    expect(codeFromRpcError('disable', { code: 'PGRST202' })).toBe('error');
    expect(memberActionResult('delete', 'HAS_RECORDS').message).toContain('改用停用');
  });

  it('資料庫回傳值:只收認得的碼, 其他當 error', () => {
    expect(codeFromRpc('disable', 'OK')).toBe('OK');
    expect(codeFromRpc('enable', 'STALE')).toBe('STALE');
    expect(codeFromRpc('delete', 'DELETED')).toBe('DELETED');
    expect(codeFromRpc('delete', 'OK')).toBe('error');
    expect(codeFromRpc('disable', 'DELETED')).toBe('error');
    expect(codeFromRpc('disable', null)).toBe('error');
  });

  it('成功只寫實際結果;狀態被改過要叫人重新整理', () => {
    expect(memberActionResult('disable', 'OK')).toEqual({ ok: true, code: 'OK', message: '已停用會員。' });
    expect(memberActionResult('enable', 'OK').message).toBe('已恢復會員。');
    expect(memberActionResult('delete', 'DELETED').message).toBe('已刪除會員。');
    expect(memberActionResult('disable', 'STALE')).toMatchObject({ ok: false });
    expect(memberActionResult('disable', 'STALE').message).toContain('可能是你剛才的操作已經完成');
    expect(memberActionResult('delete', 'unknown').message).toContain('若頁面顯示找不到這位客戶，代表已經刪除');
    expect(memberActionResult('delete', 'denied').ok).toBe(false);
  });

  it('不能刪除的原因列出實際紀錄(含經銷三種, Sean Q20 甲)', () => {
    expect(deleteBlockedText(['orders', 'wallet_ledger'])).toBe('這位會員有下列紀錄，只能停用：訂單、儲值金紀錄。');
    expect(deleteBlockedText(['dealer_applications', 'dealer_brand_discounts', 'dealer_tier'])).toBe(
      '這位會員有下列紀錄，只能停用：經銷申請、品牌折扣、會員等級是車行或經銷。',
    );
    expect(deleteBlockedText(['something_new'])).toContain('something_new');
  });

  it('原因:去頭尾空白後 1–200 字、不含控制字元', () => {
    expect(parseMemberReason('  客人要求  ')).toBe('客人要求');
    expect(parseMemberReason('   ')).toBeNull();
    expect(parseMemberReason('a'.repeat(201))).toBeNull();
    expect(parseMemberReason('a\nb')).toBeNull();
    expect(parseMemberReason(undefined)).toBeNull();
  });
});
