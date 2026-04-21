INSERT INTO bench_history (bench_id, action, actor, details, created_at)
SELECT
  id,
  'baseline',
  'Admin',
  json_object(
    'changes',
    json_array(
      json_object('field', 'title', 'label', 'Name', 'from', NULL, 'to', title),
      json_object('field', 'status', 'label', 'Status', 'from', NULL, 'to', status),
      json_object('field', 'last_inspection', 'label', 'Letzte Kontrolle', 'from', NULL, 'to', last_inspection),
      json_object('field', 'image_url', 'label', 'Foto', 'from', NULL, 'to', image_url)
    )
  ),
  CURRENT_TIMESTAMP
FROM benches
WHERE NOT EXISTS (
  SELECT 1
  FROM bench_history
  WHERE bench_history.bench_id = benches.id
);
