-- Reverte 019 (apaga só a cópia local da Tabela FIPE).
drop table if exists fipe_cache;
delete from _migrations where name = '019_fipe_cache.sql';
