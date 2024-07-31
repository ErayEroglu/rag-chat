import { UpstashError } from "./error/model";

import { Config } from "./config";
import { DEFAULT_NAMESPACE, DEFAULT_PROMPT_WITHOUT_RAG } from "./constants";
import { ContextService } from "./context-service";
import { Database } from "./database";
import { RatelimitUpstashError } from "./error";
import { UpstashVectorError } from "./error/vector";
import { HistoryService } from "./history-service";
import { LLMService } from "./llm-service";
import { ChatLogger } from "./logger";
import { RateLimitService } from "./ratelimit-service";
import type { ChatOptions, RAGChatConfig } from "./types";
import type { ModifiedChatOptions } from "./utils";
import { appendDefaultsIfNeeded, sanitizeQuestion } from "./utils";

export type PromptParameters = { chatHistory?: string; question: string; context: string };

export type CustomPrompt = ({ question, chatHistory, context }: PromptParameters) => string;

export type Message = { id: string; content: string; role: "ai" | "user" };
type ChatReturnType<T extends Partial<ChatOptions>> = Promise<
  T["streaming"] extends true
    ? {
        output: ReadableStream<string>;
        isStream: true;
      }
    : { output: string; isStream: false }
>;

export class RAGChat {
  private ratelimit: RateLimitService;
  private llm: LLMService;
  context: ContextService;
  history: HistoryService;
  private config: Config;
  private debug?: ChatLogger;

  constructor(config?: RAGChatConfig) {
    this.config = new Config(config);

    if (!this.config.vector) {
      throw new UpstashVectorError("Vector can not be undefined!");
    }

    if (!this.config.model) {
      throw new UpstashError("Model can not be undefined!");
    }

    const vectorService = new Database(this.config.vector);
    this.history = new HistoryService({
      redis: this.config.redis,
    });
    this.llm = new LLMService(this.config.model);
    this.context = new ContextService(vectorService, this.config.namespace ?? DEFAULT_NAMESPACE);
    this.debug = this.config.debug
      ? new ChatLogger({
          logLevel: "INFO",
          logOutput: "console",
        })
      : undefined;
    this.ratelimit = new RateLimitService(this.config.ratelimit);
  }

  /**
   * A method that allows you to chat LLM using Vector DB as your knowledge store and Redis - optional - as a chat history.
   *
   * @example
   * ```typescript
   *await ragChat.chat("Where is the capital of Turkey?", {
   *  stream: false,
   *})
   * ```
   */
  async chat<TChatOptions extends ChatOptions>(
    input: string,
    options?: TChatOptions
  ): Promise<ChatReturnType<TChatOptions>> {
    try {
      const optionsWithDefault = this.getOptionsWithDefaults(options);
      // Checks ratelimit of the user. If not enabled `success` will be always true.
      await this.checkRatelimit(optionsWithDefault);

      // 👇 when ragChat.chat is called, we first add the user message to chat history (without real id)
      await this.addUserMessageToHistory(input, optionsWithDefault);

      // Sanitizes the given input by stripping all the newline chars.
      const question = sanitizeQuestion(input);
      const context = await this.context.getContext(optionsWithDefault, input);
      const formattedHistory = await this.getChatHistory(optionsWithDefault);

      const prompt = await this.generatePrompt(
        optionsWithDefault,
        context,
        question,
        formattedHistory
      );

      //   Either calls streaming or non-streaming function from RAGChatBase. Streaming function returns AsyncIterator and allows callbacks like onComplete.
      return this.llm.callLLM<TChatOptions>(
        optionsWithDefault,
        prompt,
        options,
        {
          onChunk: optionsWithDefault.onChunk,
          onComplete: async (output) => {
            await this.debug?.endLLMResponse(output);
            await this.history.service.addMessage({
              message: {
                content: output,
                metadata: optionsWithDefault.metadata,
                role: "assistant",
              },
              sessionId: optionsWithDefault.sessionId,
            });
          },
        },
        this.debug
      );
    } catch (error) {
      await this.debug?.logError(error as Error);
      throw error;
    }
  }

  private async generatePrompt(
    optionsWithDefault: ModifiedChatOptions,
    context: string,
    question: string,
    formattedHistory: string
  ) {
    const prompt = optionsWithDefault.promptFn({
      context,
      question,
      chatHistory: formattedHistory,
    });
    await this.debug?.logFinalPrompt(prompt);
    return prompt;
  }

  private async getChatHistory(optionsWithDefault: ModifiedChatOptions) {
    this.debug?.startRetrieveHistory();
    // Gets the chat history from redis or in-memory store.
    const originalChatHistory = await this.history.service.getMessages({
      sessionId: optionsWithDefault.sessionId,
      amount: optionsWithDefault.historyLength,
    });
    const clonedChatHistory = structuredClone(originalChatHistory);
    const modifiedChatHistory =
      (await optionsWithDefault.onChatHistoryFetched?.(clonedChatHistory)) ?? originalChatHistory;
    await this.debug?.endRetrieveHistory(clonedChatHistory);

    // Formats the chat history for better accuracy when querying LLM
    const formattedHistory = modifiedChatHistory
      .reverse()
      .map((message) => {
        return message.role === "user"
          ? `USER MESSAGE: ${message.content}`
          : `YOUR MESSAGE: ${message.content}`;
      })
      .join("\n");
    await this.debug?.logRetrieveFormatHistory(formattedHistory);
    return formattedHistory;
  }

  private async addUserMessageToHistory(input: string, optionsWithDefault: ModifiedChatOptions) {
    await this.history.service.addMessage({
      message: { content: input, role: "user" },
      sessionId: optionsWithDefault.sessionId,
    });
  }

  private async checkRatelimit(optionsWithDefault: ModifiedChatOptions) {
    const ratelimitResponse = await this.ratelimit.checkLimit(
      optionsWithDefault.ratelimitSessionId
    );

    optionsWithDefault.ratelimitDetails?.(ratelimitResponse);
    if (!ratelimitResponse.success) {
      throw new RatelimitUpstashError("Couldn't process chat due to ratelimit.", {
        error: "ERR:USER_RATELIMITED",
        resetTime: ratelimitResponse.reset,
      });
    }
  }

  private getOptionsWithDefaults(options?: ChatOptions): ModifiedChatOptions {
    const isRagDisabledAndPromptFunctionMissing = options?.disableRAG && !options.promptFn;
    return appendDefaultsIfNeeded({
      ...options,
      metadata: options?.metadata ?? this.config.metadata,
      namespace: options?.namespace ?? this.config.namespace,
      streaming: options?.streaming ?? this.config.streaming,
      sessionId: options?.sessionId ?? this.config.sessionId,
      ratelimitSessionId: options?.ratelimitSessionId ?? this.config.ratelimitSessionId,
      promptFn: isRagDisabledAndPromptFunctionMissing
        ? DEFAULT_PROMPT_WITHOUT_RAG
        : (options?.promptFn ?? this.config.prompt),
    });
  }
}
