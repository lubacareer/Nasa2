import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import type { Acquisition, StudyDataset } from '../../../contracts/dataset';
import { findExtent, type PairAnalysis } from '../analysis';
import type { SpatialView } from '../viewState';
import { EChart } from './EChart';

const INK = '#101b30';
const MUTED = '#536277';
const GRID = '#e2e8ee';
const TEAL = '#1599a7';
const BLUE = '#2f81e8';
const ORANGE = '#e98b46';
const FONT = 'Inter, ui-sans-serif, system-ui, sans-serif';

interface TimelineProps {
  dataset: StudyDataset;
  beforeId: string;
  afterId: string;
}

/** Plot Python-prepared spatial summaries without interpolating missing or empty acquisitions. */
export function TimeSeries({ dataset, beforeId, afterId }: TimelineProps) {
  const option = useMemo<EChartsCoreOption | null>(() => {
    const observations = dataset.acquisitions;
    const bounds = observations.flatMap((item) => item.summary ? [[item.summary.q25Db, item.summary.q75Db]] : []);
    if (bounds.length === 0) return null;
    const [minimum, maximum] = findExtent(bounds, [-18, -6]);
    return {
      animation: false,
      textStyle: { fontFamily: FONT, color: INK },
      grid: { left: 55, right: 18, top: 32, bottom: 48 },
      xAxis: {
        type: 'value', min: observations[0].day, max: observations[observations.length - 1].day,
        name: 'Synthetic day', nameLocation: 'middle', nameGap: 30,
        nameTextStyle: { fontSize: 12, color: MUTED },
        axisLabel: { fontSize: 12, color: MUTED, hideOverlap: true },
        axisLine: { show: true, lineStyle: { color: '#8996a7' } },
        splitLine: { lineStyle: { color: GRID } },
      },
      yAxis: {
        type: 'value', min: Math.floor(minimum / 2) * 2, max: Math.ceil(maximum / 2) * 2,
        name: 'γ⁰ (dB)', nameGap: 12, nameTextStyle: { fontSize: 12, color: MUTED },
        axisLabel: { fontSize: 12, color: MUTED }, splitLine: { lineStyle: { color: GRID } },
      },
      series: [
        {
          type: 'line', stack: 'spatial-iqr', stackStrategy: 'all', symbol: 'none',
          data: observations.map((item) => [item.day, item.summary?.q25Db ?? null]),
          lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 }, silent: true, connectNulls: false,
        },
        {
          name: 'Spatial interquartile range', type: 'line', stack: 'spatial-iqr', stackStrategy: 'all', symbol: 'none',
          data: observations.map((item) => [item.day, item.summary ? item.summary.q75Db - item.summary.q25Db : null]),
          lineStyle: { opacity: 0 }, areaStyle: { color: '#cdecee', opacity: 0.85 },
          silent: true, connectNulls: false,
        },
        {
          name: 'Spatial median', type: 'line', symbol: 'circle', symbolSize: 8,
          data: observations.map((item) => [item.day, item.summary?.medianDb ?? null]),
          lineStyle: { width: 2, color: TEAL }, itemStyle: { color: TEAL, borderColor: '#0c6774', borderWidth: 1 },
          connectNulls: false,
          markLine: {
            symbol: ['none', 'none'], silent: true,
            lineStyle: { type: 'dashed', width: 1, color: BLUE },
            label: { show: true, formatter: '{b}', color: '#154f98', backgroundColor: '#e2efff', padding: [4, 5], fontSize: 12 },
            data: observations.filter((item) => item.id === beforeId || item.id === afterId).map((item) => ({ name: `Day ${item.day}`, xAxis: item.day })),
          },
        },
      ],
    };
  }, [dataset, beforeId, afterId]);

  if (option === null) {
    return <p className="empty-state" role="status">No valid backscatter observations are available. Available acquisitions with zero valid pixels still appear in the coverage strip.</p>;
  }

  return <>
    <div className="chart-legend">
      <span><i className="legend-line" style={{ background: TEAL }} />Spatial median</span>
      <span><i className="legend-band" style={{ background: '#cdecee' }} />Spatial interquartile range</span>
    </div>
    <EChart option={option} label="Synthetic backscatter through time. Teal points show the spatial median; the shaded band is the spatial interquartile range, not confidence. Day 37 is missing and is shown as a gap. Exact values are available in the data table." className="time-chart" testId="time-chart" />
    <p className="chart-caption">γ⁰ backscatter in decibels · Shading shows spatial spread, not measurement confidence.</p>
  </>;
}

