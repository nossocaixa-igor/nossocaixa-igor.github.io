// Nosso Caixa – IA de análise (Gemini). Segredo necessário: GEMINI_API_KEY. Opcional: GEMINI_MODEL.
import { createClient } from 'npm:@supabase/supabase-js@2';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
    const { data: u } = await sb.auth.getUser(jwt);
    if (!u?.user?.email) return json({ error: 'faça login' }, 401);
    const { data: m } = await sb.from('membros').select('email').eq('email', u.user.email.toLowerCase()).maybeSingle();
    if (!m) return json({ error: 'usuário não cadastrado' }, 403);
    const { prompt, images = [] } = await req.json();
    if (typeof prompt !== 'string' || prompt.length > 200000) return json({ error: 'pedido inválido' }, 400);
    const key = Deno.env.get('GEMINI_API_KEY');
    if (!key) return json({ error: 'chave do Gemini não configurada' }, 500);
    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-flash-latest';
    const parts: unknown[] = [{ text: prompt }, ...images.slice(0, 4).map((d: string) => ({ inline_data: { mime_type: 'image/jpeg', data: d } }))];
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }),
    });
    const j = await r.json();
    if (!r.ok) return json({ error: j?.error?.message || 'falha no Gemini' }, 502);
    const txt = (j.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || '').join('');
    let out = null;
    try { out = JSON.parse(txt); } catch { const mm = txt.match(/[\[{][\s\S]*[\]}]/); if (mm) try { out = JSON.parse(mm[0]); } catch { /* */ } }
    if (!out) return json({ error: 'a IA não devolveu dados válidos' }, 502);
    return json({ json: out });
  } catch (e) { return json({ error: String((e as Error).message || e) }, 500); }
});
