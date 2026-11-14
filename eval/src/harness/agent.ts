import type { TextModel } from '@liasse/core/models';
import { z } from 'zod';
import type { Question } from '../schema/index.ts';
import { agentPrompt, agentSystemPrompt, type Exchange } from './agent-prompt.ts';
import {
  type AgentAnswer,
  type AgentStep,
  agentStepOutputSchema,
  agentStepSchema,
} from './agent-schema.ts';
import type { McpSession, ToolResult } from './mcp-session.ts';

// Enough for the longest route of the reference questions (four calls) several times
// over; the last turn may only answer.
export const MAX_AGENT_TURNS = 12;

/** A call the agent made, as the report keeps it: without the result. */
export interface ToolCallRecord {
  readonly tool: string;
  readonly arguments: string;
  readonly is_error: boolean;
}

export interface AgentRun {
  /** Undefined when the agent gave none: see `failure`. */
  readonly answer: AgentAnswer | undefined;
  readonly calls: readonly ToolCallRecord[];
  /**
   * Why there is no answer: the model failed, or its output did not fit the schema, which
   * on the last turn allows the answer only.
   */
  readonly failure: string | undefined;
}

export interface AgentContext {
  readonly model: TextModel;
  readonly session: McpSession;
  readonly referenceDate: string;
}

const argumentsSchema = z.record(z.string(), z.unknown());

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const callTool = async (session: McpSession, tool: string, args: string): Promise<ToolResult> => {
  const parsed = argumentsSchema.safeParse(parseJson(args));
  if (!parsed.success) return { isError: true, text: 'The arguments are not one JSON object.' };
  try {
    return await session.call(tool, parsed.data);
  } catch (error) {
    return {
      isError: true,
      text: `The call failed: ${error instanceof Error ? error.name : 'error'}`,
    };
  }
};

const recordOf = ({ tool, arguments: args, result }: Exchange): ToolCallRecord => ({
  tool,
  arguments: args,
  is_error: result.isError,
});

const askModel = async (
  { model, session, referenceDate }: AgentContext,
  question: Question,
  exchanges: readonly Exchange[],
): Promise<AgentStep> => {
  // Each turn makes one call, so the exchanges count the turns already taken.
  const turnsLeft = MAX_AGENT_TURNS - exchanges.length;
  const toolNames = turnsLeft === 1 ? [] : session.tools.map(({ name }) => name);
  const { object } = await model.generateObject({
    schema: agentStepSchema(toolNames, question),
    system: agentSystemPrompt(session.tools, referenceDate),
    prompt: agentPrompt(question, exchanges, turnsLeft),
  });
  return agentStepOutputSchema.parse(object);
};

const describeFailure = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : 'the model failed';

const takeTurn = async (
  context: AgentContext,
  question: Question,
  exchanges: readonly Exchange[],
): Promise<AgentRun> => {
  const calls = exchanges.map(recordOf);
  const next = await askModel(context, question, exchanges).then(
    (step) => ({ step }),
    (error: unknown) => ({ failure: describeFailure(error) }),
  );
  if ('failure' in next) return { answer: undefined, calls, failure: next.failure };
  const { step } = next;
  if (step.action === 'answer') return { answer: step.answer, calls, failure: undefined };
  const result = await callTool(context.session, step.tool, step.arguments);
  return takeTurn(context, question, [
    ...exchanges,
    { tool: step.tool, arguments: step.arguments, result },
  ]);
};

/**
 * Lets the model answer one question with the read-only tools of the MCP server, one
 * turn at a time, each turn shown every call made so far. The model call is the one of
 * the text model port: no provider is named here.
 */
export const answerQuestion = (context: AgentContext, question: Question): Promise<AgentRun> =>
  takeTurn(context, question, []);
