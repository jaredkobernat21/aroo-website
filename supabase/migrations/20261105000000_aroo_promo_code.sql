-- Optional promo / referral code on service requests (stored uppercase).
alter table aroo_service_requests
  add column if not exists promo_code text
  check (promo_code is null or promo_code ~ '^[A-Z0-9_-]{1,30}$');
create index if not exists aroo_service_requests_promo_code_idx
  on aroo_service_requests (promo_code) where promo_code is not null;
