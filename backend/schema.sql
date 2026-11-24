-- Nosso Caixa: estrutura do banco (rodar uma vez no SQL Editor do Supabase)
create table if not exists public.membros (email text primary key, nome text, whats text, user_id uuid, criado timestamptz default now());
create table if not exists public.docs (path text primary key, col text not null, data jsonb not null, dono uuid, updated_at timestamptz default now());
create index if not exists docs_col_idx on public.docs(col);
create table if not exists public.push_subs (endpoint text primary key, user_id uuid not null, sub jsonb not null, criado timestamptz default now());
create table if not exists public.privado (chave text primary key, valor jsonb not null);

grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on public.membros, public.docs, public.push_subs to authenticated;
grant all on public.membros, public.docs, public.push_subs, public.privado to service_role;
alter table public.membros enable row level security;
alter table public.docs enable row level security;
alter table public.push_subs enable row level security;
alter table public.privado enable row level security;

create or replace function public.e_membro() returns boolean language sql security definer stable set search_path = public as $$
  select exists(select 1 from public.membros where lower(email) = lower(coalesce(auth.jwt()->>'email','')))
$$;
create or replace function public.sem_membros() returns boolean language sql security definer stable set search_path = public as $$
  select not exists(select 1 from public.membros)
$$;

drop policy if exists m_sel on public.membros; drop policy if exists m_ins on public.membros; drop policy if exists m_upd on public.membros; drop policy if exists m_del on public.membros;
create policy m_sel on public.membros for select to authenticated using (public.e_membro());
create policy m_ins on public.membros for insert to authenticated with check (public.e_membro() or (public.sem_membros() and lower(email) = lower(auth.jwt()->>'email')));
create policy m_upd on public.membros for update to authenticated using (public.e_membro()) with check (public.e_membro());
create policy m_del on public.membros for delete to authenticated using (public.e_membro());

drop policy if exists d_all on public.docs;
create policy d_all on public.docs for all to authenticated
  using (public.e_membro() and (col not like 'data/users/%' or col like 'data/users/' || auth.uid()::text || '%'))
  with check (public.e_membro() and (col not like 'data/users/%' or col like 'data/users/' || auth.uid()::text || '%'));

drop policy if exists p_own on public.push_subs;
create policy p_own on public.push_subs for all to authenticated using (user_id = auth.uid() and public.e_membro()) with check (user_id = auth.uid() and public.e_membro());

-- tempo real
do $$ begin
  begin alter publication supabase_realtime add table public.docs; exception when others then null; end;
  begin alter publication supabase_realtime add table public.membros; exception when others then null; end;
end $$;

-- arquivos (comprovantes, contracheques, fotos)
insert into storage.buckets (id, name, public) values ('arquivos','arquivos', false) on conflict (id) do nothing;
drop policy if exists arq_sel on storage.objects; drop policy if exists arq_ins on storage.objects; drop policy if exists arq_del on storage.objects;
create policy arq_sel on storage.objects for select to authenticated using (bucket_id = 'arquivos' and public.e_membro());
create policy arq_ins on storage.objects for insert to authenticated with check (bucket_id = 'arquivos' and public.e_membro());
create policy arq_del on storage.objects for delete to authenticated using (bucket_id = 'arquivos' and public.e_membro());
