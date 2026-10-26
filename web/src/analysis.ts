import type { Acquisition, StudyDataset } from '../../contracts/dataset';

export interface HistogramBin {
  start: number;
  end: number;
  count: number;
}

export interface PairAnalysis {
  valuesDb: (number | null)[];
  validCount: number;
  bins: HistogramBin[];
}

/** Find display limits in one pass without flattening grids or spreading unbounded argument lists. */
export function findExtent(
  arrays: Iterable<readonly (number | null)[] | null>,
  fallback: readonly [number, number],
): [number, number] {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const values of arrays) {
    if (values === null) continue;
    for (const value of values) {
      if (value === null || !Number.isFinite(value)) continue;
      if (value < minimum) minimum = value;
      if (value > maximum) maximum = value;
    }
  }
  return minimum === Infinity ? [fallback[0], fallback[1]] : [minimum, maximum];
}

/** Bin already prepared dB differences; the final bin includes its right edge. */
export function binDifferences(
  valuesDb: readonly (number | null)[],
  edges: readonly number[],
): HistogramBin[] {
  if (
    edges.length < 2 ||
    edges.some((edge, index) => !Number.isFinite(edge) || (index > 0 && edge <= edges[index - 1]))
  ) {
    throw new Error('Histogram edges must be finite and strictly increasing.');
  }

  const bins = edges.slice(0, -1).map((start, index) => ({ start, end: edges[index + 1], count: 0 }));
  for (const value of valuesDb) {
    if (value === null) continue;
    if (!Number.isFinite(value)) throw new Error('Histogram values must be finite or null.');
    if (value < edges[0] || value > edges[edges.length - 1]) {
      throw new Error('A paired difference falls outside the fixed histogram range.');
    }
    const index = value === edges[edges.length - 1]
      ? bins.length - 1
      : bins.findIndex((bin) => value >= bin.start && value < bin.end);
    bins[index].count += 1;
  }
  return bins;
}

/** Pair operations belong here; all plots use this same mask and subtraction. */
export function analyzePair(
  dataset: StudyDataset,
  before: Acquisition,
  after: Acquisition,
): PairAnalysis {
  const length = dataset.grid.width * dataset.grid.height;
  const valuesDb = Array.from({ length }, (_, index): number | null => {
    if (!dataset.grid.roiMask[index]) return null;
    const earlier = before.valuesDb?.[index];
    const later = after.valuesDb?.[index];
    if (earlier == null || later == null || !Number.isFinite(earlier) || !Number.isFinite(later)) return null;
    return later - earlier;
  });
  return {
    valuesDb,
    validCount: valuesDb.filter((value) => value !== null).length,
    bins: binDifferences(valuesDb, dataset.histogramEdgesDb),
  };
}
