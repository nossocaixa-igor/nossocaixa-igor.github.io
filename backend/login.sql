-- Nosso Caixa: login com senha + gestor + token a cada 30 dias
alter table public.membros add column if not exists gestor boolean not null default false;
alter table public.membros add column if not exists token_ok timestamptz;
alter table public.membros add column if not exists senha_ok boolean not null default false;

create or replace function public.e_gestor() returns boolean language sql security definer stable set search_path = public as $$
  select exists(select 1 from public.membros where lower(email) = lower(coalesce(auth.jwt()->>'email','')) and gestor)
$$;
create or replace function public.pode_entrar(p_email text) returns boolean language sql security definer stable set search_path = public as $$
  select exists(select 1 from public.membros where lower(email) = lower(p_email)) or not exists(select 1 from public.membros)
$$;
grant execute on function public.pode_entrar(text) to anon, authenticated;

drop policy if exists m_ins on public.membros; drop policy if exists m_upd on public.membros; drop policy if exists m_del on public.membros;
create policy m_ins on public.membros for insert to authenticated with check (public.e_gestor() or (public.sem_membros() and lower(email) = lower(auth.jwt()->>'email')));
create policy m_upd on public.membros for update to authenticated using (public.e_gestor() or lower(email) = lower(auth.jwt()->>'email')) with check (public.e_gestor() or lower(email) = lower(auth.jwt()->>'email'));
create policy m_del on public.membros for delete to authenticated using (public.e_gestor());

create or replace function public.protege_gestor() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.gestor is distinct from old.gestor and not public.e_gestor() then
    raise exception 'apenas o gestor altera esse campo';
  end if;
  if tg_op = 'INSERT' and new.gestor and not public.sem_membros() and not public.e_gestor() then
    raise exception 'apenas o gestor altera esse campo';
  end if;
  return new;
end $$;
drop trigger if exists trg_protege_gestor on public.membros;
create trigger trg_protege_gestor before insert or update on public.membros for each row execute function public.protege_gestor();
