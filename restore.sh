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

# Reset database to avoid duplicate key errors
# This will drop all tables and re-apply migrations
docker compose exec -T app npx prisma migrate reset --force

# Restore using session_replication_role = 'replica' to bypass FK checks
# We pipe the commands to ensure they run as a single session
(
    echo "SET session_replication_role = 'replica';"
    docker compose exec -T db cat $BACKUP_FILE
    echo "SET session_replication_role = 'origin';"
) | docker compose exec -T db psql -U $DB_USER -d $DB_NAME

echo "✅ Data restoration complete."


echo "✨ Database is ready!"
