/**
 * Full-Text Search via LadybugDB FTS
 *
 * Uses LadybugDB's built-in full-text search indexes for keyword-based search.
 * Always reads from the database (no cached state to drift).
 *
 * FTS 索引在 analyze 阶段写入 shadow DB；swap 后查询路径只读取
 * live DB，不在首次查询时创建索引。
 */

import { queryFTS } from '../lbug/lbug-adapter.js';

export interface BM25SearchResult {
  filePath: string;
  score: number;
  rank: number;
  nodeIds?: string[];
}

/**
 * FTS schema served by `searchFTSFromLbug`. Centralised so that both the
 * CLI/pipeline path and the MCP pool path use identical (table, index,
 * properties) tuples and the lazy-create logic stays in one place.
 */
export const FTS_INDEXES: ReadonlyArray<{
  table: string;
  indexName: string;
  properties: readonly string[];
}> = [
  { table: 'File', indexName: 'file_fts', properties: ['name', 'content'] },
  { table: 'Function', indexName: 'function_fts', properties: ['name', 'content'] },
  { table: 'Class', indexName: 'class_fts', properties: ['name', 'content'] },
  { table: 'Method', indexName: 'method_fts', properties: ['name', 'content'] },
  { table: 'Interface', indexName: 'interface_fts', properties: ['name', 'content'] },
];

/**
 * 兼容旧测试/调用方的失效入口。MCP pool 查询已改为只读优先，
 * 不再维护“已创建 FTS”缓存，因此这里无需执行任何操作。
 */
export function invalidateEnsuredFTSForRepo(_repoId: string): void {
  // no-op
}

/**
 * Tracks whether we've already wired the pool-close listener for this
 * process. The pool adapter is dynamically imported, so registration
 * happens lazily on the first MCP-pool-backed FTS query.
 */
let poolCloseListenerRegistered = false;
function registerPoolCloseListenerOnce(
  addPoolCloseListener: (listener: (repoId: string) => void) => void,
): void {
  if (poolCloseListenerRegistered) return;
  poolCloseListenerRegistered = true;
  addPoolCloseListener((repoId) => invalidateEnsuredFTSForRepo(repoId));
}

/**
 * Execute a single FTS query via a custom executor (for MCP connection pool).
 * Returns the same shape as core queryFTS (from LadybugDB adapter).
 */
async function queryFTSViaExecutor(
  executor: (cypher: string) => Promise<any[]>,
  tableName: string,
  indexName: string,
  query: string,
  limit: number,
): Promise<Array<{ filePath: string; score: number; nodeId: string }>> {
  // Escape single quotes and backslashes to prevent Cypher injection
  const escapedQuery = query.replace(/\\/g, '\\\\').replace(/'/g, "''");
  const cypher = `
    CALL QUERY_FTS_INDEX('${tableName}', '${indexName}', '${escapedQuery}', conjunctive := false)
    RETURN node, score
    ORDER BY score DESC
    LIMIT ${limit}
  `;
  try {
    const rows = await executor(cypher);
    return rows.map((row: any) => {
      const node = row.node || row[0] || {};
      const score = row.score ?? row[1] ?? 0;
      return {
        filePath: node.filePath || '',
        score: typeof score === 'number' ? score : parseFloat(score) || 0,
        nodeId: node.nodeId || node.id || '',
      };
    });
  } catch {
    return [];
  }
}

/**
 * Search using LadybugDB's built-in FTS (always fresh, reads from disk)
 *
 * Queries multiple node tables (File, Function, Class, Method) in parallel
 * and merges results by filePath, summing scores for the same file.
 *
 * @param query - Search query string
 * @param limit - Maximum results
 * @param repoId - If provided, queries will be routed via the MCP connection pool
 * @returns Ranked search results from FTS indexes
 */
export const searchFTSFromLbug = async (
  query: string,
  limit: number = 20,
  repoId?: string,
): Promise<BM25SearchResult[]> => {
  let fileResults: any[],
    functionResults: any[],
    classResults: any[],
    methodResults: any[],
    interfaceResults: any[];

  if (repoId) {
    // Use MCP connection pool via dynamic import
    // IMPORTANT: FTS queries run sequentially to avoid connection contention.
    // The MCP pool supports multiple connections, but FTS is best run serially.
    const poolMod = await import('../lbug/pool-adapter.js');
    const { executeQuery, addPoolCloseListener } = poolMod;
    // Register the pool-close listener lazily on first use so a teardown of
    // the pool entry (LRU eviction, idle timeout, explicit close) drops the
    // matching `ensuredPoolFTS` entries. Without this, stale ensure-state
    // can outlive the pool that produced it.
    registerPoolCloseListenerOnce(addPoolCloseListener);
    const executor = (cypher: string) => executeQuery(repoId, cypher);

    fileResults = await queryFTSViaExecutor(executor, 'File', 'file_fts', query, limit);
    functionResults = await queryFTSViaExecutor(executor, 'Function', 'function_fts', query, limit);
    classResults = await queryFTSViaExecutor(executor, 'Class', 'class_fts', query, limit);
    methodResults = await queryFTSViaExecutor(executor, 'Method', 'method_fts', query, limit);
    interfaceResults = await queryFTSViaExecutor(
      executor,
      'Interface',
      'interface_fts',
      query,
      limit,
    );
  } else {
    // Use core lbug adapter (CLI / pipeline context) — also sequential for safety.
    fileResults = await queryFTS('File', 'file_fts', query, limit, false).catch(() => []);
    functionResults = await queryFTS('Function', 'function_fts', query, limit, false).catch(
      () => [],
    );
    classResults = await queryFTS('Class', 'class_fts', query, limit, false).catch(() => []);
    methodResults = await queryFTS('Method', 'method_fts', query, limit, false).catch(() => []);
    interfaceResults = await queryFTS('Interface', 'interface_fts', query, limit, false).catch(
      () => [],
    );
  }

  // Collect all node scores per filePath to track which nodes actually matched
  const fileNodeScores = new Map<string, Array<{ score: number; nodeId: string }>>();

  const addResults = (results: any[]) => {
    for (const r of results) {
      if (!fileNodeScores.has(r.filePath)) fileNodeScores.set(r.filePath, []);
      fileNodeScores.get(r.filePath)!.push({ score: r.score, nodeId: r.nodeId });
    }
  };

  addResults(fileResults);
  addResults(functionResults);
  addResults(classResults);
  addResults(methodResults);
  addResults(interfaceResults);

  // Sum the top-3 highest-scoring nodes per file and collect their nodeIds.
  // Summing all nodes naively inflates scores for files with many mediocre
  // matches (e.g. test files) over files with a single highly-relevant symbol.
  const merged = new Map<string, { filePath: string; score: number; nodeIds: string[] }>();
  for (const [filePath, entries] of fileNodeScores) {
    const top3 = [...entries].sort((a, b) => b.score - a.score).slice(0, 3);
    merged.set(filePath, {
      filePath,
      score: top3.reduce((acc, e) => acc + e.score, 0),
      nodeIds: top3.map((e) => e.nodeId).filter((id) => id),
    });
  }

  // Sort by score descending and add rank
  const sorted = Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return sorted.map((r, index) => ({
    filePath: r.filePath,
    score: r.score,
    rank: index + 1,
    nodeIds: r.nodeIds,
  }));
};
