import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { RepoMeta } from '../storage/repo-manager.js';

export class WebhookWorktreeError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = 'WebhookWorktreeError';
  }
}

export const parseAllowedEnvs = (raw: string | undefined): string[] => {
  const values = new Set(
    (raw ?? '')
      .split(',')
      .map((env) => env.trim().toLowerCase())
      .filter(Boolean),
  );
  return [...values];
};

export const assertEnvAllowed = (env: string, allowedEnvs: string[]): void => {
  assertSafeSegment(env, 'env');
  if (!allowedEnvs.includes(env.toLowerCase())) {
    throw new WebhookWorktreeError(`Environment "${env}" is not allowed`, 403);
  }
};

export const assertSafeSegment = (value: string, fieldName: string): void => {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new WebhookWorktreeError(`Invalid "${fieldName}"`);
  }
  if (value === '.' || value === '..') {
    throw new WebhookWorktreeError(`Invalid "${fieldName}"`);
  }
};

export const buildRegistryName = (env: string, projectName: string): string => {
  assertSafeSegment(env, 'env');
  assertSafeSegment(projectName, 'projectName');
  return `${env.toLowerCase()}-${projectName}`;
};

export const getManagedWorktreePath = (env: string, projectName: string): string => {
  return path.join(os.homedir(), '.gitnexus', 'worktrees', buildRegistryName(env, projectName));
};

const pathExists = async (targetPath: string): Promise<boolean> =>
  fs.access(targetPath).then(
    () => true,
    () => false,
  );

const runGit = (args: string[], cwd: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const proc = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: process.platform === 'win32' ? 'echo' : '/bin/true',
      },
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new WebhookWorktreeError(`git ${args[0]} failed: ${stderr.trim()}`, 500));
      }
    });
    proc.on('error', (err) => {
      reject(new WebhookWorktreeError(`Failed to spawn git: ${err.message}`, 500));
    });
  });

export interface EnsureWorktreeParams {
  mainRepoPath: string;
  worktreePath: string;
  branch: string;
  baseRef?: string;
}

export interface EnsureWorktreeResult {
  worktreePath: string;
  branch: string;
  commit: string;
}

export const ensureLocalWorktree = async (
  params: EnsureWorktreeParams,
): Promise<EnsureWorktreeResult> => {
  assertSafeSegment(params.branch, 'branch');
  if (params.baseRef) assertSafeSegment(params.baseRef, 'baseRef');

  if (await pathExists(params.worktreePath)) {
    const gitDir = await runGit(['rev-parse', '--show-toplevel'], params.worktreePath);
    if (path.resolve(gitDir) !== path.resolve(params.worktreePath)) {
      throw new WebhookWorktreeError('Managed worktree path points at a different repository', 409);
    }
  } else {
    await fs.mkdir(path.dirname(params.worktreePath), { recursive: true });
    const hasBranch = await runGit(['branch', '--list', params.branch], params.mainRepoPath);
    const args = hasBranch
      ? ['worktree', 'add', params.worktreePath, params.branch]
      : ['worktree', 'add', '-b', params.branch, params.worktreePath, params.baseRef ?? 'main'];
    await runGit(args, params.mainRepoPath);
  }

  const currentBranch = await runGit(['branch', '--show-current'], params.worktreePath);
  if (currentBranch !== params.branch) {
    throw new WebhookWorktreeError('Managed worktree path uses a different branch', 409);
  }
  const commit = await runGit(['rev-parse', 'HEAD'], params.worktreePath);
  return { worktreePath: params.worktreePath, branch: currentBranch, commit };
};

export interface CopyBootstrapIndexParams {
  sourceRepoPath: string;
  worktreePath: string;
  branch: string;
  commit: string;
  registryName: string;
  register: (
    repoPath: string,
    meta: RepoMeta,
    opts?: { name?: string; allowDuplicateName?: boolean },
  ) => Promise<string>;
}

export const copyBootstrapIndex = async (params: CopyBootstrapIndexParams): Promise<boolean> => {
  const sourceIndex = path.join(params.sourceRepoPath, '.gitnexus');
  const sourceMetaPath = path.join(sourceIndex, 'meta.json');
  const sourceLbugPath = path.join(sourceIndex, 'lbug');
  if (!(await pathExists(sourceMetaPath)) || !(await pathExists(sourceLbugPath))) {
    return false;
  }

  const targetIndex = path.join(params.worktreePath, '.gitnexus');
  await fs.rm(targetIndex, { recursive: true, force: true });
  await fs.cp(sourceIndex, targetIndex, { recursive: true });

  const meta = JSON.parse(
    await fs.readFile(path.join(targetIndex, 'meta.json'), 'utf-8'),
  ) as RepoMeta;
  const updatedMeta: RepoMeta = {
    ...meta,
    repoPath: params.worktreePath,
    branch: params.branch,
    lastCommit: params.commit,
    indexedAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(targetIndex, 'meta.json'), JSON.stringify(updatedMeta, null, 2));
  await params.register(params.worktreePath, updatedMeta, { name: params.registryName });
  return true;
};
