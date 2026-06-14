import type { EmbeddableNode } from './types.js';
import { isShortLabel } from './types.js';

const SUMMARY_PROMPT_VERSION = 'zh-business-keywords-v1';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_CHARS = 6_000;
const DEFAULT_MODEL = 'qwen2.5-coder-3b-keyword-summary';
const DEFAULT_LANGUAGE = '中文';

const readPositiveInt = (value: string | undefined, fallback: number): number => {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const envFlagEnabled = (value: string | undefined): boolean => {
  if (value === undefined) return false;
  return !['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase());
};

const stripJsonFence = (text: string): string => {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match ? match[1].trim() : trimmed;
};

const pickStringArray = (value: unknown, maxItems: number): string[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, maxItems)
    : [];

export const isKeywordSummaryEnabled = (): boolean =>
  envFlagEnabled(process.env.GITNEXUS_KEYWORD_SUMMARY_ENABLED);

export const getKeywordSummaryLanguage = (): string =>
  (process.env.GITNEXUS_KEYWORD_SUMMARY_LANGUAGE || DEFAULT_LANGUAGE).trim() || DEFAULT_LANGUAGE;

export const getKeywordSummaryHashSalt = (): string =>
  isKeywordSummaryEnabled()
    ? `keyword-summary:${SUMMARY_PROMPT_VERSION}:${getKeywordSummaryLanguage()}`
    : 'keyword-summary:off';

export const shouldSummarizeNode = (node: EmbeddableNode): boolean =>
  isKeywordSummaryEnabled() &&
  !isShortLabel(node.label) &&
  ['Function', 'Method', 'Constructor', 'Class', 'Interface', 'Struct'].includes(node.label);

type SummaryPayload = {
  businessKeywords?: unknown;
  technicalKeywords?: unknown;
  intent?: unknown;
  aliases?: unknown;
};

const formatSummary = (payload: SummaryPayload, language: string): string | undefined => {
  const businessKeywords = pickStringArray(payload.businessKeywords, 8);
  const technicalKeywords = pickStringArray(payload.technicalKeywords, 8);
  const aliases = pickStringArray(payload.aliases, 6);
  const intent = typeof payload.intent === 'string' ? payload.intent.trim() : '';

  if (!businessKeywords.length && !technicalKeywords.length && !aliases.length && !intent) {
    return undefined;
  }

  return [
    `[${language}业务摘要]`,
    businessKeywords.length ? `业务词: ${businessKeywords.join(', ')}` : undefined,
    technicalKeywords.length ? `技术词: ${technicalKeywords.join(', ')}` : undefined,
    intent ? `意图: ${intent}` : undefined,
    aliases.length ? `别名: ${aliases.join(', ')}` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
};

const summaryCache = new Map<string, string | undefined>();

export const clearKeywordSummaryCacheForTests = (): void => {
  summaryCache.clear();
};

export const buildKeywordSummaryPrefix = async (
  node: EmbeddableNode,
  embeddingText: string,
  contentHash: string,
): Promise<string | undefined> => {
  if (!shouldSummarizeNode(node)) return undefined;

  const baseUrl = process.env.GITNEXUS_KEYWORD_SUMMARY_URL?.replace(/\/+$/, '');
  if (!baseUrl) return undefined;
  const language = getKeywordSummaryLanguage();

  const cacheKey = `${node.id}:${contentHash}:${SUMMARY_PROMPT_VERSION}:${language}`;
  if (summaryCache.has(cacheKey)) return summaryCache.get(cacheKey);

  const maxChars = readPositiveInt(
    process.env.GITNEXUS_KEYWORD_SUMMARY_MAX_CHARS,
    DEFAULT_MAX_CHARS,
  );
  const timeoutMs = readPositiveInt(
    process.env.GITNEXUS_KEYWORD_SUMMARY_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
  );
  const model = process.env.GITNEXUS_KEYWORD_SUMMARY_MODEL || DEFAULT_MODEL;

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GITNEXUS_KEYWORD_SUMMARY_API_KEY ?? 'unused'}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 160,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              '你是代码检索关键词提取器。只输出紧凑 JSON，不要 Markdown。' +
              `摘要输出语言: ${language}。` +
              'businessKeywords 必须优先使用摘要输出语言里的业务词；英文技术词只作为 technicalKeywords 补充。' +
              '字段: businessKeywords, technicalKeywords, intent, aliases。',
          },
          {
            role: 'user',
            content:
              `节点: ${node.label} ${node.name}\n路径: ${node.filePath}\n` +
              `代码与上下文:\n${embeddingText.slice(0, maxChars)}`,
          },
        ],
      }),
    });

    if (!resp.ok) return undefined;

    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return undefined;

    const parsed = JSON.parse(stripJsonFence(content)) as SummaryPayload;
    const formatted = formatSummary(parsed, language);
    summaryCache.set(cacheKey, formatted);
    return formatted;
  } catch {
    return undefined;
  }
};
