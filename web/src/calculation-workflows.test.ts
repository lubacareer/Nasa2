import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Acquisition, StudyDataset } from '../../contracts/dataset';
import { analyzePair, binDifferences, findExtent } from './analysis';
import { validateDataset } from './dataset';

const reference = JSON.parse(readFileSync(
  new URL('../../contracts/testing/calculation-golden.json', import.meta.url), 'utf8',
)) as { dataset: StudyDataset };
const golden = () => structuredClone(reference.dataset);

function observation(id: string, valuesDb: (number | null)[]): Acquisition {
  return { id, day: id === 'before' ? 25 : 61, availability: 'available', valuesDb, summary: null };
}

describe('independent calculation reference', () => {
  it('accepts the prepared type-7 quartiles and carries them through without replacing them', () => {
    const data = golden();
    expect(validateDataset(data)).toBe(data);
    expect(data.acquisitions[0].summary).toEqual({ medianDb: -10, q25Db: -12, q75Db: -8, validCount: 5 });
    expect(data.acquisitions[2].summary).toEqual({ medianDb: -7, q25Db: -11, q75Db: -4.5, validCount: 6 });
  });

  it('joins prepared acquisitions into row-major deltas and fixed histogram counts', () => {
    const data = golden();
    const result = analyzePair(data, data.acquisitions[0], data.acquisitions[2]);
    // Independently hand-calculated: -18 - (-12), -12 - (-10), -8 - (-8), etc.
    expect(result.valuesDb).toEqual([-6, -2, 0, 2, 6, null, null]);
    expect(result.validCount).toBe(5);
    expect(result.bins).toEqual([
      { start: -6, end: -2, count: 1 },
      { start: -2, end: 0, count: 1 },
      { start: 0, end: 2, count: 1 },
      { start: 2, end: 6, count: 2 },
    ]);
    expect(findExtent(data.acquisitions.map((item) => item.valuesDb), [-18, -6])).toEqual([-18, -3]);
  });

  it('returns no paired cells for a genuinely missing acquisition', () => {
    const data = golden();
    const result = analyzePair(data, data.acquisitions[0], data.acquisitions[1]);
    expect(result.valuesDb).toEqual([null, null, null, null, null, null, null]);
    expect(result.validCount).toBe(0);
    expect(result.bins.map((bin) => bin.count)).toEqual([0, 0, 0, 0]);
  });
});

describe('calculation invariants with independent reference values', () => {
  it.each([-1024, -16, 0, 4, 1024])('preserves differences and bins after a common %i dB translation', (offset) => {
    const data = golden();
    const before = observation('before', [-12, -10, -8, -6, -12, null, null].map((value) => value === null ? null : value + offset));
    const after = observation('after', [-18, -12, -8, -4, -6, -3, null].map((value) => value === null ? null : value + offset));
    const result = analyzePair(data, before, after);
    expect(result.valuesDb).toEqual([-6, -2, 0, 2, 6, null, null]);
    expect(result.bins.map((bin) => bin.count)).toEqual([1, 1, 1, 2]);
    expect(result.validCount).toBe(5);
  });

  it('reverses the signed differences when acquisitions are swapped, while retaining zero', () => {
    const data = golden();
    data.grid.roiMask.fill(true);
    const before = observation('before', [-10, -10, -10, -10, -10, -10, -10]);
    const after = observation('after', [-15, -14, -13, -11, -10, -9, -7]);
    const forward = analyzePair(data, before, after);
    const reverse = analyzePair(data, after, before);
    expect(forward.valuesDb).toEqual([-5, -4, -3, -1, 0, 1, 3]);
    expect(reverse.valuesDb).toEqual([5, 4, 3, 1, 0, -1, -3]);
    expect(forward.bins.map((bin) => bin.count)).toEqual([3, 1, 2, 1]);
    expect(reverse.bins.map((bin) => bin.count)).toEqual([1, 1, 2, 3]);
    expect(reverse.validCount).toBe(7);
  });

  it.each([
    { order: [0, 1, 2, 3, 4, 5, 6], expected: [-6, -2, 0, 2, 6, null, null] },
    { order: [6, 5, 4, 3, 2, 1, 0], expected: [null, null, 6, 2, 0, -2, -6] },
    { order: [2, 5, 0, 6, 4, 1, 3], expected: [0, null, -6, null, 6, -2, 2] },
  ])('preserves row-major association and histogram totals under permutation $order', ({ order, expected }) => {
    const data = golden();
    const sourceBefore = data.acquisitions[0].valuesDb!;
    const sourceAfter = data.acquisitions[2].valuesDb!;
    data.grid.roiMask = order.map((index) => data.grid.roiMask[index]);
    const result = analyzePair(data,
      observation('before', order.map((index) => sourceBefore[index])),
      observation('after', order.map((index) => sourceAfter[index])),
    );
    expect(result.valuesDb).toEqual(expected);
    expect(result.validCount).toBe(5);
    expect(result.bins.map((bin) => bin.count)).toEqual([1, 1, 1, 2]);
    expect(result.bins.reduce((total, bin) => total + bin.count, 0)).toBe(5);
  });

  it('intersects ROI and scene validity even when a caller supplies nonfinite cells', () => {
    const data = golden();
    const before = observation('before', [0, Number.NaN, -8, Infinity, -12, -4, -2]);
    const after = observation('after', [0, -4, -Infinity, -3, null, -2, 2]);
    const result = analyzePair(data, before, after);
    expect(result.valuesDb).toEqual([0, null, null, null, null, 2, null]);
    expect(result.validCount).toBe(2);
    expect(result.bins.map((bin) => bin.count)).toEqual([0, 0, 1, 1]);
  });

  it('places values immediately around each boundary without double-counting zeros or the final edge', () => {
    const counts = binDifferences([
      -6, -6 + 1e-12, -2 - 1e-12,
      -2, -2 + 1e-12, -1e-12,
      -0, 0, 1e-12, 2 - 1e-12,
      2, 2 + 1e-12, 6 - 1e-12, 6, null,
    ], [-6, -2, 0, 2, 6]);
    expect(counts.map((bin) => bin.count)).toEqual([3, 3, 4, 4]);
    expect(counts.reduce((total, bin) => total + bin.count, 0)).toBe(14);
  });

  it.each([-6 - 1e-12, 6 + 1e-12])('refuses the out-of-range boundary %s instead of losing a pixel', (value) => {
    expect(() => binDifferences([value], [-6, -2, 0, 2, 6])).toThrow(/outside/);
  });
});

