// src/ropCompletion.ts
import type { AutocompleteMeta, DefInterval } from './types';
import type { languages } from 'monaco-editor';

declare const monaco: {
    languages: typeof languages;
};
/**
 * 共享辅助函数：构建全文件的所有 def 块“禁区地图”
 */
function getDefIntervals(model: any): DefInterval[] {
  const totalLines = model.getLineCount();
  const defRegex = /\bdef\s+[a-zA-Z_]\w*\s*\(.*?\)\s*\{/;
  const defIntervals: DefInterval[] = [];

  for (let i = 1; i <= totalLines; i++) {
    const lineContent = model.getLineContent(i);
    if (defRegex.test(lineContent)) {
      let braceCount = 0;
      let defEndLine = -1;
      for (let j = i; j <= totalLines; j++) {
        const subContent = model.getLineContent(j);
        const openBraces = (subContent.match(/\{/g) || []).length;
        const closeBraces = (subContent.match(/\}/g) || []).length;
        
        if (j === i) braceCount = openBraces;
        else braceCount += openBraces - closeBraces;

        if (braceCount === 0) {
          defEndLine = j;
          break;
        }
      }
      if (defEndLine !== -1) {
        defIntervals.push({ start: i, end: defEndLine });
        i = defEndLine; 
      }
    }
  }
  return defIntervals;
}

// 兼容 Map 和普通对象的参数提取
function getMacroParams(meta: AutocompleteMeta, macroName: string): string[] {
  if (!meta || !meta.macro_details) return [];
  if (meta.macro_details instanceof Map) {
    return meta.macro_details.get(macroName) || [];
  }
  return (meta.macro_details as Record<string, string[]>)[macroName] || [];
}

/**
 * 从源码中提取指定宏定义前的连续注释行
 * @returns 注释文本数组（已去除 // 前缀），未找到时返回空数组
 */
function extractMacroDocFromSource(source: string, macroName: string): string[] {
  const lines = source.split('\n');
  const defRegex = new RegExp(`\\bdef\\s+${macroName}\\b`);
  for (let i = 0; i < lines.length; i++) {
    if (defRegex.test(lines[i])) {
      const docLines: string[] = [];
      let p = i - 1;
      while (p >= 0) {
        const trimmed = lines[p].trim();
        if (trimmed.startsWith('//')) {
          docLines.unshift(trimmed.replace(/^\/\/\s*/, ''));
          p--;
        } else if (trimmed === '') {
          p--;
        } else {
          break;
        }
      }
      return docLines;
    }
  }
  return [];
}

// ==================== 1. 自动补全提供者 (逻辑复用保持同步) ====================
export function createRopCompletionProvider(getWasmMetadata: (code: string) => AutocompleteMeta) {
  return {
    triggerCharacters: ['@', '&', '_', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'm', 'p', 's', 'r'],
    provideCompletionItems: (model: any, position: any) => {
      const currentCode = model.getValue();
      const wordInfo = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: wordInfo.startColumn,
        endColumn: wordInfo.endColumn
      };

      const staticKeywords = ['def', 'block', 'yield'];
      const builtInFields = ['@offset', '@filler', '@import'];
      const suggestions: any[] = [];
      const foundLabels: string[] = [];
      const currentLine = position.lineNumber;

      // 使用共享的地图解析
      const defIntervals = getDefIntervals(model);
      const activeDef = defIntervals.find(interval => currentLine >= interval.start && currentLine <= interval.end);

      if (activeDef) {
        let defBodyContent = '';
        for (let i = activeDef.start; i <= activeDef.end; i++) {
          defBodyContent += model.getLineContent(i) + '\n';
        }
        const labelRegex = /\b([a-zA-Z_]\w*):/g;
        let match;
        while ((match = labelRegex.exec(defBodyContent)) !== null) {
          if (!foundLabels.includes(match[1])) foundLabels.push(match[1]);
        }
      } else {
        let cleanGlobalContent = '';
        const totalLines = model.getLineCount();
        for (let i = 1; i <= totalLines; i++) {
          const isInsideAnyDef = defIntervals.some(interval => i >= interval.start && i <= interval.end);
          if (!isInsideAnyDef) {
            cleanGlobalContent += model.getLineContent(i) + '\n';
          }
        }
        const labelRegex = /\b([a-zA-Z_]\w*):/g;
        let match;
        while ((match = labelRegex.exec(cleanGlobalContent)) !== null) {
          if (!foundLabels.includes(match[1])) foundLabels.push(match[1]);
        }
      }

      const seenLabels = new Set<string>();
      const Kind = monaco.languages.CompletionItemKind;

      staticKeywords.forEach(kw => {
        if (!seenLabels.has(kw)) {
          seenLabels.add(kw);
          suggestions.push({ label: kw, kind: Kind.Keyword, insertText: kw, filterText: kw, detail: 'ROP Keyword', range });
        }
      });

      const hasAtPrefix = wordInfo.startColumn > 1 && model.getValueInRange({
        startLineNumber: position.lineNumber, startColumn: wordInfo.startColumn - 1,
        endLineNumber: position.lineNumber, endColumn: wordInfo.startColumn
      }) === '@';

      builtInFields.forEach(field => {
        if (!seenLabels.has(field)) {
          seenLabels.add(field);
          const cleanText = field.startsWith('@') ? field.slice(1) : field;
          suggestions.push({ label: field, kind: Kind.Function, insertText: hasAtPrefix ? cleanText : field, filterText: hasAtPrefix ? cleanText : field, detail: 'Built-in Annotation', range });
        }
      });

      foundLabels.forEach(label => {
        if (!seenLabels.has(label)) {
          seenLabels.add(label);
          suggestions.push({ label: label, kind: Kind.Reference, insertText: label, filterText: label, detail: activeDef ? 'Address Label (Local Def)' : 'Address Label (Global/Block)', range });
        }
      });

      try {
        const meta = getWasmMetadata(currentCode);
        (meta.macro_names || []).forEach((name: string) => {
          if (!seenLabels.has(name)) {
            seenLabels.add(name);
            const params = getMacroParams(meta, name);
            suggestions.push({ label: name, kind: Kind.Method, insertText: `${name}(${params.map((p: string, i: number) => `\${${i + 1}:${p}}`).join(', ')})`, insertTextRules: 4, filterText: name, detail: `Macro Def: (${params.join(', ')})`, range });
          }
        });
      } catch (e) { console.error("补全元数据提取失败", e); }

      return { suggestions } as any;
    }
  };
}

