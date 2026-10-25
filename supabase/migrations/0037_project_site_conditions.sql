-- Site conditions for switchgear derating: breakers lose current-carrying
-- capacity at high ambient temperature (and above 2000 m altitude).
-- Project Detail requires both before the project can be saved.
alter table projects add column site_altitude_m integer check (site_altitude_m >= 0 and site_altitude_m <= 6000);
alter table projects add column site_ambient_temp_c numeric check (site_ambient_temp_c >= -50 and site_ambient_temp_c <= 70);
comment on column projects.site_altitude_m is 'Site altitude above sea level (m) -- for switchgear derating';
comment on column projects.site_ambient_temp_c is 'Site maximum ambient temperature (deg C) -- for switchgear derating';
