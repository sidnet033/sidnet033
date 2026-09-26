-- Feeder-level electrical classification used to auto-size GA bays for
-- ArTuK-standard switchboards (see src/lib/artuk-sizing.ts). Both nullable:
-- a feeder without these simply doesn't get auto-placed, exactly like an
-- unclassified feeder behaves today.
alter table feeders add column device_type text;
alter table feeders add column rated_kw numeric;

alter table feeders add constraint feeders_device_type_check
  check (device_type is null or device_type in ('ACB', 'MCCB', 'MCB', 'DOL', 'RDOL', 'STAR_DELTA', 'VFD', 'SOFT_STARTER', 'OTHER'));