/** Display the shared paired-pixel counts with fixed bins, so date comparisons keep the same scale. */
export function Histogram({ pair, edges }: { pair: PairAnalysis; edges: number[] }) {
  const option = useMemo<EChartsCoreOption>(() => ({
    animation: false,
    textStyle: { fontFamily: FONT, color: INK },
    grid: { left: 55, right: 18, top: 20, bottom: 48 },
    xAxis: {
      type: 'value', min: edges[0], max: edges[edges.length - 1], interval: 2,
      name: 'Δ backscatter (dB)', nameLocation: 'middle', nameGap: 30,
      nameTextStyle: { fontSize: 12, color: MUTED },
      axisLabel: { fontSize: 12, color: MUTED }, axisLine: { lineStyle: { color: '#8996a7' } },
      splitLine: { lineStyle: { color: GRID } },
    },
    yAxis: {
      type: 'value', min: 0, minInterval: 1,
      name: 'Pixels', nameGap: 12, nameTextStyle: { fontSize: 12, color: MUTED },
      axisLabel: { fontSize: 12, color: MUTED }, splitLine: { lineStyle: { color: GRID } },
    },
    series: [{
      type: 'bar', barWidth: '96%',
      data: pair.bins.map((bin) => ({
        value: [(bin.start + bin.end) / 2, bin.count],
        itemStyle: { color: bin.end <= 0 ? BLUE : ORANGE },
      })),
      markLine: { symbol: ['none', 'none'], silent: true, label: { show: false }, lineStyle: { color: '#607086', type: 'dashed' }, data: [{ xAxis: 0 }] },
    }],
  }), [pair, edges]);

  return <>
    <div className="chart-legend">
      <span><i className="legend-swatch" style={{ background: BLUE }} />Backscatter decrease</span>
      <span><i className="legend-swatch" style={{ background: ORANGE }} />Backscatter increase or zero</span>
    </div>
    {pair.validCount === 0
      ? <p className="empty-state" role="status">No overlapping valid pixels for this comparison.</p>
      : <EChart option={option} label={`Synthetic paired-pixel change distribution. ${pair.validCount} valid paired pixels. Differences are after minus before, in decibels. Blue indicates backscatter decrease. Orange bins contain nonnegative backscatter differences, including exact zeros.`} className="histogram-chart" testId="change-histogram" />}
  </>;
}

/** Distinguish missing acquisitions from available acquisitions with zero valid pixels in the fixed ROI. */
export function Coverage({ dataset, beforeId, afterId }: TimelineProps) {
  const element = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    if (!element.current) return;
    const observer = new ResizeObserver((entries) => setWidth(Math.max(280, entries[0].contentRect.width)));
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  const roiCount = dataset.grid.roiMask.filter(Boolean).length;
  const firstDay = dataset.acquisitions[0].day;
  const lastDay = dataset.acquisitions[dataset.acquisitions.length - 1].day;
  const x = (day: number) => 43 + ((day - firstDay) / (lastDay - firstDay)) * (width - 62);
  const y = (fraction: number) => 78 - fraction * 48;
  return <div ref={element} className="coverage-chart">
    <svg viewBox={`0 0 ${width} 115`} width="100%" role="img" aria-label="Acquisition coverage: the valid pixel fraction of the fixed analysis area. Day 37 is missing, distinct from zero backscatter change." data-testid="coverage-strip">
      {[0, 0.5, 1].map((fraction) => <g key={fraction}>
        <line x1="43" x2={width - 19} y1={y(fraction)} y2={y(fraction)} stroke={GRID} />
        <text x="32" y={y(fraction) + 4} textAnchor="end" fill={MUTED} fontSize="11">{fraction.toFixed(1)}</text>
      </g>)}
      {dataset.acquisitions.map((item) => {
        const fraction = item.availability === 'missing' ? null : (item.summary?.validCount ?? 0) / roiCount;
        const selected = item.id === beforeId || item.id === afterId;
        return <g key={item.id} data-availability={item.availability}>
          {selected ? <line x1={x(item.day)} x2={x(item.day)} y1="18" y2="78" stroke={BLUE} strokeDasharray="3 4" /> : null}
          {selected ? <circle cx={x(item.day)} cy={y(fraction ?? 0)} r="8" fill="white" stroke={BLUE} strokeWidth="1.5" /> : null}
          <circle cx={x(item.day)} cy={y(fraction ?? 0)} r="4.5" fill={fraction === null ? 'white' : TEAL} stroke={fraction === null ? MUTED : '#0c6774'} strokeDasharray={fraction === null ? '3 2' : undefined}>
            <title>{`Day ${item.day}: ${fraction === null ? 'missing acquisition' : `${(fraction * 100).toFixed(1)}% valid pixels`}`}</title>
          </circle>
          <text x={x(item.day)} y="99" textAnchor="middle" fill={MUTED} fontSize="11">{item.day}</text>
        </g>;
      })}
    </svg>
    <p className="chart-caption">Valid pixel fraction · Synthetic day · Hollow mark: missing acquisition</p>
  </div>;
}

