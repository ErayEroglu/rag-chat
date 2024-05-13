import type { BaseLanguageModelInterface } from "@langchain/core/language_models/base";
import type { PromptTemplate } from "@langchain/core/prompts";
import type { Index, Ratelimit, Redis } from "@upstash/sdk";

export type PreferredRegions = "eu-west-1" | "us-east-1";

export type ChatOptions = {
  /** Set to `true` if working with web apps and you want to be interactive without stalling users.
   */
  stream: boolean;

  /** Chat session ID of the user interacting with the application.
   * @default "upstash-rag-chat-session"
   */
  sessionId?: string;

  /** Length of the conversation history to include in your LLM query. Increasing this may lead to hallucinations. Retrieves the last N messages.
   * @default 5
   */
  historyLength?: number;

  /** Configuration to retain chat history. After the specified time, the history will be automatically cleared.
   * @default 86_400 // 1 day in seconds
   */
  historyTTL?: number;

  /** Configuration to adjust the accuracy of results.
   * @default 0.5
   */
  similarityThreshold?: number;

  /** Rate limit session ID of the user interacting with the application.
   * @default "upstash-rag-chat-ratelimit-session"
   */
  ratelimitSessionId?: string;

  /** Amount of data points to include in your LLM query.
   * @default 5
   */
  topK?: number;

  /** Key of metadata that we use to store additional content .
   * @default "text"
   * @example {text: "Capital of France is Paris"}
   *
   */
  metadataKey?: string;
};

export type PrepareChatResult = {
  question: string;
  facts: string;
};

type RAGChatConfigCommon = {
  /**Any valid Langchain compatiable LLM will work
   * @example new ChatOpenAI({
      modelName: "gpt-3.5-turbo",
      streaming: true,
      verbose,
      temperature: 0,
      apiKey,
    })
  */
  model?: BaseLanguageModelInterface;
  /**
   * If no Index name or instance is provided, falls back to the default.
   * @default
        PromptTemplate.fromTemplate(`You are a friendly AI assistant augmented with an Upstash Vector Store.
        To help you answer the questions, a context will be provided. This context is generated by querying the vector store with the user question.
        Answer the question at the end using only the information available in the context and chat history.
        If the answer is not available in the chat history or context, do not answer the question and politely let the user know that you can only answer if the answer is available in context or the chat history.

        -------------
        Chat history:
        {chat_history}
        -------------
        Context:
        {context}
        -------------

        Question: {question}
        Helpful answer:`)
   */
  template?: PromptTemplate;
  /**
   * Region that will be used to create or get Vector and Redis instance.
   * @default "us-east-1"
   */
  region?: PreferredRegions;
  /**
   * Ratelimit instance
   * @example new Ratelimit({
        redis,
        limiter: Ratelimit.tokenBucket(10, "1d", 10),
        prefix: "@upstash/rag-chat-ratelimit",
        })
   */
  ratelimit?: Ratelimit;
};

/**Config needed to initialize RAG Chat SDK */
export type RAGChatConfig = {
  /**
   * If no Index name or instance is provided, falls back to the default.
   * @default "upstash-rag-chat-redis"
   */
  vector?: string | Index;
  /**
   * If no Redis database name or instance is provided, falls back to the default.
   * @default "upstash-rag-chat-redis"
   */
  redis?: string | Redis;
} & RAGChatConfigCommon;
