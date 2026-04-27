const lbug = require('@ladybugdb/core');
const path = require('path');
const fs = require('fs');

const dbPath = '/tmp/test_lbug.db';
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
if (fs.existsSync(dbPath + '.wal')) fs.unlinkSync(dbPath + '.wal');

console.log('Testing LadybugDB initialization...');
try {
  const db = new lbug.Database(dbPath);
  const conn = new lbug.Connection(db);
  console.log('Opening DB: OK');

  console.log('Installing VECTOR extension...');
  conn.query('INSTALL VECTOR').then(() => {
    console.log('INSTALL VECTOR: OK');
    conn.query('LOAD EXTENSION VECTOR').then(() => {
      console.log('LOAD EXTENSION VECTOR: OK');
      process.exit(0);
    }).catch(err => {
      console.error('LOAD failed:', err.message);
      process.exit(1);
    });
  }).catch(err => {
    console.error('INSTALL failed:', err.message);
    process.exit(1);
  });
} catch (err) {
  console.error('Init failed:', err.message);
  process.exit(1);
}
