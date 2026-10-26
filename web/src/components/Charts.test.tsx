import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import type { EChartsCoreOption } from 'echarts/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudyDataset } from '../../../contracts/dataset';
import { analyzePair, type PairAnalysis } from '../analysis';
import { Coverage, Histogram, SpatialGrid, TimeSeries } from './Charts';

const { chartCalls } = vi.hoisted(() => ({
  chartCalls: [] as { option: EChartsCoreOption; label: string; testId?: string }[],
}));

vi.mock('./EChart', () => ({
  EChart: (props: { option: EChartsCoreOption; label: string; testId?: string }) => {
    chartCalls.push(props);
    return <div role="img" aria-label={props.label} data-testid={props.testId} />;
  },
}));

const reference = JSON.parse(readFileSync(
  new URL('../../../contracts/testing/calculation-golden.json', import.meta.url), 'utf8',
)) as { dataset: StudyDataset };
const golden = () => structuredClone(reference.dataset);
const previewBytes = readFileSync(new URL('../../public/data/preview.json', import.meta.url));
const preview = JSON.parse(previewBytes.toString('utf8')) as StudyDataset;
const previewLedger = JSON.parse(readFileSync(
  new URL('../../../contracts/testing/preview-pair-bins.json', import.meta.url), 'utf8',
)) as {
  fixtureSha256: string;
  pairs: { beforeId: string; afterId: string; validCount: number; binCounts: number[] }[];
};
// These are hand-calculated expectations, not output from the production analysis helpers.
const pair: PairAnalysis = {
  valuesDb: [-6, -2, 0, 2, 6, null, null], validCount: 5,
  bins: [
    { start: -6, end: -2, count: 1 }, { start: -2, end: 0, count: 1 },
    { start: 0, end: 2, count: 1 }, { start: 2, end: 6, count: 2 },
  ],
};

interface TimelineOption {
  xAxis: { min: number; max: number };
  yAxis: { min: number; max: number };
  series: {
    data: [number, number | null][];
    connectNulls: boolean;
    stack?: string;
    stackStrategy?: string;
    markLine?: { data: { name: string; xAxis: number }[] };
  }[];
}

function spatialMarkup(data: StudyDataset, view: 'before' | 'after' | 'change') {
  return renderToStaticMarkup(<SpatialGrid dataset={data} before={data.acquisitions[0]} after={data.acquisitions[2]} pair={pair} view={view} />);
}

function cellAttributes(markup: string) {
  return [...markup.matchAll(/<rect\b(?=[^>]*\bdata-cell="\d+")[^>]*>/g)].map(([tag]) => ({
    index: Number(tag.match(/data-cell="([^"]+)"/)![1]),
    value: tag.match(/data-value="([^"]+)"/)![1],
    fill: tag.match(/fill="([^"]+)"/)![1],
    x: Number(tag.match(/\bx="([^"]+)"/)![1]),
    y: Number(tag.match(/\by="([^"]+)"/)![1]),
  }));
}

beforeEach(() => chartCalls.splice(0));

describe('prepared time-series chart options', () => {
  it('plots producer medians and reconstructs q75 from a negative q25 plus the positive IQR span', () => {
    const data = golden();
    const markup = renderToStaticMarkup(<TimeSeries dataset={data} beforeId="reference-before" afterId="reference-after" />);
    const option = chartCalls[0].option as unknown as TimelineOption;
    expect(option.xAxis).toMatchObject({ min: 25, max: 61 });
    expect(option.yAxis).toMatchObject({ min: -12, max: -4 });
    expect(option.series[0].data).toEqual([[25, -12], [37, null], [61, -11]]);
    expect(option.series[1].data).toEqual([[25, 4], [37, null], [61, 6.5]]);
    expect(option.series[2].data).toEqual([[25, -10], [37, null], [61, -7]]);
    expect(option.series[0].data[0][1]! + option.series[1].data[0][1]!).toBe(-8);
    expect(option.series[0].data[2][1]! + option.series[1].data[2][1]!).toBe(-4.5);
    expect(option.series.slice(0, 2).map((series) => [series.stack, series.stackStrategy])).toEqual([
      ['spatial-iqr', 'all'], ['spatial-iqr', 'all'],
    ]);
    expect(option.series.map((series) => series.connectNulls)).toEqual([false, false, false]);
    expect(option.series[2].markLine!.data).toEqual([{ name: 'Day 25', xAxis: 25 }, { name: 'Day 61', xAxis: 61 }]);
    expect(markup).toContain('Spatial interquartile range');
    expect(chartCalls[0].label).toContain('spatial interquartile range, not confidence');
  });

  it('leaves a gap for an available acquisition with no valid pixels', () => {
    const data = golden();
    data.acquisitions[0].valuesDb!.fill(null);
    data.acquisitions[0].summary = null;
    renderToStaticMarkup(<TimeSeries dataset={data} beforeId="reference-before" afterId="reference-after" />);
    const option = chartCalls[0].option as unknown as TimelineOption;
    expect(option.series.map((series) => series.data[0])).toEqual([[25, null], [25, null], [25, null]]);
    expect(option.series[2].data[2]).toEqual([61, -7]);
  });

  it('shows an explicit empty state instead of constructing a chart with invalid limits', () => {
    const data = golden();
    data.acquisitions.forEach((item) => { item.summary = null; });
    const markup = renderToStaticMarkup(<TimeSeries dataset={data} beforeId="reference-before" afterId="reference-after" />);
    expect(chartCalls).toHaveLength(0);
    expect(markup).toContain('No valid backscatter observations are available');
    expect(markup).toContain('role="status"');
  });
});

