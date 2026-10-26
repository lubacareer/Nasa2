import type { Acquisition, StudyDataset } from '../../../contracts/dataset';
import type { PairAnalysis } from '../analysis';

const number = (value: number | null | undefined) =>
  value == null ? 'No data' : value.toFixed(2);

/** Expose prepared summaries, plotted bin counts, and paired cells without plot hover. */
export function DataTable({
  dataset,
  before,
  after,
  pair,
}: {
  dataset: StudyDataset;
  before: Acquisition;
  after: Acquisition;
  pair: PairAnalysis;
}) {
  return (
    <>
      <p className="section-note">
        Synthetic preview — no satellite measurements. Values are γ⁰ backscatter
        in dB.
      </p>
      <div
        className="table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Acquisition summary table"
      >
        <table>
          <caption>
            Acquisition summaries · spatial spread within the fixed study mask
          </caption>
          <thead>
            <tr>
              <th scope="col">Synthetic day</th>
              <th scope="col">Status</th>
              <th scope="col">Median (dB)</th>
              <th scope="col">25th percentile</th>
              <th scope="col">75th percentile</th>
              <th scope="col">Valid pixels</th>
            </tr>
          </thead>
          <tbody>
            {dataset.acquisitions.map((a) => (
              <tr
                key={a.id}
                className={
                  a.id === before.id || a.id === after.id
                    ? 'selected-row'
                    : undefined
                }
              >
                <th scope="row">Day {a.day}</th>
                <td>{a.availability}</td>
                <td>{number(a.summary?.medianDb)}</td>
                <td>{number(a.summary?.q25Db)}</td>
                <td>{number(a.summary?.q75Db)}</td>
                <td>
                  {a.availability === 'missing'
                    ? 'No data'
                    : (a.summary?.validCount ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div
        className="table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Histogram bin counts table"
      >
        <table>
          <caption>
            Histogram bin counts · Day {after.day} minus Day {before.day}. Every
            bin includes its lower edge; only the final bin includes its upper
            edge.
          </caption>
          <thead>
            <tr>
              <th scope="col">Lower edge (dB)</th>
              <th scope="col">Upper edge (dB)</th>
              <th scope="col">Upper edge</th>
              <th scope="col">Paired pixels</th>
            </tr>
          </thead>
          <tbody>
            {pair.bins.map((bin, index) => (
              <tr key={bin.start}>
                <th scope="row">{String(bin.start)}</th>
                <td>{String(bin.end)}</td>
                <td>
                  {index === pair.bins.length - 1 ? 'included' : 'excluded'}
                </td>
                <td>{bin.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="cell-table">
        <summary>
          Paired cell values · Day {after.day} minus Day {before.day}
        </summary>
        <div
          className="table-scroll cell-scroll"
          tabIndex={0}
          role="region"
          aria-label="Paired cell values table"
        >
          <table>
            <caption>
              Schematic row-major grid. Rows and columns start at 1; missing
              cells stay missing.
            </caption>
            <thead>
              <tr>
                <th scope="col">Row</th>
                <th scope="col">Column</th>
                <th scope="col">Before (dB)</th>
                <th scope="col">After (dB)</th>
                <th scope="col">Change (dB)</th>
              </tr>
            </thead>
            <tbody>
              {pair.valuesDb.map((value, i) => (
                <tr key={i}>
                  <th scope="row">{Math.floor(i / dataset.grid.width) + 1}</th>
                  <td>{(i % dataset.grid.width) + 1}</td>
                  <td>{number(before.valuesDb?.[i])}</td>
                  <td>{number(after.valuesDb?.[i])}</td>
                  <td>{number(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
