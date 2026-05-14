import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import Groq from 'groq-sdk';
import { auth } from '../auth';

const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const groqClient = new Groq({
  apiKey: process.env.GROQ_API_KEY,
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

function buildSystemPrompt(_brand_voice: GeneratePostBody['brand_voice'], _style: string): string {
  return `You are a world-class LinkedIn ghostwriter for founders and operators. You write posts that feel real, earned, and specific — never generic, never corporate. Your posts get high engagement because they are honest, concrete, and make the reader feel something.`;
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
{"variations":[{"type":"story","hook":"<hook sentence>","content":"<full post>"},{"type":"opinion","hook":"<hook sentence>","content":"<full post>"},{"type":"insight","hook":"<hook sentence>","content":"<full post>"}]}`;
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

      let raw: string;
      try {
        const completion = await groqClient.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: buildSystemPrompt(brand_voice, style) },
            { role: 'user', content: buildUserPrompt(answers, style, brand_voice) },
          ],
          temperature: 0.85,
          max_tokens: 2000,
        });
        raw = completion.choices[0]?.message?.content ?? '';
      } catch (err: any) {
        fastify.log.error({ err: err.message, status: err.status, code: err.code }, 'AI generate error');
        if (err.message?.includes('timeout') || err.status === 408) {
          return reply.status(504).send({ error: 'Generation timed out — try again' });
        }
        return reply.status(500).send({ error: 'Failed to generate posts', message: err.message });
      }

      let parsed: { variations: Array<{ type: string; hook: string; content: string }> };
      try {
        const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        // Escape literal control characters inside JSON string values
        const sanitized = clean.replace(/"((?:[^"\\]|\\.)*)"/g, (match) =>
          match.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
        );
        parsed = JSON.parse(sanitized);
        if (!Array.isArray(parsed.variations) || parsed.variations.length === 0) throw new Error('empty variations array');
      } catch (parseErr: any) {
        fastify.log.error({ raw, parseErr: parseErr.message }, 'Failed to parse AI response');
        return reply.status(500).send({ error: 'Failed to parse AI response', detail: parseErr.message, raw });
      }

      return reply.send({ variations: parsed.variations });
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
