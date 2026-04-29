import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  backupLatestIndex,
  restoreLatestIndexBackup,
  type LbugProbe,
} from '../../src/core/lbug/index-backup.js';

async function makeRepoStorage(): Promise<{ dir: string; lbugPath: string; metaPath: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitnexus-index-backup-'));
  return {
    dir,
    lbugPath: path.join(dir, 'lbug'),
    metaPath: path.join(dir, 'meta.json'),
  };
}

const okProbe: LbugProbe = async () => ({ ok: true });

describe('index backup', () => {
  it('keeps only one latest backup after repeated backup creation', async () => {
    const { dir, lbugPath, metaPath } = await makeRepoStorage();
    await fs.writeFile(lbugPath, 'first-live');
    await fs.writeFile(metaPath, JSON.stringify({ lastCommit: 'one' }));

    await backupLatestIndex({ lbugPath, metaPath, repoPath: dir, probe: okProbe });

    await fs.writeFile(lbugPath, 'second-live');
    await fs.writeFile(metaPath, JSON.stringify({ lastCommit: 'two' }));
    await backupLatestIndex({ lbugPath, metaPath, repoPath: dir, probe: okProbe });

    const backupsDir = path.join(dir, 'backups');
    const entries = await fs.readdir(backupsDir);
    expect(entries).toEqual(['latest']);
    await expect(fs.readFile(path.join(backupsDir, 'latest', 'lbug'), 'utf-8')).resolves.toBe(
      'second-live',
    );
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('does not overwrite latest when current live is invalid', async () => {
    const { dir, lbugPath, metaPath } = await makeRepoStorage();
    await fs.writeFile(lbugPath, 'good-live');
    await fs.writeFile(metaPath, JSON.stringify({ lastCommit: 'good' }));
    await backupLatestIndex({ lbugPath, metaPath, repoPath: dir, probe: okProbe });

    await fs.writeFile(lbugPath, 'bad-live');
    const result = await backupLatestIndex({
      lbugPath,
      metaPath,
      repoPath: dir,
      probe: async (dbPath) =>
        dbPath === lbugPath ? { ok: false, error: 'not a valid Lbug database file' } : { ok: true },
    });

    expect(result.status).toBe('skipped-invalid-live');
    await expect(fs.readFile(path.join(dir, 'backups', 'latest', 'lbug'), 'utf-8')).resolves.toBe(
      'good-live',
    );
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('restores live lbug and meta from latest backup', async () => {
    const { dir, lbugPath, metaPath } = await makeRepoStorage();
    await fs.writeFile(lbugPath, 'good-live');
    await fs.writeFile(metaPath, JSON.stringify({ lastCommit: 'good' }));
    await backupLatestIndex({ lbugPath, metaPath, repoPath: dir, probe: okProbe });

    await fs.writeFile(lbugPath, 'corrupt-live');
    await fs.writeFile(metaPath, JSON.stringify({ lastCommit: 'bad' }));
    const restore = await restoreLatestIndexBackup({ lbugPath, metaPath, probe: okProbe });

    expect(restore.restored).toBe(true);
    await expect(fs.readFile(lbugPath, 'utf-8')).resolves.toBe('good-live');
    await expect(fs.readFile(metaPath, 'utf-8')).resolves.toBe(
      JSON.stringify({ lastCommit: 'good' }),
    );
    await fs.rm(dir, { recursive: true, force: true });
  });
});
