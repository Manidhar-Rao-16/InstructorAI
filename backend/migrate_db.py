import sqlite3
import os

db_path = "instructorai.db"

if not os.path.exists(db_path):
    print("Database not found. No migration needed.")
    exit()

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

print("Starting migration...")

try:
    # 1. Check if google_id already exists (might have been added by my previous command)
    cursor.execute("PRAGMA table_info(users)")
    columns = [col[1] for col in cursor.fetchall()]
    
    if "google_id" not in columns:
        print("Adding google_id column...")
        cursor.execute("ALTER TABLE users ADD COLUMN google_id VARCHAR(100)")
        cursor.execute("CREATE UNIQUE INDEX ix_users_google_id ON users (google_id)")
    else:
        print("google_id column already exists.")

    # 2. To make hashed_password nullable, we need to recreate the table in SQLite
    print("Fixing hashed_password nullability...")
    
    # Create temp table
    cursor.execute("""
        CREATE TABLE users_new (
            id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            email VARCHAR(255) NOT NULL,
            google_id VARCHAR(100),
            hashed_password VARCHAR(255),
            role VARCHAR(20) NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT 1,
            is_verified BOOLEAN NOT NULL DEFAULT 0,
            verification_token VARCHAR(128),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Copy data
    cursor.execute("""
        INSERT INTO users_new (id, email, google_id, hashed_password, role, is_active, is_verified, verification_token, created_at, updated_at)
        SELECT id, email, google_id, hashed_password, role, is_active, is_verified, verification_token, created_at, updated_at FROM users
    """)
    
    # Drop old table and rename new one
    cursor.execute("DROP TABLE users")
    cursor.execute("ALTER TABLE users_new RENAME TO users")
    
    # Recreate indexes
    cursor.execute("CREATE UNIQUE INDEX ix_users_email ON users (email)")
    cursor.execute("CREATE INDEX ix_users_id ON users (id)")
    cursor.execute("CREATE UNIQUE INDEX ix_users_google_id ON users (google_id)")
    cursor.execute("CREATE INDEX ix_users_verification_token ON users (verification_token)")

    conn.commit()
    print("Migration completed successfully!")

except Exception as e:
    conn.rollback()
    print(f"Migration failed: {e}")
finally:
    conn.close()
