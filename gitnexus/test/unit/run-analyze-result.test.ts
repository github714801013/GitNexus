import { describe, expect, it, vi } from 'vitest';

const fakePipelineResult = {
  graph: { marker: 'large-graph' },
  repoPath: '/repo',
  totalFileCount: 2,
  communityResult: { stats: { totalCommunities: 1 }, communities: [] },
  processResult: { stats: { totalProcesses: 1 } },
};

vi.mock('../../src/core/ingestion/pipeline.js', () => ({
  runPipelineFromRepo: vi.fn(async () => fakePipelineResult),
}));

vi.mock('../../src/core/lbug/lbug-adapter.js', () => ({
  initLbug: vi.fn(async () => {}),
  loadGraphToLbug: vi.fn(async () => {}),
  getLbugStats: vi.fn(async () => ({ nodes: 3, edges: 4 })),
  executeQuery: vi.fn(async () => [{ cnt: 0 }]),
  executeWithReusedStatement: vi.fn(async () => {}),
  ensureFTSIndex: vi.fn(async () => {}),
  closeLbug: vi.fn(async () => {}),
  loadCachedEmbeddings: vi.fn(async () => ({ embeddingNodeIds: new Set(), embeddings: [] })),
  fetchExistingEmbeddingHashes: vi.fn(async () => new Map()),
}));

vi.mock('../../src/storage/repo-manager.js', () => ({
  getStoragePaths: vi.fn(() => ({
    storagePath: '/tmp/gitnexus-test-index',
    lbugPath: '/tmp/gitnexus-test-index/index.lbug',
  })),
  saveMeta: vi.fn(async () => {}),
  loadMeta: vi.fn(async () => null),
  addToGitignore: vi.fn(async () => {}),
  registerRepo: vi.fn(async () => 'repo'),
  cleanupOldKuzuFiles: vi.fn(async () => ({ found: false, needsReindex: false })),
}));

vi.mock('../../src/storage/git.js', () => ({
  getCurrentCommit: vi.fn(() => 'abc123'),
  getCurrentBranch: vi.fn(() => 'main'),
  getRemoteUrl: vi.fn(() => 'https://example.invalid/repo.git'),
  hasGitDir: vi.fn(() => true),
  getInferredRepoName: vi.fn(() => 'repo'),
}));

vi.mock('../../src/cli/ai-context.js', () => ({
  generateAIContextFiles: vi.fn(async () => {}),
}));

vi.mock('../../src/core/lbug/index-backup.js', () => ({
  backupLatestIndex: vi.fn(async () => ({ status: 'skipped-invalid-live' })),
  prepareEmbeddingShadowIndex: vi.fn(async () => {}),
  probeLbugFile: vi.fn(async () => ({ ok: true })),
  swapEmbeddingShadowToLive: vi.fn(async () => {}),
}));

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<any>('fs/promises');
  return {
    ...actual,
    rm: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    stat: vi.fn(async () => ({ isFile: () => true })),
  };
});

describe('runFullAnalysis result shape', () => {
  it('omits pipelineResult by default', async () => {
    const { runFullAnalysis } = await import('../../src/core/run-analyze.js');

    const result = await runFullAnalysis(
      '/repo',
      { force: true, embeddings: false },
      {
        onProgress: vi.fn(),
        onLog: vi.fn(),
      },
    );

    expect(result.pipelineResult).toBeUndefined();
    expect(result.stats).toEqual({
      files: 2,
      nodes: 3,
      edges: 4,
      communities: 1,
      processes: 1,
      embeddings: 0,
    });
  });

  it('returns pipelineResult only when explicitly requested', async () => {
    const { runFullAnalysis } = await import('../../src/core/run-analyze.js');

    const result = await runFullAnalysis(
      '/repo',
      {
        force: true,
        embeddings: false,
        returnPipelineResult: true,
      },
      {
        onProgress: vi.fn(),
        onLog: vi.fn(),
      },
    );

    expect(result.pipelineResult).toBe(fakePipelineResult);
  });
});
