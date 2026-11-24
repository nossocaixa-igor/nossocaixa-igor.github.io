// Nosso Caixa – avisos de pagamento por notificação (web push). Desligar "Verify JWT" desta função.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addM = (ym: string, k: number) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + k, 1)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; };
const norm = (x: string) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter((w) => w.length > 1).slice(0, 3).join(' ');
const brl = (n: number) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const br = (s: string) => s.split('-').reverse().join('/');
// deno-lint-ignore no-explicit-any
type Any = any;
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    let body: Any = {}; try { body = await req.json(); } catch { /* */ }
    let { data: k } = await sb.from('privado').select('valor').eq('chave', 'vapid').maybeSingle();
    if (!k) { const v = webpush.generateVAPIDKeys(); await sb.from('privado').insert({ chave: 'vapid', valor: v }); k = { valor: v }; }
    const v = k.valor as { publicKey: string; privateKey: string };
    if (body.acao === 'vapid') return json({ publicKey: v.publicKey });
    webpush.setVapidDetails('mailto:avisos@nossocaixa.app', v.publicKey, v.privateKey);
    const enviar = async (subs: Any[], msg: Any) => {
      let n = 0;
      for (const s of subs) {
        try { await webpush.sendNotification(s.sub, JSON.stringify(msg), { TTL: 86400 }); n++; }
        catch (e: Any) { if (e?.statusCode === 404 || e?.statusCode === 410) await sb.from('push_subs').delete().eq('endpoint', s.endpoint); }
      }
      return n;
    };
    if (body.acao === 'teste') {
      const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
      const { data: u } = await sb.auth.getUser(jwt);
      if (!u?.user) return json({ error: 'faça login' }, 401);
      const { data: subs } = await sb.from('push_subs').select('*').eq('user_id', u.user.id);
      return json({ enviados: await enviar(subs || [], { title: 'Nosso Caixa', body: 'Teste: as notificações deste celular estão funcionando.', tag: 'teste' }) });
    }
    // rotina diária: contas perto do vencimento
    const agora = new Date(Date.now() - 3 * 3600e3); // horário de Brasília
    const hoje = iso(agora), cur = hoje.slice(0, 7);
    const { data: rows } = await sb.from('docs').select('path,col,data').or('col.eq.contas,col.eq.lanc,col.like.data/users/*');
    const contas: Any[] = [], lanc: Any[] = [], prefs: Record<string, Any> = {};
    for (const r of rows || []) {
      if (r.col === 'contas') contas.push({ id: r.path.split('/').pop(), ...r.data });
      else if (r.col === 'lanc') lanc.push(r.data);
      else if (r.path.endsWith('/prefs')) prefs[r.col.split('/')[2]] = r.data;
    }
    const venc = (c: Any, ym: string) => { if (!c.recorrente) return c.data || ''; const [y, m] = ym.split('-').map(Number); const ult = new Date(Date.UTC(y, m, 0)).getUTCDate(); return `${ym}-${pad(Math.min(Number(c.dia) || 1, ult))}`; };
    const paga = (c: Any, ym: string) => { if ((c.pagas || {})[c.recorrente ? ym : 'unica']) return true; const kk = c.chave || norm(c.nome); return lanc.some((l) => l.tipo === 'saida' && String(l.data || '').slice(0, 7) === ym && (l.contaId === c.id || (kk && norm(l.desc) === kk))); };
    const { data: subs } = await sb.from('push_subs').select('*');
    const porUser: Record<string, Any[]> = {};
    for (const s of subs || []) (porUser[s.user_id] ||= []).push(s);
    let total = 0;
    for (const uidKey of Object.keys(porUser)) {
      const p = prefs[uidKey] || {};
      if (p.notif === false) continue;
      const dias = Number(p.dias) || 3;
      const lim = iso(new Date(agora.getTime() + dias * 864e5)), min = iso(new Date(agora.getTime() - 7 * 864e5));
      const itens: Any[] = [];
      for (const ym of [cur, addM(cur, 1)]) for (const c of contas) {
        if (c.recorrente ? ((c.inicio && c.inicio > ym) || (c.fim && ym > c.fim)) : String(c.data || '').slice(0, 7) !== ym) continue;
        const vv = venc(c, ym); if (!vv || vv > lim || vv < min || paga(c, ym)) continue;
        itens.push({ c, vv });
      }
      if (!itens.length) continue;
      itens.sort((a, b) => a.vv.localeCompare(b.vv));
      const dd = (s: string) => Math.round((Date.parse(s) - Date.parse(hoje)) / 864e5);
      const quando = (s: string) => { const d = dd(s); return d < 0 ? `venceu há ${-d} dia(s)` : d === 0 ? 'vence hoje' : `vence em ${d} dia(s)`; };
      const msg = itens.length === 1
        ? { title: `${itens[0].c.nome} ${quando(itens[0].vv)}`, body: `${brl(itens[0].c.valor)} · ${br(itens[0].vv)}. Toque para abrir.`, tag: 'contas' }
        : { title: `${itens.length} contas a pagar`, body: itens.slice(0, 4).map((i) => `${i.c.nome}: ${brl(i.c.valor)} (${quando(i.vv)})`).join('\n'), tag: 'contas' };
      total += await enviar(porUser[uidKey], { ...msg, url: './#contas' });
    }
    return json({ ok: true, enviados: total });
  } catch (e) { return json({ error: String((e as Error).message || e) }, 500); }
});
