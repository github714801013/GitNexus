/**
 * Pipeline Phase Runner
 *
 * Executes pipeline phases in dependency order using Kahn's topological sort.
 * Each phase receives typed outputs from its upstream dependencies.
 *
 * The runner is intentionally simple:
 * - No dynamic phase loading
 * - No plugin system
 * - Static phase graph, compile-time type safety
 * - Sequential execution (parallel support is architecturally possible
 *   but most phases have linear dependencies)
 */

import type { PipelinePhase, PipelineContext, PhaseResult } from './types.js';
import { isDev } from '../utils/env.js';

/**
 * Validate that the phases form a valid dependency graph (no cycles, all deps present).
 * Returns phases in topological execution order.
 */
function topologicalSort(phases: readonly PipelinePhase[]): PipelinePhase[] {
  const phaseMap = new Map<string, PipelinePhase>();
  for (const phase of phases) {
    if (phaseMap.has(phase.name)) {
      throw new Error(`Duplicate phase name: '${phase.name}'`);
    }
    phaseMap.set(phase.name, phase);
  }

  // Validate all deps exist
  for (const phase of phases) {
    for (const dep of phase.deps) {
      if (!phaseMap.has(dep)) {
        throw new Error(`Phase '${phase.name}' depends on '${dep}', which is not registered`);
      }
    }
  }

  // Kahn's algorithm
  const inDegree = new Map<string, number>();
  const reverseDeps = new Map<string, string[]>();

  for (const phase of phases) {
    inDegree.set(phase.name, phase.deps.length);
    for (const dep of phase.deps) {
      let rev = reverseDeps.get(dep);
      if (!rev) {
        rev = [];
        reverseDeps.set(dep, rev);
      }
      rev.push(phase.name);
    }
  }

  const sorted: PipelinePhase[] = [];
  const queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([name]) => name);

  while (queue.length > 0) {
    const name = queue.shift()!;
    sorted.push(phaseMap.get(name)!);

    for (const dependent of reverseDeps.get(name) ?? []) {
      const newDeg = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, newDeg);
      if (newDeg === 0) queue.push(dependent);
    }
  }

  if (sorted.length !== phases.length) {
    const remaining = new Set(
      [...inDegree.entries()].filter(([, d]) => d > 0).map(([name]) => name),
    );
    const cyclePath = findCyclePath(remaining, phaseMap);
    const dependentsBlocked = remaining.size - new Set(cyclePath).size;
    let message = `Cycle detected in pipeline phases: ${cyclePath.join(' -> ')}`;
    if (dependentsBlocked > 0) {
      message += ` (and ${dependentsBlocked} transitive dependent${dependentsBlocked === 1 ? '' : 's'} blocked)`;
    }
    throw new Error(message);
  }

  return sorted;
}

/**
 * Find a concrete cycle path among the phases that Kahn's algorithm could not drain.
 *
 * Kahn's leftovers include both true cycle members AND phases transitively dependent
 * on them. To produce an actionable error message, we DFS over the leftovers (using
 * each leftover's `deps` as edges) until we hit a back-edge — that closes the cycle.
 * The returned list is the cycle in order with the entry node repeated at the end:
 * `[A, B, C, A]` for `A -> B -> C -> A`.
 *
 * Falls back to the raw remaining set (sorted) if no back-edge is found, which
 * should be unreachable but keeps the error informative.
 */
function findCyclePath(
  remaining: ReadonlySet<string>,
  phaseMap: ReadonlyMap<string, PipelinePhase>,
): string[] {
  for (const start of remaining) {
    const stack: string[] = [];
    const onStack = new Set<string>();
    const visited = new Set<string>();

    const dfs = (name: string): string[] | null => {
      stack.push(name);
      onStack.add(name);
      visited.add(name);

      const phase = phaseMap.get(name);
      if (phase) {
        for (const dep of phase.deps) {
          if (!remaining.has(dep)) continue; // dep already drained — not part of cycle
          if (onStack.has(dep)) {
            // Back-edge — slice from the first occurrence of `dep` and close the loop.
            const cycleStart = stack.indexOf(dep);
            return [...stack.slice(cycleStart), dep];
          }
          if (!visited.has(dep)) {
            const found = dfs(dep);
            if (found) return found;
          }
        }
      }

      stack.pop();
      onStack.delete(name);
      return null;
    };

    const cycle = dfs(start);
    if (cycle) return cycle;
  }
  // Unreachable in practice (Kahn proved a cycle exists), but stay defensive.
  return [...remaining].sort();
}

export interface PipelineRunOptions {
  readonly retainResults?: readonly string[];
  readonly releaseConsumedResults?: boolean;
}

