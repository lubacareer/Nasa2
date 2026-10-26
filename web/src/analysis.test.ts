import { describe, expect, it } from 'vitest';
import type { Acquisition, StudyDataset } from '../../contracts/dataset';
import { analyzePair, binDifferences } from './analysis';

const acquisition = (id: string, valuesDb: (number | null)[]): Acquisition => ({
  id, day: id === 'before' ? 1 : 2, availability: 'available', valuesDb, summary: null,
});

const dataset = {
  grid: { width: 5, height: 1, roiMask: [true, true, true, true, false] },
  histogramEdgesDb: [-6, -2, 0, 2, 6],
} as StudyDataset;

describe('paired backscatter analysis', () => {
  it('subtracts after minus before and intersects the valid scene/ROI masks, preserving zero', () => {
    const result = analyzePair(dataset, acquisition('before', [-10, null, -8, -9, -3]), acquisition('after', [-12, -8, -8, null, 2]));
    expect(result.valuesDb).toEqual([-2, null, 0, null, null]);
    expect(result.validCount).toBe(2);
    expect(result.bins.map((bin) => bin.count)).toEqual([0, 1, 1, 0]);
  });

  it('returns an empty analysis when there are no overlapping valid cells', () => {
    const result = analyzePair(dataset, acquisition('before', [null, -8, null, null, -3]), acquisition('after', [-12, null, -8, null, 2]));
    expect(result.validCount).toBe(0);
    expect(result.bins.every((bin) => bin.count === 0)).toBe(true);
  });
});

describe('fixed histogram bins', () => {
  it('uses left-inclusive bins and includes the final right edge exactly once', () => {
    const result = binDifferences([-6, -2, 0, 2, 6, null], [-6, -2, 0, 2, 6]);
    expect(result.map((bin) => bin.count)).toEqual([1, 1, 1, 2]);
    expect(result.reduce((sum, bin) => sum + bin.count, 0)).toBe(5);
  });

  it('refuses values outside the range rather than silently losing pixels', () => {
    expect(() => binDifferences([6.1], [-6, 0, 6])).toThrow('outside');
    expect(() => binDifferences([Number.NaN], [-6, 0, 6])).toThrow('finite');
  });

  it('rejects non-increasing or non-finite bin edges', () => {
    expect(() => binDifferences([0], [0, 0, 1])).toThrow('increasing');
    expect(() => binDifferences([0], [-Infinity, 1])).toThrow('finite');
  });
});