describe('paired histogram chart options', () => {
  it('plots independent bin centers and counts, with exact zeros described as nonnegative', () => {
    const markup = renderToStaticMarkup(<Histogram pair={pair} edges={[-6, -2, 0, 2, 6]} />);
    const option = chartCalls[0].option as {
      xAxis: { min: number; max: number };
      series: { data: { value: number[]; itemStyle: { color: string } }[]; markLine: { data: { xAxis: number }[] } }[];
    };
    expect(option.xAxis).toMatchObject({ min: -6, max: 6 });
    expect(option.series[0].data).toEqual([
      { value: [-4, 1], itemStyle: { color: '#2f81e8' } },
      { value: [-1, 1], itemStyle: { color: '#2f81e8' } },
      { value: [1, 1], itemStyle: { color: '#e98b46' } },
      { value: [4, 2], itemStyle: { color: '#e98b46' } },
    ]);
    expect(option.series[0].markLine.data).toEqual([{ xAxis: 0 }]);
    expect(chartCalls[0].label).toContain('5 valid paired pixels');
    expect(chartCalls[0].label).toContain('after minus before');
    expect(chartCalls[0].label).toContain('including exact zeros');
    expect(markup).toContain('Backscatter increase or zero');
  });

  it('does not replace an empty paired intersection with a misleading zero-change histogram', () => {
    const empty: PairAnalysis = { valuesDb: [null, null], validCount: 0, bins: pair.bins.map((bin) => ({ ...bin, count: 0 })) };
    const markup = renderToStaticMarkup(<Histogram pair={empty} edges={[-6, -2, 0, 2, 6]} />);
    expect(chartCalls).toHaveLength(0);
    expect(markup).toContain('No overlapping valid pixels for this comparison');
    expect(markup).toContain('role="status"');
  });
});

describe('all prepared-preview pairs through analysis and histogram rendering', () => {
  it('binds the independent Fraction-reference ledger to the current fixture and all 28 chronological pairs', () => {
    expect(createHash('sha256').update(previewBytes).digest('hex')).toBe(previewLedger.fixtureSha256);
    const available = preview.acquisitions.filter((item) => item.availability === 'available');
    const expectedPairs = available.flatMap((before, index) =>
      available.slice(index + 1).map((after) => `${before.id}/${after.id}`));
    const ledgerPairs = previewLedger.pairs.map((entry) => `${entry.beforeId}/${entry.afterId}`);
    expect(previewLedger.pairs).toHaveLength(28);
    expect(new Set(ledgerPairs).size).toBe(28);
    expect(ledgerPairs.sort()).toEqual(expectedPairs.sort());
  });

  it.each(previewLedger.pairs)('plots independently verified bins for $beforeId → $afterId', (expected) => {
    const before = preview.acquisitions.find((item) => item.id === expected.beforeId)!;
    const after = preview.acquisitions.find((item) => item.id === expected.afterId)!;
    // Production functions supply only actual values. Expected counts come from exact Fraction arithmetic.
    const actual = analyzePair(preview, before, after);
    renderToStaticMarkup(<Histogram pair={actual} edges={preview.histogramEdgesDb} />);
    const option = chartCalls[0].option as {
      xAxis: { min: number; max: number };
      series: { data: { value: [number, number] }[] }[];
    };
    expect(actual.validCount).toBe(expected.validCount);
    expect(actual.bins.map((bin) => bin.count)).toEqual(expected.binCounts);
    expect(option.xAxis).toMatchObject({ min: -6, max: 6 });
    expect(option.series[0].data.map((bin) => bin.value[0])).toEqual([
      -5.625, -4.875, -4.125, -3.375, -2.625, -1.875, -1.125, -0.375,
      0.375, 1.125, 1.875, 2.625, 3.375, 4.125, 4.875, 5.625,
    ]);
    expect(option.series[0].data.map((bin) => bin.value[1])).toEqual(expected.binCounts);
    expect(option.series[0].data.reduce((total, bin) => total + bin.value[1], 0)).toBe(expected.validCount);
    expect(chartCalls[0].label).toContain(`${expected.validCount} valid paired pixels`);
  });
});

