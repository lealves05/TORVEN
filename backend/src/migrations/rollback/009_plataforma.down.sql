-- Reversão manual da migração 009 (faça backup antes). Desliga a ligação com a central da plataforma.
begin;
alter table companies drop column if exists platform_access;
alter table companies drop column if exists platform_access_at;
alter table companies drop column if exists platform_registered_at;
alter table users drop column if exists last_login_at;
delete from _secrets where key in ('platform_hub_url', 'platform_secret', 'platform_product');
delete from _migrations where name = '009_plataforma.sql';
commit;
