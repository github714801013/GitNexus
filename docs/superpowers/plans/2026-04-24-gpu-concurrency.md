# GPU 并发保护实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 防止多个进程并发占用 GPU 内存导致 OOM，同时保证进程内并发 embedding 请求串行执行。

**Architecture:** 三层保护：(1) Python 侧 analyze 串行化；(2) Node.js 进程内 async mutex；(3) serve 进程暴露 `/v1/embeddings` 路由，analyze 进程切换 HTTP 模式不再持有 GPU。

**Tech Stack:** Python ThreadPoolExecutor, asyncio.Semaphore, TypeScript async mutex (promise chain), Express.js

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `mcp_proxy_docker/app/main.py` | 修改 | max_workers=1，加 Semaphore |
| `gitnexus/src/core/embeddings/embedder.ts` | 修改 | 加进程内 async mutex |
| `gitnexus/src/server/api.ts` | 修改 | 新增 POST /v1/embeddings 路由 |
| `mcp_proxy_docker/entrypoint.sh` | 修改 | analyze 注入 GITNEXUS_EMBEDDING_URL |
| `mcp_proxy_docker/app/executor.py` | 修改 | 透传 GITNEXUS_EMBEDDING_URL |

---

## Task 1：Python 串行化 analyze

**Files:**
- Modify: `mcp_proxy_docker/app/main.py`

- [ ] **Step 1：修改 max_workers 并加全局 Semaphore**

将 `main.py` 中以下内容：

```python
_startup_executor = ThreadPoolExecutor(max_workers=2)
```

改为：

```python
_startup_executor = ThreadPoolExecutor(max_workers=1)
_analyze_semaphore: asyncio.Semaphore | None = None
```

在 `lifespan` 函数开头加初始化：

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    global _analyze_semaphore
    _analyze_semaphore = asyncio.Semaphore(1)
    projects_root = get_projects_root()
    # ... 其余不变
```

- [ ] **Step 2：webhook handler 使用 Semaphore**

在 `gitea_webhook` 函数中，将：

```python
background_tasks.add_task(run_analyze, repo_path, clone_url, branch)
```

改为：

```python
async def _guarded_analyze():
    async with _analyze_semaphore:
        await asyncio.get_event_loop().run_in_executor(
            None, run_analyze, repo_path, clone_url, branch
        )

background_tasks.add_task(_guarded_analyze)
```

- [ ] **Step 3：验证改动**

```bash
# 检查语法
python -c "import ast; ast.parse(open('mcp_proxy_docker/app/main.py').read()); print('OK')"
```

期望输出：`OK`

- [ ] **Step 4：commit**

```bash
git add mcp_proxy_docker/app/main.py
git commit -m "fix(gpu): serialize analyze jobs to prevent concurrent GPU OOM"
```

---

## Task 2：Node.js 进程内 async mutex

**Files:**
- Modify: `gitnexus/src/core/embeddings/embedder.ts`

- [ ] **Step 1：在模块级加 mutex 状态**

在 `embedder.ts` 的模块级状态区（`let embedderInstance` 附近，约第 140 行）加：

```typescript
// 进程内 GPU 串行锁：防止并发 embedText/embedBatch 同时触发 ONNX 推理
// 使用 promise chain 实现无依赖的 async mutex
let _gpuLock: Promise<void> = Promise.resolve();
```

- [ ] **Step 2：封装 mutex 辅助函数**

在同一文件，`_gpuLock` 声明之后加：

```typescript
/**
 * 在 GPU mutex 保护下执行 fn。
 * HTTP 模式下直接执行（HTTP 服务自己管理串行）。
 */
