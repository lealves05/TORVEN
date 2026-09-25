-- Reversão manual da migração 008 (faça backup antes). Apaga os follow-ups de relacionamento.
begin;
drop table if exists followups;
delete from _migrations where name = '008_fase5_gestao.sql';
commit;
