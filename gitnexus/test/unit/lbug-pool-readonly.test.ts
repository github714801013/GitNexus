import { describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const dbConstructors: any[][] = [];

vi.mock('@ladybugdb/core', () => {
  class Database {
    constructor(...args: any[]) {
      dbConstructors.push(args);
    }

    close = vi.fn().mockResolvedValue(undefined);
  }

  class Connection {
    query = vi.fn().mockResolvedValue({
      getAll: vi.fn().mockResolvedValue([]),
    });
    close = vi.fn().mockResolvedValue(undefined);

    constructor(_db: Database) {}
  }

  return { default: { Database, Connection } };
});

describe('pool-adapter live database open mode', () => {
  it('opens repository databases read-only for query pools', async () => {
    vi.resetModules();
    dbConstructors.length = 0;

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitnexus-lbug-pool-'));
    const dbPath = path.join(tmpDir, 'lbug');
    await fs.writeFile(dbPath, '');
    const adapter = await import('../../src/core/lbug/pool-adapter.js');

    try {
      await adapter.initLbug('readonly-repo', dbPath);

      expect(dbConstructors[0]).toEqual([dbPath, 0, false, true]);
    } finally {
      await adapter.closeLbug('readonly-repo');
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
