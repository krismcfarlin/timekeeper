-- Clients
CREATE TABLE clients (
  id       BLOB NOT NULL PRIMARY KEY CHECK (is_uuid_v7(id)) DEFAULT (uuid_v7()),
  created  INTEGER NOT NULL DEFAULT (UNIXEPOCH()),
  updated  INTEGER NOT NULL DEFAULT (UNIXEPOCH()),
  name     TEXT NOT NULL,
  email    TEXT NOT NULL DEFAULT '',
  phone    TEXT NOT NULL DEFAULT '',
  notes    TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TRIGGER _clients__updated_trigger AFTER UPDATE ON clients FOR EACH ROW
  BEGIN UPDATE clients SET updated = UNIXEPOCH() WHERE id = OLD.id; END;

-- Projects
CREATE TABLE projects (
  id      BLOB NOT NULL PRIMARY KEY CHECK (is_uuid_v7(id)) DEFAULT (uuid_v7()),
  created INTEGER NOT NULL DEFAULT (UNIXEPOCH()),
  updated INTEGER NOT NULL DEFAULT (UNIXEPOCH()),
  name    TEXT NOT NULL,
  client  BLOB NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  active  INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE TRIGGER _projects__updated_trigger AFTER UPDATE ON projects FOR EACH ROW
  BEGIN UPDATE projects SET updated = UNIXEPOCH() WHERE id = OLD.id; END;

-- Tasks
CREATE TABLE tasks (
  id      BLOB NOT NULL PRIMARY KEY CHECK (is_uuid_v7(id)) DEFAULT (uuid_v7()),
  created INTEGER NOT NULL DEFAULT (UNIXEPOCH()),
  updated INTEGER NOT NULL DEFAULT (UNIXEPOCH()),
  name    TEXT NOT NULL,
  project BLOB NOT NULL REFERENCES projects(id) ON DELETE CASCADE
) STRICT;

CREATE TRIGGER _tasks__updated_trigger AFTER UPDATE ON tasks FOR EACH ROW
  BEGIN UPDATE tasks SET updated = UNIXEPOCH() WHERE id = OLD.id; END;

-- Time entries
CREATE TABLE time_entries (
  id         BLOB NOT NULL PRIMARY KEY CHECK (is_uuid_v7(id)) DEFAULT (uuid_v7()),
  created    INTEGER NOT NULL DEFAULT (UNIXEPOCH()),
  updated    INTEGER NOT NULL DEFAULT (UNIXEPOCH()),
  project    BLOB NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  task       BLOB REFERENCES tasks(id) ON DELETE SET NULL,
  date       TEXT NOT NULL,
  hours      REAL NOT NULL,
  notes      TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL DEFAULT '',
  ended_at   TEXT NOT NULL DEFAULT ''
) STRICT;

CREATE TRIGGER _time_entries__updated_trigger AFTER UPDATE ON time_entries FOR EACH ROW
  BEGIN UPDATE time_entries SET updated = UNIXEPOCH() WHERE id = OLD.id; END;

-- View: time entries with joined project, client, task names
CREATE VIEW time_entries_full AS
  SELECT
    te.id,
    te.created,
    te.updated,
    te.project AS project_id,
    te.task    AS task_id,
    te.date,
    te.hours,
    te.notes,
    te.started_at,
    te.ended_at,
    p.name    AS project_name,
    p.active  AS project_active,
    p.client  AS client_id,
    c.name    AS client_name,
    t.name    AS task_name
  FROM time_entries te
  JOIN projects p ON p.id = te.project
  JOIN clients  c ON c.id = p.client
  LEFT JOIN tasks t ON t.id = te.task;

-- View: projects with client name
CREATE VIEW projects_with_client AS
  SELECT
    p.id,
    p.created,
    p.updated,
    p.name,
    p.client  AS client_id,
    p.active,
    c.name    AS client_name
  FROM projects p
  JOIN clients c ON c.id = p.client;

-- Admin user (krismcfarlin@gmail.com / super1234bad)
INSERT INTO _user (email, password_hash, verified, admin)
  VALUES ('krismcfarlin@gmail.com', (hash_password('super1234bad')), TRUE, TRUE);
