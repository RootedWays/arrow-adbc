# ADBC Web Client Demonstration

This project is a web client demonstrating the capabilities of an Apache Arrow Database Connectivity (ADBC) driver manager. It focuses on the following core aspects:

-   **Pure-TypeScript ADBC Driver Manager:** Implements a client-side ADBC driver manager entirely in TypeScript.
-   **Arrow over HTTP:** Demonstrates fetching query results from an ADBC Gateway over HTTP, utilizing the Apache Arrow binary format.
-   **Result Set Streaming:** Shows continuous streaming of Arrow record batches into the web client.
-   **High-Performance Last-Mile Data Handling:** Presents Arrow data directly to the UI, leveraging client-side processing for efficient visualization of large datasets.
-   **Interactive Data Grid:** Features a virtualized grid capable of displaying large result sets, with column type introspection (from Arrow schema) and optimized rendering.

## Technical Stack:

-   **Frontend Framework:** React 19
-   **Language:** TypeScript
-   **Build Tool:** Vite
-   **Routing:** @tanstack/react-router
-   **State Management & Data Fetching:** Zustand, @tanstack/react-query
-   **UI Components:** shadcn/ui
-   **Data Processing:** apache-arrow
-   **API Generation:** Kubb (from openapi.yaml)

## Getting Started:

1.  **Generate API Client:**
    Before running the development server, you need to generate the API client based on the OpenAPI specification.
    You will first need to copy the `openapi.yaml` spec from your ADBC Gateway's directory into `node/web-demo/openapi.yaml`.
    Then, run:
    ```bash
    npm run gen
    ```
2.  **Start Development Server:**
    ```bash
    npm run dev
    ```

This will start the Vite development server, and you can access the application in your browser.
