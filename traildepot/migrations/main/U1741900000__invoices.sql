-- Invoices
CREATE TABLE invoices (
  id             BLOB NOT NULL PRIMARY KEY CHECK (is_uuid_v7(id)) DEFAULT (uuid_v7()),
  created        INTEGER NOT NULL DEFAULT (UNIXEPOCH()),
  updated        INTEGER NOT NULL DEFAULT (UNIXEPOCH()),
  invoice_number TEXT NOT NULL UNIQUE,
  client         BLOB NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  date_from      TEXT NOT NULL DEFAULT '',
  date_to        TEXT NOT NULL DEFAULT '',
  issue_date     TEXT NOT NULL DEFAULT '',
  due_date       TEXT NOT NULL DEFAULT 'upon_receipt',
  po_number      TEXT NOT NULL DEFAULT '',
  subject        TEXT NOT NULL DEFAULT '',
  notes          TEXT NOT NULL DEFAULT '',
  discount       REAL NOT NULL DEFAULT 0,
  currency       TEXT NOT NULL DEFAULT 'USD',
  status         TEXT NOT NULL DEFAULT 'draft'
) STRICT;

CREATE TRIGGER _invoices__updated_trigger AFTER UPDATE ON invoices FOR EACH ROW
  BEGIN UPDATE invoices SET updated = UNIXEPOCH() WHERE id = OLD.id; END;

-- Invoice line items
CREATE TABLE invoice_line_items (
  id          BLOB NOT NULL PRIMARY KEY CHECK (is_uuid_v7(id)) DEFAULT (uuid_v7()),
  created     INTEGER NOT NULL DEFAULT (UNIXEPOCH()),
  updated     INTEGER NOT NULL DEFAULT (UNIXEPOCH()),
  invoice     BLOB NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL DEFAULT '',
  quantity    REAL NOT NULL DEFAULT 1,
  unit_price  REAL NOT NULL DEFAULT 0,
  item_type   TEXT NOT NULL DEFAULT 'service',
  sort_order  INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TRIGGER _invoice_line_items__updated_trigger AFTER UPDATE ON invoice_line_items FOR EACH ROW
  BEGIN UPDATE invoice_line_items SET updated = UNIXEPOCH() WHERE id = OLD.id; END;

-- Track which invoice covers each time entry
ALTER TABLE time_entries ADD COLUMN invoice_id BLOB REFERENCES invoices(id) ON DELETE SET NULL;

-- Rebuild time_entries_full to include invoice_id
DROP VIEW time_entries_full;
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

-- Invoices joined with client + computed total
CREATE VIEW invoices_full AS
  SELECT
    i.id,
    i.created,
    i.updated,
    i.invoice_number,
    i.client       AS client_id,
    c.name         AS client_name,
    c.email        AS client_email,
    i.date_from,
    i.date_to,
    i.issue_date,
    i.due_date,
    i.po_number,
    i.subject,
    i.notes,
    i.discount,
    i.currency,
    i.status,
    COALESCE(
      (SELECT SUM(li.quantity * li.unit_price)
       FROM invoice_line_items li
       WHERE li.invoice = i.id),
      0
    ) * (1.0 - i.discount / 100.0) AS total
  FROM invoices i
  JOIN clients c ON c.id = i.client;
