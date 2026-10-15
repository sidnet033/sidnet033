-- INR is the base currency: a project priced in INR always converts at 1.
alter table projects add constraint projects_inr_rate_is_one check (currency <> 'INR' or exchange_rate = 1);
alter table projects alter column currency set default 'INR';