describe('spatial values, masks and comparison scales', () => {
  it('shares one before/after domain and encodes equal dB values with equal colors', () => {
    const data = golden();
    const before = spatialMarkup(data, 'before');
    const after = spatialMarkup(data, 'after');
    expect(before).toContain('Backscatter scale from -18 to -3 decibels');
    expect(after).toContain('Backscatter scale from -18 to -3 decibels');
    expect(cellAttributes(before).map((cell) => cell.value)).toEqual(['-12', '-10', '-8', '-6', '-12', 'missing', 'missing']);
    expect(cellAttributes(after).map((cell) => cell.value)).toEqual(['-18', '-12', '-8', '-4', '-6', '-3', 'missing']);
    expect(cellAttributes(before)[0].fill).toBe('rgb(150,193,200)');
    expect(cellAttributes(after)[1].fill).toBe('rgb(150,193,200)');
    expect(cellAttributes(before).filter((cell) => cell.fill.startsWith('url(#'))).toHaveLength(2);
    expect(cellAttributes(after).filter((cell) => cell.fill.startsWith('url(#'))).toHaveLength(1);
  });

  it('keeps the global backscatter range stable when a nonselected acquisition has the largest extent', () => {
    const data = golden();
    data.acquisitions.push({ id: 'unselected', day: 85, availability: 'available', valuesDb: [-30, null, null, null, null, null, null], summary: { medianDb: -30, q25Db: -30, q75Db: -30, validCount: 1 } });
    expect(spatialMarkup(data, 'before')).toContain('Backscatter scale from -30 to -3 decibels');
    expect(spatialMarkup(data, 'after')).toContain('Backscatter scale from -30 to -3 decibels');
  });

  it('renders signed pair values with a symmetric scale, a neutral genuine zero, and two invalid cells', () => {
    const markup = spatialMarkup(golden(), 'change');
    const cells = cellAttributes(markup);
    expect(markup).toContain('Change scale from -6 to 6 decibels');
    expect(markup).toContain('data-paired-count="5"');
    expect(markup).toContain('Day 61 minus day 25');
    expect(cells.map((cell) => cell.value)).toEqual(['-6', '-2', '0', '2', '6', 'missing', 'missing']);
    expect(cells[0].fill).toBe('rgb(47,129,232)');
    expect(cells[2].fill).toBe('rgb(247,249,251)');
    expect(cells[4].fill).toBe('rgb(233,139,70)');
    expect(cells.filter((cell) => cell.fill.startsWith('url(#'))).toHaveLength(2);
  });

  it('uses the row-major cell order for a vertical grid without transposing the values', () => {
    const data = golden();
    data.grid.width = 1;
    data.grid.height = 7;
    const cells = cellAttributes(spatialMarkup(data, 'change'));
    expect(cells.map((cell) => [cell.index, cell.x, cell.y])).toEqual([
      [0, 0, 0], [1, 0, 20], [2, 0, 40], [3, 0, 60], [4, 0, 80], [5, 0, 100], [6, 0, 120],
    ]);
  });

  it('retains finite fallback limits when every available cell is invalid', () => {
    const data = golden();
    data.acquisitions.forEach((item) => { item.valuesDb = item.availability === 'missing' ? null : Array(7).fill(null); item.summary = null; });
    const markup = spatialMarkup(data, 'before');
    expect(markup).toContain('Backscatter scale from -18 to -6 decibels');
    expect(cellAttributes(markup).every((cell) => cell.value === 'missing' && cell.fill.startsWith('url(#'))).toBe(true);
  });
});

describe('fixed-ROI acquisition coverage', () => {
  it('uses six ROI cells as the denominator, distinguishes the missing slot, and marks the selected pair', () => {
    const data = golden();
    const markup = renderToStaticMarkup(<Coverage dataset={data} beforeId="reference-before" afterId="reference-after" />);
    const groups = [...markup.matchAll(/<g data-availability="(available|missing)">([\s\S]*?)<\/g>/g)];
    expect(groups.map((group) => group[1])).toEqual(['available', 'missing', 'available']);
    expect(groups[0][2]).toContain('Day 25: 83.3% valid pixels');
    expect(groups[0][2]).toContain('cy="38" r="4.5" fill="#1599a7"');
    expect(groups[1][2]).toContain('Day 37: missing acquisition');
    expect(groups[1][2]).toContain('cy="78" r="4.5" fill="white"');
    expect(groups[2][2]).toContain('Day 61: 100.0% valid pixels');
    expect(groups[2][2]).toContain('cy="30" r="4.5" fill="#1599a7"');
    expect(groups.map((group) => group[2].includes('r="8"'))).toEqual([true, false, true]);
  });

  it('places zero-coverage available observations at zero with a filled mark, distinct from missing', () => {
    const data = golden();
    data.acquisitions[0].valuesDb!.fill(null);
    data.acquisitions[0].summary = null;
    const markup = renderToStaticMarkup(<Coverage dataset={data} beforeId="reference-before" afterId="reference-after" />);
    const groups = [...markup.matchAll(/<g data-availability="(available|missing)">([\s\S]*?)<\/g>/g)];
    expect(groups[0][2]).toContain('Day 25: 0.0% valid pixels');
    expect(groups[0][2]).toContain('cy="78" r="4.5" fill="#1599a7"');
    expect(groups[1][2]).toContain('Day 37: missing acquisition');
    expect(groups[1][2]).toContain('cy="78" r="4.5" fill="white"');
  });
});
