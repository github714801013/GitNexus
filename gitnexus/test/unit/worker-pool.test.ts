import { describe, expect, it, vi } from 'vitest';
import { createWorkerPool } from '../../src/core/ingestion/workers/worker-pool.js';

describe('WorkerPool streaming dispatch', () => {
  it('streams worker results through onResult without retaining aggregate results', async () => {
    const streamed: Array<{ workerIndex: number; result: string[] }> = [];
    const pool = createWorkerPool(new URL('./fixtures/echo-worker.js', import.meta.url), 1);

    try {
      const retained = await pool.dispatch<string, string[]>(
        ['a', 'b'],
        vi.fn(),
        (result, workerIndex) => streamed.push({ workerIndex, result }),
      );

      expect(streamed).toEqual([{ workerIndex: 0, result: ['a', 'b'] }]);
      expect(retained).toEqual([]);
    } finally {
      await pool.terminate();
    }
  });

  it('rejects when onResult throws', async () => {
    const pool = createWorkerPool(new URL('./fixtures/echo-worker.js', import.meta.url), 1);

    try {
      await expect(
        pool.dispatch<string, string[]>(['a'], vi.fn(), () => {
          throw new Error('merge failed');
        }),
      ).rejects.toThrow('merge failed');
    } finally {
      await pool.terminate();
    }
  });
});
