import { migrate } from 'drizzle-orm/mysql2/migrator';
import { db } from './src/drizzle';

// This will run migrations on the database, skipping the ones already applied
await migrate(db, { migrationsFolder: './drizzle' });

// Don't forget to close the connection, otherwise the script will hang
console.log('done')
