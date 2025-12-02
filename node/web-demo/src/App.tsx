import { useState } from "react";
import { Table as ArrowTable, tableFromIPC } from "apache-arrow";
import { Play, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function App() {
  const [query, setQuery] = useState("SELECT * FROM sqlite_schema");
  const [results, setResults] = useState<ArrowTable | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRunQuery = async () => {
    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const response = await fetch("http://localhost:8080/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to execute query");
      }

      const buffer = await response.arrayBuffer();
      const table = tableFromIPC(new Uint8Array(buffer));
      setResults(table);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : "An unknown error occurred",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">
            Arrow ADBC Gateway Demo
          </h1>
          <p className="text-muted-foreground">
            Connect to your data source and execute queries via Apache Arrow.
          </p>
        </div>

        <div className="grid gap-8">
          <Card>
            <CardHeader>
              <CardTitle>SQL Query</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Enter your SQL query here..."
                className="font-mono min-h-[150px]"
              />
              <div className="flex justify-end">
                <Button onClick={handleRunQuery} disabled={loading}>
                  {loading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="mr-2 h-4 w-4" />
                  )}
                  Run Query
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="min-h-[300px]">
            <CardHeader>
              <CardTitle>Results</CardTitle>
            </CardHeader>
            <CardContent>
              {error && (
                <div className="rounded-md bg-destructive/15 p-4 text-sm text-destructive">
                  {error}
                </div>
              )}

              {!error && !results && !loading && (
                <div className="text-center text-muted-foreground py-12">
                  No results to display. Run a query to see data.
                </div>
              )}

              {results && (
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {results.schema.fields.map((field) => (
                          <TableHead key={field.name}>{field.name}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Array.from(results).map((row, i) => (
                        <TableRow key={i}>
                          {results.schema.fields.map((field) => (
                            <TableCell key={field.name}>
                              {String(row[field.name])}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="p-4 text-xs text-muted-foreground border-t">
                    {results.numRows} rows returned
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default App;