function getRemainingDependentCounts(phases: readonly PipelinePhase[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const phase of phases) {
    counts.set(phase.name, 0);
  }
  for (const phase of phases) {
    for (const dep of phase.deps) {
      counts.set(dep, (counts.get(dep) ?? 0) + 1);
    }
  }
  return counts;
}

function getMemorySnapshotDetail(retainedResults: number): string {
  const memory = process.memoryUsage();
  return `heapUsedMb=${Math.round(memory.heapUsed / 1024 / 1024)} rssMb=${Math.round(memory.rss / 1024 / 1024)} retainedResults=${retainedResults}`;
}

function emitPhaseMemory(
  ctx: PipelineContext,
  phaseName: string,
  marker: string,
  retainedResults: number,
): void {
  if (process.env.GITNEXUS_PIPELINE_MEMORY_LOG !== '1') return;
  try {
    ctx.onProgress({
      phase: 'enriching',
      percent: 0,
      message: `[memory] phase=${phaseName} marker=${marker} ${getMemorySnapshotDetail(retainedResults)}`,
    });
  } catch {
    /* diagnostic progress must not interrupt analysis */
  }
}

/**
 * Execute a set of pipeline phases in dependency order.
 *
 * @param phases  All phases to execute (order doesn't matter — sorted internally)
 * @param ctx     Shared pipeline context
 * @returns       Map of retained phase name → PhaseResult
 */
export async function runPipeline(
  phases: readonly PipelinePhase[],
  ctx: PipelineContext,
  options: PipelineRunOptions = {},
): Promise<ReadonlyMap<string, PhaseResult<unknown>>> {
  let sorted: PipelinePhase[];
  try {
    sorted = topologicalSort(phases);
  } catch (err) {
    // Emit a terminal 'error' progress event for graph-validation failures
    // (cycle detected, duplicate phase, missing dep) so CLI/MCP consumers see
    // the failure before the rejection propagates. Symmetric with the
    // per-phase error path below. Best-effort: a throwing handler must not
    // mask the underlying validation error.
    const message = err instanceof Error ? err.message : String(err);
    try {
      ctx.onProgress({
        phase: 'error',
        percent: 100,
        message: 'Pipeline graph validation failed',
        detail: message,
      });
    } catch {
      // Swallow handler errors — preserving the original cause is more important.
    }
    throw err;
  }
  const results = new Map<string, PhaseResult<unknown>>();
  const retainedResultNames = new Set(options.retainResults ?? []);
  const remainingDependentCounts = getRemainingDependentCounts(sorted);

  for (const phase of sorted) {
    const start = Date.now();

    if (isDev) {
      console.log(`▶ Phase: ${phase.name}`);
    }

    emitPhaseMemory(ctx, phase.name, 'start', results.size);

    // Only expose declared dependencies — prevents hidden coupling to undeclared phases.
    const declaredDeps = new Map<string, PhaseResult<unknown>>();
    for (const depName of phase.deps) {
      const depResult = results.get(depName);
      if (depResult) declaredDeps.set(depName, depResult);
    }

    let output: unknown;
    try {
      output = await phase.execute(ctx, declaredDeps);
    } catch (err) {
      const originalMessage = err instanceof Error ? err.message : String(err);
      const wrapped = new Error(`Phase '${phase.name}' failed: ${originalMessage}`, {
        cause: err,
      });

      // Emit a terminal 'error' progress event so CLI/MCP consumers see the failure
      // before the rejection propagates. Best-effort: a throwing handler must not
      // mask the underlying phase error.
      try {
        ctx.onProgress({
          phase: 'error',
          percent: 100,
          message: `Phase '${phase.name}' failed`,
          detail: originalMessage,
        });
      } catch {
        // Swallow handler errors — preserving the original cause is more important.
      }

      throw wrapped;
    }
    const durationMs = Date.now() - start;

    results.set(phase.name, {
      phaseName: phase.name,
      output,
      durationMs,
    });

    for (const depName of phase.deps) {
      const remaining = (remainingDependentCounts.get(depName) ?? 0) - 1;
      remainingDependentCounts.set(depName, remaining);
      if (options.releaseConsumedResults && remaining === 0 && !retainedResultNames.has(depName)) {
        results.delete(depName);
      }
    }

    if (isDev) {
      console.log(
        `Pipeline retained ${results.size} phase result${results.size === 1 ? '' : 's'} after ${phase.name}`,
      );
    }

    emitPhaseMemory(ctx, phase.name, 'complete', results.size);

    if (isDev) {
      console.log(`✓ Phase: ${phase.name} (${durationMs}ms)`);
    }
  }

  return results;
}
