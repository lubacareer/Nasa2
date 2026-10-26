export interface AcquisitionSummary {
  medianDb: number;
  q25Db: number;
  q75Db: number;
  validCount: number;
}

export interface Acquisition {
  id: string;
  day: number;
  availability: 'available' | 'missing';
  valuesDb: (number | null)[] | null;
  summary: AcquisitionSummary | null;
}

export interface StudyDataset {
  schemaVersion: 1;
  id: string;
  title: string;
  provenance: {
    kind: 'synthetic';
    description: string;
    generatorVersion: string;
    seed: number;
    productIds: string[];
  };
  units: 'gamma0_db';
  polarization: 'HH';
  grid: {
    width: number;
    height: number;
    order: 'row-major';
    coordinateSystem: 'synthetic';
    roiMask: boolean[];
  };
  histogramEdgesDb: number[];
  acquisitions: Acquisition[];
}
