import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalBackend } from '../../src/mcp/local/local-backend.js';
import * as zoektClient from '../../src/core/search/zoekt-client.js';

// Mock dependencies
vi.mock('../../core/lbug/pool-adapter.js', () => ({
  initLbug: vi.fn(),
  executeQuery: vi.fn(),
  executeParameterized: vi.fn(),
  closeLbug: vi.fn(),
  isLbugReady: vi.fn(() => true),
  isWriteQuery: vi.fn(() => false),
}));

vi.mock('../../storage/repo-manager.js', () => ({
  listRegisteredRepos: vi.fn(async () => []),
  cleanupOldKuzuFiles: vi.fn(async () => ({ found: false })),
  loadMeta: vi.fn(async () => ({ branch: 'main' })),
}));

// Mock ZoektClient
const mockSearch = vi.fn();
vi.spyOn(zoektClient, 'ZoektClient').mockImplementation(
  class {
    search = mockSearch;
    symbolSearch = vi.fn();
  } as any,
);

const mockLoadConfig = vi.spyOn(zoektClient, 'loadZoektConfig');

describe('LocalBackend filtering with "head"', () => {
  let backend: LocalBackend;

  beforeEach(async () => {
    backend = new LocalBackend();

    mockSearch.mockReset();
    mockLoadConfig.mockReset();

    // Default mocks for search helpers to avoid errors
    vi.spyOn(backend as any, 'bm25Search').mockResolvedValue({ results: [], ftsUsed: true });
    vi.spyOn(backend as any, 'semanticSearch').mockResolvedValue([]);
    // Bypass ensureInitialized
    vi.spyOn(backend as any, 'ensureInitialized').mockResolvedValue(undefined);

    // Setup multiple repos
    (backend as any).repos.set('repo-1', { id: 'repo-1', name: 'repo-1', repoPath: '/p1' });
    (backend as any).repos.set('repo-2', { id: 'repo-2', name: 'repo-2', repoPath: '/p2' });
  });

  it('should filter query results to only include repositories in the "head" whitelist', async () => {
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

    const querySpy = vi.spyOn(backend as any, 'query');
    querySpy.mockResolvedValue({
      processes: [],
      process_symbols: [],
      definitions: [],
      timing: { wall: 10 },
    });

    // Call tool with head parameter whitelisting ONLY repo-1
    await backend.callTool('query', {
      query: 'handleError',
      head: ['repo-1'],
    });

    // Should have called query ONLY for repo-1
    expect(querySpy).toHaveBeenCalledTimes(1);
    expect(querySpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'repo-1' }),
      expect.any(Object),
    );
    expect(querySpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'repo-2' }),
      expect.any(Object),
    );
  });

  it('should support comma-separated string for "head"', async () => {
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

    const querySpy = vi.spyOn(backend as any, 'query');
    querySpy.mockResolvedValue({
      processes: [],
      process_symbols: [],
      definitions: [],
      timing: { wall: 10 },
    });

    // Call tool with head as a STRING
    await backend.callTool('query', {
      query: 'handleError',
      head: 'repo-1, repo-3',
    });

    expect(querySpy).toHaveBeenCalledTimes(1);
    expect(querySpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'repo-1' }),
      expect.any(Object),
    );
  });

  it('should be case-insensitive and handle trimming/empty items', async () => {
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

    const querySpy = vi.spyOn(backend as any, 'query');
    querySpy.mockResolvedValue({
      processes: [],
      process_symbols: [],
      definitions: [],
      timing: { wall: 10 },
    });

    // Mixed case, spaces, and empty items in array
    await backend.callTool('query', {
      query: 'handleError',
      head: [' REPO-1 ', '', 'repo-3'],
    });

    expect(querySpy).toHaveBeenCalledTimes(1);
    expect(querySpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'repo-1' }),
      expect.any(Object),
    );
  });

  it('should support prefix entries for env-scoped "head" filtering', async () => {
    mockLoadConfig.mockReturnValue({
      enabled: true,
      endpoints: ['http://localhost:6070'],
    });

    (backend as any).repos.clear();
    (backend as any).repos.set('dev-api', { id: 'dev-api', name: 'dev-api', repoPath: '/dev-api' });
    (backend as any).repos.set('saas-api', {
      id: 'saas-api',
      name: 'saas-api',
      repoPath: '/saas-api',
    });

    mockSearch.mockResolvedValueOnce({
      matches: [
        { repository: 'dev-api', fileName: 'src/a.ts', score: 10.0, lineMatches: [] },
        { repository: 'saas-api', fileName: 'src/b.ts', score: 9.0, lineMatches: [] },
      ],
      stats: { matchCount: 2, durationMs: 1 },
    });

    const querySpy = vi.spyOn(backend as any, 'query');
    querySpy.mockResolvedValue({
      processes: [],
      process_symbols: [],
      definitions: [],
      timing: { wall: 10 },
    });

    await backend.callTool('query', {
      query: 'handleError',
      head: ['dev-*'],
    });

    expect(querySpy).toHaveBeenCalledTimes(1);
    expect(querySpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'dev-api' }),
      expect.any(Object),
    );
  });
});
