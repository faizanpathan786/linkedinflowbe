import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { auth } from '../auth';

const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const openRouterClient = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
});

interface GeneratePostBody {
  answers: {
    q1: string;  // what happened (required)
    q2?: string; // who it was for
    q3?: string; // what was learned
    q4?: string; // uncomfortable truth
    q5?: string; // what reader should do
  };
  style?: 'story' | 'opinion' | 'insight';
  brand_voice?: {
    tone?: string;
    style?: string;
    examples?: string;
  };
}

export function buildSystemPrompt(brand_voice: GeneratePostBody['brand_voice'], _style: string): string {
  const examplesBlock = brand_voice?.examples?.trim()
    ? `\nYou write exactly like this person. Study these example posts and mirror their sentence length, rhythm, hook style, closing style, and vocabulary:\n\nEXAMPLE POSTS:\n${brand_voice.examples.trim()}\n`
    : '';

  const toneBlock = brand_voice?.tone?.trim() ? `\nTone: ${brand_voice.tone.trim()}` : '';
  const styleBlock = brand_voice?.style?.trim() ? `\nVoice notes: ${brand_voice.style.trim()}` : '';

  return `You are a world-class LinkedIn ghostwriter for B2B founders. Your posts consistently go viral because they feel personal, earned, and specific — never generic, never corporate.
${examplesBlock}${toneBlock}${styleBlock}

Your writing rules:
- Open with a hook that stops the scroll in the first 2 seconds
- Write like you're texting a smart friend, not presenting to a boardroom
- Use short sentences. One idea per line. White space is your friend.
- Every paragraph must earn its place — cut anything that doesn't add tension, proof, or insight
- End with something that makes the reader think or act
- Never use: "In today's world", "I'm excited to share", "Game-changer", "Leverage", "Synergy", "Thrilled", "Journey", "Hustle"
- No corporate jargon, no buzzwords, no filler
- Max 280 words per post

Anti-AI rules (never violate):
- No hedging: never write "it's important to", "I think", "perhaps", "one might", "it's worth noting"
- No throat-clearing openers: never start with "As a [title]", "In my experience", "I wanted to share", "I'm proud to"
- No passive voice — every sentence has an active subject doing something
- No filler transitions: never use "Furthermore", "Moreover", "In conclusion", "At the end of the day", "Having said that"
- No motivational poster language: never write "Success is a journey", "Embrace the process", "Every challenge is an opportunity"
- If example posts are provided above, mirror their sentence rhythm exactly`;
}

function buildUserPrompt(
  answers: GeneratePostBody['answers'],
  style: string,
  brand_voice: GeneratePostBody['brand_voice'],
): string {
  return `Write 3 LinkedIn post variations. Style: ${style}

Style guide:
- story: narrative arc (setup → conflict → resolution → lesson), drop the reader into the middle of the action
- opinion: bold opening claim + 2-3 concrete reasons + debate-inviting close
- insight: lead with the counterintuitive truth, then the breakdown

${brand_voice?.tone ? `Tone: ${brand_voice.tone}` : ''}
${brand_voice?.style ? `Voice notes: ${brand_voice.style}` : ''}
${brand_voice?.examples ? `Example posts from this person:\n${brand_voice.examples}` : ''}

What happened: ${answers.q1}
Who it's for: ${answers.q2 || 'founders and professionals'}
What the reader should do differently: ${answers.q5 || 'think differently about this topic'}

Use a DIFFERENT hook type for each variation:
Variation 1 — open with a specific number, stat, or concrete detail
Variation 2 — open with a counter-intuitive statement or confession
Variation 3 — open with a tension-building question

Format each variation as:
[Hook — 1 sentence, max 15 words]
[blank line]
[Body — 3-5 short paragraphs, 1-3 sentences each, blank line between]
[blank line]
[Closing — 1 punchy takeaway or CTA]

Hard rules:
- Never start with "In today's", "I'm excited to share", "Thrilled to", "Game-changer", or "Leverage"
- No buzzwords or jargon
- First person, past tense for story / present tense for opinion & insight
- Max 280 words per variation

Return ONLY valid JSON — no markdown fences, no explanation, nothing else:
{"variations":[{"type":"stat-hook","hook":"<hook sentence>","content":"<full post>"},{"type":"confession-hook","hook":"<hook sentence>","content":"<full post>"},{"type":"tension-hook","hook":"<hook sentence>","content":"<full post>"}]}`;
}

interface RephrasePostBody {
  content: string;
  brand_voice?: {
    tone?: string;
    style?: string;
    examples?: string;
  };
}

interface GenerateCaptionBody {
  content: string;         // the post text/topic
  tone?: string;           // professional | casual | inspirational | humorous
  post_type?: string;      // text | image | link
}

