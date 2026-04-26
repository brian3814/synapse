import { initBetterSQLite, resetBetterSQLite } from './better-sqlite3-engine';
import { createActionHandler } from '../src/db/worker/action-handler';

const handleAction = createActionHandler(initBetterSQLite, resetBetterSQLite);

export { handleAction };
