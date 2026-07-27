'use client';
import React, { useContext, useEffect, useMemo, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  flexRender,
} from '@tanstack/react-table';
import styles from './listogs.module.css';
import { ColorContext } from '../ColorContext';

// Helper to flatten videoData object to array with deduplication
function flattenVideoData(videoData) {
  const rows = [];
  const seenVideoIds = new Set();
  
  if (!videoData) return rows;
  
  Object.values(videoData).forEach(releaseObj => {
    if (Array.isArray(releaseObj)) {
      releaseObj.forEach(video => {
        // Only add if we haven't seen this videoId before
        if (video && video.videoId && !seenVideoIds.has(video.videoId)) {
          seenVideoIds.add(video.videoId);
          rows.push(video);
        } else if (video && !video.videoId) {
          // Include videos without videoId (shouldn't happen but be safe)
          rows.push(video);
        }
      });
    } else if (releaseObj && typeof releaseObj === 'object') {
      Object.values(releaseObj).forEach(video => {
        // Only add if we haven't seen this videoId before
        if (video && video.videoId && !seenVideoIds.has(video.videoId)) {
          seenVideoIds.add(video.videoId);
          rows.push(video);
        } else if (video && !video.videoId) {
          // Include videos without videoId (shouldn't happen but be safe)
          rows.push(video);
        }
      });
    }
  });
  
  return rows;
}

// Human-readable explanation of how a result relates to the searched Discogs
// page, based on the source type and the row's section/subsection/role.
function describeRelationship(row, sourceType) {
  const section = row.section || '';
  const subsection = row.subsection || '';
  if (sourceType === 'label') {
    return `Released on this label${subsection ? ` · ${subsection}` : ''}`;
  }
  if (sourceType === 'master') {
    return `A version/release under this master release${subsection ? ` · ${subsection}` : ''}`;
  }
  // artist (default)
  if (section === 'Releases') {
    return `Main release by this artist${subsection ? ` · ${subsection}` : ''}`;
  }
  if (section === 'Appearances') {
    return `This artist appears on this release${subsection ? ` · ${subsection}` : ''}`;
  }
  if (section === 'Unofficial') {
    return `Unofficial release featuring this artist${subsection ? ` · ${subsection}` : ''}`;
  }
  if (section === 'Credits') {
    return `This artist is credited${subsection ? ` for ${subsection}` : ''} on this release`;
  }
  return 'Related to your Discogs search';
}

