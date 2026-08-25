/**
 * Conversation state helpers — re-export talk-context for the Talk package surface.
 */
export {
  getTalkContext,
  rememberTalkTurn,
  getConversation,
  rememberTurn,
  emptyTalkContext,
  type TalkContext,
  type TalkMessage,
  type TalkOption,
  type ConversationState,
} from "./talk-context.js";
