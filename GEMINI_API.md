# Gemini API Integration

This document describes the Gemini API integration for competitor research and AI-powered text generation.

## Overview

The Gemini API integration provides two main functionalities:
1. **Competitor Analysis** - Analyze social media data to extract structured insights
2. **Text Generation** - Generate text using Gemini AI

## Setup

### 1. Environment Variables

Add your Gemini API key to your environment:

```bash
export GEMINI_API_KEY=your_gemini_api_key_here
```

### 2. Install Dependencies

```bash
pnpm install
```

## API Endpoints

### 1. Competitor Analysis

**POST** `/api/gemini/analyze`

Analyzes social media data for competitor research insights.

#### Request Body

```json
{
  "dataset": [
    {
      "url": "https://twitter.com/YouTubeCreators/status/1968006044795441438",
      "Tweet": "YouTube Creators just announced new tools...",
      "Likes": "0",
      "Comments": [
        "Comment 1...",
        "Comment 2..."
      ]
    }
  ],
  "prompt": "Optional custom analysis prompt"
}
```

#### Response

```json
{
  "success": true,
  "data": {
    "features": [
      {
        "canonical": "AI video generation with Veo 3",
        "evidence_ids": ["comment_1", "comment_2"]
      }
    ],
    "complaints": [
      {
        "canonical": "Algorithm shadowbanning issues",
        "evidence_ids": ["comment_3"]
      }
    ],
    "leads": [
      {
        "username": "user123",
        "platform": "twitter",
        "excerpt": "Looking for alternatives to YouTube",
        "reason": "Frustrated with algorithm"
      }
    ]
  }
}
```

### 2. Text Generation

**POST** `/api/gemini/generate`

Generates text using Gemini AI.

#### Request Body

```json
{
  "text": "What are the key features of YouTube's new AI tools?",
  "prompt": "Provide a concise summary"
}
```

#### Response

```json
{
  "success": true,
  "data": {
    "text": "YouTube's new AI tools include Veo 3 for video generation...",
    "usage": {
      "prompt_tokens": 25,
      "completion_tokens": 150,
      "total_tokens": 175
    }
  }
}
```

### 3. Health Check

**GET** `/api/gemini/health`

Checks the health and configuration of the Gemini API.

#### Response

```json
{
  "success": true,
  "status": "ready",
  "api_key_configured": true
}
```

## Usage Examples

### Using the Service Directly

```typescript
import { analyzeCompetitorData, generateText } from './src/services/gemini-service';

// Competitor analysis
const analysisResult = await analyzeCompetitorData({
  dataset: yourSocialMediaData,
  prompt: "Analyze for competitor insights"
});

// Text generation
const textResult = await generateText({
  text: "Your input text here",
  prompt: "Optional custom prompt"
});
```

### Using the API Endpoints

```bash
# Competitor analysis
curl -X POST http://localhost:3000/api/gemini/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "dataset": [{"url": "...", "Tweet": "...", "Comments": [...]}],
    "prompt": "Analyze for competitor insights"
  }'

# Text generation
curl -X POST http://localhost:3000/api/gemini/generate \
  -H "Content-Type: application/json" \
  -d '{
    "text": "What are the key features?",
    "prompt": "Provide a summary"
  }'

# Health check
curl http://localhost:3000/api/gemini/health
```

## Running the Example

```bash
# Set your API key
export GEMINI_API_KEY=your_api_key_here

# Run the example
npx ts-node examples/gemini-example.ts
```

## Error Handling

The API includes comprehensive error handling:

- **400 Bad Request**: Invalid input data or validation errors
- **500 Internal Server Error**: API key not configured or Gemini API errors

All errors return a consistent format:

```json
{
  "success": false,
  "error": "Error description"
}
```

## Data Validation

All requests and responses are validated using Zod schemas:

- Input data is validated against request schemas
- Response data is validated against response schemas
- Maximum limits are enforced (e.g., 5 items per category, 1000 characters for prompts)

## Rate Limits

The API respects Gemini's rate limits and includes:

- Token usage tracking
- Request size limits
- Response validation

## Security

- API key is required and validated
- Input sanitization and validation
- Error messages don't expose sensitive information
