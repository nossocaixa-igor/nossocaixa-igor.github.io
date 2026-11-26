// Nosso Caixa – avisos de pagamento por notificação (web push). Verify JWT desligado: a função faz a própria checagem.
// Segue o mesmo ciclo do app (datas de pagamento) e consulta os lançamentos para não cobrar o que já foi pago.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addM = (ym: string, k: number) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + k, 1)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; };
const addD = (s: string, n: number) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const norm = (x: string) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter((w) => w.length > 1).slice(0, 3).join(' ');
const toks = (x: string) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter((w) => w.length > 2 && !['pix', 'pagamento', 'pago', 'para', 'com', 'das', 'dos', 'ref', 'referente', 'mes', 'boleto', 'conta'].includes(w));
const num = (v: unknown) => Number(v) || 0;
const brl = (n: number) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const br = (s: string) => s.split('-').reverse().join('/');
const FER = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'];
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
    const hoje = iso(new Date(Date.now() - 3 * 3600e3));
    const { data: rows } = await sb.from('docs').select('path,col,data').or('col.eq.contas,col.eq.lanc,col.eq.app,col.like.data/users/*');
    const contas: Any[] = [], lanc: Any[] = [], prefs: Record<string, Any> = {}; let cfg: Any = {};
    for (const r of rows || []) {
      if (r.col === 'contas') contas.push({ id: r.path.split('/').pop(), ...r.data });
      else if (r.col === 'lanc') lanc.push(r.data);
      else if (r.path === 'app/config') cfg = r.data || {};
      else if (r.path.endsWith('/prefs')) prefs[r.col.split('/')[2]] = r.data;
    }
    // ---- ciclo igual ao do app ----
    const ps: Any[] = (Array.isArray(cfg.pagamentos) ? cfg.pagamentos : []).filter((p: Any) => num(p.n) > 0);
    const diaUtil = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number); let c = 0; for (let d = 1; d <= 31; d++) { const dt = new Date(Date.UTC(y, m - 1, d, 12)); if (dt.getUTCMonth() !== m - 1) break; const w = dt.getUTCDay(); if (w === 0 || w === 6 || FER.includes(pad(m) + '-' + pad(d))) continue; if (++c === n) return `${ym}-${pad(d)}`; } return `${ym}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`; };
    const diaPag = (p: Any, ym: string) => { if (p.tipo === 'util') return diaUtil(ym, Math.min(23, num(p.n) || 5)); const [y, m] = ym.split('-').map(Number); return `${ym}-${pad(Math.min(num(p.n) || 1, new Date(Date.UTC(y, m, 0)).getUTCDate()))}`; };
    const seg = (p: Any) => p.para ? p.para === 'seguinte' : (p.tipo !== 'util' && num(p.n) >= 20);
    const pagDoCiclo = (p: Any, M: string) => diaPag(p, seg(p) ? addM(M, -1) : M);
    const cIni = (M: string) => ps.length ? ps.map((p) => pagDoCiclo(p, M)).sort()[0] : M + '-01';
    const cFim = (M: string) => addD(cIni(addM(M, 1)), -1);
    const compNat = (d: string) => { let M = d.slice(0, 7), g = 0; while (g++ < 4 && d >= cIni(addM(M, 1))) M = addM(M, 1); while (g++ < 8 && d < cIni(M)) M = addM(M, -1); return M; };
    const ini = cfg.inicioControle || '';
    const comp = (d: string) => { let M = compNat(d); if (ini && M < ini) M = ini; return M; };
    const refL = (l: Any) => (/^\d{4}-\d\d$/.test(l.ref || '') ? l.ref : comp(l.data || hoje));
    const venc = (c: Any, M: string) => {
      if (!c.recorrente) return c.data || '';
      if (c.noSalario && ps.length) return pagDoCiclo(ps[Math.min(num(c.pagador), ps.length - 1)], M);
      const dia = num(c.dia) || 1; const em = (X: string) => { const [y, m] = X.split('-').map(Number); return `${X}-${pad(Math.min(dia, new Date(Date.UTC(y, m, 0)).getUTCDate()))}`; };
      if (ps.length) { const a = cIni(M), b = cFim(M); for (const X of [addM(M, -1), M, addM(M, 1)]) { const vv = em(X); if (vv >= a && vv <= b) return vv; } }
      return em(M);
    };
    const doMes = (c: Any, M: string) => !c.excluida && (c.recorrente ? (!(c.inicio && c.inicio > M) && !(c.fim && M > c.fim)) : (c.ref || comp(c.data || '')) === M);
    const paga = (c: Any, M: string) => {
      if ((c.pagas || {})[c.recorrente ? M : 'unica']) return true;
      const kk = c.chave || norm(c.nome), tk = toks(c.nome), vv = num(c.valor);
      return lanc.some((l) => { if (l.tipo !== 'saida' || refL(l) !== M) return false; if (l.contaId) return l.contaId === c.id; if (kk && norm(l.desc) === kk) return true; const td = toks(l.desc); return vv > 0 && tk.length > 0 && tk.every((w) => td.includes(w)) && Math.abs(num(l.valor) - vv) <= Math.max(1, vv * .03); });
    };
    let cur = compNat(hoje); if (ini && cur < ini) cur = ini;
    const { data: subs } = await sb.from('push_subs').select('*');
    const porUser: Record<string, Any[]> = {};
    for (const s of subs || []) (porUser[s.user_id] ||= []).push(s);
    let total = 0;
    for (const uidKey of Object.keys(porUser)) {
      const p = prefs[uidKey] || {};
      if (p.notif === false) continue;
      const dias = Number(p.dias) || 3;
      const lim = addD(hoje, dias), min = addD(hoje, -7);
      const itens: Any[] = [], vistos = new Set<string>();
      for (const M of [cur, addM(cur, 1)]) for (const c of contas) {
        if (!doMes(c, M) || num(c.valor) <= 0) continue;
        const vv = venc(c, M); if (!vv || vv > lim || vv < min || paga(c, M) || vistos.has(c.id + vv)) continue;
        vistos.add(c.id + vv); itens.push({ c, vv });
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
