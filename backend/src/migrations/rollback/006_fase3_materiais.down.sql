-- Reversão manual da migração 006 (faça backup antes). Apaga cotações, pedidos de compra e dados de separação.
begin;
delete from attachments where entity in ('purchase','purchase_order');
alter table attachments drop constraint if exists attachments_entity_check;
alter table attachments add constraint attachments_entity_check check (entity in ('equipment','request','quote','order','customer','warranty','inspection'));
alter table order_items drop column if exists picked_qty, drop column if exists picked_at, drop column if exists picked_by;
alter table purchase_items drop column if exists po_item_id, drop column if exists lot, drop column if exists certificate, drop column if exists qty_ordered;
alter table purchases drop column if exists purchase_order_id;
drop table if exists purchase_order_items, purchase_orders, quotation_prices, quotation_suppliers, quotation_items, purchase_quotations;
alter table products drop column if exists max_stock, drop column if exists lead_days;
delete from _migrations where name = '006_fase3_materiais.sql';
commit;
