import { createIntercalaryDate, createMonthDate, gregorianDate } from '@thirteen/core';
import { describe, expect, it } from 'vitest';
import { moveToYear, resolveConvertState, thirteenRoute } from './convertState.ts';

const today = gregorianDate(2026, 10, 19);

describe('resolveConvertState', () => {
  it('defaults to today, Gregorian side as input', () => {
    const state = resolveConvertState({ date: null, thirteen: null, system: null }, 'ifc', today);
    expect(state.source).toBe('gregorian');
    expect(state.thirteen).toEqual(createMonthDate(2026, 11, 12, 'ifc'));
  });

  it('parses the 13-month numeric form with the display year of the given system', () => {
    const state = resolveConvertState({ date: null, thirteen: '0238-M11-12', system: 'positivist' }, 'ifc', today);
    expect(state.source).toBe('thirteen');
    expect(state.gregorian).toEqual(today);
    expect(state.thirteen).toEqual(createMonthDate(2026, 11, 12, 'ifc'));
    expect(state.error).toBeNull();
  });

  it('reports unreadable input and falls back to today', () => {
    expect(resolveConvertState({ date: '2026-02-30', thirteen: null, system: null }, 'ifc', today).error).toMatch(/not a Gregorian date/);
    expect(resolveConvertState({ date: null, thirteen: '2025-LD', system: 'ifc' }, 'ifc', today).error).toMatch(/not a IFC date|not an? IFC date/);
  });
});

describe('moveToYear', () => {
  it('keeps slots that exist and falls back for leap-only days', () => {
    expect(moveToYear(createMonthDate(2024, 7, 3, 'ifc'), 2025)).toEqual({ date: createMonthDate(2025, 7, 3, 'ifc'), fellBack: false });
    expect(moveToYear(createIntercalaryDate(2024, 'leap-day', 'ifc'), 2025)).toEqual({
      date: createMonthDate(2025, 6, 28, 'ifc'),
      fellBack: true,
    });
    expect(moveToYear(createIntercalaryDate(2024, 'leap-day', 'positivist'), 2025)).toEqual({
      date: createIntercalaryDate(2025, 'year-day', 'positivist'),
      fellBack: true,
    });
  });

  it('always writes the system into 13-month links', () => {
    expect(thirteenRoute(createMonthDate(2026, 11, 12, 'positivist'))).toEqual({
      name: 'convert',
      date: null,
      thirteen: '0238-M11-12',
      system: 'positivist',
    });
  });
});
