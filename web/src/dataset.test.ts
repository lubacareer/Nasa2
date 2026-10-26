import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateDataset } from './dataset';

const fixture = JSON.parse(
  readFileSync(new URL('../public/data/preview.json', import.meta.url), 'utf8'),
);

describe('data package boundary', () => {
  it('accepts an available acquisition with zero valid coverage and no summary', () => {
    const data = structuredClone(fixture);
    data.acquisitions[0].valuesDb.fill(null);
    data.acquisitions[0].summary = null;
    expect(validateDataset(data).acquisitions[0].availability).toBe(
      'available',
    );
  });
  it('rejects an empty study mask', () => {
    const data = structuredClone(fixture);
    data.grid.roiMask.fill(false);
    expect(() => validateDataset(data)).toThrow(/study mask/i);
  });
  it('accepts the Python-prepared fixture', () => {
    expect(validateDataset(fixture).acquisitions).toHaveLength(9);
  });
  it('rejects unsupported versions before other validation', () => {
    expect(() => validateDataset({ schemaVersion: 2 })).toThrow(
      /unsupported.*version/i,
    );
  });
  it('rejects malformed shapes', () => {
    expect(() => validateDataset({ schemaVersion: 1 })).toThrow(
      /invalid data package/i,
    );
  });
  it('rejects grid sizes inconsistent with dimensions', () => {
    const data = structuredClone(fixture);
    data.grid.width = 21;
    expect(() => validateDataset(data)).toThrow(/grid mask size/i);
  });
  it('rejects unsorted days', () => {
    const data = structuredClone(fixture);
    data.acquisitions[1].day = data.acquisitions[0].day;
    expect(() => validateDataset(data)).toThrow(/ordered/i);
  });
  it('rejects a summary count inconsistent with its valid cells', () => {
    const data = structuredClone(fixture);
    data.acquisitions[0].summary.validCount--;
    expect(() => validateDataset(data)).toThrow(/summary/i);
  });
  it('rejects bins that omit possible changes', () => {
    const data = structuredClone(fixture);
    data.histogramEdgesDb = [-0.01, 0, 0.01];
    expect(() => validateDataset(data)).toThrow(/cover all paired/i);
  });
});
