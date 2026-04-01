"""
Migration: Add updated_at column to chat_sessions table.
Run once: python migrate_add_updated_at.py
"""
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "instructorai.db")

def migrate():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # Check if column already exists
    cur.execute("PRAGMA table_info(chat_sessions)")
    cols = [row[1] for row in cur.fetchall()]

    if "updated_at" not in cols:
        print("Adding 'updated_at' column to chat_sessions...")
        # Add column with default value equal to created_at for existing rows
        cur.execute("""
            ALTER TABLE chat_sessions
            ADD COLUMN updated_at DATETIME
        """)
        # Back-fill: set updated_at = created_at for all existing rows
        cur.execute("UPDATE chat_sessions SET updated_at = created_at")
        conn.commit()
        print(f"Done. {cur.rowcount} rows back-filled.")
    else:
        print("Column 'updated_at' already exists — skipping.")

    conn.close()

if __name__ == "__main__":
    migrate()
