import { describe, expect, it } from 'vitest';
import type { StudyDataset } from '../../contracts/dataset';
import { availableAcquisitions, defaultViewState, parseViewState, serializeViewState } from './viewState';

const dataset = {
  acquisitions: [
    { id: 'day-1', day: 1, availability: 'available', valuesDb: [0] },
    { id: 'day-25', day: 25, availability: 'available', valuesDb: [0] },
    { id: 'day-37', day: 37, availability: 'missing', valuesDb: null },
    { id: 'day-61', day: 61, availability: 'available', valuesDb: [0] },
    { id: 'day-97', day: 97, availability: 'available', valuesDb: [0] },
  ],
} as StudyDataset;

describe('analysis URL state', () => {
  it('defaults to day 25 / day 61 and excludes the missing acquisition', () => {
    expect(defaultViewState(dataset)).toEqual({ beforeId: 'day-25', afterId: 'day-61', view: 'change' });
    expect(availableAcquisitions(dataset).map((item) => item.day)).not.toContain(37);
  });

  it('round trips all selected values and preserves unrelated query parameters', () => {
    const state = { beforeId: 'day-1', afterId: 'day-97', view: 'before' as const };
    const query = serializeViewState(state, '?source=link');
    expect(parseViewState(query, dataset)).toEqual(state);
    expect(new URLSearchParams(query).get('source')).toBe('link');
  });

  it.each([
    '?before=day-37&after=day-61',
    '?before=day-97&after=day-1',
    '?before=day-25&after=day-25',
    '?before=unknown&after=day-61',
  ])('uses the default pair for invalid selections: %s', (query) => {
    expect(parseViewState(query, dataset)).toEqual(defaultViewState(dataset));
  });

  it('falls back to change for an unsupported spatial view', () => {
    expect(parseViewState('?before=day-1&after=day-97&view=globe', dataset).view).toBe('change');
  });
});
