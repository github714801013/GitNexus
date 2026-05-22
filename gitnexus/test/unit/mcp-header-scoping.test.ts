import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalBackend } from '../../src/mcp/local/local-backend.js';
import { createMCPServer } from '../../src/mcp/server.js';

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

describe('MCP Server with project whitelisting', () => {
  let backend: LocalBackend;

  beforeEach(async () => {
    backend = new LocalBackend();
    // Bypass ensureInitialized
    vi.spyOn(backend as any, 'ensureInitialized').mockResolvedValue(undefined);
  });

  async function callToolViaHandler(server: any, name: string, args: any) {
    const handlers = (server as any)._requestHandlers;
    for (const [key, h] of handlers.entries()) {
      const method = typeof key === 'string' ? key : (key as any).method;
      if (method === 'tools/call') {
        return await h({
          method: 'tools/call',
          params: { name, arguments: args },
        });
      }
    }
    throw new Error('CallTool handler not found');
  }

  it('should filter list_repos output when projectWhitelist is provided', async () => {
    // Setup multiple repos in the backend
    (backend as any).repos.set('repo-1', { id: 'repo-1', name: 'repo-1' });
    (backend as any).repos.set('repo-2', { id: 'repo-2', name: 'repo-2' });

    // Mock list_repos tool output
    vi.spyOn(backend, 'callTool').mockImplementation(async (method, params) => {
      if (method === 'list_repos') {
        return [
          { name: 'repo-1', lastCommit: 'abc' },
          { name: 'repo-2', lastCommit: 'def' },
        ];
      }
      return {};
    });

    const server = createMCPServer(backend, ['repo-1']);
    const result = await callToolViaHandler(server, 'list_repos', {});

    // Tool responses include a hint after the JSON. Extract JSON only.
    const text = result.content[0].text as string;
    const jsonMatch = text.match(/^(\[[\s\S]*?\]|\{[\s\S]*?\})/);
    if (!jsonMatch) throw new Error('Failed to find JSON in result: ' + text);

    const repos = JSON.parse(jsonMatch[1]);
    expect(repos).toHaveLength(1);
    expect(repos[0].name).toBe('repo-1');
  });

  it('should filter list_repos output by env prefix when env scope is provided', async () => {
    vi.spyOn(backend, 'callTool').mockImplementation(async (method) => {
      if (method === 'list_repos') {
        return [
          { name: 'dev-api', lastCommit: 'abc' },
          { name: 'saas-api', lastCommit: 'def' },
          { name: 'api', lastCommit: 'ghi' },
        ];
      }
      return {};
    });

    const server = createMCPServer(backend, { envs: ['dev'] });
    const result = await callToolViaHandler(server, 'list_repos', {});

    const text = result.content[0].text as string;
    const jsonMatch = text.match(/^(\[[\s\S]*?\]|\{[\s\S]*?\})/);
    if (!jsonMatch) throw new Error('Failed to find JSON in result: ' + text);

    const repos = JSON.parse(jsonMatch[1]);
    expect(repos).toHaveLength(1);
    expect(repos[0].name).toBe('dev-api');
  });

  it('should return base repositories and exclude env-prefixed indexes when pro env scope is provided', async () => {
    vi.spyOn(backend, 'callTool').mockImplementation(async (method) => {
      if (method === 'list_repos') {
        return [
          { name: 'dev-api', lastCommit: 'abc' },
          { name: 'saas-api', lastCommit: 'def' },
          { name: 'api', lastCommit: 'ghi' },
        ];
      }
      return {};
    });

    const server = createMCPServer(backend, { envs: ['pro'] });
    const result = await callToolViaHandler(server, 'list_repos', {});

    const text = result.content[0].text as string;
    const jsonMatch = text.match(/^(\[[\s\S]*?\]|\{[\s\S]*?\})/);
    if (!jsonMatch) throw new Error('Failed to find JSON in result: ' + text);

    const repos = JSON.parse(jsonMatch[1]);
    expect(repos).toHaveLength(1);
    expect(repos[0].name).toBe('api');
  });

  it('should apply the intersection of project and env scopes', async () => {
    vi.spyOn(backend, 'callTool').mockImplementation(async (method) => {
      if (method === 'list_repos') {
        return [
          { name: 'dev-api', lastCommit: 'abc' },
          { name: 'dev-web', lastCommit: 'def' },
          { name: 'saas-api', lastCommit: 'ghi' },
        ];
      }
      return {};
    });

    const server = createMCPServer(backend, { projects: ['dev-api', 'saas-api'], envs: ['dev'] });
    const result = await callToolViaHandler(server, 'list_repos', {});

    const text = result.content[0].text as string;
    const jsonMatch = text.match(/^(\[[\s\S]*?\]|\{[\s\S]*?\})/);
    if (!jsonMatch) throw new Error('Failed to find JSON in result: ' + text);

    const repos = JSON.parse(jsonMatch[1]);
    expect(repos).toHaveLength(1);
    expect(repos[0].name).toBe('dev-api');
  });

  it('should expand base project whitelist entries with the requested env prefix', async () => {
    vi.spyOn(backend, 'callTool').mockImplementation(async (method) => {
      if (method === 'list_repos') {
        return [
          { name: 'dev-oa-stock', lastCommit: 'abc' },
          { name: 'oa-stock', lastCommit: 'def' },
          { name: 'dev-oa-order', lastCommit: 'ghi' },
        ];
      }
      return {};
    });

    const server = createMCPServer(backend, { projects: ['oa-stock', 'oa-order'], envs: ['dev'] });
    const result = await callToolViaHandler(server, 'list_repos', {});

    const text = result.content[0].text as string;
    const jsonMatch = text.match(/^(\[[\s\S]*?\]|\{[\s\S]*?\})/);
    if (!jsonMatch) throw new Error('Failed to find JSON in result: ' + text);

    const repos = JSON.parse(jsonMatch[1]);
    expect(repos.map((repo: any) => repo.name)).toEqual(['dev-oa-stock', 'dev-oa-order']);
  });

  it('should block access to non-whitelisted repos', async () => {
    const server = createMCPServer(backend, ['repo-1']);

    // Call tool for repo-2 (which is NOT in whitelist)
    await expect(
      callToolViaHandler(server, 'query', { repo: 'repo-2', query: 'test' }),
    ).rejects.toThrow("Access to repository 'repo-2' is restricted.");
  });

  it('should allow access to whitelisted repos', async () => {
    vi.spyOn(backend, 'callTool').mockResolvedValue({ processes: [] });
    const server = createMCPServer(backend, ['repo-1']);

    await expect(
      callToolViaHandler(server, 'query', { repo: 'repo-1', query: 'test' }),
    ).resolves.toBeDefined();
  });
});
