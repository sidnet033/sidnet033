-- New-project details captured up front: when the customer needs the quote,
-- and whether the enquiry is a bid (tender) or a purchase.
alter table projects add column quote_required_by date;
alter table projects add column nature text check (nature in ('bidding','purchase'));
comment on column projects.quote_required_by is 'Date the customer needs the quote by';
comment on column projects.nature is 'bidding (tender) or purchase (firm order enquiry)';
