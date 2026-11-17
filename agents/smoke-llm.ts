// Quick check that the key, model name and structured output all work: bun agents/smoke-llm.ts
import { plan, spend } from './llm';
const out = await plan<{ greeting: string }>('smoke', 'You reply in JSON.', 'Say hi in five words.', {
    type: 'object',
    properties: { greeting: { type: 'string' } },
    required: ['greeting'],
    additionalProperties: false
});
console.log(out, spend());
