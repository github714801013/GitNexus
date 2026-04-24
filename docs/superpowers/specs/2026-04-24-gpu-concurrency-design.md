# GPU 并发保护设计

**日期：** 2026-04-24
**状态：** 已批准

## 问题

多个 Node.js 进程（analyze × N + mcp serve + mcp proxy）各自持有独立的 ONNX Runtime CUDA session，并发运行时 GPU 内存被多份占用，触发 `BFCArena::AllocateRawInternal` OOM 错误。

错误现象：
```
Failed to allocate memory for requested buffer of size 197413632
```

根因：
1. `ThreadPoolExecutor(max_workers=2)` 启动时并发跑 2 个 analyze 子进程，各自初始化 CUDA session
2. MCP query 触发 `embedText` 与 analyze 的 `embedBatch` 在同一进程内并发执行
3. analyze 进程与 mcp/serve 进程跨进程竞争 GPU 内存

## 方案

三个改动，按优先级排序：

### 改动 1：Python 串行化（立即上线）

**文件：** `mcp_proxy_docker/app/main.py`

将 `ThreadPoolExecutor(max_workers=2)` 改为 `max_workers=1`，消除启动时多个 analyze 并发抢 GPU 的根因。

同时在 webhook handler 加 `asyncio.Semaphore(1)` 限制同时只有一个 analyze 在跑（防止 webhook 并发触发）。

### 改动 2：Node.js 进程内 async mutex

**文件：** `gitnexus/src/core/embeddings/embedder.ts`

在模块级维护一个 promise chain 作为 async mutex，保证同一进程内 `embedBatch` / `embedText` 串行执行，防止并发 MCP query 同时触发 GPU 推理。

```typescript
let _gpuLock: Promise<void> = Promise.resolve();

// 在 embedBatch / embedText 内：
const prev = _gpuLock;
let release!: () => void;
_gpuLock = new Promise(r => { release = r; });
await prev;
try {
  // 原有推理逻辑
} finally {
  release();
}
```

HTTP 模式下跳过锁（HTTP 服务自己管理串行）。

### 改动 3：serve 进程暴露 /v1/embeddings 路由（彻底方案）

**文件：**
- `gitnexus/src/server/api.ts` — 新增 `POST /v1/embeddings` 路由（OpenAI 兼容格式）
- `mcp_proxy_docker/entrypoint.sh` — analyze 进程注入 `GITNEXUS_EMBEDDING_URL=http://localhost:1349/v1`
- `mcp_proxy_docker/app/executor.py` — 透传 `GITNEXUS_EMBEDDING_URL` 环境变量

效果：
- GPU session 只在 serve 进程（端口 1349）里初始化一次
- analyze 进程设置 `GITNEXUS_EMBEDDING_URL` 后自动切换 HTTP 模式，不再持有 GPU
- serve 进程内部的 async mutex（改动 2）保证所有请求串行过 GPU
- mcp 进程也可配置 `GITNEXUS_EMBEDDING_URL` 指向 serve，彻底统一 GPU 入口

## 数据流（改动 3 后）

```
analyze process (no GPU)
    │  POST /v1/embeddings
    ▼
serve process (port 1349)
    │  async mutex
    ▼
ONNX Runtime CUDA session (单一实例)
    │
    ▼
GPU (RTX 2080 Ti)
```

## 不在范围内

- 动态 batch size 调整（OOM 自动重试缩小 batch）— 改动 3 后 analyze 进程不直接用 GPU，不需要
- 多 GPU 支持 — 当前只有一张卡
- embedding 服务独立部署 — serve 进程内嵌已足够，不需要新增容器

## 验证方法

1. 改动 1 上线后：观察 `docker logs` 中 analyze 是否串行执行，OOM 错误消失
2. 改动 2 上线后：并发发送多个 MCP query，观察无 GPU 内存错误
3. 改动 3 上线后：`docker exec` 进容器，`curl localhost:1349/v1/embeddings` 验证路由可用；观察 analyze 日志中无 CUDA 初始化信息（已切换 HTTP 模式）