describe('numerical handoff integrity', () => {
  it.each(['medianDb', 'q25Db', 'q75Db'] as const)('rejects a plausible but incorrect prepared %s', (field) => {
    const data = golden();
    data.acquisitions[2].summary![field] += 0.125;
    expect(() => validateDataset(data)).toThrow(/inconsistent acquisition summary/i);
  });

  it('honors the documented 1e-9 summary tolerance without rewriting producer values', () => {
    const withinTolerance = golden();
    withinTolerance.acquisitions[2].summary!.q25Db += 5e-10;
    const prepared = withinTolerance.acquisitions[2].summary!.q25Db;
    expect(validateDataset(withinTolerance).acquisitions[2].summary!.q25Db).toBe(prepared);
    const outsideTolerance = golden();
    outsideTolerance.acquisitions[2].summary!.q25Db += 2e-9;
    expect(() => validateDataset(outsideTolerance)).toThrow(/inconsistent acquisition summary/i);
  });

  it('accepts exact zero backscatter and single-cell summaries', () => {
    const data = golden();
    for (const item of [data.acquisitions[0], data.acquisitions[2]]) {
      item.valuesDb = [0, null, null, null, null, null, null];
      item.summary = { medianDb: 0, q25Db: 0, q75Db: 0, validCount: 1 };
    }
    expect(validateDataset(data)).toBe(data);
    expect(analyzePair(data, data.acquisitions[0], data.acquisitions[2]).valuesDb).toEqual([0, null, null, null, null, null, null]);
  });

  it('accepts finite reference quartiles when subtracting opposite finite extremes would overflow', () => {
    const data = golden();
    data.grid = { ...data.grid, width: 2, height: 1, roiMask: [true, true] };
    for (const item of [data.acquisitions[0], data.acquisitions[2]]) {
      item.valuesDb = [-1e308, 1e308];
      // Exact type-7 interpolation: one-quarter and three-quarters along a symmetric pair.
      item.summary = { medianDb: 0, q25Db: -5e307, q75Db: 5e307, validCount: 2 };
    }
    expect(validateDataset(data)).toBe(data);
    const result = analyzePair(data, data.acquisitions[0], data.acquisitions[2]);
    expect(result.valuesDb).toEqual([0, 0]);
    expect(result.bins.map((bin) => bin.count)).toEqual([0, 0, 2, 0]);
  });

  it.each([Number.NaN, Infinity, -Infinity])('rejects nonfinite prepared backscatter %s at the handoff', (value) => {
    const data = golden();
    data.acquisitions[0].valuesDb![0] = value;
    expect(() => validateDataset(data)).toThrow(/invalid data package/i);
  });

  it('rejects power units so a linear-power package cannot be silently interpreted as dB', () => {
    const data = { ...golden(), units: 'gamma0_power' };
    expect(() => validateDataset(data)).toThrow(/invalid data package/i);
  });

  it('rejects valid-looking values placed outside the ROI', () => {
    const data = golden();
    data.acquisitions[0].valuesDb![6] = 0;
    expect(() => validateDataset(data)).toThrow(/outside the study mask/i);
  });

  it('rejects a histogram range that fits the default pair but omits a later pair', () => {
    const data = golden();
    data.acquisitions.push({
      id: 'later', day: 85, availability: 'available', valuesDb: [-25, null, null, null, null, null, null],
      summary: { medianDb: -25, q25Db: -25, q75Db: -25, validCount: 1 },
    });
    expect(() => validateDataset(data)).toThrow(/cover all paired changes/i);
  });
});
