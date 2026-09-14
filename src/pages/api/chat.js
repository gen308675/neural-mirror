import { streamText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createClient } from '@supabase/supabase-js';

const googleProvider = createGoogleGenerativeAI({
  apiKey: import.meta.env.GEMINI_API_KEY || (typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : ''),
});

const SUPABASE_URL = import.meta.env.SUPABASE_URL || (typeof process !== 'undefined' ? process.env.SUPABASE_URL : '');
const SUPABASE_ANON_KEY = import.meta.env.SUPABASE_ANON_KEY || (typeof process !== 'undefined' ? process.env.SUPABASE_ANON_KEY : '');

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const N8N_WEBHOOK_URL = 'https://api.genmarkangus.dev/webhook/neural-mirror';

/**
 * Fallback function to query Supabase directly if n8n is unreachable
 */
async function getSupabaseContext(query) {
  try {
    // 1. Generate embedding for user query via Gemini Embedding API
    const embedRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${import.meta.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/text-embedding-004',
          content: { parts: [{ text: query }] },
        }),
      }
    );

    if (!embedRes.ok) return '';
    const embedData = await embedRes.json();
    const queryVector = embedData?.embedding?.values;

    if (!queryVector) return '';

    // 2. Perform vector search in Supabase using the match_documents RPC function
    const { data: documents, error } = await supabase.rpc('match_documents', {
      query_embedding: queryVector,
      match_threshold: 0.25,
      match_count: 4,
    });

    if (error || !documents || documents.length === 0) return '';

    // 3. Format matched context chunks
    return documents.map((doc) => doc.content).join('\n---\n');
  } catch (err) {
    console.error('Supabase RAG fallback error:', err);
    return '';
  }
}

export async function POST({ request }) {
  let messages = [];

  try {
    const body = await request.json();
    messages = body.messages || [];

    const lastUserMessage = messages.slice().reverse().find((m) => m.role === 'user')?.content || 'Hello';
    const sessionId = body.sessionId || 'default-session';

    // 1. TRY PRIMARY ROUTE: N8N PRODUCTION WEBHOOK
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const n8nResponse = await fetch(N8N_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          message: lastUserMessage,
          messages: messages,
          sessionId: sessionId,
        }),
      });

      clearTimeout(timeoutId);

      if (n8nResponse.ok) {
        const n8nData = await n8nResponse.json();
        if (n8nData && n8nData.response) {
          return new Response(n8nData.response, {
            status: 200,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        }
      }
    } catch (n8nError) {
      clearTimeout(timeoutId);
    }

    // 2. FALLBACK ROUTE: Direct Supabase RAG Search + Gemini 2.5
    const retrievedContext = await getSupabaseContext(lastUserMessage);

    const systemPrompt = `
You are the "Neural Mirror Agent", an interactive AI proxy for Gen Mark Angus.
Your role is to present Gen Mark as a top-tier AI Automation Specialist & n8n Workflow Engineer.

=== THREE CORE FEATURED WORKFLOWS ===
1. Workflow 01 - Neural Mirror RAG Agent [TRIGGER:P1]: Continuous vector indexing via Supabase pgvector and grounded n8n agent response generation.
2. Workflow 02 - Multimodal Voice Transcriber [TRIGGER:P2]: Webhook audio processing using Groq Whisper API for real-time meeting/note summaries.
3. Workflow 03 - Lead Enrichment & Triage Engine [TRIGGER:P3]: Real-time lead validation using Abstract API, Supabase deduplication, and automated Telegram/Slack alert routing.

${retrievedContext ? `=== RETRIEVED KNOWLEDGE BASE CONTEXT ===\n${retrievedContext}\n` : ''}

Use the retrieved context above whenever relevant to ground your answers accurately. Maintain a polite, technical, and concise tone.
`;

    const result = streamText({
      model: googleProvider('gemini-2.5-flash-lite'),
      messages,
      system: systemPrompt,
      maxRetries: 5,
    });

    return result.toTextStreamResponse();

  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Internal server error', message: error?.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}