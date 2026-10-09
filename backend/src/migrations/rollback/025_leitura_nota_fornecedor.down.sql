-- desfaz 025
drop index if exists purchases_invoice_key_idx;
drop table if exists supplier_product_codes;
alter table purchases drop column if exists source;
alter table purchase_items drop column if exists ncm;
alter table purchase_items drop column if exists barcode;
alter table purchase_items drop column if exists supplier_code;
delete from _migrations where name = '025_leitura_nota_fornecedor.sql';
