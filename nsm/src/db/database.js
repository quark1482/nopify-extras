// src/db/database.js
const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

const dbPath = path.join(app.getPath('userData'), 'servers.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.prepare(`
  CREATE TABLE IF NOT EXISTS servers (
    hostname TEXT PRIMARY KEY,
    nickname TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL,
    password TEXT NOT NULL
  )
`).run();

function loadAll() {
    return db.prepare(`
    SELECT nickname, hostname, username, password
    FROM servers
  `).all();
}

function replaceAll(rows) {
    const insert = db.prepare(`
    INSERT INTO servers (nickname, hostname, username, password)
    VALUES (@nickname, @hostname, @username, @password)
  `);
    const tx = db.transaction((rows) => {
        db.prepare(`DELETE FROM servers`).run();
        for (const row of rows) {
            insert.run(row);
        }
    });
    tx(rows);
}

function deleteByHostnames(hostnames) {
    const stmt = db.prepare(`
    DELETE FROM servers WHERE hostname = ?
  `);
    const tx = db.transaction((list) => {
        for (const h of list) stmt.run(h);
    });
    tx(hostnames);
}

module.exports = {
    loadAll,
    replaceAll,
    deleteByHostnames
};