// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoApplySubmit } from './auto-apply-submit';

// auto-apply-submit.test.tsx — MAIN-063 C/D:「點選後下方列表沒自動跳」。
//
// 🔴 本檔守的三件事,**在畫面上都不會報錯**:
//   ① 選了下拉真的送出表單(壞掉 = 回到 Sean 抱怨的那個狀態,而畫面完全正常)
//   ② 只有**自己那張表單**裡的改動才送出(壞掉 = 頁面上別的下拉會亂送這張表單)
//   ③ 關掉 JS 時鈕看得見(壞掉 = 沒有 JS 的人**永遠無法篩選**,而有 JS 的我們看不到)
// ⚠️ ③ 用的是 server 端輸出(`renderToStaticMarkup`),不是 jsdom 那份 —— jsdom 那份 effect
//    一定會跑完,量它等於量「有 JS」的世界,答不出 ③ 這一題。

afterEach(cleanup);

/** 真的掛在一張 form 裡 —— 本元件靠 `closest('form')` 找它,脫離 form 就什麼都不做。 */
function Harness() {
  return (
    <>
      <form>
        <select aria-label='表單內'>
          <option value=''>全部</option>
          <option value='vip'>VIP</option>
        </select>
        <AutoApplySubmit label='篩選' />
      </form>
      {/* 負對照:同一頁、同樣是下拉,但不在那張 form 裡。 */}
      <select aria-label='表單外'>
        <option value=''>全部</option>
        <option value='vip'>VIP</option>
      </select>
    </>
  );
}

describe('AutoApplySubmit', () => {
  it('表單內的下拉一改就送出,而表單外的不送(負對照)', () => {
    const submit = vi
      .spyOn(HTMLFormElement.prototype, 'requestSubmit')
      .mockImplementation(() => {});
    render(<Harness />);

    fireEvent.change(screen.getByLabelText('表單外'), { target: { value: 'vip' } });
    // 🔴 這一格若是綠的才有資格相信下一格:量具分得出「有送」與「沒送」。
    expect(submit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('表單內'), { target: { value: 'vip' } });
    expect(submit).toHaveBeenCalledTimes(1);

    submit.mockRestore();
  });

  it('掛上監聽之後,那顆鈕自己收起來(有 JS 時它是多餘的)', () => {
    vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    render(<Harness />);
    expect(screen.getByRole('button', { hidden: true })).toHaveProperty('hidden', true);
    vi.restoreAllMocks();
  });

  it('🔴 server 端輸出的鈕【沒有】hidden —— 關掉 JS 時它是唯一的出口', () => {
    const html = renderToStaticMarkup(
      <form>
        <AutoApplySubmit label='篩選' />
      </form>,
    );
    expect(html).toContain('type="submit"');
    expect(html).not.toContain('hidden');
  });
});
