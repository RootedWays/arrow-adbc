import test from 'ava';
import { buildServer } from '../src/index';
import * as path from 'path';
import * as process from 'process';
import { RecordBatchReader, tableFromIPC, tableFromArrays, tableToIPC, Schema } from 'apache-arrow';

// Helper to get driver path
function getDriverPath(driverName: string): string {
  const platform = process.platform;
  let libName = `lib${driverName}.so`; 
  if (platform === 'darwin') {
    libName = `lib${driverName}.dylib`;
  } else if (platform === 'win32') {
    libName = `${driverName}.dll`;
  }
  return path.join(__dirname, '../../native/build/lib', libName);
}

const driverPath = getDriverPath("adbc_driver_sqlite");
const server = buildServer({
    driverPath,
    entrypoint: "AdbcDriverSQLiteInit"
});

let baseUrl: string;

test.before(async () => {
    // Explicitly bind to IPv4 localhost to avoid environments where binding to ::1 is restricted
    await server.listen({ port: 0, host: '127.0.0.1' });
    const address = server.server.address();
    if (typeof address === 'object' && address !== null) {
        baseUrl = `http://localhost:${address.port}`;
    }
});

test.after(async () => {
    await server.close();
});

test.serial('POST /update - Create Table', async (t) => {
    const res = await fetch(`${baseUrl}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: "CREATE TABLE IF NOT EXISTS test_endpoints (id INTEGER, name TEXT)" })
    });
    t.is(res.status, 200);
    const body = await res.json();
    t.true('rowsAffected' in body);
});

test.serial('POST /bind - Insert Data', async (t) => {
    const tableToBind = tableFromArrays({
        id: [1, 2],
        name: ["Alice", "Bob"]
    });
    console.log('GETS HERE')
    const ipcBuffer = tableToIPC(tableToBind, "file");

    console.log('GETS HERE 2')
    const res = await fetch(`${baseUrl}/bind`, {
        method: 'POST',
        headers: {
            'x-adbc-query': "INSERT INTO test_endpoints (id, name) VALUES (?, ?)",
            'Content-Type': 'application/octet-stream'
        },
        body: ipcBuffer
    });

    if (res.status !== 200) {
        console.log(await res.text());
    }
    t.is(res.status, 200);
    const body = await res.json();
    t.deepEqual(body, { rowsAffected: 2 });
});

test.serial('POST /query - Select Data', async (t) => {
    const res = await fetch(`${baseUrl}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: "SELECT * FROM test_endpoints ORDER BY id" })
    });

    t.is(res.status, 200);
    t.is(res.headers.get('content-type'), 'application/vnd.apache.arrow.stream');

    const buffer = await res.arrayBuffer();
    const table = tableFromIPC(new Uint8Array(buffer));
    t.is(table.numRows, 2);
    t.is(table.getChild("id")?.get(0), 1n);
    t.is(table.getChild("name")?.get(0), "Alice");
});

test('POST /metadata/objects', async (t) => {
    const res = await fetch(`${baseUrl}/metadata/objects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depth: 1 })
    });

    t.is(res.status, 200);
    t.is(res.headers.get('content-type'), 'application/vnd.apache.arrow.stream');

    const buffer = await res.arrayBuffer();
    const table = tableFromIPC(new Uint8Array(buffer));
    t.true(table.numRows > 0);
    t.truthy(table.getChild("catalog_name"));
    t.truthy(table.getChild("catalog_db_schemas"));
});

test('POST /metadata/table-schema', async (t) => {
    const res = await fetch(`${baseUrl}/metadata/table-schema`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableName: "test_endpoints" })
    });

    t.is(res.status, 200);
    t.is(res.headers.get('content-type'), 'application/vnd.apache.arrow.stream');

    const buffer = await res.arrayBuffer();
    const reader = RecordBatchReader.from(new Uint8Array(buffer));
    if (!reader.schema) {
        await reader.next();
    }
    
    const schema = reader.schema;
    t.truthy(schema);
    t.is(schema.fields.length, 2);
    t.is(schema.fields[0].name, "id");
    t.is(schema.fields[1].name, "name");
});

test('POST /metadata/table-types', async (t) => {
    const res = await fetch(`${baseUrl}/metadata/table-types`, { method: 'POST' });

    t.is(res.status, 200);
    t.is(res.headers.get('content-type'), 'application/vnd.apache.arrow.stream');

    const buffer = await res.arrayBuffer();
    const table = tableFromIPC(new Uint8Array(buffer));
    t.true(table.numRows > 0);
    t.truthy(table.getChild("table_type"));
});

test('POST /metadata/info', async (t) => {
    const res = await fetch(`${baseUrl}/metadata/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ infoCodes: [] })
    });

    t.is(res.status, 200);
    t.is(res.headers.get('content-type'), 'application/vnd.apache.arrow.stream');

    const buffer = await res.arrayBuffer();
    const table = tableFromIPC(new Uint8Array(buffer));
    t.true(table.numRows > 0);
    t.truthy(table.getChild("info_name"));
    t.truthy(table.getChild("info_value"));
});