async function withGpuLock<T>(fn: () => Promise<T>): Promise<T> {
  if (isHttpMode()) return fn();
  const prev = _gpuLock;
  let release!: () => void;
  _gpuLock = new Promise<void>((r) => {
    release = r;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}
```

- [ ] **Step 3：embedText 使用 mutex**

找到 `embedText` 函数（约第 337 行），将函数体改为：

```typescript
export const embedText = async (text: string): Promise<Float32Array> => {
  if (isHttpMode()) {
    const [vec] = await httpEmbed([text]);
    return vec;
  }

  return withGpuLock(async () => {
    const embedder = getEmbedder();
    const result = await embedder(text, { pooling: 'mean', normalize: true });
    return new Float32Array(result.data as ArrayLike<number>);
  });
};
```

- [ ] **Step 4：embedBatch 使用 mutex**

找到 `embedBatch` 函数（约第 361 行），将函数体改为：

```typescript
export const embedBatch = async (texts: string[]): Promise<Float32Array[]> => {
  if (texts.length === 0) return [];

  if (isHttpMode()) return httpEmbed(texts);

  return withGpuLock(async () => {
    const embedder = getEmbedder();
    const result = await embedder(texts, { pooling: 'mean', normalize: true });
    const data = result.data as ArrayLike<number>;
    const dimensions = DEFAULT_EMBEDDING_CONFIG.dimensions;
    const embeddings: Float32Array[] = [];
    for (let i = 0; i < texts.length; i++) {
      const start = i * dimensions;
      const end = start + dimensions;
      embeddings.push(new Float32Array(Array.prototype.slice.call(data, start, end)));
    }
    return embeddings;
  });
};
```

- [ ] **Step 5：编译验证**

```bash
cd gitnexus && npm run build 2>&1 | tail -20
```

期望：无 TypeScript 错误，输出 `Build complete` 或类似成功信息。

- [ ] **Step 6：commit**

```bash
git add gitnexus/src/core/embeddings/embedder.ts
git commit -m "fix(gpu): add async mutex to serialize intra-process GPU embedding calls"
```

---

## Task 3：serve 进程暴露 /v1/embeddings 路由

**Files:**
- Modify: `gitnexus/src/server/api.ts`（在 `/api/embed` 路由附近新增路由）

- [ ] **Step 1：在 api.ts 中找到插入点**

在 `api.ts` 中找到 `// POST /api/embed` 注释（约第 1416 行），在其**之前**插入新路由：

```typescript
  // POST /v1/embeddings — OpenAI-compatible embedding endpoint
  // Allows analyze subprocesses to use this serve process as the sole GPU holder.
  // Activated by setting GITNEXUS_EMBEDDING_URL=http://localhost:<port>/v1 in analyze env.
  app.post('/v1/embeddings', async (req, res) => {
    try {
      const { input, model: _model } = req.body as { input: string | string[]; model?: string };
      if (!input) {
        res.status(400).json({ error: 'Missing required field: input' });
        return;
      }

      const texts = Array.isArray(input) ? input : [input];
      if (texts.length === 0) {
        res.json({ object: 'list', data: [], model: 'local' });
        return;
      }

      // Lazy-load embedder to avoid loading onnxruntime-node at server startup
      const { initEmbedder, embedBatch, isEmbedderReady } = await import(
        '../core/embeddings/embedder.js'
      );
      if (!isEmbedderReady()) {
        await initEmbedder();
      }

      const vectors = await embedBatch(texts);
      const data = vectors.map((vec, index) => ({
        object: 'embedding',
        index,
        embedding: Array.from(vec),
      }));

      res.json({ object: 'list', data, model: 'local' });
    } catch (err: any) {
      console.error('POST /v1/embeddings error:', err);
      res.status(500).json({ error: err.message ?? 'Embedding failed' });
    }
  });
```

- [ ] **Step 2：编译验证**

```bash
cd gitnexus && npm run build 2>&1 | tail -20
```

期望：无 TypeScript 错误。

- [ ] **Step 3：commit**

```bash
git add gitnexus/src/server/api.ts
git commit -m "feat(serve): expose POST /v1/embeddings OpenAI-compatible route for subprocess use"
```

---

## Task 4：entrypoint.sh 注入 GITNEXUS_EMBEDDING_URL

**Files:**
- Modify: `mcp_proxy_docker/entrypoint.sh`

- [ ] **Step 1：在 serve 启动后、mcp-proxy 启动前注入环境变量**

在 `entrypoint.sh` 中，找到：

```bash
# Wait a bit for initialization
sleep 2
```

在 `sleep 2` **之后**、`exec mcp-proxy` **之前**加：

```bash
# Route analyze subprocess embedding calls through the serve process (port 1349).
# This ensures only one CUDA session exists (in the serve process), preventing
# concurrent GPU memory allocation from multiple analyze subprocesses.
export GITNEXUS_EMBEDDING_URL="http://localhost:1349/v1"
```

- [ ] **Step 2：验证 shell 语法**

```bash
bash -n mcp_proxy_docker/entrypoint.sh && echo "OK"
```

期望：`OK`

- [ ] **Step 3：commit**

```bash
git add mcp_proxy_docker/entrypoint.sh
git commit -m "fix(docker): route analyze embedding through serve process to unify GPU session"
```

---

## Task 5：executor.py 透传 GITNEXUS_EMBEDDING_URL

**Files:**
- Modify: `mcp_proxy_docker/app/executor.py`

- [ ] **Step 1：在 env 构建块中透传变量**

在 `executor.py` 的 `run_analyze` 函数中，找到：

```python
if os.getenv("GITNEXUS_EMBEDDING_DEVICE"):
    env["GITNEXUS_EMBEDDING_DEVICE"] = os.getenv("GITNEXUS_EMBEDDING_DEVICE")
```

在其**之后**加：

```python
if os.getenv("GITNEXUS_EMBEDDING_URL"):
    env["GITNEXUS_EMBEDDING_URL"] = os.getenv("GITNEXUS_EMBEDDING_URL")
```

- [ ] **Step 2：验证语法**

```bash
python -c "import ast; ast.parse(open('mcp_proxy_docker/app/executor.py').read()); print('OK')"
```

期望：`OK`

- [ ] **Step 3：commit**

```bash
git add mcp_proxy_docker/app/executor.py
git commit -m "fix(executor): pass GITNEXUS_EMBEDDING_URL to analyze subprocess env"
```

---

## Task 6：构建并部署验证

- [ ] **Step 1：本地构建 Docker 镜像**

```bash
bash mcp_proxy_docker/local_build_push.sh
```

期望：镜像构建成功，推送到远端，容器重启。

- [ ] **Step 2：等待服务启动，检查 GPU 初始化日志**

```bash
ssh ji99@10.1.14.177 "sleep 20 && docker logs gitnexus-mcp-proxy 2>&1 | grep -iE 'cuda|gpu|embedding|v1/embed|error' | head -30"
```

期望：
- serve 进程日志中出现 CUDA 初始化（`Using GPU (CUDA) backend`）
- analyze 进程日志中**不出现** CUDA 初始化（已切换 HTTP 模式）
- 无 `BFCArena` OOM 错误

- [ ] **Step 3：验证 /v1/embeddings 路由可用**

```bash
ssh ji99@10.1.14.177 "docker exec gitnexus-mcp-proxy curl -s -X POST http://localhost:1349/v1/embeddings \
  -H 'Content-Type: application/json' \
  -d '{\"input\": [\"test\"], \"model\": \"local\"}' | head -c 200"
```

期望：返回包含 `embedding` 数组的 JSON，维度为 512。

- [ ] **Step 4：等待 analyze 完成，确认无 OOM**

```bash
ssh ji99@10.1.14.177 "docker logs gitnexus-mcp-proxy 2>&1 | grep -iE 'BFCArena|OOM|AllocateRaw|Successfully indexed' | tail -20"
```

期望：出现 `Successfully indexed` 日志，无 `BFCArena` 错误。
