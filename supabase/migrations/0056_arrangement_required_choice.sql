-- Single / double front is a required choice (Project Details): new
-- switchboards start blank instead of defaulting to single front; the app
-- won't save a revision until every board has one. Existing boards keep
-- their value.
alter table switchboards alter column arrangement drop default;
alter table switchboards alter column arrangement drop not null;
