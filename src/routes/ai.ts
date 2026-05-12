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

function buildSystemPrompt(brand_voice: GeneratePostBody['brand_voice'], style: string): string {
  const tone = brand_voice?.tone ?? 'professional';
  const styleNotes = brand_voice?.style ?? 'Short sentences. No buzzwords. Write like you talk.';
  const examples = brand_voice?.examples ?? '';

  return `You are a LinkedIn ghostwriter for B2B founders. You write in a direct, human voice — no fluff, no buzzwords, no "I'm excited to share".

Rules:
- Never start with "I'm excited", "Thrilled to", "In today's fast-paced"
- Short sentences. One idea per line. White space is your friend.
- End with a question or a clear call to action
- The post should sound like the founder wrote it at 11pm after a good day
- Maximum 1300 characters per variation

Brand voice tone: ${tone}
Style notes: ${styleNotes}
${examples ? `Example posts from this founder:\n${examples}` : ''}

Generate exactly 3 LinkedIn post variations based on the interview answers.
Requested style emphasis: ${style}

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "variations": [
    { "type": "story", "hook": "first line of the post", "content": "full post text" },
    { "type": "opinion", "hook": "first line of the post", "content": "full post text" },
    { "type": "insight", "hook": "first line of the post", "content": "full post text" }
  ]
}`;
}

function buildUserPrompt(answers: GeneratePostBody['answers']): string {
  return `Interview answers:

What happened: ${answers.q1}
Who it was for: ${answers.q2 ?? 'Not specified'}
What was learned: ${answers.q3 ?? 'Not specified'}
The uncomfortable truth: ${answers.q4 ?? 'Not specified'}
What the reader should do: ${answers.q5 ?? 'Not specified'}

Generate 3 LinkedIn post variations (story, opinion, insight) using the brand voice rules above.`;
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
            { role: 'user', content: buildUserPrompt(answers) },
          ],
          temperature: 0.85,
          max_tokens: 2000,
        });
        raw = completion.choices[0]?.message?.content ?? '';
      } catch (err: any) {
        fastify.log.error('AI generate error:', err.message);
        if (err.message?.includes('timeout') || err.status === 408) {
          return reply.status(504).send({ error: 'Generation timed out — try again' });
        }
        return reply.status(500).send({ error: 'Failed to generate posts', message: err.message });
      }

      let parsed: { variations: Array<{ type: string; hook: string; content: string }> };
      try {
        const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        parsed = JSON.parse(clean);
        if (!Array.isArray(parsed.variations) || parsed.variations.length === 0) throw new Error('empty');
      } catch {
        fastify.log.error({ raw }, 'Failed to parse AI response');
        return reply.status(500).send({ error: 'Failed to parse AI response' });
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
