/**
 * Export module for WP 4.
 * Single entry point: buildExport(name, ctx)
 */

export type {
  ExportName,
  BuildExportContext,
  BuildExportResult,
  ExportStats,
} from './types';

export { buildExport } from './buildExport';
export { computeExportStats } from './stats';
export { exportLines } from './exportLines';
export { exportRows } from './exportRows';
export { exportAllDecisions } from './exportAllDecisions';
export { exportPairsJsonl } from './exportPairs';