/** Map a normalized scalar into a bounded RGB ramp; this encodes backscatter, not water classes. */
function interpolate(from: number[], to: number[], fraction: number): string {
  const t = Math.max(0, Math.min(1, fraction));
  return `rgb(${from.map((value, index) => Math.round(value + (to[index] - value) * t)).join(',')})`;
}

/** Render the row-major schematic grid, preserving invalid cells and shared before/after color limits. */
export function SpatialGrid({ dataset, before, after, pair, view }: {
  dataset: StudyDataset;
  before: Acquisition;
  after: Acquisition;
  pair: PairAnalysis;
  view: SpatialView;
}) {
  const hatchId = useId().replace(/:/g, '');
  const domain = useMemo(() => {
    const [minimum, maximum] = findExtent(dataset.acquisitions.map((item) => item.valuesDb), [-18, -6]);
    return [Math.floor(minimum), Math.ceil(maximum)];
  }, [dataset]);
  const changeMax = Math.max(Math.abs(dataset.histogramEdgesDb[0]), Math.abs(dataset.histogramEdgesDb.at(-1) ?? 6));
  const values = view === 'change' ? pair.valuesDb : view === 'before' ? before.valuesDb : after.valuesDb;
  const color = (value: number) => view === 'change'
    ? value < 0 ? interpolate([247, 249, 251], [47, 129, 232], -value / changeMax) : interpolate([247, 249, 251], [233, 139, 70], value / changeMax)
    : interpolate([241, 247, 248], [13, 112, 127], (value - domain[0]) / (domain[1] - domain[0] || 1));
  const minimum = view === 'change' ? -changeMax : domain[0];
  const maximum = view === 'change' ? changeMax : domain[1];
  return <div className="spatial-chart" data-testid="spatial-grid" data-view={view} data-before-id={before.id} data-after-id={after.id} data-paired-count={pair.validCount}>
    <svg viewBox={`0 0 ${dataset.grid.width * 20} ${dataset.grid.height * 20}`} width="100%" role="img" aria-label={`Schematic synthetic grid. ${view === 'change' ? `Day ${after.day} minus day ${before.day}` : `Day ${view === 'before' ? before.day : after.day}`} backscatter. Hatched cells are invalid; this is not a georeferenced Louisiana map.`}>
      <defs><pattern id={hatchId} patternUnits="userSpaceOnUse" width="6" height="6"><rect width="6" height="6" fill="#f1f4f7" /><path d="M-1 1L1-1 M0 6L6 0 M5 7L7 5" stroke="#9da9b8" strokeWidth="1" /></pattern></defs>
      {Array.from({ length: dataset.grid.width * dataset.grid.height }, (_, index) => {
        const value = dataset.grid.roiMask[index] ? values?.[index] ?? null : null;
        return <rect key={index} x={(index % dataset.grid.width) * 20} y={Math.floor(index / dataset.grid.width) * 20} width="20" height="20" stroke="#bdcbd7" strokeWidth="0.5" fill={value === null ? `url(#${hatchId})` : color(value)} data-cell={index} data-value={value ?? 'missing'} />;
      })}
    </svg>
    <div className="color-key" aria-label={`${view === 'change' ? 'Change' : 'Backscatter'} scale from ${minimum} to ${maximum} decibels`}>
      <p>{view === 'change' ? 'Δ backscatter (dB)' : 'γ⁰ backscatter (dB)'}</p>
      <div className={`color-key-ramp ${view === 'change' ? 'change-ramp' : 'backscatter-ramp'}`} style={{ height: 12, background: view === 'change' ? `linear-gradient(90deg, ${BLUE}, #f7f9fb, ${ORANGE})` : 'linear-gradient(90deg, #f1f7f8, #0d707f)' }} />
      <div className="color-key-labels" style={{ display: 'flex', justifyContent: 'space-between' }}><span>{minimum}</span><span>{view === 'change' ? '0' : ''}</span><span>{maximum > 0 ? '+' : ''}{maximum}</span></div>
    </div>
    <p className="chart-caption">Schematic grid ({dataset.grid.width} × {dataset.grid.height} pixels) · Hatched: invalid / no data</p>
  </div>;
}
