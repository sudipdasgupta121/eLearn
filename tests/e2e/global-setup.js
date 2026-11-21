// Safety net inside the runner's lifecycle; the ordering guarantee comes from webServer.command,
// which runs prepare-test-db.js before the app starts.
import { prepareTestDatabase } from './prepare-test-db.js';

export default async function globalSetup() {
  await prepareTestDatabase();
}
