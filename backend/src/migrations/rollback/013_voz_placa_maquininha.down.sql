-- Reverte 013 (apaga cobranças de maquininha, maquininhas, integrações e cache de placas; mantém as OS e o financeiro).
drop table if exists terminal_charges;
drop table if exists payment_terminals;
drop table if exists plate_lookups;
drop table if exists integration_configs;
drop index if exists equipment_plate_idx;
alter table equipment drop column if exists vehicle_data;
alter table equipment drop column if exists color;
delete from _migrations where name = '013_voz_placa_maquininha.sql';
