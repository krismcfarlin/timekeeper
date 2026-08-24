ALTER TABLE time_entries ADD COLUMN source_event_id TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX idx_time_entries_source_event_id
  ON time_entries(source_event_id)
  WHERE source_event_id <> '';

ALTER TABLE invoice_line_items ADD COLUMN source_entry_ids TEXT NOT NULL DEFAULT '[]';

DROP VIEW IF EXISTS time_entries_full;
CREATE VIEW time_entries_full AS
  SELECT
    te.id,
    te.created,
    te.updated,
    te.project     AS project_id,
    te.task        AS task_id,
    te.date,
    te.hours,
    te.notes,
    te.started_at,
    te.ended_at,
    te.source_event_id,
    te.invoice_id,
    p.name         AS project_name,
    p.active       AS project_active,
    p.client       AS client_id,
    c.name         AS client_name,
    t.name         AS task_name
  FROM time_entries te
  JOIN projects p ON p.id = te.project
  JOIN clients  c ON c.id = p.client
  LEFT JOIN tasks t ON t.id = te.task;
