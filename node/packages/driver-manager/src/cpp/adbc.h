// adbc.h - Minimal ADBC definitions needed for the driver manager
#pragma once

#include <cstdint>
#include <cstdlib>
#include "arrow_c_definitions.h"

#ifdef __cplusplus
extern "C" {
#endif

#define ADBC_VERSION_1_0_0 1000000
#define ADBC_VERSION_1_1_0 1001000

typedef uint8_t AdbcStatusCode;

#define ADBC_STATUS_OK 0
#define ADBC_STATUS_UNKNOWN 1
#define ADBC_STATUS_NOT_IMPLEMENTED 2
#define ADBC_STATUS_NOT_FOUND 3
#define ADBC_STATUS_ALREADY_EXISTS 4
#define ADBC_STATUS_INVALID_ARGUMENT 5
#define ADBC_STATUS_INVALID_STATE 6
#define ADBC_STATUS_INVALID_DATA 7
#define ADBC_STATUS_INTEGRITY 8
#define ADBC_STATUS_INTERNAL 9
#define ADBC_STATUS_IO 10
#define ADBC_STATUS_CANCELLED 11
#define ADBC_STATUS_TIMEOUT 12
#define ADBC_STATUS_UNAUTHENTICATED 13
#define ADBC_STATUS_UNAUTHORIZED 14

struct AdbcError {
  char* message;
  int32_t vendor_code;
  char sqlstate[5];
  void (*release)(struct AdbcError* error);
  void* private_data;
  void* private_driver;
};

struct AdbcDatabase {
  void* private_data;
  void* private_driver;
};

struct AdbcConnection {
  void* private_data;
  void* private_driver;
};

struct AdbcStatement {
  void* private_data;
  void* private_driver;
};

struct AdbcPartitions {
  size_t num_partitions;
  const uint8_t** partitions;
  const size_t* partition_lengths;
  void* private_data;
  void (*release)(struct AdbcPartitions* partitions);
};

struct AdbcDriver {
  void* private_data;
  void* private_manager;
  AdbcStatusCode (*release)(struct AdbcDriver* driver, struct AdbcError* error);

  AdbcStatusCode (*DatabaseInit)(struct AdbcDatabase*, struct AdbcError*);
  AdbcStatusCode (*DatabaseNew)(struct AdbcDatabase*, struct AdbcError*);
  AdbcStatusCode (*DatabaseSetOption)(struct AdbcDatabase*, const char*, const char*, struct AdbcError*);
  AdbcStatusCode (*DatabaseRelease)(struct AdbcDatabase*, struct AdbcError*);

  AdbcStatusCode (*ConnectionCommit)(struct AdbcConnection*, struct AdbcError*);
  AdbcStatusCode (*ConnectionGetInfo)(struct AdbcConnection*, const uint32_t*, size_t, struct ArrowArrayStream*, struct AdbcError*);
  AdbcStatusCode (*ConnectionGetObjects)(struct AdbcConnection*, int, const char*, const char*, const char*, const char**, const char*, struct ArrowArrayStream*, struct AdbcError*);
  AdbcStatusCode (*ConnectionGetTableSchema)(struct AdbcConnection*, const char*, const char*, const char*, struct ArrowSchema*, struct AdbcError*);
  AdbcStatusCode (*ConnectionGetTableTypes)(struct AdbcConnection*, struct ArrowArrayStream*, struct AdbcError*);
  AdbcStatusCode (*ConnectionInit)(struct AdbcConnection*, struct AdbcDatabase*, struct AdbcError*);
  AdbcStatusCode (*ConnectionNew)(struct AdbcConnection*, struct AdbcError*);
  AdbcStatusCode (*ConnectionSetOption)(struct AdbcConnection*, const char*, const char*, struct AdbcError*);
  AdbcStatusCode (*ConnectionReadPartition)(struct AdbcConnection*, const uint8_t*, size_t, struct ArrowArrayStream*, struct AdbcError*);
  AdbcStatusCode (*ConnectionRelease)(struct AdbcConnection*, struct AdbcError*);
  AdbcStatusCode (*ConnectionRollback)(struct AdbcConnection*, struct AdbcError*);

  AdbcStatusCode (*StatementBind)(struct AdbcStatement*, struct ArrowArray*, struct ArrowSchema*, struct AdbcError*);
  AdbcStatusCode (*StatementBindStream)(struct AdbcStatement*, struct ArrowArrayStream*, struct AdbcError*);
  AdbcStatusCode (*StatementExecuteQuery)(struct AdbcStatement*, struct ArrowArrayStream*, int64_t*, struct AdbcError*);
  AdbcStatusCode (*StatementExecutePartitions)(struct AdbcStatement*, struct ArrowSchema*, struct AdbcPartitions*, int64_t*, struct AdbcError*);
  AdbcStatusCode (*StatementGetParameterSchema)(struct AdbcStatement*, struct ArrowSchema*, struct AdbcError*);
  AdbcStatusCode (*StatementNew)(struct AdbcConnection*, struct AdbcStatement*, struct AdbcError*);
  AdbcStatusCode (*StatementPrepare)(struct AdbcStatement*, struct AdbcError*);
  AdbcStatusCode (*StatementRelease)(struct AdbcStatement*, struct AdbcError*);
  AdbcStatusCode (*StatementSetOption)(struct AdbcStatement*, const char*, const char*, struct AdbcError*);
  AdbcStatusCode (*StatementSetSqlQuery)(struct AdbcStatement*, const char*, struct AdbcError*);
  AdbcStatusCode (*StatementSetSubstraitPlan)(struct AdbcStatement*, const uint8_t*, size_t, struct AdbcError*);
};

typedef AdbcStatusCode (*AdbcDriverInitFunc)(int version, void* driver, struct AdbcError* error);

#ifdef __cplusplus
}
#endif
