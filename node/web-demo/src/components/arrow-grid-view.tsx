import { useRef, useMemo } from "react";
import { Table as ArrowTable } from "apache-arrow";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";

interface ArrowGridViewProps {
  table: ArrowTable;
  className?: string;
  columns?: ColumnDef<any>[];
}

export function ArrowGridView({
  table,
  className,
  columns: userColumns,
}: ArrowGridViewProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  // Generate columns from Arrow Schema if not provided
  const columns = useMemo<ColumnDef<any>[]>(() => {
    if (userColumns) return userColumns;

    return table.schema.fields.map((field) => ({
      accessorKey: field.name,
      header: field.name,
      // We can add custom cell formatters here based on Arrow Type later
      cell: (info) => String(info.getValue()),
    }));
  }, [table.schema, userColumns]);

  const reactTable = useReactTable({
    data: [], // Dummy data, we handle rendering manually
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    defaultColumn: {
      size: 150, // Default width
      minSize: 50,
      maxSize: 500,
    },
  });

  const rowVirtualizer = useVirtualizer({
    count: table.numRows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 35, // 35px row height
    overscan: 5,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const flatHeaders = reactTable
    .getHeaderGroups()
    .flatMap((headerGroup) => headerGroup.headers);
  const tableColumns = reactTable.getVisibleFlatColumns();

  return (
    <div
      ref={parentRef}
      className={`h-full w-full overflow-auto border rounded-md bg-background ${className}`}
    >
      {/* We use a table-like structure but driven by divs for absolute positioning of virtual rows */}
      <div
        style={{
          // Ensure the container is at least as wide as the columns
          width: reactTable.getTotalSize(),
          minWidth: "100%",
          position: "relative",
        }}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex bg-muted/50 border-b font-medium text-muted-foreground backdrop-blur-sm">
          {flatHeaders &&
            flatHeaders.map((header) => (
              <div
                key={header.id}
                className="px-4 py-3 text-left text-sm text-xs uppercase tracking-wider font-semibold border-r last:border-r-0 flex items-center"
                style={{ width: header.getSize(), flexShrink: 0 }}
              >
                {flexRender(
                  header.column.columnDef.header,
                  header.getContext(),
                )}
              </div>
            ))}
        </div>

        {/* Virtualized Body */}
        <div style={{ height: `${totalSize}px`, position: "relative" }}>
          {virtualRows.map((virtualRow) => {
            const row = table.get(virtualRow.index);

            // Safety check
            if (!row) return null;

            return (
              <div
                key={virtualRow.index}
                className="absolute top-0 left-0 flex w-full border-b hover:bg-muted/30 transition-colors"
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {tableColumns.map((column) => {
                  // Access raw value directly from Arrow Row using column ID
                  const val = (row as any)[column.id];
                  return (
                    <div
                      key={column.id}
                      className="px-4 py-2 text-sm flex items-center border-r last:border-r-0 truncate font-mono text-xs"
                      style={{ width: column.getSize(), flexShrink: 0 }}
                      title={String(val)} // Tooltip for truncated content
                    >
                      {String(val)}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
