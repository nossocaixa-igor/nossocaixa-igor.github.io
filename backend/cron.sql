-- Agenda o aviso diário às 8h de Brasília (11h UTC). Troque wokvveiylyqfpssnwpdy pela referência do seu projeto.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('nosso-caixa-avisos') where exists (select 1 from cron.job where jobname = 'nosso-caixa-avisos');
select cron.schedule('nosso-caixa-avisos', '0 11 * * *', $$
  select net.http_post(url := 'https://wokvveiylyqfpssnwpdy.supabase.co/functions/v1/avisos', headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb);
$$);
