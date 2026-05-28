// @vitest-environment jsdom
//
// TierBadge smoke + 字面對齊 design TierComponents.jsx TIER_META(M-1-14e-g-2)。
// 覆蓋:3 tier label 字面 / 3 tier cls / 3 size cls / default size = 'md' /
// camelCase ↔ snake_case mapping(premiumStore → tier-badge-premium、非 tier-badge-premiumStore)。

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { TierBadge } from './TierBadge';

describe('TierBadge', () => {
  it('general → 「一般會員」+ tier-badge-general', () => {
    const { container } = render(<TierBadge tier="general" />);
    const span = container.querySelector('span.tier-badge')!;
    expect(span.textContent).toBe('一般會員');
    expect(span.classList.contains('tier-badge-general')).toBe(true);
  });

  it('store → 「店家會員」+ tier-badge-store', () => {
    const { container } = render(<TierBadge tier="store" />);
    const span = container.querySelector('span.tier-badge')!;
    expect(span.textContent).toBe('店家會員');
    expect(span.classList.contains('tier-badge-store')).toBe(true);
  });

  it('premiumStore → 「PREMIUM STORE」+ tier-badge-premium(非 tier-badge-premiumStore)', () => {
    const { container } = render(<TierBadge tier="premiumStore" />);
    const span = container.querySelector('span.tier-badge')!;
    expect(span.textContent).toBe('PREMIUM STORE');
    expect(span.classList.contains('tier-badge-premium')).toBe(true);
    // 防 camel/snake drift
    expect(span.classList.contains('tier-badge-premiumStore')).toBe(false);
    expect(span.classList.contains('tier-badge-premium_store')).toBe(false);
  });

  it('default size = md', () => {
    const { container } = render(<TierBadge tier="general" />);
    const span = container.querySelector('span.tier-badge')!;
    expect(span.classList.contains('tier-badge-md')).toBe(true);
  });

  it('size = sm', () => {
    const { container } = render(<TierBadge tier="general" size="sm" />);
    expect(container.querySelector('span.tier-badge')!.classList.contains('tier-badge-sm')).toBe(true);
  });

  it('size = lg', () => {
    const { container } = render(<TierBadge tier="premiumStore" size="lg" />);
    const span = container.querySelector('span.tier-badge')!;
    expect(span.classList.contains('tier-badge-lg')).toBe(true);
    expect(span.classList.contains('tier-badge-premium')).toBe(true);
  });
});
