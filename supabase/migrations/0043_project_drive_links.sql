-- Links to the enquiry's Google Drive folders / Docs / Sheets. Optional while
-- the project is "Yet to quote"; the app requires at least one valid link at
-- any later stage.
alter table projects add column drive_links text[] not null default '{}';
comment on column projects.drive_links is 'Google Drive / Docs / Sheets links for the enquiry; required once the stage is past Yet to quote';
