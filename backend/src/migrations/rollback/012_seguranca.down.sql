drop table if exists rate_limits;
alter table users drop column if exists auth_version;
delete from _migrations where name = '012_seguranca.sql';