export default function VideoTable({ videoData, onFilteredDataChange = () => {}, sourceType = 'artist' }) {
  const { darkMode } = useContext(ColorContext);

  // Dark mode color helpers
  const t = {
    bg: darkMode ? '#1e1e2e' : '#ffffff',
    bgAlt: darkMode ? '#252538' : '#f8f9fa',
    text: darkMode ? '#ffffff' : '#000000',
    textSecondary: darkMode ? '#ffffff' : '#000000',
    border: darkMode ? '#444' : '#eee',
    borderMed: darkMode ? '#444' : '#dee2e6',
    inputBg: darkMode ? '#2a2a3d' : '#ffffff',
    hoverBg: darkMode ? '#2d2d40' : '#f5f5f5',
  };

  const [search, setSearch] = useState('');
  // Cell ids the user has clicked to expand (show full text instead of the
  // truncated one-line ellipsis).
  const [expandedCells, setExpandedCells] = useState(() => new Set());
  const toggleCellExpanded = (id) => setExpandedCells(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  // Video ids whose embed iframe has finished loading (spinner hides once loaded).
  const [loadedVideos, setLoadedVideos] = useState(() => new Set());
  const markVideoLoaded = (videoId) => setLoadedVideos(prev => {
    if (prev.has(videoId)) return prev;
    const next = new Set(prev);
    next.add(videoId);
    return next;
  });
  const [masterOnly, setMasterOnly] = useState(false);
  // Video ids the user has explicitly UN-checked. Everything is selected by
  // default; deselecting specific rows removes them from the outputs (Video IDs
  // tab, CSV export, and the playlist count).
  const [deselectedRowIds, setDeselectedRowIds] = useState(() => new Set());
  const toggleRowSelected = (videoId) => setDeselectedRowIds(prev => {
    const next = new Set(prev);
    if (next.has(videoId)) next.delete(videoId); else next.add(videoId);
    return next;
  });
  const [sorting, setSorting] = useState([]);
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 4, // Show 4 rows by default
  });

  // Memoize rawData so reference is stable
  const rawData = useMemo(() => flattenVideoData(videoData), [videoData]);

  // Build the section/subsection tree (with counts) from the fetched rows, in
  // Discogs artist-page order. This drives the checkbox filter below (the same
  // shape as the "Sections to fetch" panel).
  const sectionTree = useMemo(() => {
    const order = ['Releases', 'Appearances', 'Unofficial', 'Credits'];
    const map = new Map();
    rawData.forEach(row => {
      const section = (row.section && row.section.trim()) || 'Other';
      const subsection = (row.subsection && row.subsection.trim()) || 'Other';
      if (!map.has(section)) map.set(section, { count: 0, subs: new Map() });
      const node = map.get(section);
      node.count += 1;
      node.subs.set(subsection, (node.subs.get(subsection) || 0) + 1);
    });
    const seen = [...map.keys()];
    const ordered = [...order.filter(x => map.has(x)), ...seen.filter(x => !order.includes(x))];
    return ordered.map(section => ({
      section,
      count: map.get(section).count,
      subs: [...map.get(section).subs.entries()].map(([name, count]) => ({ name, count })),
    }));
  }, [rawData]);

  const allTableCategoryKeys = useMemo(
    () => sectionTree.flatMap(sec => sec.subs.map(sub => `${sec.section}/${sub.name}`)),
    [sectionTree]
  );

  // null until first load = "everything selected". Preserve the user's choices
  // as new categories stream in (auto-include newly-seen ones; never clobber a
  // deselection).
  const [selectedTableCategories, setSelectedTableCategories] = useState(null);
  useEffect(() => {
    setSelectedTableCategories(prev => {
      if (prev === null) return new Set(allTableCategoryKeys);
      const next = new Set(prev);
      allTableCategoryKeys.forEach(k => { if (!prev.has(k)) next.add(k); });
      return next;
    });
  }, [allTableCategoryKeys]);

  const effectiveSelected = selectedTableCategories || new Set(allTableCategoryKeys);

  const toggleTableCategory = (key) => setSelectedTableCategories(prev => {
    const next = new Set(prev || allTableCategoryKeys);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const toggleTableSection = (section, subs) => setSelectedTableCategories(prev => {
    const next = new Set(prev || allTableCategoryKeys);
    const keys = subs.map(sub => `${section}/${sub.name}`);
    const allOn = keys.every(k => next.has(k));
    keys.forEach(k => { if (allOn) next.delete(k); else next.add(k); });
    return next;
  });
  const allTableCategoriesSelected =
    allTableCategoryKeys.length > 0 && allTableCategoryKeys.every(k => effectiveSelected.has(k));
  const toggleAllTableCategories = () =>
    setSelectedTableCategories(allTableCategoriesSelected ? new Set() : new Set(allTableCategoryKeys));

  const anyFiltersApplied = !allTableCategoriesSelected || masterOnly || !!search;
  const clearAllFilters = () => {
    setSelectedTableCategories(new Set(allTableCategoryKeys));
    setMasterOnly(false);
    setSearch('');
  };

  const data = useMemo(() => {
    let filteredData = rawData;

    // Section/subsection checkbox filter
    if (selectedTableCategories) {
      filteredData = filteredData.filter(row => {
        const key = `${(row.section && row.section.trim()) || 'Other'}/${(row.subsection && row.subsection.trim()) || 'Other'}`;
        return selectedTableCategories.has(key);
      });
    }

    if (masterOnly) {
      filteredData = filteredData.filter(row => row.isMasterRelease);
    }

    if (search) {
      const lower = search.toLowerCase();
      filteredData = filteredData.filter(row =>
        Object.values(row).some(
          v => typeof v === 'string' && v.toLowerCase().includes(lower)
        )
      );
    }

    return filteredData;
  }, [rawData, search, masterOnly, selectedTableCategories]);

  // Rows that survive the filters AND haven't been individually de-selected.
  // This is what feeds the outputs (Video IDs tab, CSV, playlist count).
  const outputRows = useMemo(
    () => data.filter(row => !deselectedRowIds.has(row.videoId)),
    [data, deselectedRowIds]
  );

  useEffect(() => {
    onFilteredDataChange(outputRows);
  }, [outputRows, onFilteredDataChange]);

  // Header "select all" state, scoped to the currently filtered rows.
  const filteredSelectedCount = data.filter(row => !deselectedRowIds.has(row.videoId)).length;
  const allFilteredSelected = data.length > 0 && filteredSelectedCount === data.length;
  const someFilteredSelected = filteredSelectedCount > 0 && filteredSelectedCount < data.length;
  const toggleSelectAllFiltered = () => setDeselectedRowIds(prev => {
    const next = new Set(prev);
    if (allFilteredSelected) {
      // deselect every currently-filtered row
      data.forEach(row => next.add(row.videoId));
    } else {
      // select every currently-filtered row
      data.forEach(row => next.delete(row.videoId));
    }
    return next;
  });

  const columns = useMemo(() => [
    {
      accessorKey: 'releaseTitle',
      header: 'Release',
      cell: info => info.getValue(),
      enableSorting: true,
    },
    {
      accessorKey: 'artist',
      header: 'Artist',
      cell: info => info.getValue(),
      enableSorting: true,
    },
    {
      accessorKey: 'year',
      header: 'Year',
      cell: info => info.getValue(),
      enableSorting: true,
    },
    {
      accessorKey: 'releaseType',
      header: 'Release Type',
      cell: info => info.getValue() || 'N/A',
      enableSorting: true,
    },
    {
      accessorKey: 'section',
      header: 'Section',
      cell: info => info.getValue() || 'N/A',
      enableSorting: true,
    },
    {
      accessorKey: 'subsection',
      header: 'Subsection',
      cell: info => info.getValue() || 'N/A',
      enableSorting: true,
    },
    {
      accessorKey: 'labelsAndCompanies',
      header: 'Labels & Companies',
      cell: info => {
        const value = info.getValue();
        if (!value) return 'N/A';
        if (Array.isArray(value)) {
          if (value.length === 0) return 'N/A';
          return value.join(', ');
        }
        return value;
      },
      enableSorting: false,
    },
    {
      accessorKey: 'genres',
      header: 'Genres',
      cell: info => {
        const value = info.getValue();
        if (!value) return 'N/A';
        if (Array.isArray(value)) {
          if (value.length === 0) return 'N/A';
          return value.join(', ');
        }
        return value;
      },
      enableSorting: false,
    },
    {
      accessorKey: 'styles',
      header: 'Styles',
      cell: info => {
        const value = info.getValue();
        if (!value) return 'N/A';
        if (Array.isArray(value)) {
          if (value.length === 0) return 'N/A';
          return value.join(', ');
        }
        return value;
      },
      enableSorting: false,
    },
    {
      accessorKey: 'country',
      header: 'Country',
      cell: info => info.getValue() || 'N/A',
      enableSorting: true,
    },
    {
      accessorKey: 'title',
      header: 'Video Title',
      cell: info => info.getValue(),
      enableSorting: true,
    },
    {
      accessorKey: 'fullUrl',
      header: 'YouTube Link',
      cell: info => (
        <a href={info.getValue()} target="_blank" rel="noopener noreferrer" style={{ color: '#0066cc' }}>
          {info.row.original.videoId}
        </a>
      ),
      enableSorting: false,
    },
    {
      accessorKey: 'discogsUrl',
      header: 'Discogs Link',
      cell: info => (
        <a href={info.getValue()} target="_blank" rel="noopener noreferrer" style={{ color: '#0066cc' }}>
          Discogs
        </a>
      ),
      enableSorting: false,
    },
  ], []);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    state: { 
      pagination,
      sorting,
    },
    autoResetPageIndex: false,
    autoResetExpanded: false,
  });

  return (
    <div className={styles.tableWrapper}>
      <div className={styles.filterCard}>
        <div className={styles.filterHeaderRow}>
          <span className={styles.filterHeaderTitle}>Filter Results</span>
          {anyFiltersApplied && (
            <button
              type="button"
              className={styles.clearFiltersButton}
              onClick={clearAllFilters}
            >
              Clear All
            </button>
          )}
        </div>

        {/* Search across every field (title, artist, release, id, labels, …) */}
        <div style={{ position: 'relative', margin: '4px 0 12px', maxWidth: 420 }}>
          <span aria-hidden="true" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: t.textSecondary, fontSize: 14 }}>🔍</span>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search results (title, artist, release, id, label…)"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '8px 30px 8px 30px',
              fontSize: 14,
              borderRadius: 6,
              border: `1px solid ${t.borderMed}`,
              background: t.inputBg,
              color: t.text,
            }}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'transparent', color: t.textSecondary, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
            >
              ×
            </button>
          )}
        </div>

        <div style={{ padding: '4px 0 8px' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <button
              type="button"
              onClick={toggleAllTableCategories}
              style={{ padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'transparent', color: '#0066cc', border: `1px solid ${t.borderMed}`, borderRadius: 4 }}
            >
              {allTableCategoriesSelected ? 'Deselect all' : 'Select all'}
            </button>
            <span style={{ fontSize: 12, color: t.textSecondary }}>Show these sections in the results</span>
          </div>
          {sectionTree.length === 0 ? (
            <div style={{ fontSize: 13, color: t.textSecondary }}>No results yet.</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, rowGap: 12 }}>
              {sectionTree.map(({ section, count, subs }) => {
                const keys = subs.map(sub => `${section}/${sub.name}`);
                const allOn = keys.every(k => effectiveSelected.has(k));
                const someOn = keys.some(k => effectiveSelected.has(k));
                return (
                  <div key={section} style={{ minWidth: 190 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: t.text, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={allOn}
                        ref={el => { if (el) el.indeterminate = !allOn && someOn; }}
                        onChange={() => toggleTableSection(section, subs)}
                      />
                      {section} <span style={{ color: t.textSecondary, fontWeight: 600 }}>({count})</span>
                    </label>
                    <div style={{ paddingLeft: 22, marginTop: 2 }}>
                      {subs.map(sub => {
                        const key = `${section}/${sub.name}`;
                        return (
                          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: t.text, padding: '1px 0', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={effectiveSelected.has(key)}
                              onChange={() => toggleTableCategory(key)}
                            />
                            <span style={{ flex: 1 }}>{sub.name}</span>
                            <span style={{ color: t.textSecondary }}>{sub.count}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className={styles.masterToggleRow}>
          <label>
            <input
              type="checkbox"
              checked={masterOnly}
              onChange={e => setMasterOnly(e.target.checked)}
            />
            Master releases only
          </label>
        </div>

        <div className={styles.filterFooter}>
          Showing {data.length} of {rawData.length} videos · <strong>{outputRows.length} selected</strong> (used for Video IDs, CSV & playlist)
        </div>
      </div>
      
      <div style={{ width: '100%', maxWidth: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse', marginBottom: 16, background: t.bg, color: t.text }}>
        <thead>
          {table.getHeaderGroups().map(headerGroup => (
            <tr key={headerGroup.id}>
              <th
                style={{
                  borderBottom: `1px solid ${t.borderMed}`,
                  padding: '8px',
                  background: t.bg,
                  color: t.text,
                  textAlign: 'center',
                  width: 36,
                }}
                title={allFilteredSelected ? 'Deselect all shown rows' : 'Select all shown rows'}
              >
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  ref={el => { if (el) el.indeterminate = someFilteredSelected; }}
                  onChange={toggleSelectAllFiltered}
                />
              </th>
              {headerGroup.headers.map(header => (
                <th
                  key={header.id}
                  style={{
                    borderBottom: `1px solid ${t.borderMed}`,
                    padding: '8px',
                    background: t.bg,
                    color: t.text,
                    textAlign: 'left',
                    cursor: header.column.getCanSort() ? 'pointer' : 'default',
                    userSelect: 'none',
                    position: 'relative',
                    maxWidth: 220,
                    whiteSpace: 'nowrap',
                  }}
                  onClick={header.column.getToggleSortingHandler()}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getCanSort() && (
                      <span style={{ 
                        fontSize: '12px', 
                        opacity: header.column.getIsSorted() ? 1 : 0.5,
                        fontWeight: 'bold'
                      }}>
                        {header.column.getIsSorted() === 'asc' ? '↑' : 
                         header.column.getIsSorted() === 'desc' ? '↓' : '↕'}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map(row => {
            const rowSelected = !deselectedRowIds.has(row.original.videoId);
            return (
            <React.Fragment key={row.id}>
              <tr style={{ opacity: rowSelected ? 1 : 0.45 }}>
                <td
                  style={{
                    padding: '8px',
                    borderBottom: `1px solid ${t.border}`,
                    background: t.bg,
                    textAlign: 'center',
                    verticalAlign: 'top',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={rowSelected}
                    onChange={() => toggleRowSelected(row.original.videoId)}
                    title={rowSelected ? 'Exclude this video' : 'Include this video'}
                  />
                </td>
                {row.getVisibleCells().map(cell => {
                  const raw = cell.getValue();
                  const titleText = typeof raw === 'string' || typeof raw === 'number' ? String(raw) : undefined;
                  const expanded = expandedCells.has(cell.id);
                  return (
                    <td
                      key={cell.id}
                      title={expanded ? undefined : titleText}
                      onClick={() => toggleCellExpanded(cell.id)}
                      style={{
                        padding: '8px',
                        borderBottom: `1px solid ${t.border}`,
                        background: t.bg,
                        color: t.text,
                        maxWidth: 220,
                        cursor: 'pointer',
                        verticalAlign: 'top',
                      }}
                    >
                      <div
                        style={expanded
                          ? { maxWidth: 220, whiteSpace: 'normal', overflowWrap: 'anywhere' }
                          : { maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </div>
                    </td>
                  );
                })}
              </tr>
              <tr>
                <td colSpan={row.getVisibleCells().length + 1} style={{ padding: 0, background: t.bg, color: t.text }}>
                  {/* How this result relates to the searched Discogs page */}
                  <div style={{ padding: '4px 8px 0', fontSize: 12, color: t.textSecondary, textAlign: 'center' }}>
                    <span aria-hidden="true">🔗 </span>{describeRelationship(row.original, sourceType)}
                  </div>
                  {row.original.videoId && (
                    <div style={{ padding: '8px 0 12px', textAlign: 'center' }}>
                      <div style={{ position: 'relative', width: 360, height: 203, margin: '0 auto' }}>
                        {!loadedVideos.has(row.original.videoId) && (
                          <div
                            style={{
                              position: 'absolute', inset: 0, display: 'flex',
                              alignItems: 'center', justifyContent: 'center',
                              background: t.bgAlt, borderRadius: 8,
                            }}
                          >
                            <span className={styles.videoSpinner} aria-label="Loading video" role="status" />
                          </div>
                        )}
                        <iframe
                          width="360"
                          height="203"
                          src={`https://www.youtube.com/embed/${row.original.videoId}`}
                          title="YouTube video"
                          frameBorder="0"
                          loading="lazy"
                          onLoad={() => markVideoLoaded(row.original.videoId)}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                          style={{ position: 'relative', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}
                        />
                      </div>
                    </div>
                  )}
                </td>
              </tr>
            </React.Fragment>
            );
          })}
        </tbody>
      </table>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: t.text, background: t.bg, flexWrap: 'wrap' }}>
        {/* Pagination controls (left) */}
        <button onClick={() => table.firstPage()} disabled={!table.getCanPreviousPage()}>
          {'<<'}
        </button>
        <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
          {'<'}
        </button>
        <span>
          Page{' '}
          <strong>
            {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
          </strong>
        </span>
        <button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
          {'>'}
        </button>
        <button onClick={() => table.lastPage()} disabled={!table.getCanNextPage()}>
          {'>>'}
        </button>
        <span>
          | Go to page:{' '}
          <input
            type="number"
            min={1}
            max={table.getPageCount()}
            value={table.getState().pagination.pageIndex + 1}
            onChange={e => {
              const page = e.target.value ? Number(e.target.value) - 1 : 0;
              table.setPageIndex(page);
            }}
            style={{ width: '60px' }}
          />
        </span>
        <select
          value={table.getState().pagination.pageSize}
          onChange={e => {
            table.setPageSize(Number(e.target.value));
          }}
        >
          {[10, 20, 30, 40, 50].map(pageSize => (
            <option key={pageSize} value={pageSize}>
              Show {pageSize}
            </option>
          ))}
        </select>
        <span style={{ marginLeft: 'auto' }}>
          {table.getRowCount()} videos
        </span>
      </div>
    </div>
  );
}
