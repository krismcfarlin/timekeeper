// pb_migrations/1700000001_init_collections.js
migrate((db) => {
  const dao = new Dao(db);

  // clients
  const clients = new Collection({
    name: "clients",
    type: "base",
    schema: [
      { name: "name", type: "text", required: true },
      { name: "email", type: "email" },
      { name: "phone", type: "text" },
      { name: "notes", type: "text" },
      { name: "archived", type: "bool", options: { default: false } }
    ]
  });
  dao.saveCollection(clients);

  // projects
  const projects = new Collection({
    name: "projects",
    type: "base",
    schema: [
      { name: "name", type: "text", required: true },
      { name: "client", type: "relation", required: true, options: { collectionId: clients.id, cascadeDelete: false } },
      { name: "active", type: "bool", options: { default: true } }
    ]
  });
  dao.saveCollection(projects);

  // tasks
  const tasks = new Collection({
    name: "tasks",
    type: "base",
    schema: [
      { name: "name", type: "text", required: true },
      { name: "project", type: "relation", required: true, options: { collectionId: projects.id, cascadeDelete: true } }
    ]
  });
  dao.saveCollection(tasks);

  // time_entries
  const timeEntries = new Collection({
    name: "time_entries",
    type: "base",
    schema: [
      { name: "project", type: "relation", required: true, options: { collectionId: projects.id, cascadeDelete: false } },
      { name: "task", type: "relation", options: { collectionId: tasks.id, cascadeDelete: false } },
      { name: "date", type: "text", required: true },
      { name: "hours", type: "number", required: true },
      { name: "notes", type: "text" },
      { name: "started_at", type: "text" },
      { name: "ended_at", type: "text" }
    ]
  });
  dao.saveCollection(timeEntries);
}, (db) => {
  const dao = new Dao(db);
  dao.deleteCollection("time_entries");
  dao.deleteCollection("tasks");
  dao.deleteCollection("projects");
  dao.deleteCollection("clients");
});
