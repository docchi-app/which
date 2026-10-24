-- Sharper snaps: photos are now 1080 × 1440 (3:4), about 150–400 KB, so the
-- "snaps" bucket allows up to 600 KB a photo (was 300 KB). Photos are still
-- deleted after the snap's 24 hours, so storage stays small.

update storage.buckets set file_size_limit = 614400 where id = 'snaps';
