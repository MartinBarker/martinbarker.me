"use client";

import React, { useMemo, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
} from "@tanstack/react-table";
import { DndContext, closestCenter } from "@dnd-kit/core";
import {
  useSortable,
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import styles from "./Table.module.css";

function IndeterminateCheckbox({ indeterminate, className = "", ...rest }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (typeof indeterminate === "boolean" && ref.current) {
      ref.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);
  return <input type="checkbox" ref={ref} className={`${styles.checkbox} ${className}`} {...rest} />;
}

function DragHandle({ attributes, listeners, rowIndex }) {
  return (
    <div className={styles.dragHandleWrapper}>
      <button {...attributes} {...listeners} className={styles.dragHandle} title="Drag to reorder">
        ☰
      </button>
      <span className={styles.rowNumber}>{rowIndex + 1}</span>
    </div>
  );
}

function Row({
  row,
  rowIndex,
  toggleRowSelected,
  removeRow,
  isSelected,
  selectionEnabled,
}) {
  const { setNodeRef, transform, transition, attributes, listeners } = useSortable({
    id: row.original.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`${styles.row} ${isSelected ? styles.selected : ""}`}
      onClick={() => selectionEnabled && toggleRowSelected(row.original.id)}
    >
      {row.getVisibleCells().map((cell) => {
        const header = cell.column.columnDef.header;
        return (
          <td key={cell.id} className={styles.cell}>
            {header === "Select" && (
              <input
                type="checkbox"
                checked={isSelected}
                onChange={(e) => {
                  e.stopPropagation();
                  toggleRowSelected(row.original.id);
                }}
              />
            )}
            {header === "Drag" && (
              <DragHandle attributes={attributes} listeners={listeners} rowIndex={rowIndex} />
            )}
            {header === "Remove" && (
              <button
                className={styles.removeButton}
                onClick={(e) => {
                  e.stopPropagation();
                  removeRow(row.original.id);
                }}
                title="Remove this file"
              >
                ❌
              </button>
            )}
            {header !== "Select" && header !== "Drag" && header !== "Remove" && (
              <>{flexRender(cell.column.columnDef.cell, cell.getContext())}</>
            )}
          </td>
        );
      })}
    </tr>
  );
}

export default function Table({
  title,
  data,
  setData,
  selectedIds,
  onSelectionChange,
  onRemove,
  columns,
}) {
  const selectionSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const [sorting, setSorting] = useState([]);

  const toggleRowSelected = (id) => {
    const next = new Set(selectionSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(Array.from(next));
  };

  const toggleAllRowsSelected = () => {
    if (selectionSet.size === data.length) {
      onSelectionChange([]);
    } else {
      onSelectionChange(data.map((d) => d.id));
    }
  };

  const tableColumns = useMemo(() => {
    const base = [
      {
        header: "Select",
        id: "select",
        cell: () => null,
      },
      {
        header: "Drag",
        id: "drag",
        cell: () => null,
      },
      ...columns,
      {
        header: "Remove",
        id: "remove",
        cell: () => null,
      },
    ];
    return base.map((col) => ({
      ...col,
      enableSorting: col.header !== "Select" && col.header !== "Drag" && col.header !== "Remove",
      header: col.header === "Select" || col.header === "Drag" || col.header === "Remove"
        ? col.header
        : ({ column }) => (
            <button
              className={styles.sortButton}
              onClick={column.getToggleSortingHandler()}
              type="button"
            >
              <span>{typeof col.header === "string" ? col.header : flexRender(col.header, { column })}</span>
              <span className={styles.sortIcon}>
                {column.getIsSorted() === "asc" ? "▲" : column.getIsSorted() === "desc" ? "▼" : "⇅"}
              </span>
            </button>
          ),
    }));
  }, [columns]);

  const table = useReactTable({
    data,
    columns: tableColumns,
    getRowId: (row) => row.id,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!active || !over || active.id === over.id) return;
    const rows = table.getRowModel().rows;
    const oldIndex = rows.findIndex((r) => r.id === active.id);
    const newIndex = rows.findIndex((r) => r.id === over.id);
    const newData = arrayMove(rows.map((r) => r.original), oldIndex, newIndex);
    setData(newData);
  };

  return (
    <div className={styles.tableWrapper}>
      <div className={styles.tableHeader}>
        <div className={styles.tableTitle}>{title}</div>
        <div className={styles.headerActions}>
          <label className={styles.selectAll}>
            <IndeterminateCheckbox
              checked={selectionSet.size === data.length && data.length > 0}
              indeterminate={selectionSet.size > 0 && selectionSet.size < data.length}
              onChange={toggleAllRowsSelected}
            />
            Select all
          </label>
          <span className={styles.selectedCount}>
            {selectionSet.size} selected / {data.length} total
          </span>
        </div>
      </div>
      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={data.map((row) => row.id)} strategy={verticalListSortingStrategy}>
          <table className={styles.table}>
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className={styles.headerRow}>
                  {headerGroup.headers.map((header) => (
                    <th key={header.id} className={styles.headerCell}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row, rowIndex) => (
                <Row
                  key={row.id}
                  row={row}
                  rowIndex={rowIndex}
                  toggleRowSelected={toggleRowSelected}
                  removeRow={(id) => onRemove(id)}
                  isSelected={selectionSet.has(row.original.id)}
                  selectionEnabled
                />
              ))}
            </tbody>
          </table>
        </SortableContext>
      </DndContext>
    </div>
  );
}

