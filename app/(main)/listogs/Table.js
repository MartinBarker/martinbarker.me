'use client';
import React, { useMemo, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  flexRender,
} from '@tanstack/react-table';

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

export default function VideoTable({ videoData }) {
  const [search, setSearch] = useState('');
  const [releaseTypeFilter, setReleaseTypeFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [yearRangeStart, setYearRangeStart] = useState('');
  const [yearRangeEnd, setYearRangeEnd] = useState('');
  const [sorting, setSorting] = useState([]);
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 4, // Show 4 rows by default
  });

  // Memoize rawData so reference is stable
  const rawData = useMemo(() => flattenVideoData(videoData), [videoData]);
  const data = useMemo(() => {
    let filteredData = rawData;
    
    // Apply release type filter
    if (releaseTypeFilter !== 'all') {
      filteredData = filteredData.filter(row => row.releaseType === releaseTypeFilter);
    }
    
    // Apply year filter
    if (yearFilter === 'specific' && yearRangeStart) {
      if (yearRangeEnd) {
        // Year range filter
        const startYear = parseInt(yearRangeStart);
        const endYear = parseInt(yearRangeEnd);
        filteredData = filteredData.filter(row => {
          const year = parseInt(row.year);
          return year >= startYear && year <= endYear;
        });
      } else {
        // Single year filter
        filteredData = filteredData.filter(row => row.year === yearRangeStart);
      }
    } else if (yearFilter !== 'all') {
      // Specific year filter
      filteredData = filteredData.filter(row => row.year === yearFilter);
    }
    
    // Apply search filter
    if (search) {
      const lower = search.toLowerCase();
      filteredData = filteredData.filter(row =>
        Object.values(row).some(
          v => typeof v === 'string' && v.toLowerCase().includes(lower)
        )
      );
    }
    
    return filteredData;
  }, [rawData, search, releaseTypeFilter, yearFilter, yearRangeStart, yearRangeEnd]);

  // Get unique release types for filter dropdown
  const uniqueReleaseTypes = useMemo(() => {
    const types = new Set();
    rawData.forEach(row => {
      if (row.releaseType && row.releaseType.trim()) {
        types.add(row.releaseType);
      }
    });
    return Array.from(types).sort();
  }, [rawData]);

  // Get unique years for filter dropdown
  const uniqueYears = useMemo(() => {
    const years = new Set();
    rawData.forEach(row => {
      // Handle various year formats and ensure we have valid years
      if (row.year) {
        const yearStr = row.year.toString().trim();
        // Only add valid 4-digit years (and some 3-digit years for historical records)
        if (yearStr && /^\d{3,4}$/.test(yearStr)) {
          years.add(yearStr);
        }
      }
    });
    return Array.from(years).sort((a, b) => parseInt(b) - parseInt(a)); // Sort descending (newest first)
  }, [rawData]);

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
      accessorKey: 'title',
      header: 'Video Title',
      cell: info => info.getValue(),
      enableSorting: true,
    },
    {
      accessorKey: 'fullUrl',
      header: 'YouTube Link',
      cell: info => (
        <a href={info.getValue()} target="_blank" rel="noopener noreferrer">
          {info.row.original.videoId}
        </a>
      ),
      enableSorting: false,
    },
    {
      accessorKey: 'discogsUrl',
      header: 'Discogs Link',
      cell: info => (
        <a href={info.getValue()} target="_blank" rel="noopener noreferrer">
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
    <div>
      {/* Table Filter Options */}
      <div style={{ 
        marginBottom: 16, 
        padding: 16, 
        background: '#f8f9fa', 
        borderRadius: 8, 
        border: '1px solid #dee2e6',
        boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
      }}>
        <h4 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: 600, color: '#495057' }}>
          Table Filter Options
        </h4>
        
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
          gap: 16,
          alignItems: 'end'
        }}>
          {/* Release Type Filter */}
          {uniqueReleaseTypes.length > 0 && (
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>
                Release Type:
              </label>
              <select
                value={releaseTypeFilter}
                onChange={(e) => setReleaseTypeFilter(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  borderRadius: 4,
                  border: '1px solid #ced4da',
                  fontSize: 14,
                  background: 'white'
                }}
              >
                <option value="all">All Types ({rawData.length})</option>
                {uniqueReleaseTypes.map(type => {
                  const count = rawData.filter(row => row.releaseType === type).length;
                  return (
                    <option key={type} value={type}>
                      {type} ({count})
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {/* Year Filter */}
          {uniqueYears.length > 0 && (
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>
                Year:
              </label>
              <select
                value={yearFilter}
                onChange={(e) => {
                  setYearFilter(e.target.value);
                  if (e.target.value !== 'specific') {
                    setYearRangeStart('');
                    setYearRangeEnd('');
                  }
                }}
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  borderRadius: 4,
                  border: '1px solid #ced4da',
                  fontSize: 14,
                  background: 'white'
                }}
              >
                <option value="all">All Years ({rawData.length})</option>
                <option value="specific">Custom Range/Year</option>
                {uniqueYears.map(year => {
                  const count = rawData.filter(row => row.year && row.year.toString() === year).length;
                  return (
                    <option key={year} value={year}>
                      {year} ({count})
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {/* Year Range Inputs */}
          {yearFilter === 'specific' && (
            <>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>
                  From Year:
                </label>
                <input
                  type="number"
                  value={yearRangeStart}
                  onChange={(e) => setYearRangeStart(e.target.value)}
                  placeholder="e.g., 1970"
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    borderRadius: 4,
                    border: '1px solid #ced4da',
                    fontSize: 14
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>
                  To Year (optional):
                </label>
                <input
                  type="number"
                  value={yearRangeEnd}
                  onChange={(e) => setYearRangeEnd(e.target.value)}
                  placeholder="e.g., 1980"
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    borderRadius: 4,
                    border: '1px solid #ced4da',
                    fontSize: 14
                  }}
                />
              </div>
            </>
          )}
        </div>

        {/* Results Count */}
        <div style={{ 
          marginTop: 12, 
          fontSize: 13, 
          color: '#6c757d',
          fontStyle: 'italic'
        }}>
          Showing {data.length} of {rawData.length} videos
        </div>
      </div>
      
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
        <thead>
          {table.getHeaderGroups().map(headerGroup => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map(header => (
                <th
                  key={header.id}
                  style={{
                    borderBottom: '1px solid #ccc',
                    padding: '8px',
                    background: '#f5f5f5',
                    textAlign: 'left',
                    cursor: header.column.getCanSort() ? 'pointer' : 'default',
                    userSelect: 'none',
                    position: 'relative',
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
          {table.getRowModel().rows.map(row => (
            <React.Fragment key={row.id}>
              <tr>
                {row.getVisibleCells().map(cell => (
                  <td key={cell.id} style={{ padding: '8px', borderBottom: '1px solid #eee' }}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
              <tr>
                <td colSpan={row.getVisibleCells().length} style={{ padding: 0, background: '#fafafa' }}>
                  {row.original.videoId && (
                    <div style={{ padding: '12px 0', textAlign: 'center' }}>
                      <iframe
                        width="360"
                        height="203"
                        src={`https://www.youtube.com/embed/${row.original.videoId}`}
                        title="YouTube video"
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        style={{ borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}
                      />
                    </div>
                  )}
                </td>
              </tr>
            </React.Fragment>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
        {/* Search box (right, small) */}
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search"
          style={{
            marginLeft: 12,
            padding: '4px 8px',
            fontSize: 14,
            width: 140,
            borderRadius: 4,
            border: '1px solid #ccc',
          }}
        />
      </div>
    </div>
  );
}
