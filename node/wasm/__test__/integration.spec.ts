import { describe, it, expect } from 'vitest'
import { AdbcDatabase } from '../src/index.js'
import { Table, Vector, vectorFromArray } from 'apache-arrow'

describe('ADBC WASM Integration Tests', () => {
  const BASE_URL = 'http://localhost:8080'

  it('should create a database, connection, and statement, then execute a query', async () => {
    // 1. Initialize Database
    const database = new AdbcDatabase({
      driver: BASE_URL,
      databaseOptions: {
        backend_driver: 'sqlite',
        uri: ':memory:',
      },
    })

    // 2. Connect
    const connection = await database.connect()
    expect(connection).toBeDefined()

    // 3. Create Statement
    const statement = await connection.createStatement()
    expect(statement).toBeDefined()

    // 4. Create a Table
    await statement.setSqlQuery('CREATE TABLE test_table (id INTEGER, name TEXT)')
    await statement.executeUpdate()

    // 5. Insert Data
    await statement.setSqlQuery("INSERT INTO test_table VALUES (1, 'Alice'), (2, 'Bob')")
    await statement.executeUpdate()

    // 6. Query Data
    await statement.setSqlQuery('SELECT * FROM test_table ORDER BY id')
    const reader = await statement.executeQuery()

    const batches = []
    for await (const batch of reader) {
      batches.push(batch)
    }

    expect(batches.length).toBeGreaterThan(0)
    const table = batches[0]
    expect(table.numRows).toBe(2)

    const idCol = table.getChildAt(0)
    const nameCol = table.getChildAt(1)

    expect(idCol?.get(0)).toBe(1n)
    expect(nameCol?.get(0)).toBe('Alice')
    expect(idCol?.get(1)).toBe(2n)
    expect(nameCol?.get(1)).toBe('Bob')

    await statement.close()
    await connection.close()
    await database.close()
  })

  it('should get database objects (metadata)', async () => {
    const database = new AdbcDatabase({
      driver: BASE_URL,
      databaseOptions: {
        backend_driver: 'sqlite',
        uri: ':memory:',
      },
    })
    const connection = await database.connect()

    const statement = await connection.createStatement()
    await statement.setSqlQuery('CREATE TABLE metadata_test (id INTEGER)')
    await statement.executeUpdate()
    await statement.close()

    const reader = await connection.getObjects({
      depth: 0, // All
      tableName: 'metadata_test',
    })

    let found = false
    for await (const batch of reader) {
      if (batch.numRows > 0) {
        found = true
      }
    }
    expect(found).toBe(true)

    await connection.close()
    await database.close()
  })

  it('should get database info', async () => {
    const database = new AdbcDatabase({
      driver: BASE_URL,
      databaseOptions: {
        backend_driver: 'sqlite',
        uri: ':memory:',
      },
    })
    const connection = await database.connect()

    const reader = await connection.getInfo()
    let rowCount = 0
    for await (const batch of reader) {
      rowCount += batch.numRows
    }
    expect(rowCount).toBeGreaterThan(0)

    await connection.close()
    await database.close()
  })

  it('should get table types', async () => {
    const database = new AdbcDatabase({
      driver: BASE_URL,
      databaseOptions: {
        backend_driver: 'sqlite',
        uri: ':memory:',
      },
    })
    const connection = await database.connect()

    const reader = await connection.getTableTypes()
    let tableTypes: string[] = []
    for await (const batch of reader) {
      // Assuming single column "table_type"
      const col = batch.getChildAt(0)
      if (col) {
        for (let i = 0; i < batch.numRows; i++) {
          tableTypes.push(col.get(i))
        }
      }
    }

    expect(tableTypes).toContain('table')
    expect(tableTypes).toContain('view')

    await connection.close()
    await database.close()
  })

  it('should handle transactions (commit/rollback)', async () => {
    const database = new AdbcDatabase({
      driver: BASE_URL,
      databaseOptions: {
        backend_driver: 'sqlite',
        uri: ':memory:',
        'adbc.connection.autocommit': 'false',
      },
    })
    const connection = await database.connect()

    const statement = await connection.createStatement()

    // Create table (DDL usually auto-commits in some DBs, but let's try DML)
    await statement.setSqlQuery('CREATE TABLE transaction_test (id INTEGER)')
    await statement.executeUpdate()

    // Insert and Commit
    await statement.setSqlQuery('INSERT INTO transaction_test VALUES (1)')
    await statement.executeUpdate()
    await connection.commit()

    // Verify Insert
    await statement.setSqlQuery('SELECT * FROM transaction_test WHERE id = 1')
    let reader = await statement.executeQuery()
    let count = 0
    for await (const batch of reader) count += batch.numRows
    expect(count).toBe(1)

    // Insert and Rollback
    await statement.setSqlQuery('INSERT INTO transaction_test VALUES (2)')
    await statement.executeUpdate()
    await connection.rollback()

    // Verify Rollback
    await statement.setSqlQuery('SELECT * FROM transaction_test WHERE id = 2')
    reader = await statement.executeQuery()
    count = 0
    for await (const batch of reader) count += batch.numRows
    expect(count).toBe(0)

    await statement.close()
    await connection.close()
    await database.close()
  })

  it('should bind parameters and execute', async () => {
    const database = new AdbcDatabase({
      driver: BASE_URL,
      databaseOptions: { backend_driver: 'sqlite', uri: ':memory:' },
    })
    const connection = await database.connect()
    const statement = await connection.createStatement()

    await statement.setSqlQuery('CREATE TABLE bind_test (id INTEGER, name TEXT)')
    await statement.executeUpdate()

    // Prepare Insert
    await statement.setSqlQuery('INSERT INTO bind_test VALUES (?, ?)')

    // Bind Data
    // Create a simple table with 2 rows
    const bindData = new Table({
      col0: vectorFromArray([100, 101]),
      col1: vectorFromArray(['Bound Value', 'Another Value']),
    })

    await statement.bind(bindData)
    await statement.executeUpdate()

    // Verify
    await statement.setSqlQuery('SELECT * FROM bind_test ORDER BY id')
    const reader = await statement.executeQuery()

    const batches = []
    for await (const batch of reader) batches.push(batch)

    expect(batches.length).toBeGreaterThan(0)
    const resTable = batches[0]
    expect(resTable.numRows).toBe(2)
    // Verify values (using BigInt for integers as verified in previous tests)
    expect(resTable.getChildAt(0)?.get(0)).toBe(100n)
    expect(resTable.getChildAt(1)?.get(0)).toBe('Bound Value')
    expect(resTable.getChildAt(0)?.get(1)).toBe(101n)

    await statement.close()
    await connection.close()
    await database.close()
  })

  it('should get table schema', async () => {
    const database = new AdbcDatabase({
      driver: BASE_URL,
      databaseOptions: { backend_driver: 'sqlite', uri: ':memory:' },
    })
    const connection = await database.connect()
    const statement = await connection.createStatement()

    // Create a table to ensure getTableSchema doesn't fail on 404/500 from server
    await statement.setSqlQuery('CREATE TABLE schema_test (id INTEGER)')
    await statement.executeUpdate()

    const schema = await connection.getTableSchema({ tableName: 'schema_test' })
    expect(schema).toBeDefined()
    // Check if fields exist.
    // Note: Arrow JS Schema structure access: schema.fields is an array of Field
    expect(schema.fields.length).toBeGreaterThan(0)
    expect(schema.fields[0].name).toBe('id')

    await statement.close()
    await connection.close()
    await database.close()
  })
})
