// src/types.ts
export interface WebCompileResult {
  success: boolean;
  error_message?: string | null;
  line?: number | null; 
  column?: number | null; 
  blocks: Record<string, string>; 
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