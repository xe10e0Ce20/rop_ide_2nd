// src/ropCompletion.ts
import type { AutocompleteMeta, DefInterval, MacroParamInfo } from './types';
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

// 辅助：从元数据中提取参数信息（对象数组）
function getMacroParamsInfo(meta: AutocompleteMeta, macroName: string): MacroParamInfo[] {
  if (!meta?.macro_details) return [];
  return meta.macro_details[macroName] ?? [];
}

// 提取参数名数组（向后兼容）
function getMacroParams(meta: AutocompleteMeta, macroName: string): string[] {
  return getMacroParamsInfo(meta, macroName).map(p => p.name);
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

      // 在 provideCompletionItems 里，原来处理宏的代码块改为：
      try {
        const meta = getWasmMetadata(currentCode);
        (meta.macro_names || []).forEach((name: string) => {
          if (seenLabels.has(name)) return;
          seenLabels.add(name);

          const paramsInfo = getMacroParamsInfo(meta, name);
          const paramNames = paramsInfo.map(p => p.name);

          // RT 标记检测
          const docLines = extractMacroDocFromSource(currentCode, name);
          const isRT = docLines.length > 0 && docLines[0].startsWith('RT');

          const detailParts = [`Macro Def: (${paramNames.join(', ')})`];
          if (isRT) detailParts.push('[RT]');

          suggestions.push({
            label: name,
            kind: Kind.Method,
            insertText: `${name}(${paramNames.map((p, i) => `\${${i + 1}:${p}}`).join(', ')})`,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, // 4
            filterText: name,
            detail: detailParts.join(' '),
            range,
          });
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
  getLibSource?: (libName: string) => string | undefined
) {
  return {
    provideHover: (model: any, position: any) => {
      const wordInfo = model.getWordAtPosition(position);
      if (!wordInfo) return null;

      const targetWord = wordInfo.word;
      const currentCode = model.getValue();

      // 获取元数据（优先使用）
      let paramsInfo: MacroParamInfo[] = [];
      let isImported = false;
      try {
        const meta = getWasmMetadata(currentCode);
        paramsInfo = getMacroParamsInfo(meta, targetWord);
        if (paramsInfo.length > 0) {
          // 判断是否是导入宏（本地没有 def 行）
          const defRegex = new RegExp(`\\bdef\\s+${targetWord}\\b`);
          let hasLocalDef = false;
          for (let i = 1; i <= model.getLineCount(); i++) {
            if (defRegex.test(model.getLineContent(i))) {
              hasLocalDef = true;
              break;
            }
          }
          isImported = !hasLocalDef;
        }
      } catch (e) {}

      if (paramsInfo.length === 0) return null;  // 无任何信息则不显示

      // 构建签名参数显示
      const paramDisplay = paramsInfo.map(p => {
        let s = p.name;
        if (p.type_spec) s += `:${p.type_spec}`;
        if (p.has_default) s += ' = ...';
        return s;
      });

      const signature = `macro ${targetWord}(${paramDisplay.join(', ')})`;

      // 提取文档注释
      let docLines: string[] = [];
      if (!isImported) {
        docLines = extractMacroDocFromSource(currentCode, targetWord);
      } else if (getLibSource) {
        const importRegex = /@import\s*\(\s*([a-zA-Z_]\w*)\s*\)/g;
        let match;
        while ((match = importRegex.exec(currentCode)) !== null) {
          const libSource = getLibSource(match[1]);
          if (libSource) {
            const found = extractMacroDocFromSource(libSource, targetWord);
            if (found.length > 0) { docLines = found; break; }
          }
        }
      }

      // RT 标记
      const isRT = docLines.length > 0 && docLines[0].startsWith('RT');
      const docText = docLines.length > 0 ? docLines.join('\n') : '*暂无文档说明*';
      const rtBadge = isRT ? ' 🔴 RT' : '';

      return {
        range: {
          startLineNumber: position.lineNumber,
          startColumn: wordInfo.startColumn,
          endLineNumber: position.lineNumber,
          endColumn: wordInfo.endColumn
        },
        contents: [
          { value: `\`\`\`rop\n${signature}\n\`\`\`` },
          { value: docText + rtBadge }
        ]
      };
    }
  };
}