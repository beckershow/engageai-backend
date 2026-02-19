#!/bin/bash

# Configuration
DB_USER="user"
DB_NAME="engageai_db"
BACKUP_FILE="/backup.sql"

echo "🚀 Starting database restoration..."

# Step 1: Run Prisma migrations
echo "📂 Step 1: Applying database schema migrations..."
if docker compose exec app npx prisma migrate deploy; then
    echo "✅ Migrations applied successfully."
else
    echo "❌ Error applying migrations."
    exit 1
fi

# Step 2: Restore SQL backup
echo "📥 Step 2: Restoring data from $BACKUP_FILE..."
if docker compose exec db psql -U $DB_USER -d $DB_NAME -f $BACKUP_FILE; then
    echo "✅ Data restoration complete."
else
    echo "❌ Error restoring data."
    exit 1
fi

echo "✨ Database is ready!"
