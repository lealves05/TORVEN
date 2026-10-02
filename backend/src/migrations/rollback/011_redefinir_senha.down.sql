drop table if exists password_resets;
alter table users drop column if exists password_changed_at;
delete from _migrations where name = '011_redefinir_senha.sql';
