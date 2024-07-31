import type { BaseMessage } from "@langchain/core/messages";
import type { ChatOptions } from "./types";
import {
  DEFAULT_CHAT_SESSION_ID,
  DEFAULT_CHAT_RATELIMIT_SESSION_ID,
  DEFAULT_SIMILARITY_THRESHOLD,
  DEFAULT_TOP_K,
  DEFAULT_HISTORY_LENGTH,
  DEFAULT_HISTORY_TTL,
  DEFAULT_NAMESPACE,
} from "./constants";

export const sanitizeQuestion = (question: string) => {
  return question.trim().replaceAll("\n", " ");
};

export const formatFacts = (facts: string[]): string => {
  return facts.join("\n");
};

export const formatChatHistory = (chatHistory: BaseMessage[]) => {
  const formattedDialogueTurns = chatHistory.map((dialogueTurn) =>
    dialogueTurn._getType() === "human"
      ? `Human: ${dialogueTurn.content}`
      : `Assistant: ${dialogueTurn.content}`
  );

  return formatFacts(formattedDialogueTurns);
};

export function appendDefaultsIfNeeded(
  options: Partial<ChatOptions> | undefined
): Required<
  Omit<
    ChatOptions,
    "ratelimitDetails" | "onChunk" | "onContextFetched" | "onChatHistoryFetched" | "prompt"
  >
> {
  return {
    streaming: false,
    metadata: {},
    disableRAG: false,
    sessionId: DEFAULT_CHAT_SESSION_ID,
    ratelimitSessionId: DEFAULT_CHAT_RATELIMIT_SESSION_ID,
    similarityThreshold: DEFAULT_SIMILARITY_THRESHOLD,
    topK: DEFAULT_TOP_K,
    historyLength: DEFAULT_HISTORY_LENGTH,
    historyTTL: DEFAULT_HISTORY_TTL,
    namespace: DEFAULT_NAMESPACE,
    ...options,
  };
}

const DEFAULT_DELAY = 20_000;
export function delay(ms = DEFAULT_DELAY): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
