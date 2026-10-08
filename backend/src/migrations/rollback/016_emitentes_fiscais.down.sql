-- Reverte 016 (apaga os emitentes e seus certificados guardados; as notas ficam, sem o vínculo com o emitente).
alter table invoices drop column if exists manual;
alter table invoices drop column if exists external_id;
alter table invoices drop column if exists emitter_id;
drop table if exists fiscal_emitters;
delete from _migrations where name = '016_emitentes_fiscais.sql';
