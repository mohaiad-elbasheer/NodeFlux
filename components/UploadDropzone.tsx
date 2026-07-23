"use client";

import { useCallback, useRef, useState } from "react";
import { FileSpreadsheet, Loader2, UploadCloud } from "lucide-react";
import { useAppStore } from "@/lib/store";

/** Drag-and-drop CSV/XLSX intake, shown as the empty-state hero panel. */
export default function UploadDropzone() {
  const { ingestFile, loadSample, loading, error, clearError } = useAppStore();
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) void ingestFile(file);
    },
    [ingestFile],
  );

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="w-full max-w-xl">
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload supplier CSV or Excel file"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            clearError();
            onFiles(e.dataTransfer.files);
          }}
          className={`group cursor-pointer rounded-2xl border-2 border-dashed p-12 text-center transition-colors ${
            dragOver
              ? "border-sky-400 bg-sky-400/10"
              : "border-slate-700 bg-slate-900/60 hover:border-sky-500/60 hover:bg-slate-900"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,text/csv"
            className="hidden"
            onChange={(e) => {
              clearError();
              onFiles(e.target.files);
              e.target.value = "";
            }}
          />
          {loading ? (
            <Loader2 className="mx-auto h-12 w-12 animate-spin text-sky-400" />
          ) : (
            <UploadCloud className="mx-auto h-12 w-12 text-slate-500 transition-colors group-hover:text-sky-400" />
          )}
          <p className="mt-4 text-lg font-semibold text-slate-200">
            {loading ? "Ingesting & enriching…" : "Drop your Tier-1 supplier file here"}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            CSV or Excel · Supplier_Name, Country_of_Origin, City, Product_Description,
            HS_Code_Chapter_85, Estimated_Lead_Time_Days
          </p>
        </div>

        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            onClick={() => void loadSample()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/80 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-sky-500/60 hover:text-sky-300 disabled:opacity-50"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Load sample electronics portfolio
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-center text-sm text-rose-300">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
