import { describe, it, expect } from 'vitest';
import { STAFF, resolveStaff } from './staff';

describe('staff', () => {
  it('should have at least one staff with unique ids', () => {
    expect(STAFF.length).toBeGreaterThan(0);
    const ids = STAFF.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should resolve a known id to its StaffActor', () => {
    expect(resolveStaff('sean')).toEqual({ id: 'sean', label: 'Sean(老闆)' });
  });

  it('should return null for unknown / empty / nullish id (fail-closed)', () => {
    expect(resolveStaff('nope')).toBeNull();
    expect(resolveStaff('')).toBeNull();
    expect(resolveStaff(null)).toBeNull();
    expect(resolveStaff(undefined)).toBeNull();
  });
});