// ==================== 2. 隔离作用域的 标签定义跳转提供者 ====================
export function createRopDefinitionProvider() {
  return {
    provideDefinition: (model: any, position: any) => {
      const wordInfo = model.getWordAtPosition(position);
      if (!wordInfo) return null;

      const targetLabel = wordInfo.word;
      const currentLine = position.lineNumber;
      const definitionRegex = new RegExp(`\\b${targetLabel}\\s*:`);

      // 1. 获取禁区地图
      const defIntervals = getDefIntervals(model);
      // 2. 判断当前点击源所处的严格域
      const activeDef = defIntervals.find(interval => currentLine >= interval.start && currentLine <= interval.end);

      if (activeDef) {
        // 【严格局部跳转】：用户在 def 内部发起跳转，定义必须限制在当前的 defInterval 之间
        for (let lineNumber = activeDef.start; lineNumber <= activeDef.end; lineNumber++) {
          const currentLineText = model.getLineContent(lineNumber);
          const match = currentLineText.match(definitionRegex);
          if (match) {
            const column = currentLineText.indexOf(targetLabel) + 1;
            return {
              uri: model.uri,
              range: { startLineNumber: lineNumber, startColumn: column, endLineNumber: lineNumber, endColumn: column + targetLabel.length }
            };
          }
        }
      } else {
        // 【严格全局/Block跳转】：用户在全局/block中发起跳转，必须剔除所有 def 内部的同名标签
        const totalLines = model.getLineCount();
        for (let lineNumber = 1; lineNumber <= totalLines; lineNumber++) {
          // 如果该行命中了任何一个 def 块内部，直接跳过审查
          const isInsideAnyDef = defIntervals.some(interval => lineNumber >= interval.start && lineNumber <= interval.end);
          if (isInsideAnyDef) continue;

          const currentLineText = model.getLineContent(lineNumber);
          const match = currentLineText.match(definitionRegex);
          if (match) {
            const column = currentLineText.indexOf(targetLabel) + 1;
            return {
              uri: model.uri,
              range: { startLineNumber: lineNumber, startColumn: column, endLineNumber: lineNumber, endColumn: column + targetLabel.length }
            };
          }
        }
      }

      return null;
    }
  };
}

