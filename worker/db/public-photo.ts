/** Start at indexed keys, then enforce the current publication and suppression state before reading R2. */
export const PUBLIC_PHOTO_SQL = `WITH matches AS (
  SELECT id AS revision_id FROM revisions WHERE photo_key = ?1
  UNION SELECT revision_id FROM revision_photos WHERE key = ?1
  UNION SELECT revision_id FROM revision_photos WHERE thumb_key = ?1
)
SELECT p.id FROM matches m
JOIN revisions r ON r.id = m.revision_id
JOIN places p ON p.id = r.place_id
WHERE p.status = 'published' AND p.published_revision_id = m.revision_id
AND NOT EXISTS (
  SELECT 1 FROM field_suppressions s
  WHERE s.place_id = p.id AND s.lifted_at IS NULL AND s.field IN ('photo', 'whole')
) LIMIT 1`

export async function publicPhotoOwner(db: D1Database, key: string): Promise<string | null> {
  return db.prepare(PUBLIC_PHOTO_SQL).bind(key).first<string>("id")
}
