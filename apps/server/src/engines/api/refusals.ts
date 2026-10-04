/**
 * A request refused over its tools, told apart from every other refusal (ADR 0072).
 *
 * A provider that won't take a request with tools says one of two things, and
 * each heals differently:
 *
 *  - `schema`: it reads tools, but not the way one of them was described
 *    (Gemini's "Unknown name additionalProperties", OpenAI's "Invalid schema
 *    for function", Anthropic's "input_schema: JSON schema is invalid"). The
 *    schemas are reduced to the plainest dialect and the request sent again.
 *  - `tools`: this model takes no tools at all ("does not support tools",
 *    OpenRouter's "No endpoints found that support tool use"). The tools go
 *    in the prompt instead.
 *
 * Schema words are read first, so a schema complaint that happens to say "not
 * supported" is never taken for a model that can't use tools. Neither is ever
 * a reason to drop the tools: that's only for a model that can't follow them
 * even in words.
 */
import { ApiError } from './types';

export type ToolRefusal = 'schema' | 'tools' | 'effort';

/** Words that point at how a tool was described, not whether tools are allowed. */
const SCHEMA =
  /json.?schema|input_schema|function_declarations?|functiondeclaration|invalid_function_parameters|invalid schema|schema for function|\$ref|\$defs|definitions|additionalproperties|unknown name|cannot find field|anyof|oneof|allof|\.parameters\b|parameters\.|\bproperties\b.*\b(non-empty|should|must|invalid|required)|\b(enum|format|pattern|nullable|items)\b.*\b(not supported|unsupported|invalid|unknown|only|must|should)/;

/** Words that say the model takes no tools at all. */
const TOOLS =
  /(tool|function)s?\b[^.]{0,60}\b(not supported|unsupported|not available|not enabled|not allowed|disabled)|(does not|doesn't|do not|cannot|can't|not) support[^.]{0,40}\b(tool|function)|no endpoints found that support tool|tool.?use is not|tool_choice/;

/** Words that say the model takes no thinking level. */
const EFFORT =
  /(reasoning|thinking|effort)[^.]{0,60}(not support|unsupported|invalid|unknown|unrecognized|not allowed)|(not support|unsupported|unrecognized)[^.]{0,40}(reasoning|thinking|effort)/;

/** What a 400 about tools (or a thinking level) means, from the provider's own words. */
export function toolRefusal(words: string): ToolRefusal | undefined {
  const said = words.toLowerCase();
  const tools = /\b(tool|function|schema|parameters|properties)/.test(said);
  if (tools && SCHEMA.test(said)) return 'schema';
  if (TOOLS.test(said)) return 'tools';
  if (EFFORT.test(said)) return 'effort';
  return undefined;
}

/** The failure the engine heals by itself: a schema to simplify, or tools to put in words. */
export function refusalError(refusal: 'schema' | 'tools', label: string): ApiError {
  return refusal === 'schema'
    ? new ApiError('schema', `${label} refused how one of the tools was described.`)
    : new ApiError('tools', `${label} can’t take tools with this model.`);
}
