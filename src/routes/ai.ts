import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { auth } from '../auth';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface GenerateCaptionBody {
  content: string;         // the post text/topic
  tone?: string;           // professional | casual | inspirational | humorous
  post_type?: string;      // text | image | link
}

export default async function aiRoutes(fastify: FastifyInstance) {

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
        const message = await client.messages.create({
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
        const message = await client.messages.create({
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
