import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalBackend } from '../../src/mcp/local/local-backend.js';
import * as zoektClient from '../../src/core/search/zoekt-client.js';
import { executeParameterized } from '../../src/core/lbug/pool-adapter.js';

// Mock dependencies
vi.mock('../../src/core/lbug/pool-adapter.js', () => ({
  initLbug: vi.fn(),
  executeQuery: vi.fn(),
  executeParameterized: vi.fn(),
  closeLbug: vi.fn(),
  isLbugReady: vi.fn(() => true),
  isWriteQuery: vi.fn(() => false),
}));

vi.mock('../../src/storage/repo-manager.js', () => ({
  listRegisteredRepos: vi.fn(async () => [
    {
      name: 'test-repo',
      path: '/path/to/repo',
      storagePath: '/path/to/storage',
      indexedAt: '2026-05-16',
      lastCommit: 'abc',
    },
  ]),
  cleanupOldKuzuFiles: vi.fn(async () => ({ found: false })),
  loadMeta: vi.fn(async () => ({ branch: 'main' })),
}));

// Mock ZoektClient using vi.spyOn to handle dynamic imports better
const mockSearch = vi.fn();
vi.spyOn(zoektClient, 'ZoektClient').mockImplementation(
  class {
    search = mockSearch;
    symbolSearch = vi.fn();
  } as any,
);

const mockLoadConfig = vi.spyOn(zoektClient, 'loadZoektConfig');

