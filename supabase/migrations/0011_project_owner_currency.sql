-- Project Owner, Currency and Exchange Rate fields for Project Information.

alter table projects
  add column owner_id uuid references profiles (id) on delete set null,
  add column currency text not null default 'USD',
  add column exchange_rate numeric(12, 4) not null default 1;
