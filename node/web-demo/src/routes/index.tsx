import { createFileRoute, Link } from "@tanstack/react-router";
import { useListDrivers } from "@/api/hooks/useListDrivers";
import {
  useListDatabases,
  listDatabasesQueryKey,
} from "@/api/hooks/useListDatabases";
import { useCreateDatabase } from "@/api/hooks/useCreateDatabase";
import { useDeleteDatabase } from "@/api/hooks/useDeleteDatabase";
import { useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "@/lib/store";

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Trash2, Play } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

const DRIVER_LABELS: Record<string, string> = {
  sqlite: "SQLite",
  postgresql: "PostgreSQL",
  postgres: "PostgreSQL",
  duckdb: "DuckDB",
  snowflake: "Snowflake",
  flight: "Arrow Flight SQL",
  flight_sql: "Arrow Flight SQL",
};

const formatDriverName = (name: string) =>
  DRIVER_LABELS[name] || name.charAt(0).toUpperCase() + name.slice(1);

function Dashboard() {
  const {
    data: drivers,
    isLoading: isLoadingDrivers,
    error: driversError,
  } = useListDrivers();
  const {
    data: databases,
    isLoading: isLoadingDatabases,
    error: databasesError,
  } = useListDatabases();
  const { mutateAsync: createDatabaseMutation, isPending: isCreatingDatabase } =
    useCreateDatabase(); // Use mutateAsync
  const { mutate: deleteDatabaseMutation } = useDeleteDatabase();

  const establishConnection = useAppStore((state) => state.establishConnection);
  const closeConnection = useAppStore((state) => state.closeConnection);

  const queryClient = useQueryClient();

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState<string | undefined>(
    undefined,
  );
  const [dbUri, setDbUri] = useState<string>(":memory:");
  const [createDbError, setCreateDbError] = useState<string | null>(null);

  const handleCreateDatabase = async () => {
    if (!selectedDriver) {
      setCreateDbError("Please select a driver");
      return;
    }

    setCreateDbError(null);
    try {
      const dbResponse = await createDatabaseMutation({
        data: {
          driver: selectedDriver,
          options: {
            uri: dbUri,
          },
        },
      });
      // After successful DB creation on backend, establish ADBC connection and store token
      await establishConnection(dbResponse.id, {
        driver: `http://localhost:8080`, // Assuming same gateway
        databaseOptions: {
          backend_driver: selectedDriver,
          uri: dbUri,
        },
      });

      queryClient.invalidateQueries({ queryKey: listDatabasesQueryKey() }); // Invalidate to refetch list
      setIsCreateDialogOpen(false);
      setSelectedDriver(undefined);
      setDbUri(":memory:");
      toast.success("Database Created");
    } catch (err: any) {
      const message = err.message || "Failed to create database";
      setCreateDbError(message);
      toast.error("Failed to Create Database", {
        description: message,
      });
    }
  };

  const handleDeleteDatabase = (id: string) => {
    if (confirm("Are you sure you want to delete this database?")) {
      deleteDatabaseMutation(
        { id },
        {
          onSuccess: async () => {
            await closeConnection(id); // Close connection in context
            queryClient.invalidateQueries({
              queryKey: listDatabasesQueryKey(),
            }); // Invalidate to refetch list
            toast.success("Database Deleted");
          },
          onError: (err: any) => {
            toast.error("Failed to Delete Database", {
              description: err.message || "An unknown error occurred",
            });
          },
        },
      );
    }
  };

  const renderDriverOptions = () => {
    if (!selectedDriver) return null;

    const normalizedDriver = selectedDriver.toLowerCase();

    if (normalizedDriver === "sqlite" || normalizedDriver === "duckdb") {
      return (
        <div className="grid grid-cols-4 items-start gap-4">
          <Label htmlFor="uri" className="text-right pt-2">
            Database Path
          </Label>
          <div className="col-span-3 space-y-1">
            <Input
              id="uri"
              value={dbUri}
              onChange={(e) => setDbUri(e.target.value)}
              placeholder=":memory: or /path/to/file.db"
            />
            <p className="text-xs text-muted-foreground">
              Use <code className="bg-muted px-1 rounded">:memory:</code> for
              ephemeral in-memory storage.
            </p>
          </div>
        </div>
      );
    }

    if (normalizedDriver.includes("postgres")) {
      return (
        <div className="grid grid-cols-4 items-start gap-4">
          <Label htmlFor="uri" className="text-right pt-2">
            Connection URI
          </Label>
          <div className="col-span-3 space-y-1">
            <Input
              id="uri"
              value={dbUri}
              onChange={(e) => setDbUri(e.target.value)}
              placeholder="postgres://user:pass@localhost:5432/db"
            />
            <p className="text-xs text-muted-foreground">
              Format: <code>postgres://user:password@host:port/database</code>
            </p>
          </div>
        </div>
      );
    }

    if (normalizedDriver === "snowflake") {
      return (
        <div className="grid grid-cols-4 items-start gap-4">
          <Label htmlFor="uri" className="text-right pt-2">
            Account URI
          </Label>
          <div className="col-span-3 space-y-1">
            <Input
              id="uri"
              value={dbUri}
              onChange={(e) => setDbUri(e.target.value)}
              placeholder="user:pass@account_identifier/db/schema"
            />
            <p className="text-xs text-muted-foreground">
              Usually requires specific ADBC options for warehouse, role, etc.
            </p>
          </div>
        </div>
      );
    }

    // Default generic
    return (
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="uri" className="text-right">
          URI
        </Label>
        <Input
          id="uri"
          value={dbUri}
          onChange={(e) => setDbUri(e.target.value)}
          placeholder="Driver connection string"
          className="col-span-3"
        />
      </div>
    );
  };

  const dialogTitle = selectedDriver
    ? `New ${formatDriverName(selectedDriver)} Connection`
    : "New Database Connection";

  return (
    <div className="container mx-auto py-6">
      <h1 className="text-3xl font-bold mb-6">Dashboard</h1>

      {/* Drivers Section */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Available Drivers</CardTitle>
          <CardDescription>
            Drivers registered on the ADBC Gateway.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingDrivers && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}
          {driversError && (
            <div className="text-destructive">
              Error loading drivers: {driversError.message}
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {drivers?.map((driver) => (
              <Card key={driver} className="flex flex-col justify-between">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">
                    {formatDriverName(driver)}
                  </CardTitle>
                  <CardDescription>ADBC Driver ({driver})</CardDescription>
                </CardHeader>
                <CardContent className="pt-2">
                  {/* Driver-specific info could go here */}
                </CardContent>
                <CardFooter className="pt-4">
                  <Button
                    className="w-full"
                    onClick={() => {
                      setSelectedDriver(driver);
                      setIsCreateDialogOpen(true);
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Create Database
                  </Button>
                </CardFooter>
              </Card>
            ))}
            {!isLoadingDrivers && drivers?.length === 0 && (
              <div className="col-span-full text-center text-muted-foreground py-8">
                No drivers found.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Databases Section */}
      <Card>
        <CardHeader>
          <CardTitle>Active Databases</CardTitle>
          <CardDescription>
            Your currently active database connections.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingDatabases && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}
          {databasesError && (
            <div className="text-destructive">
              Error loading databases: {databasesError.message}
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {databases?.map((db) => (
              <Card key={db.id} className="flex flex-col justify-between">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg truncate" title={db.id}>
                    {formatDriverName(db.driver_name)} - {db.id.substring(0, 8)}
                    ...
                  </CardTitle>
                  <CardDescription>Database ID: {db.id}</CardDescription>
                </CardHeader>
                <CardContent className="pt-2">
                  {/* Database-specific info could go here */}
                </CardContent>
                <CardFooter className="flex justify-between pt-4">
                  <Link to="/query" search={{ dbId: db.id }}>
                    <Button variant="outline" size="sm">
                      <Play className="mr-2 h-4 w-4" />
                      Query
                    </Button>
                  </Link>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDeleteDatabase(db.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardFooter>
              </Card>
            ))}
            {!isLoadingDatabases && databases?.length === 0 && (
              <div className="col-span-full text-center text-muted-foreground py-8">
                No active databases. Create one using a driver above.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Create Database Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>
              Configure your{" "}
              {selectedDriver ? formatDriverName(selectedDriver) : "database"}{" "}
              connection settings.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="driver" className="text-right">
                Driver
              </Label>
              <Select value={selectedDriver} onValueChange={setSelectedDriver}>
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder="Select a driver" />
                </SelectTrigger>
                <SelectContent>
                  {drivers?.map((driver) => (
                    <SelectItem key={driver} value={driver}>
                      {formatDriverName(driver)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {renderDriverOptions()}
          </div>
          {createDbError && (
            <div className="text-destructive text-sm mt-2">{createDbError}</div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCreateDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateDatabase}
              disabled={!selectedDriver || !dbUri || isCreatingDatabase}
            >
              {isCreatingDatabase ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
