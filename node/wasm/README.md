# ADBC TypeScript Driver Manager

This package (`adbc-node-wasm`) provides a pure TypeScript implementation of an ADBC (Arrow Database Connectivity) Driver Manager. It is designed to facilitate querying Arrow data over HTTP via an ADBC Gateway.

## Overview

This library serves as a client-side driver manager (targeting Web/Node.js environments) that:
-   Implements the ADBC standard interfaces for Database, Connection, and Statement.
-   Communicates with an ADBC Gateway (running remotely) to execute SQL queries.
-   Receives and processes Apache Arrow streams directly in the browser or Node.js environment via HTTP.
-   Is built with TypeScript and compiled to JavaScript (ESM), making it suitable for modern web development workflows.

*Note: The package name `adbc-node-wasm` is currently being used, but this implementation is pure TypeScript/JavaScript.*

## Prerequisites

-   Node.js (LTS version recommended)
-   An ADBC Gateway running and accessible via HTTP.

## Installation

```bash
npm install
```

## Building

To build the project (transpile TypeScript to JavaScript):

```bash
npm run build
```

This will generate the output in the `dist/` directory.

## Testing

To run the test suite:

```bash
npm run test
```

This uses `vitest` to execute the tests located in the `__test__` directory.

## Formatting

To format the code using Prettier:

```bash
npm run format
```
