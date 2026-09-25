-- Reversão manual da migração 007 (faça backup antes). Apaga contas, extratos e conciliações; transferências viram lançamentos comuns.
begin;
drop trigger if exists transactions_default_account on transactions;
drop function if exists torven_tx_default_account();
drop table if exists statement_lines, bank_statements;
alter table transactions drop column if exists account_id, drop column if exists reconciled_at,
  drop column if exists statement_line_id, drop column if exists transfer_id;
drop table if exists financial_accounts;
delete from _migrations where name = '007_fase4_financeiro.sql';
commit;
