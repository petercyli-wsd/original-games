// The one place the API talks to Claude. Every call asks for JSON matching a
// schema, so results are machine-checked. `Llm` is an interface so tests can
// substitute a fake.

import Anthropic from '@anthropic-ai/sdk';

export const MODEL = 'claude-opus-5-5';

export interface JsonRequest {
  /** Stable text, cached across calls (rubric, catalogue). */
  system: string;
  user: string;
  schema: Record<string, unknown>;
  effort: 'low' | 'medium' | 'high';
}

export interface Llm {
  readonly model: string;
  json<T>(req: JsonRequest): Promise<T>;
}

export class LlmError extends Error {}

export function createClaude(apiKey: string): Llm {
  const client = new Anthropic({ apiKey, maxRetries: 3 });
  return {
    model: MODEL,
    async json<T>({ system, user, schema, effort }: JsonRequest): Promise<T> {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        // If a safety classifier declines, retry on Anthropic's recommended model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort, format: { type: 'json_schema', schema } },
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: user }],
      });

      if (response.stop_reason === 'refusal') {
        throw new LlmError(`Claude declined to answer (${response.stop_details?.category ?? 'unspecified'}).`);
      }
      if (response.stop_reason === 'max_tokens') {
        throw new LlmError('Claude ran out of output tokens before finishing.');
      }
      const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new LlmError(`Claude returned invalid JSON: ${text.slice(0, 200)}`);
      }
    },
  };
}