export function createRopHoverProvider(
  getWasmMetadata: (code: string) => AutocompleteMeta,
  getLibSource?: (libName: string) => string | undefined   // 新增可选参数
) {
  return {
    provideHover: (model: any, position: any) => {
      const wordInfo = model.getWordAtPosition(position);
      if (!wordInfo) return null;

      const targetWord = wordInfo.word;
      const currentCode = model.getValue();
      const totalLines = model.getLineCount();

      // 1. 搜索本地 def
      let defLineNumber = -1;
      let defLineText = '';
      const defRegex = new RegExp(`\\bdef\\s+${targetWord}\\b`);
      for (let i = 1; i <= totalLines; i++) {
        const lineContent = model.getLineContent(i);
        if (defRegex.test(lineContent)) {
          defLineNumber = i;
          defLineText = lineContent;
          break;
        }
      }

      // 2. 获取 WASM 元数据
      let params: string[] = [];
      let isImportedMacro = false;
      try {
        const meta = getWasmMetadata(currentCode);
        if (meta?.macro_details) {
          // 兼容 Map 和普通对象
          if (meta.macro_details instanceof Map) {
            params = meta.macro_details.get(targetWord) || [];
          } else {
            params = (meta.macro_details as Record<string, string[]>)[targetWord] || [];
          }
          // 没有本地 def 但 WASM 里有 → 导入宏
          if (defLineNumber === -1 && (params.length > 0 || (meta.macro_names || []).includes(targetWord))) {
            isImportedMacro = true;
          }
        }
      } catch (e) {
        // 静默失败，不影响编辑体验
      }

      if (defLineNumber === -1 && !isImportedMacro) return null;

      // 3. 兜底：从本地 def 行提取参数（如果有）
      if (params.length === 0 && defLineText) {
        const paramMatch = defLineText.match(new RegExp(`\\bdef\\s+${targetWord}\\s*\\((.*?)\\)`));
        if (paramMatch?.[1]) {
          params = paramMatch[1].split(',').map(p => p.trim()).filter(p => p.length > 0);
        }
      }

      const signature = `macro ${targetWord}(${params.join(', ')})`;
      const markdownContents = [
        { value: `\`\`\`rop\n${signature}\n\`\`\`` }
      ];

      // 4. 提取文档注释
      if (defLineNumber !== -1) {
        // 本地宏：从当前编辑器模型提取
        const docLines: string[] = [];
        for (let i = defLineNumber - 1; i >= 1; i--) {
          const lineText = model.getLineContent(i).trim();
          if (lineText.startsWith('//')) {
            docLines.unshift(lineText.replace(/^\/\/\s*/, ''));
          } else if (lineText === '') {
            continue;
          } else {
            break;
          }
        }
        markdownContents.push({ value: docLines.length > 0 ? docLines.join('\n') : '*暂无文档说明*' });
      } else if (isImportedMacro && getLibSource) {
        // 导入宏：尝试从对应的库源码中提取注释
        // 先找到当前文件中所有 @import 的库名
        const importRegex = /@import\s*\(\s*([a-zA-Z_]\w*)\s*\)/g;
        let match;
        let docFromLib: string[] = [];
        while ((match = importRegex.exec(currentCode)) !== null) {
          const libName = match[1];
          const libSource = getLibSource(libName);
          if (libSource) {
            const foundDoc = extractMacroDocFromSource(libSource, targetWord);
            if (foundDoc.length > 0) {
              docFromLib = foundDoc;
              break;  // 找到注释即停止搜索
            }
          }
        }
        markdownContents.push({ value: docFromLib.length > 0 ? docFromLib.join('\n') : '*暂无文档说明*' });
      } else {
        markdownContents.push({ value: '*暂无文档说明*' });
      }

      return {
        range: {
          startLineNumber: position.lineNumber,
          startColumn: wordInfo.startColumn,
          endLineNumber: position.lineNumber,
          endColumn: wordInfo.endColumn
        },
        contents: markdownContents
      };
    }
  };
}