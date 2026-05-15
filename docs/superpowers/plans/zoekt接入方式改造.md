# GitNexus 接入 Zoekt 标准方案：作为精确代码召回通道融入多路召回

## 一、目标

将 Zoekt 作为 GitNexus 多路召回体系中的一条高精度代码全文检索通道，用于补强：

1. 函数名 / 类名 / 方法名检索
2. 配置 key 检索
3. 表名 / 字段名 / SQL 片段检索
4. 接口路径检索
5. 错误日志 / 异常片段检索
6. 跨仓库代码片段定位
7. 正则 / 子串搜索

Zoekt 不替代 GitNexus 原有能力，而是作为新增召回源：

- GitNexus semantic：负责自然语言语义召回
- GitNexus BM25 / FTS：负责基础关键词召回
- GitNexus graph：负责调用关系、依赖关系、上下文扩展
- GitNexus process：负责业务执行流聚合
- Zoekt：负责高精度代码全文召回

最终目标：

```text
用户问题
  ↓
多路召回
  ├─ GitNexus semantic
  ├─ GitNexus BM25 / FTS
  ├─ GitNexus symbol / graph
  └─ Zoekt exact / regex / substring
  ↓
统一结果结构
  ↓
加权 RRF 融合
  ↓
GitNexus graph enrichment
  ↓
Process / Module / File 聚合
  ↓
返回给 Agent