export default async function aiRoutes(fastify: FastifyInstance) {

  // POST /api/posts/generate — AI Interview: generate 3 LinkedIn post variations
  fastify.post(
    '/api/posts/generate',
    async (request: FastifyRequest<{ Body: GeneratePostBody }>, reply: FastifyReply) => {
      const session = await auth.api.getSession({ headers: request.headers as any });
      if (!session) return reply.status(401).send({ error: 'Unauthorized' });

      const { answers, style = 'story', brand_voice } = request.body ?? ({} as GeneratePostBody);

      if (!answers?.q1?.trim()) {
        return reply.status(400).send({ error: 'At least q1 (what happened) is required' });
      }

      if (!process.env.GROQ_API_KEY) {
        return reply.status(500).send({ error: 'AI generation not configured' });
      }

      const callGroq = async () => {
        const completion = await openRouterClient.chat.completions.create({
          model: 'openai/gpt-4o-mini',
          messages: [
            { role: 'system', content: buildSystemPrompt(brand_voice, style) },
            { role: 'user', content: buildUserPrompt(answers, style, brand_voice) },
          ],
          temperature: 0.85,
          max_tokens: 4000,
        });
        return completion.choices[0]?.message?.content ?? '';
      };

      const parseRaw = (raw: string) => {
        // Strip markdown fences if model wrapped response
        let clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        // Extract JSON object if model added preamble text
        const jsonStart = clean.indexOf('{');
        const jsonEnd = clean.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1) clean = clean.slice(jsonStart, jsonEnd + 1);
        const result = JSON.parse(clean) as { variations: Array<{ type: string; hook: string; content: string }> };
        if (!Array.isArray(result.variations) || result.variations.length === 0) throw new Error('empty variations array');
        return result;
      };

      let raw: string;
      try {
        raw = await callGroq();
      } catch (err: any) {
        fastify.log.error({ err: err.message, status: err.status }, 'Groq generate error');
        return reply.status(500).send({ error: 'Failed to generate posts', message: err.message });
      }

      let parsed: { variations: Array<{ type: string; hook: string; content: string }> };
      try {
        parsed = parseRaw(raw);
      } catch (parseErr: any) {
        fastify.log.warn({ raw, parseErr: parseErr.message }, 'First parse failed — retrying');
        try {
          const raw2 = await callGroq();
          parsed = parseRaw(raw2);
        } catch (err2: any) {
          fastify.log.error({ raw, err: err2.message }, 'Second parse also failed');
          return reply.status(500).send({ error: 'Failed to parse AI response', detail: err2.message });
        }
      }

      return reply.send({ variations: parsed.variations });
    }
  );


  // POST /api/posts/rephrase — rewrite a raw caption into a high-performing LinkedIn post
  fastify.post(
    '/api/posts/rephrase',
    async (request: FastifyRequest<{ Body: RephrasePostBody }>, reply: FastifyReply) => {
      let session: Awaited<ReturnType<typeof auth.api.getSession>>;
      try {
        session = await auth.api.getSession({ headers: request.headers as any });
      } catch {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      if (!session) return reply.status(401).send({ error: 'Unauthorized' });

      const { content, brand_voice } = request.body ?? ({} as RephrasePostBody);

      if (!content?.trim()) {
        return reply.status(400).send({ error: 'content is required' });
      }

      const brandVoiceText = [
        brand_voice?.tone && `Tone: ${brand_voice.tone}`,
        brand_voice?.style && `Style: ${brand_voice.style}`,
        brand_voice?.examples && `Examples:\n${brand_voice.examples}`,
      ]
        .filter(Boolean)
        .join('\n') || 'professional and authentic';

      const userMessage = `Brand voice: ${brandVoiceText}\n\nOriginal caption:\n${content}`;

      try {
        const completion = await openRouterClient.chat.completions.create({
          model: 'openai/gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are a LinkedIn content expert. Rewrite the user's raw caption into a high-performing LinkedIn post.

Brand voice context:
${brandVoiceText}

Anti-AI rules (never violate):
- No hedging: never write "it's important to", "I think", "perhaps", "one might", "it's worth noting"
- No throat-clearing openers: never start with "As a [title]", "In my experience", "I wanted to share", "I'm proud to"
- No passive voice — every sentence has an active subject doing something
- No filler transitions: never use "Furthermore", "Moreover", "In conclusion", "At the end of the day"
- No motivational poster language: never write "Success is a journey", "Embrace the process"
- If example posts are in the brand voice context above, mirror their sentence rhythm exactly

Rules:
- Keep the original message and facts — do NOT invent new information
- Open with a strong hook (first line must stop the scroll)
- Use short paragraphs (1–3 lines max) for mobile readability
- Add relevant line breaks and white space
- End with a clear call-to-action or thought-provoking question
- Sound human and professional — no corporate buzzwords, no cringe
- Stay under 3000 characters

Return ONLY the rewritten post text. No explanation, no preamble, no quotes around it.`,
            },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.8,
          max_tokens: 1200,
        });

        const rephrased = completion.choices[0]?.message?.content?.trim() ?? '';
        return reply.send({ success: true, content: rephrased });
      } catch (err: any) {
        fastify.log.error({ err: err.message }, 'Rephrase error');
        return reply.status(500).send({ success: false, message: 'Failed to rephrase' });
      }
    }
  );

  fastify.post(
    '/ai/generate-caption',
    {
      schema: {
        body: {
          type: 'object',
          required: ['content'],
          properties: {
            content: { type: 'string', minLength: 1, maxLength: 5000 },
            tone: {
              type: 'string',
              enum: ['professional', 'casual', 'inspirational', 'humorous'],
              default: 'professional',
            },
            post_type: {
              type: 'string',
              enum: ['text', 'image', 'link'],
              default: 'text',
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: GenerateCaptionBody }>,
      reply: FastifyReply
    ) => {
      const session = await auth.api.getSession({ headers: request.headers as any });
      if (!session) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { content, tone = 'professional', post_type = 'text' } = request.body;

      const toneGuide: Record<string, string> = {
        professional: 'formal, authoritative, and business-focused',
        casual: 'friendly, conversational, and relatable',
        inspirational: 'motivating, uplifting, and thought-provoking',
        humorous: 'witty, light-hearted, and engaging',
      };

      const postTypeGuide: Record<string, string> = {
        text: 'a text-only LinkedIn post',
        image: 'a LinkedIn post with an image',
        link: 'a LinkedIn post sharing an article or link',
      };

      try {
        const message = await anthropicClient.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          system: `You are an expert LinkedIn content writer who specializes in writing high-performing captions.
Your captions always:
- Start with a strong hook that grabs attention
- Include relevant emojis where appropriate
- Use line breaks for readability
- End with a call-to-action or thought-provoking question
- Include 3-5 relevant hashtags at the end
- Are optimized for LinkedIn's algorithm
Keep the caption concise (150-300 words) unless the post requires more detail.`,
          messages: [
            {
              role: 'user',
              content: `Generate a ${toneGuide[tone]} caption for ${postTypeGuide[post_type]}.

Post content/topic:
${content}

Write only the caption — no explanations or additional commentary.`,
            },
          ],
        });

        const caption = message.content[0].type === 'text' ? message.content[0].text : '';

        return reply.send({
          success: true,
          caption,
          usage: {
            input_tokens: message.usage.input_tokens,
            output_tokens: message.usage.output_tokens,
          },
        });
      } catch (err: any) {
        fastify.log.error('AI caption generation error:', err.message);
        return reply.status(500).send({
          success: false,
          error: 'Failed to generate caption',
          message: err.message,
        });
      }
    }
  );

  // Generate multiple caption variations at once
  fastify.post(
    '/ai/generate-captions',
    {
      schema: {
        body: {
          type: 'object',
          required: ['content'],
          properties: {
            content: { type: 'string', minLength: 1, maxLength: 5000 },
            tones: {
              type: 'array',
              items: { type: 'string', enum: ['professional', 'casual', 'inspirational', 'humorous'] },
              default: ['professional', 'casual', 'inspirational'],
              maxItems: 4,
            },
            post_type: {
              type: 'string',
              enum: ['text', 'image', 'link'],
              default: 'text',
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: { content: string; tones?: string[]; post_type?: string } }>,
      reply: FastifyReply
    ) => {
      const session = await auth.api.getSession({ headers: request.headers as any });
      if (!session) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { content, tones = ['professional', 'casual', 'inspirational'], post_type = 'text' } = request.body;

      try {
        const message = await anthropicClient.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2048,
          system: `You are an expert LinkedIn content writer who specializes in writing high-performing captions.
Your captions always:
- Start with a strong hook that grabs attention
- Include relevant emojis where appropriate
- Use line breaks for readability
- End with a call-to-action or thought-provoking question
- Include 3-5 relevant hashtags at the end
- Are optimized for LinkedIn's algorithm`,
          messages: [
            {
              role: 'user',
              content: `Generate ${tones.length} different LinkedIn caption variations for a ${post_type} post.

Post content/topic:
${content}

Write one variation for each of these tones: ${tones.join(', ')}.

Format your response as valid JSON with this exact structure:
{
  "captions": [
    { "tone": "professional", "caption": "..." },
    { "tone": "casual", "caption": "..." }
  ]
}

Write only the JSON — no explanations.`,
            },
          ],
        });

        const raw = message.content[0].type === 'text' ? message.content[0].text : '{}';

        let parsed: any;
        try {
          // Strip markdown code fences if present
          const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          parsed = JSON.parse(clean);
        } catch {
          parsed = { captions: [] };
        }

        return reply.send({
          success: true,
          captions: parsed.captions ?? [],
          usage: {
            input_tokens: message.usage.input_tokens,
            output_tokens: message.usage.output_tokens,
          },
        });
      } catch (err: any) {
        fastify.log.error('AI captions generation error:', err.message);
        return reply.status(500).send({
          success: false,
          error: 'Failed to generate captions',
          message: err.message,
        });
      }
    }
  );
}
