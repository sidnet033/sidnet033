-- Pictures of ArTuK enclosure parts uploaded by admins (Enclosure Master).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('artuk-part-images', 'artuk-part-images', true, 5242880,
        array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do nothing;

create policy "artuk part images read" on storage.objects
  for select using (bucket_id = 'artuk-part-images');
create policy "artuk part images admin insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'artuk-part-images' and public.is_admin());
create policy "artuk part images admin update" on storage.objects
  for update to authenticated using (bucket_id = 'artuk-part-images' and public.is_admin());
create policy "artuk part images admin delete" on storage.objects
  for delete to authenticated using (bucket_id = 'artuk-part-images' and public.is_admin());

create table artuk_part_images (
  sku text primary key,
  path text not null,
  caption text,
  updated_at timestamptz not null default now()
);
alter table artuk_part_images enable row level security;
create policy "artuk_part_images read" on artuk_part_images
  for select to authenticated using (true);
create policy "artuk_part_images admin write" on artuk_part_images
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
