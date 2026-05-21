import { mkdtemp, mkdir, readFile, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  WebhookWorktreeError,
  assertEnvAllowed,
  assertSafeGitRef,
  assertSafeSegment,
  buildRegistryName,
  copyBootstrapIndex,
  getGiteaWebhookRepoPath,
  getLegacyManagedWorktreePath,
  getManagedWorktreePath,
  parseGiteaWebhookRepo,
  parseAllowedEnvs,
  upsertWebhookRepoConfig,
} from '../../src/server/webhook-worktree.js';

describe('webhook worktree helpers', () => {
  it('parses allowed envs and rejects envs outside the allow list', () => {
    const allowed = parseAllowedEnvs('dev, saas,,DEV');

    expect(allowed).toEqual(['dev', 'saas']);
    expect(() => assertEnvAllowed('dev', allowed)).not.toThrow();
    expect(() => assertEnvAllowed('prod', allowed)).toThrow(WebhookWorktreeError);
  });

  it('rejects unsafe path segments before they reach git commands', () => {
    expect(() => assertSafeSegment('feature-dev', 'branch')).not.toThrow();
    expect(() => assertSafeGitRef('origin/feature-dev', 'baseRef')).not.toThrow();
    expect(() => assertSafeSegment('../main', 'branch')).toThrow(WebhookWorktreeError);
    expect(() => assertSafeGitRef('../main', 'baseRef')).toThrow(WebhookWorktreeError);
    expect(() => assertSafeSegment('dev/api', 'projectName')).toThrow(WebhookWorktreeError);
    expect(() => assertSafeSegment('', 'projectName')).toThrow(WebhookWorktreeError);
  });

  it('parses legacy Gitea webhook payloads and maps them under the projects root', () => {
    const repo = parseGiteaWebhookRepo({
      repository: {
        full_name: 'oa-java/oa-order',
        clone_url: 'https://code.9ji.com/oa-java/oa-order.git',
      },
      ref: 'refs/heads/dev',
    });

    expect(repo).toEqual({
      fullName: 'oa-java/oa-order',
      cloneUrl: 'https://code.9ji.com/oa-java/oa-order.git',
      branch: 'dev',
    });
    expect(getGiteaWebhookRepoPath('/projects', repo.fullName)).toBe(
      path.join('/projects', 'oa-java', 'oa-order'),
    );
    expect(() => getGiteaWebhookRepoPath('/projects', '../oa-order')).toThrow(WebhookWorktreeError);
  });

  it('upserts legacy webhook repo config without dropping existing entries', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'gitnexus-webhook-config-test-'));
    const reposFile = path.join(tempRoot, 'repos.json');
    await writeFile(
      reposFile,
      JSON.stringify([{ full_name: 'oa-java/oa-order', clone_url: 'old', branch: 'master' }]),
    );

    await upsertWebhookRepoConfig(reposFile, {
      full_name: 'oa-java/oa-order',
      clone_url: 'https://code.9ji.com/oa-java/oa-order.git',
      branch: 'dev',
    });
    await upsertWebhookRepoConfig(reposFile, {
      full_name: 'Front-end/jiuji-m',
      clone_url: 'https://code.9ji.com/Front-end/jiuji-m.git',
    });

    const repos = JSON.parse(await readFile(reposFile, 'utf-8'));
    expect(repos).toEqual([
      {
        full_name: 'oa-java/oa-order',
        clone_url: 'https://code.9ji.com/oa-java/oa-order.git',
        branch: 'dev',
      },
      {
        full_name: 'Front-end/jiuji-m',
        clone_url: 'https://code.9ji.com/Front-end/jiuji-m.git',
        branch: 'master',
      },
    ]);
  });

  it('builds env-prefixed registry names and managed worktree paths', () => {
    const registryName = buildRegistryName('dev', 'api');
    const worktreePath = getManagedWorktreePath(
      path.join('/projects', 'oa-java', 'api'),
      'dev',
      'api',
    );

    expect(registryName).toBe('dev-api');
    expect(worktreePath).toBe(path.join('/projects', 'oa-java', 'dev-api'));
    expect(getLegacyManagedWorktreePath('dev', 'api')).toBe(
      path.join(os.homedir(), '.gitnexus', 'worktrees', 'dev-api'),
    );
  });

  it('copies a main index and rewrites meta for the worktree registry entry', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'gitnexus-worktree-test-'));
    const mainRepo = path.join(tempRoot, 'main');
    const worktree = path.join(tempRoot, 'worktree');
    await mkdir(path.join(mainRepo, '.gitnexus', 'lbug'), { recursive: true });
    await mkdir(worktree, { recursive: true });
    await writeFile(
      path.join(mainRepo, '.gitnexus', 'meta.json'),
      JSON.stringify({
        repoPath: mainRepo,
        branch: 'main',
        lastCommit: 'main-sha',
        indexedAt: '2026-01-01T00:00:00.000Z',
        remoteUrl: 'https://example.com/org/api.git',
        stats: { files: 1 },
      }),
    );

    const copied = await copyBootstrapIndex({
      sourceRepoPath: mainRepo,
      worktreePath: worktree,
      branch: 'feature-local',
      commit: 'feature-sha',
      registryName: 'dev-api',
      register: async (repoPath, meta, opts) => {
        expect(repoPath).toBe(worktree);
        expect(meta.repoPath).toBe(worktree);
        expect(meta.branch).toBe('feature-local');
        expect(meta.lastCommit).toBe('feature-sha');
        expect(opts?.name).toBe('dev-api');
        return opts?.name ?? 'missing';
      },
    });

    const meta = JSON.parse(await readFile(path.join(worktree, '.gitnexus', 'meta.json'), 'utf-8'));
    expect(copied).toBe(true);
    expect(meta.repoPath).toBe(worktree);
    expect(meta.branch).toBe('feature-local');
    expect(meta.lastCommit).toBe('feature-sha');
  });
});
