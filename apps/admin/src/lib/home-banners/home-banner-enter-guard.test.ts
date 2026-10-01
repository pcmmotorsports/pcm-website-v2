import { describe, expect, it, vi } from 'vitest';
import { preventEnterSubmit } from './home-banner-enter-guard';

function ev(key: string, target: { tagName: string; type?: string }, native: { isComposing?: boolean; keyCode?: number } = {}) {
  const preventDefault = vi.fn();
  preventEnterSubmit({ key, target: target as unknown as EventTarget, nativeEvent: native, preventDefault });
  return preventDefault;
}

describe('preventEnterSubmit(按 Enter 不會觸發封存或發布)', () => {
  it.each(['text', 'datetime-local', 'url', undefined])('🔴 單行輸入框(type=%s)按 Enter ⇒ 不送出表單', (type) => {
    expect(ev('Enter', { tagName: 'INPUT', type })).toHaveBeenCalledTimes(1);
  });

  it('多行文字框(FB / IG 貼文)按 Enter ⇒ 照常換行', () => {
    expect(ev('Enter', { tagName: 'TEXTAREA' })).not.toHaveBeenCalled();
  });

  it('按鈕上按 Enter ⇒ 照常按那顆鈕', () => {
    expect(ev('Enter', { tagName: 'BUTTON' })).not.toHaveBeenCalled();
    expect(ev('Enter', { tagName: 'INPUT', type: 'submit' })).not.toHaveBeenCalled();
  });

  it('🔴 中文輸入法選字中的 Enter ⇒ 放過(那是確定選字)', () => {
    expect(ev('Enter', { tagName: 'INPUT', type: 'text' }, { isComposing: true })).not.toHaveBeenCalled();
    expect(ev('Enter', { tagName: 'INPUT', type: 'text' }, { keyCode: 229 })).not.toHaveBeenCalled();
  });

  it('其他按鍵不管', () => {
    expect(ev('a', { tagName: 'INPUT', type: 'text' })).not.toHaveBeenCalled();
  });
});
