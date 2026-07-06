// src/types.ts
export interface WebCompileResult {
    success: boolean;
    error_message?: string;
    line?: number;
    column?: number;
    blocks: Record<string, string>;
    span_map?: Record<string, [number, number, number, number][]>;
}

export interface AutocompleteMeta {
  macro_names: string[];
  macro_details: Record<string, MacroParamInfo[]>;
}

export interface DefInterval {
  start: number;
  end: number;
}

export interface MacroParamInfo {
  name: string;
  type_spec: string | null;   // 如 "4b"
  has_default: boolean;
}