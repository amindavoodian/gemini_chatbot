/**
Turso Database Client (libSQL over HTTP v2 pipeline)
Handles Cloud SQLite persistence for conversations and messages.
*/
const TursoDB = {
  dbUrl: "https://geminichatbot-dramindavoudian.turso.io/v2/pipeline",
  authToken: "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODcxMjcyNzksImlkIjoiMDFhMDE5MTUtODcwMS03ZTNlLThkMGItNzNiOGIyZmI5MWZmIiwia2lkIjoiZXNsNzRzeFBkRkVydjc2ckRBRDFBdU1ZcVlwcGlJcFFfUlh3aU1EM0JDbyIsInJpZCI6IjcwMThlZDNhLWE3MGQtNDBhYS1hMWMxLTBkYzhjMWYzNjYyOCJ9.v_BtiDiQBrN_Y27WBE-nGJ7RNVHruDYSCEzAZc-gGMRNJFD0-vS-mDcT6upMid7ehlBa7BJHcAUNnoydtcvtCA",

  /**
  Helper to format JavaScript values into Hrana/Turso v2 type objects
  */
  formatArg(val) {
    if (val === null || val === undefined) return { type: "null" };
    if (typeof val === "number") {
      return Number.isInteger(val)
        ? { type: "integer", value: String(val) }
        : { type: "float", value: String(val) };
    }
    if (typeof val === "boolean") {
      return { type: "integer", value: val ? "1" : "0" };
    }
    return { type: "text", value: String(val) };
  },

  /**
  Execute parameterized SQL query over Turso HTTP pipeline
  */
  async execute(sql, args = []) {
    const formattedArgs = args.map(arg => this.formatArg(arg));
    const payload = {
      requests: [
        {
          type: "execute",
          stmt: {
            sql: sql,
            args: formattedArgs
          }
        },
        { type: "close" }
      ]
    };

    try {
      const res = await fetch(this.dbUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.authToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error(`Turso HTTP Error: ${res.status} ${res.statusText}`);
      }

      const json = await res.json();
      const firstResult = json.results?.[0];

      if (firstResult?.type === "error") {
        throw new Error(firstResult.error?.message || "SQL Execution Error");
      }

      const execResult = firstResult?.response?.result;
      if (!execResult || !execResult.cols) return [];

      const cols = execResult.cols.map(c => c.name);
      return execResult.rows.map(row => {
        const item = {};
        row.forEach((cell, idx) => {
          item[cols[idx]] = cell.value !== undefined ? cell.value : null;
        });
        return item;
      });
    } catch (err) {
      console.error("Turso Query Exception:", err);
      throw err;
    }
  },

  /**
  Initialize Turso Tables and Ensure Translation Column
  */
  async initDB() {
    try {
      await this.execute("CREATE TABLE IF NOT EXISTS conversations ( id TEXT PRIMARY KEY, title TEXT, created_at INTEGER, updated_at INTEGER );");
      await this.execute("CREATE TABLE IF NOT EXISTS messages ( id TEXT PRIMARY KEY, conversation_id TEXT, role TEXT, content TEXT, model_used TEXT, files TEXT, created_at INTEGER, translation TEXT, FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE );");
      
      try {
        await this.execute("ALTER TABLE messages ADD COLUMN translation TEXT;");
      } catch (colErr) {
        // Ignored if column already exists
      }
      
      console.log("Turso Database initialized successfully.");
    } catch (e) {
      console.warn("Turso Init issue:", e);
    }
  },

  async getConversations() {
    return await this.execute("SELECT * FROM conversations ORDER BY updated_at DESC;");
  },

  async saveConversation(id, title, createdAt, updatedAt) {
    return await this.execute(
      "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, updated_at=excluded.updated_at;",
      [id, title, createdAt, updatedAt]
    );
  },

  async updateConversationTitle(id, title) {
    return await this.execute(
      "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?;",
      [title, Date.now(), id]
    );
  },

  async updateConversationTime(id, updatedAt) {
    return await this.execute(
      "UPDATE conversations SET updated_at = ? WHERE id = ?;",
      [updatedAt, id]
    );
  },

  async getMessages(conversationId) {
    return await this.execute(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC;",
      [conversationId]
    );
  },

  async saveMessage(id, conversationId, role, content, modelUsed, filesJson, createdAt, translation = "") {
    return await this.execute(
      "INSERT INTO messages (id, conversation_id, role, content, model_used, files, created_at, translation) VALUES (?, ?, ?, ?, ?, ?, ?, ?);",
      [id, conversationId, role, content, modelUsed, filesJson, createdAt, translation]
    );
  },

  async updateMessageTranslation(id, translation) {
    return await this.execute(
      "UPDATE messages SET translation = ? WHERE id = ?;",
      [translation, id]
    );
  },

  async deleteConversation(conversationId) {
    await this.execute("DELETE FROM messages WHERE conversation_id = ?;", [conversationId]);
    await this.execute("DELETE FROM conversations WHERE id = ?;", [conversationId]);
  },

  async clearAllHistory() {
    await this.execute("DELETE FROM messages;");
    await this.execute("DELETE FROM conversations;");
  }
};