import { useState, useEffect } from "react";
import { Table as ArrowTable } from "apache-arrow";
import { Play, Loader2, Database } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createFileRoute } from "@tanstack/react-router";
import { useAppStore } from "@/lib/store";
import { useListDatabases } from "@/api/hooks/useListDatabases";

const searchSchema = z.object({
  dbId: z.string().optional(),
});

export const Route = createFileRoute("/query")({
  validateSearch: (search) => searchSchema.parse(search),
  component: QueryEditor,
});

function QueryEditor() {
  const { dbId } = Route.useSearch();
  const navigate = Route.useNavigate();
  
  const getConnection = useAppStore((state) => state.getConnection);
  const establishConnection = useAppStore((state) => state.establishConnection);
  const activeConn = useAppStore((state) => dbId ? state.connections[dbId] : undefined);
  
  const runQuery = useAppStore((state) => state.runQuery);
  const results = useAppStore((state) => state.queryResults);
  const loading = useAppStore((state) => state.isQueryRunning);
  const error = useAppStore((state) => state.queryError);

  const { data: databases } = useListDatabases();

  // Auto-connect effect
  useEffect(() => {
    if (dbId && !activeConn && databases) {
      const dbInfo = databases.find((d) => d.id === dbId);
      if (dbInfo) {
        establishConnection(dbId, {
          driver: "http://localhost:8080",
          databaseOptions: { id: dbId },
        }).catch((err) => {
          console.error("Failed to auto-connect:", err);
          toast.error("Connection Failed", { description: "Could not connect to selected database." });
        });
      }
    }
  }, [dbId, activeConn, databases, establishConnection]);

  const [query, setQuery] = useState(`SELECT * FROM sqlite_master`);

  // Handle DB change: maybe clear results? 
  // Store logic handles clearing on new runQuery, but switching DB might want to clear view.
  useEffect(() => {
     // Optional: Clear results in store if needed, but for now we just switch context.
  }, [dbId]);

  const handleDbChange = (newDbId: string) => {
    navigate({ search: { dbId: newDbId } });
  };

  const handleRunQuery = () => {
    if (!dbId) {
        toast.error("No Database Selected");
        return;
    }
    runQuery(dbId, query);
  };

  const connectionList = databases || [];

  return (
    <div className="flex flex-col h-full space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Query Editor</h2>
        <div className="flex items-center gap-4">
          <Select value={dbId} onValueChange={handleDbChange}>
            <SelectTrigger className="w-[250px]">
              <Database className="mr-2 h-4 w-4" />
              <SelectValue placeholder="Select a database..." />
            </SelectTrigger>
            <SelectContent>
              {databases?.map((db) => (
                <SelectItem key={db.id} value={db.id}>
                  <span className="font-medium">{db.driver_name}</span>
                  <span className="ml-2 text-muted-foreground text-xs">
                    {db.id.substring(0, 8)}...
                  </span>
                </SelectItem>
              ))}
              {databases?.length === 0 && (
                <div className="p-2 text-sm text-muted-foreground text-center">
                  No databases found. Create one in Dashboard.
                </div>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!activeConn && (
        <div className="flex-1 flex items-center justify-center rounded-lg border border-dashed p-8 text-center animate-in fade-in-50">
          <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
            <Database className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="mt-4 text-lg font-semibold">No Database Selected</h3>
            <p className="mb-4 mt-2 text-sm text-muted-foreground">
              Select an active database connection from the dropdown above to start querying.
            </p>
          </div>
        </div>
      )}

      {activeConn && (
        <div className="flex-1 flex flex-col space-y-4 overflow-hidden">
          <Card className="flex-shrink-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                SQL Input
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="SELECT * FROM ..."
                className="font-mono min-h-[120px] resize-y"
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

          <Card className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                Results
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 p-0 overflow-auto relative">
              {error && (
                <div className="absolute inset-0 p-4 bg-destructive/5 text-destructive text-sm font-mono whitespace-pre-wrap">
                  {error}
                </div>
              )}

              {!error && !results && !loading && (
                <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                  Execute a query to view results
                </div>
              )}

              {results && (
                <div className="h-full w-full overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
                      <TableRow>
                        {results.schema.fields.map((field) => (
                          <TableHead key={field.name} className="whitespace-nowrap">
                            {field.name}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Array.from(results.slice(0, 100)).map((row, i) => (
                        <TableRow key={i}>
                          {results.schema.fields.map((field) => (
                            <TableCell key={field.name} className="whitespace-nowrap font-mono text-xs">
                              {String(row[field.name])}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
            {results && (
              <div className="p-2 border-t bg-muted/20 text-xs text-muted-foreground text-right">
                Showing {Math.min(results.numRows, 100)} of {results.numRows} rows
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
