-- Replace invoices_full (subquery unsupported by TrailBase schema inference)
-- with a simple join view. Totals computed in the frontend.
DROP VIEW IF EXISTS invoices_full;

CREATE VIEW invoices_with_client AS
  SELECT
    i.id,
    i.created,
    i.updated,
    i.invoice_number,
    i.client     AS client_id,
    c.name       AS client_name,
    c.email      AS client_email,
    i.date_from,
    i.date_to,
    i.issue_date,
    i.due_date,
    i.po_number,
    i.subject,
    i.notes,
    i.discount,
    i.currency,
    i.status
  FROM invoices i
  JOIN clients c ON c.id = i.client;
