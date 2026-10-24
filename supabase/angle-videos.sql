begin;
update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime']
where id = 'livewire-photos';
-- Existing attachment ownership, four-item limit, cleanup, and LIVEWIRE mirroring also cover video paths.
notify pgrst,'reload schema';
commit;