describe('LocalBackend.query with Zoekt integration', () => {
  let backend: LocalBackend;

  beforeEach(async () => {
    backend = new LocalBackend();
    // Force inject repo to bypass validate check in refreshRepos
    (backend as any).repos.set('test-repo', {
      id: 'test-repo',
      name: 'test-repo',
      repoPath: '/path/to/repo',
      storagePath: '/path/to/storage',
      lbugPath: '/path/to/storage/lbug',
      indexedAt: '2026-05-16',
      lastCommit: 'abc',
    });

    mockSearch.mockReset();
    mockLoadConfig.mockReset();
    vi.mocked(executeParameterized).mockClear();
    vi.mocked(executeParameterized).mockResolvedValue([]);

    // Default mocks for search helpers to avoid errors
    vi.spyOn(backend as any, 'bm25Search').mockResolvedValue({ results: [], ftsUsed: true });
    vi.spyOn(backend as any, 'semanticSearch').mockResolvedValue([]);
    // Bypass ensureInitialized
    vi.spyOn(backend as any, 'ensureInitialized').mockResolvedValue(undefined);
  });

  it('如果启用则调用 Zoekt search', async () => {
    mockLoadConfig.mockReturnValue({
      enabled: true,
      endpoints: ['http://localhost:6070'],
    });
    mockSearch.mockResolvedValue({
      matches: [
        {
          repository: 'test-repo',
          fileName: 'src/foo.ts',
          score: 1.0,
          lineMatches: [],
        },
      ],
      stats: { matchCount: 1, durationMs: 1 },
    });

    const result = await backend.callTool('query', { query: 'test', repo: 'test-repo' });

    expect(mockSearch).toHaveBeenCalled();
    expect(result.definitions).toContainEqual(
      expect.objectContaining({
        filePath: 'src/foo.ts',
        type: 'File',
      }),
    );
  });

  it('如果禁用则不调用 Zoekt search', async () => {
    mockLoadConfig.mockReturnValue({
      enabled: false,
      endpoints: [],
    });

    await backend.callTool('query', { query: 'test', repo: 'test-repo' });

    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('如果未提供 repo 且存在多个项目，则尝试通过 Zoekt 自动发现多个项目并合并结果', async () => {
    mockLoadConfig.mockReturnValue({
      enabled: true,
      endpoints: ['http://localhost:6070'],
    });

    // Mock search for discovery: returns two repos
    mockSearch.mockResolvedValueOnce({
      matches: [
        { repository: 'repo-1', fileName: 'src/a.ts', score: 10.0, lineMatches: [] },
        { repository: 'repo-2', fileName: 'src/b.ts', score: 9.0, lineMatches: [] },
      ],
      stats: { matchCount: 2, durationMs: 1 },
    });

    // Mock search calls for each repo's individual query
    mockSearch.mockResolvedValue({
      matches: [],
      stats: { matchCount: 0, durationMs: 1 },
    });

    // Add repos to backend
    (backend as any).repos.set('repo-1', { id: 'repo-1', name: 'repo-1', repoPath: '/p1' });
    (backend as any).repos.set('repo-2', { id: 'repo-2', name: 'repo-2', repoPath: '/p2' });

    // Spy on query to check what it returns for each repo
    const querySpy = vi.spyOn(backend as any, 'query');
    querySpy.mockImplementation(async (repo: any) => ({
      processes: [{ id: `proc-${repo.id}`, priority: 0.5, summary: `Process in ${repo.id}` }],
      process_symbols: [{ id: `sym-${repo.id}`, name: `Symbol in ${repo.id}` }],
      definitions: [{ name: `Def in ${repo.id}`, filePath: 'src/x.ts' }],
      timing: { wall: 10 },
    }));

    const result = await backend.callTool('query', { query: 'handleError' });

    // Should have called discovery search once
    expect(mockSearch.mock.calls[0][1]).not.toHaveProperty('repoFilter');

    // Should have called query for both repos
    expect(querySpy).toHaveBeenCalledTimes(2);

    // Results should be merged
    expect(result.processes).toHaveLength(2);
    expect(result.processes.map((p: any) => p.id)).toContain('proc-repo-1');
    expect(result.processes.map((p: any) => p.id)).toContain('proc-repo-2');

    expect(result.process_symbols).toHaveLength(2);
    expect(result.definitions).toHaveLength(2);
  });

  it('如果未提供 repo 且传入 zoekt，则使用 Zoekt 跨仓库发现并合并结果', async () => {
    mockLoadConfig.mockReturnValue({
      enabled: true,
      endpoints: ['http://localhost:6070'],
    });

    mockSearch.mockResolvedValueOnce({
      matches: [
        { repository: 'repo-1', fileName: 'src/a.ts', score: 10.0, lineMatches: [] },
        { repository: 'repo-2', fileName: 'src/b.ts', score: 9.0, lineMatches: [] },
      ],
      stats: { matchCount: 2, durationMs: 1 },
    });

    (backend as any).repos.set('repo-1', { id: 'repo-1', name: 'repo-1', repoPath: '/p1' });
    (backend as any).repos.set('repo-2', { id: 'repo-2', name: 'repo-2', repoPath: '/p2' });

    const querySpy = vi.spyOn(backend as any, 'query');
    querySpy.mockImplementation(async (repo: any) => ({
      processes: [{ id: `proc-${repo.id}`, priority: 0.5, summary: `Process in ${repo.id}` }],
      process_symbols: [],
      definitions: [],
      timing: { wall: 10 },
    }));

    const result = await backend.callTool('query', { zoekt: '"成为会员"' });

    expect(mockSearch).toHaveBeenCalledWith('"成为会员"', { maxDocDisplayCount: 20 });
    expect(querySpy).toHaveBeenCalledTimes(2);
    expect(result.processes.map((p: any) => p.id)).toEqual(['proc-repo-1', 'proc-repo-2']);
  });

  it('Zoekt 行命中应映射到覆盖该行的真实符号', async () => {
    mockLoadConfig.mockReturnValue({
      enabled: true,
      endpoints: ['http://localhost:6070'],
    });
    mockSearch.mockResolvedValue({
      matches: [
        {
          repository: 'test-repo',
          fileName: 'src/foo.ts',
          score: 10,
          lineMatches: [{ line: 'handleRequest()', lineNumber: 12, lineFragments: [] }],
        },
      ],
      stats: { matchCount: 1, durationMs: 1 },
    });
    vi.mocked(executeParameterized).mockImplementation(async (_repo: string, query: string) => {
      if (query.includes('$filePath0') && query.includes('$lineNumber0')) {
        return [
          {
            id: 'Function:src/foo.ts:handleRequest',
            name: 'handleRequest',
            type: 'Function',
            filePath: 'src/foo.ts',
            startLine: 10,
            endLine: 20,
          },
        ];
      }
      if (query.includes('STEP_IN_PROCESS')) {
        return [
          {
            pid: 'Process:HandleRequest',
            label: 'HandleRequest',
            heuristicLabel: 'HandleRequest',
            processType: 'intra_community',
            stepCount: 1,
            step: 1,
          },
        ];
      }
      return [];
    });

    const result = await backend.callTool('query', { query: 'handleRequest', repo: 'test-repo' });

    expect(result.process_symbols).toContainEqual(
      expect.objectContaining({
        id: 'Function:src/foo.ts:handleRequest',
        name: 'handleRequest',
        type: 'Function',
      }),
    );
    expect(result.definitions).not.toContainEqual(
      expect.objectContaining({ id: 'File:src/foo.ts' }),
    );
  });

  it('Zoekt 与向量同排名时按 source weight 优先排序', async () => {
    mockLoadConfig.mockReturnValue({
      enabled: true,
      endpoints: ['http://localhost:6070'],
    });
    mockSearch.mockResolvedValue({
      matches: [
        {
          repository: 'test-repo',
          fileName: 'src/zoekt.ts',
          score: 10,
          lineMatches: [{ line: 'exactSymbol()', lineNumber: 4, lineFragments: [] }],
        },
      ],
      stats: { matchCount: 1, durationMs: 1 },
    });
    vi.spyOn(backend as any, 'semanticSearch').mockResolvedValue([
      {
        nodeId: 'Function:src/vector.ts:conceptSymbol',
        name: 'conceptSymbol',
        type: 'Function',
        filePath: 'src/vector.ts',
        startLine: 1,
        endLine: 5,
      },
    ]);
    vi.mocked(executeParameterized).mockImplementation(
      async (_repo: string, query: string, params?: any) => {
        if (query.includes('$filePath0') && query.includes('$lineNumber0')) {
          return [
            {
              id: 'Function:src/zoekt.ts:exactSymbol',
              name: 'exactSymbol',
              type: 'Function',
              filePath: 'src/zoekt.ts',
              startLine: 1,
              endLine: 8,
            },
          ];
        }
        if (query.includes('STEP_IN_PROCESS')) {
          if (params?.nodeId === 'Function:src/zoekt.ts:exactSymbol') {
            return [
              {
                pid: 'Process:ZoektExact',
                label: 'ZoektExact',
                heuristicLabel: 'ZoektExact',
                processType: 'intra_community',
                stepCount: 1,
                step: 1,
              },
            ];
          }
          if (params?.nodeId === 'Function:src/vector.ts:conceptSymbol') {
            return [
              {
                pid: 'Process:VectorConcept',
                label: 'VectorConcept',
                heuristicLabel: 'VectorConcept',
                processType: 'intra_community',
                stepCount: 1,
                step: 1,
              },
            ];
          }
        }
        return [];
      },
    );

    const result = await backend.callTool('query', { query: 'exactSymbol', repo: 'test-repo' });

    expect(result.processes.map((process: any) => process.id)).toEqual([
      'Process:ZoektExact',
      'Process:VectorConcept',
    ]);
  });

  it('批量解析多个 Zoekt 行命中的真实符号', async () => {
    mockLoadConfig.mockReturnValue({
      enabled: true,
      endpoints: ['http://localhost:6070'],
    });
    mockSearch.mockResolvedValue({
      matches: [
        {
          repository: 'test-repo',
          fileName: 'src/a.ts',
          score: 10,
          lineMatches: [{ line: 'first()', lineNumber: 4, lineFragments: [] }],
        },
        {
          repository: 'test-repo',
          fileName: 'src/b.ts',
          score: 9,
          lineMatches: [{ line: 'second()', lineNumber: 8, lineFragments: [] }],
        },
      ],
      stats: { matchCount: 2, durationMs: 1 },
    });
    vi.mocked(executeParameterized).mockImplementation(
      async (_repo: string, query: string, params?: any) => {
        if (query.includes('$filePath0') && query.includes('$lineNumber0')) {
          expect(params).toMatchObject({
            filePath0: 'src/a.ts',
            lineNumber0: 4,
            filePath1: 'src/b.ts',
            lineNumber1: 8,
          });
          return [
            {
              id: 'Function:src/a.ts:first',
              name: 'first',
              type: 'Function',
              filePath: 'src/a.ts',
              startLine: 1,
              endLine: 5,
            },
            {
              id: 'Function:src/b.ts:second',
              name: 'second',
              type: 'Function',
              filePath: 'src/b.ts',
              startLine: 6,
              endLine: 10,
            },
          ];
        }
        if (query.includes('STEP_IN_PROCESS')) {
          return [
            {
              pid: `Process:${params?.nodeId}`,
              label: String(params?.nodeId),
              heuristicLabel: String(params?.nodeId),
              processType: 'intra_community',
              stepCount: 1,
              step: 1,
            },
          ];
        }
        return [];
      },
    );

    const result = await backend.callTool('query', { query: 'symbols', repo: 'test-repo' });

    const batchLookups = vi
      .mocked(executeParameterized)
      .mock.calls.filter(([, query]) => String(query).includes('$filePath0'));
    expect(batchLookups).toHaveLength(1);
    expect(result.process_symbols.map((symbol: any) => symbol.id)).toEqual(
      expect.arrayContaining(['Function:src/a.ts:first', 'Function:src/b.ts:second']),
    );
  });
});
