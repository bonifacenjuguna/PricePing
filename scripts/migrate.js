const { migrate } = require('../src/db/migrate');
const { close } = require('../src/db/postgres');

migrate()
  .then(() => close())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err.message);
    process.exit(1);
  });
