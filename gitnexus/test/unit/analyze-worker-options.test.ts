import { describe, expect, it } from 'vitest';
import {
  buildAnalyzeWorkerExecArgv,
  getAnalyzeWorkerHeapMb,
} from '../../src/server/analyze-worker-options.js';

describe('analyze worker options', () => {
  it('uses 8192 MB by default', () => {
    expect(getAnalyzeWorkerHeapMb(undefined)).toBe(8192);
    expect(buildAnalyzeWorkerExecArgv([])).toEqual(['--max-old-space-size=8192']);
  });

  it('uses the configured worker heap size', () => {
    expect(getAnalyzeWorkerHeapMb('16384')).toBe(16384);
    expect(buildAnalyzeWorkerExecArgv(['--import', 'tsx'], '16384')).toEqual([
      '--import',
      'tsx',
      '--max-old-space-size=16384',
    ]);
  });

  it('falls back when the configured heap size is invalid', () => {
    expect(getAnalyzeWorkerHeapMb('abc')).toBe(8192);
    expect(getAnalyzeWorkerHeapMb('-1')).toBe(8192);
  });
});
