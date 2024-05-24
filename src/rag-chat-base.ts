/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AIMessage, BaseMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import { RunnableSequence, RunnableWithMessageHistory } from "@langchain/core/runnables";
import { LangChainAdapter, StreamingTextResponse } from "ai";

import type { BaseLanguageModelInterface } from "@langchain/core/language_models/base";
import type { PromptTemplate } from "@langchain/core/prompts";
import type { HistoryService, VectorPayload } from "./services";
import type { VectorService } from "./services/database";
import type { ChatOptions, PrepareChatResult } from "./types";
import { formatChatHistory, sanitizeQuestion } from "./utils";

type CustomInputValues = { chat_history?: BaseMessage[]; question: string; context: string };

export class RAGChatBase {
  protected vectorService: VectorService;
  protected historyService: HistoryService;

  #model: BaseLanguageModelInterface;
  #prompt: PromptTemplate;

  constructor(
    retrievalService: VectorService,
    historyService: HistoryService,
    config: { model: BaseLanguageModelInterface; prompt: PromptTemplate }
  ) {
    this.vectorService = retrievalService;
    this.historyService = historyService;

    this.#model = config.model;
    this.#prompt = config.prompt;
  }

  protected async prepareChat({
    question: input,
    similarityThreshold,
    topK,
    metadataKey,
  }: VectorPayload): Promise<PrepareChatResult> {
    const question = sanitizeQuestion(input);
    const facts = await this.vectorService.retrieve({
      question,
      similarityThreshold,
      metadataKey,
      topK,
    });
    return { question, facts };
  }

  /** This method first gets required params, then returns another function depending on streaming param input */
  chainCall(chatOptions: ChatOptions, question: string, facts: string) {
    const formattedHistoryChain = RunnableSequence.from<CustomInputValues>([
      {
        chat_history: (input) => formatChatHistory(input.chat_history ?? []),
        question: (input) => input.question,
        context: (input) => input.context,
      },
      this.#prompt,
      this.#model,
    ]);

    const chainWithMessageHistory = new RunnableWithMessageHistory({
      runnable: formattedHistoryChain,
      getMessageHistory: (sessionId: string) =>
        this.historyService.getMessageHistory({
          sessionId,
          length: chatOptions.historyLength,
        }),
      inputMessagesKey: "question",
      historyMessagesKey: "chat_history",
    });
    const runnableArgs = {
      input: {
        question,
        context: facts,
      },
      options: {
        configurable: { sessionId: chatOptions.sessionId },
      },
    };

    return (streaming: boolean) =>
      streaming
        ? this.streamingChainCall(chainWithMessageHistory, runnableArgs)
        : (chainWithMessageHistory.invoke(
            runnableArgs.input,
            runnableArgs.options
          ) as Promise<AIMessage>);
  }

  protected async streamingChainCall(
    runnable: RunnableWithMessageHistory<CustomInputValues, any>,
    runnableArgs: { input: CustomInputValues; options?: Partial<RunnableConfig> | undefined }
  ) {
    const stream = await runnable.stream(runnableArgs.input, runnableArgs.options);
    const wrappedStream = LangChainAdapter.toAIStream(stream);
    return new StreamingTextResponse(wrappedStream, {});
  }
}
