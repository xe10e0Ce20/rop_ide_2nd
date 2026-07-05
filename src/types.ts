// src/types.ts
export interface WebCompileResult {
  success: boolean;
  error_message: string | null;
  blocks: Record<string, string>;
}

export interface AutocompleteMeta {
  macro_names: string[];
  macro_details: Record<string, string[]>;
}

export interface DefInterval {
  start: number;
  end: number;
}