-- =============================================================================
-- PH Books — initial schema (AUTHORED, NOT APPLIED)
-- Target: Supabase Postgres. This file mirrors src/data/ports/ so the
-- SupabaseAdapter can be a one-file swap. Every tenant table carries
-- company_id; RLS drafts at the bottom assume a company_members mapping.
-- Amounts are BIGINT centavos everywhere — never floating point.
-- =============================================================================

create extension if not exists "pgcrypto";

-- ---------- Tenancy ----------

create table companies (
  id            uuid primary key default gen_random_uuid(),
  tin_base      char(9)  not null,
  tin_branch    varchar(5) not null default '000',
  registered_name text   not null,
  business_style  text   not null default '',
  registered_address text not null default '',
  zip_code      text,
  created_at    timestamptz not null default now(),
  unique (tin_base, tin_branch)
);

-- Who may see a company's rows (Supabase auth.users).
create table company_members (
  company_id  uuid not null references companies(id) on delete cascade,
  user_id     uuid not null, -- references auth.users(id)
  role        text not null default 'member' check (role in ('owner','accountant','member')),
  primary key (company_id, user_id)
);

-- ---------- Tax profiles (versioned) ----------

create table tax_profiles (
  company_id        uuid not null references companies(id) on delete cascade,
  effective_from    date not null,
  effective_to      date,
  entity_type       text not null,
  income_tax_regime text not null,
  business_tax_regime text not null,
  registered_tax_types text[] not null default '{}',   -- the multi-line registration SET
  wa_expanded       boolean not null default false,
  wa_final          boolean not null default false,
  wa_compensation   boolean not null default false,
  wa_government_payor boolean not null default false,
  wa_top_withholding_agent boolean not null default false,
  liab_dst          boolean not null default false,
  liab_excise       boolean not null default false,
  liab_fbt          boolean not null default false,
  accounting_basis  text not null check (accounting_basis in ('accrual','cash')),
  fiscal_year_end_month smallint not null check (fiscal_year_end_month between 1 and 12),
  has_mixed_transactions boolean not null default false,
  eopt_classification text not null default 'micro',
  start_of_operations date,
  rdo_code          text not null,
  incentive_agency  text,
  incentive_registration_no text,
  incentive_valid_from date,
  incentive_valid_to   date,
  primary key (company_id, effective_from)
);

-- ---------- Chart of accounts ----------

create table accounts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  code         text not null,
  name         text not null,
  type         text not null check (type in ('asset','liability','equity','income','expense')),
  normal_balance text not null check (normal_balance in ('debit','credit')),
  tax_tag      text not null default 'none',
  system_role  text,
  parent_id    uuid references accounts(id),
  postable     boolean not null default true,
  active       boolean not null default true,
  unique (company_id, code)
);

-- ---------- Master data ----------

create table parties (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  tin_base     char(9) not null,
  tin_branch   varchar(5) not null default '000',
  registered_name text not null,
  business_style  text not null default '',
  registered_address text not null default '',
  zip_code     text,
  is_customer  boolean not null default false,
  is_supplier  boolean not null default false,
  payee_class  text not null check (payee_class in ('individual','corporation')),
  is_government boolean not null default false,
  default_atc  text,
  active       boolean not null default true
);
create index parties_company_idx on parties(company_id);

create table employees (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  employee_no  text not null,
  tin_base     char(9),
  tin_branch   varchar(5) default '000',
  first_name   text not null,
  last_name    text not null,
  middle_name  text,
  registered_address text not null default '',
  hire_date    date not null,
  separation_date date,
  monthly_basic_pay_centavos bigint not null default 0,
  sss_no       text,
  philhealth_no text,
  pagibig_no   text,
  active       boolean not null default true,
  unique (company_id, employee_no)
);

create table bank_accounts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  bank_name    text not null,
  account_name text not null,
  account_no   text not null,
  gl_account_code text not null,
  active       boolean not null default true
);

create table items (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  sku          text not null,
  name         text not null,
  kind         text not null check (kind in ('good','service')),
  unit_price_centavos bigint not null default 0,
  default_vat_class text not null default 'vatable'
    check (default_vat_class in ('vatable','exempt','zero_rated')),
  income_account_code text not null,
  expense_account_code text,
  active       boolean not null default true,
  unique (company_id, sku)
);

create table numbering_series (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  document_type text not null,
  prefix       text not null default '',
  padding      smallint not null default 4,
  next_number  integer not null default 1,
  authority_ref text
);

-- Reference table (not tenant data): BIR RDO codes.
create table rdo_codes (
  code  text primary key,
  name  text not null
);

-- ---------- Sheets (drafts mutable; posted immutable) ----------

create table sheets (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  type         text not null check (type in (
    'sales_invoice','sales_receipt','purchase_bill','collection','disbursement',
    'general_journal','payroll_register','credit_memo','debit_memo')),
  document_no  text not null,
  date         date not null,
  party_id     uuid references parties(id),
  memo         text not null default '',
  status       text not null default 'draft' check (status in ('draft','posted','void')),
  posted_entry_id uuid,
  bank_account_code text,
  payroll_from date,
  payroll_to   date,
  lines        jsonb not null default '[]',   -- SheetLine[]; drafts are documents, not ledger rows
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, type, document_no)
);
create index sheets_company_status_idx on sheets(company_id, status);

-- ---------- Journal (append-only) ----------

