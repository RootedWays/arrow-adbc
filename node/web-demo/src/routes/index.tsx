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
import { useState, useMemo } from "react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export const Route = createFileRoute("/")({
  component: Databases,
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

function Databases() {
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
  const [dbName, setDbName] = useState<string>("");
  const [dbUri, setDbUri] = useState<string>(":memory:");
  const [createDbError, setCreateDbError] = useState<string | null>(null);

  // PostgreSQL specific states
  const [pgUser, setPgUser] = useState<string>("");
  const [pgPass, setPgPass] = useState<string>("");
  const [pgHost, setPgHost] = useState<string>("localhost");
  const [pgPort, setPgPort] = useState<string>("5432");
  const [pgDb, setPgDb] = useState<string>("");
  const [pgInputType, setPgInputType] = useState<"uri" | "params">("uri");

  const handleCreateDatabase = async () => {
    if (!selectedDriver) {
      setCreateDbError("Please select a driver");
      return;
    }

    let finalDbUri = dbUri; // Default to the general dbUri state
    if (
      selectedDriver.toLowerCase().includes("postgres") &&
      pgInputType === "params"
    ) {
      if (!pgUser || !pgHost || !pgDb) {
        // pgPort is now optional
        setCreateDbError(
          "Please fill in all required PostgreSQL parameters (User, Host, Database).",
        );
        return;
      }
      finalDbUri = `postgres://${pgUser}:${pgPass}@${pgHost}:${pgPort}/${pgDb}`;
    }

    setCreateDbError(null);
    try {
      const dbResponse = await createDatabaseMutation({
        data: {
          driver: selectedDriver,
          name: dbName || null,
          options: {
            [selectedDriver.toLowerCase() === "duckdb" ? "path" : "uri"]:
              finalDbUri,
          },
        },
      });
      // After successful DB creation on backend, establish ADBC connection and store token
      await establishConnection(dbResponse.id, {
        driver: `http://localhost:8080`, // Assuming same gateway
        databaseOptions: {
          backend_driver: selectedDriver,
        },
      });
      queryClient.invalidateQueries({ queryKey: listDatabasesQueryKey() }); // Invalidate to refetch list
      setIsCreateDialogOpen(false);
      setSelectedDriver(undefined);
      setDbName("");
      setDbUri(":memory:");
      setPgUser("");
      setPgPass("");
      setPgHost("localhost");
      setPgPort("5432");
      setPgDb("");
      setPgInputType("uri");
      toast.success("Database Created");
    } catch (err: any) {
      const message = err.message || "Failed to create database";
      setCreateDbError(message);
      toast.error("Failed to Create Database", {
        description: message,
      });
    }
  };

  const isCreateButtonDisabled = useMemo(() => {
    if (!selectedDriver || isCreatingDatabase) {
      return true;
    }
    const normalizedDriver = selectedDriver.toLowerCase();
    if (normalizedDriver.includes("postgres") && pgInputType === "params") {
      return !pgUser || !pgHost || !pgDb; // pgPort is now optional
    }
    return !dbUri;
  }, [
    selectedDriver,
    isCreatingDatabase,
    pgInputType,
    dbUri,
    pgUser,
    pgHost,
    pgPort,
    pgDb,
  ]);

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
          <Label htmlFor="path" className="text-right pt-2">
            Database Path
          </Label>
          <div className="col-span-3 space-y-1">
            <Input
              id="path"
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
      const portPart = pgPort ? `:${pgPort}` : "";
      const constructedUri = `postgres://${pgUser}:${pgPass}@${pgHost}${portPart}/${pgDb}`;
      const maskedUri = `postgres://${pgUser}:${pgPass ? "*******" : ""}@${pgHost}${portPart}/${pgDb}`;
      return (
        <Tabs
          value={pgInputType}
          onOnValueChange={(value) => setPgInputType(value as "uri" | "params")}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="uri">Connection URI</TabsTrigger>
            <TabsTrigger value="params">Parameters</TabsTrigger>
          </TabsList>
          <TabsContent value="uri" className="space-y-4 pt-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="uri" className="text-right">
                Connection URI
              </Label>
              <Input
                id="uri"
                value={dbUri}
                onChange={(e) => setDbUri(e.target.value)}
                placeholder="postgres://user:pass@host:port/database"
                className="col-span-3"
              />
            </div>
            <p className="text-xs text-muted-foreground col-span-4 text-center">
              Format: <code>postgres://user:password@host:port/database</code>
            </p>
          </TabsContent>
          <TabsContent value="params" className="space-y-4 pt-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="pgUser" className="text-right">
                User
              </Label>
              <Input
                id="pgUser"
                value={pgUser}
                onChange={(e) => setPgUser(e.target.value)}
                placeholder="user"
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="pgPass" className="text-right">
                Password
              </Label>
              <Input
                id="pgPass"
                type="password"
                value={pgPass}
                onChange={(e) => setPgPass(e.target.value)}
                placeholder="password"
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="pgHost" className="text-right">
                Host
              </Label>
              <Input
                id="pgHost"
                value={pgHost}
                onChange={(e) => setPgHost(e.target.value)}
                placeholder="localhost"
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="pgPort" className="text-right">
                Port (optional)
              </Label>
              <Input
                id="pgPort"
                value={pgPort}
                onChange={(e) => setPgPort(e.target.value)}
                placeholder="5432"
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="pgDb" className="text-right">
                Database
              </Label>
              <Input
                id="pgDb"
                value={pgDb}
                onChange={(e) => setPgDb(e.target.value)}
                placeholder="database"
                className="col-span-3"
              />
            </div>
            <p className="text-xs text-muted-foreground col-span-4 text-center">
              Constructed URI: <code>{maskedUri}</code>
            </p>
          </TabsContent>
        </Tabs>
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
      <h1 className="text-3xl font-bold mb-6">Databases</h1>

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
                    {db.name || formatDriverName(db.driver_name)}
                  </CardTitle>
                  <CardDescription className="truncate" title={db.id}>
                    ID: {db.id}
                  </CardDescription>
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
      <Dialog
        open={isCreateDialogOpen}
        onOpenChange={(open) => {
          setIsCreateDialogOpen(open);
          if (!open) {
            // Reset all form states when dialog is closed
            setSelectedDriver(undefined);
            setDbName("");
            setDbUri(":memory:");
            setPgUser("");
            setPgPass("");
            setPgHost("localhost");
            setPgPort("5432");
            setPgDb("");
            setPgInputType("uri");
            setCreateDbError(null);
          }
        }}
      >
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
              <Label htmlFor="name" className="text-right">
                Name
              </Label>
              <Input
                id="name"
                value={dbName}
                onChange={(e) => setDbName(e.target.value)}
                placeholder="My Database"
                className="col-span-3"
              />
            </div>
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
              disabled={isCreateButtonDisabled}
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
