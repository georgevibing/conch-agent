import { describe, expect, it } from 'vitest';

import { toolRefusal } from './refusals';

describe('telling a refused schema from a model without tools (ADR 0069)', () => {
  it.each([
    "Invalid schema for function 'search': In context=('properties', 'when'), 'format' is not supported.",
    'Invalid JSON payload received. Unknown name "additionalProperties" at \'tools[0].function_declarations[0].parameters\': Cannot find field.',
    '* GenerateContentRequest.tools[0].function_declarations[1].parameters.properties: should be non-empty for OBJECT type',
    'tools.0.custom.input_schema: JSON schema is invalid. It must match JSON Schema draft 2020-12',
    'tools.0.function.parameters: $ref is not supported',
    "Invalid 'tools[0].function.parameters': schema must be a JSON Schema of 'type: \"object\"', got 'type: \"None\"'.",
    'invalid_function_parameters: anyOf is not supported for function parameters',
  ])('a schema it won’t read: %s', (message) => {
    expect(toolRefusal(message)).toBe('schema');
  });

  it.each([
    'This model does not support tools',
    'registry.ollama.ai/library/gemma3:1b does not support tools',
    'No endpoints found that support tool use. Try disabling "tools".',
    'Function calling is not enabled for this model',
    'tool use is not supported by this model',
    '"auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set; tool_choice is not supported',
    "this model doesn't support function calling",
  ])('a model without tools: %s', (message) => {
    expect(toolRefusal(message)).toBe('tools');
  });

  it.each([
    'Unrecognized request argument supplied: reasoning_effort',
    'thinking is not supported for this model',
  ])('a thinking level it won’t take: %s', (message) => {
    expect(toolRefusal(message)).toBe('effort');
  });

  it.each([
    "This model's maximum context length is 8192 tokens. However, you requested 9000 tokens.",
    'Invalid value for messages[2].content: expected a string',
    'Your credit balance is too low',
    '',
  ])('anything else is not about tools: %s', (message) => {
    expect(toolRefusal(message)).toBeUndefined();
  });
});
