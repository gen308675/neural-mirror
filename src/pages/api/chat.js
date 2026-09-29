export const maxDuration = 60; // Allows Vercel serverless function up to 60s for streaming

export async function POST({ request }) {
  try {
    const body = await request.json();
    const messages = body.messages || [];

    const lastUserMessage =
      messages.slice().reverse().find((m) => m.role === 'user')?.content || 'Hello';
    const sessionId = body.sessionId || 'default-session';

    const N8N_WEBHOOK_URL = 'https://api.genmarkangus.dev/webhook/e4fda136-8b05-4eb5-9e20-747434b8524e/chat';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    // Call n8n Chat Trigger formatted specifically for streaming
    const n8nResponse = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream, application/json'
      },
      signal: controller.signal,
      body: JSON.stringify({
        action: 'sendMessage',
        chatInput: lastUserMessage,
        sessionId: sessionId,
      }),
    });

    clearTimeout(timeoutId);

    if (n8nResponse.ok) {
      // Stream the response body directly back to the client UI
      return new Response(n8nResponse.body, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    return new Response(
      JSON.stringify({ error: `n8n Webhook returned status ${n8nResponse.status}` }),
      { status: n8nResponse.status, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('API Chat Route Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', message: error?.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}