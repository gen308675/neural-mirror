export async function POST({ request }) {
  try {
    const body = await request.json();
    const messages = body.messages || [];

    const lastUserMessage =
      messages.slice().reverse().find((m) => m.role === 'user')?.content || 'Hello';
    const sessionId = body.sessionId || 'default-session';

    const N8N_WEBHOOK_URL = 'https://api.genmarkangus.dev/webhook/e4fda136-8b05-4eb5-9e20-747434b8524e/chat';

    // Call n8n production webhook
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

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

      // Extract response string returned from n8n
      const responseText =
        n8nData?.response || n8nData?.output || 'No response returned from n8n.';

      // Return a ReadableStream so the client UI consumes the response without lagging
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controllerStream) {
          controllerStream.enqueue(encoder.encode(responseText));
          controllerStream.close();
        },
      });

      return new Response(stream, {
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