create table journal_entries (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  entry_no     integer not null,
  date         date not null,
  description  text not null default '',
  sheet_id     uuid references sheets(id),
  reversal_of_entry_id uuid references journal_entries(id),
  posted_at    timestamptz not null default now(),
  unique (company_id, entry_no)
);
create index journal_entries_company_date_idx on journal_entries(company_id, date);

create table journal_lines (
  id           uuid primary key default gen_random_uuid(),
  entry_id     uuid not null references journal_entries(id) on delete restrict,
  company_id   uuid not null references companies(id) on delete cascade,
  line_no      smallint not null,
  account_code text not null,
  debit_centavos  bigint not null default 0 check (debit_centavos >= 0),
  credit_centavos bigint not null default 0 check (credit_centavos >= 0),
  party_id     uuid references parties(id),
  tax_tag      text not null default 'none',
  description  text not null default '',
  check (debit_centavos = 0 or credit_centavos = 0),
  unique (entry_id, line_no)
);
create index journal_lines_company_account_idx on journal_lines(company_id, account_code);

-- Balanced-entry invariant, enforced in the database as well as the domain:
-- a deferred constraint trigger checks each entry sums to zero at commit.
create or replace function assert_entry_balanced() returns trigger
language plpgsql as $$
declare
  imbalance bigint;
begin
  select coalesce(sum(debit_centavos - credit_centavos), 0)
    into imbalance
    from journal_lines
   where entry_id = coalesce(new.entry_id, old.entry_id);
  if imbalance <> 0 then
    raise exception 'journal entry % does not balance (off by % centavos)',
      coalesce(new.entry_id, old.entry_id), imbalance;
  end if;
  return null;
end $$;

create constraint trigger journal_lines_balanced
  after insert or update or delete on journal_lines
  deferrable initially deferred
  for each row execute function assert_entry_balanced();

-- Append-only: forbid UPDATE/DELETE on posted ledger rows outright.
create or replace function forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'ledger rows are append-only; post a reversing entry instead';
end $$;

create trigger journal_entries_immutable
  before update or delete on journal_entries
  for each row execute function forbid_mutation();

create trigger journal_lines_immutable
  before update or delete on journal_lines
  for each row execute function forbid_mutation();

-- ---------- Period locks ----------

create table period_locks (
  company_id  uuid not null references companies(id) on delete cascade,
  period_key  char(7) not null,          -- 'YYYY-MM'
  locked_at   timestamptz not null default now(),
  locked_by   uuid not null,             -- auth.users
  primary key (company_id, period_key)
);

create trigger period_locks_immutable
  before update or delete on period_locks
  for each row execute function forbid_mutation();

-- =============================================================================
-- Row-level security (DRAFT — reviewed and enabled when Supabase integration
-- lands; policies assume membership via company_members).
-- =============================================================================

alter table companies        enable row level security;
alter table company_members  enable row level security;
alter table tax_profiles     enable row level security;
alter table accounts         enable row level security;
alter table parties          enable row level security;
alter table employees        enable row level security;
alter table bank_accounts    enable row level security;
alter table items            enable row level security;
alter table numbering_series enable row level security;
alter table sheets           enable row level security;
alter table journal_entries  enable row level security;
alter table journal_lines    enable row level security;
alter table period_locks     enable row level security;

create or replace function is_member(target_company uuid) returns boolean
language sql stable security definer as $$
  select exists (
    select 1 from company_members m
     where m.company_id = target_company and m.user_id = auth.uid()
  );
$$;

create policy companies_select on companies
  for select using (is_member(id));
create policy companies_insert on companies
  for insert with check (true);  -- creator immediately inserts membership row
create policy company_members_all on company_members
  for all using (user_id = auth.uid() or is_member(company_id))
  with check (is_member(company_id));

-- Uniform member policies for tenant tables.
create policy tax_profiles_all on tax_profiles
  for all using (is_member(company_id)) with check (is_member(company_id));
create policy accounts_all on accounts
  for all using (is_member(company_id)) with check (is_member(company_id));
create policy parties_all on parties
  for all using (is_member(company_id)) with check (is_member(company_id));
create policy employees_all on employees
  for all using (is_member(company_id)) with check (is_member(company_id));
create policy bank_accounts_all on bank_accounts
  for all using (is_member(company_id)) with check (is_member(company_id));
create policy items_all on items
  for all using (is_member(company_id)) with check (is_member(company_id));
create policy numbering_series_all on numbering_series
  for all using (is_member(company_id)) with check (is_member(company_id));
create policy sheets_all on sheets
  for all using (is_member(company_id)) with check (is_member(company_id));

-- Ledger: members may SELECT and INSERT; UPDATE/DELETE blocked by triggers
-- and intentionally have no policy at all.
create policy journal_entries_select on journal_entries
  for select using (is_member(company_id));
create policy journal_entries_insert on journal_entries
  for insert with check (is_member(company_id));
create policy journal_lines_select on journal_lines
  for select using (is_member(company_id));
create policy journal_lines_insert on journal_lines
  for insert with check (is_member(company_id));
create policy period_locks_select on period_locks
  for select using (is_member(company_id));
create policy period_locks_insert on period_locks
  for insert with check (is_member(company_id));

-- rdo_codes is public reference data.
alter table rdo_codes enable row level security;
create policy rdo_codes_read on rdo_codes for select using (true);
