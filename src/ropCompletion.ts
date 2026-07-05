// src/ropCompletion.ts
import type { AutocompleteMeta, DefInterval } from './types';

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
      staticKeywords.forEach(kw => {
        if (!seenLabels.has(kw)) {
          seenLabels.add(kw);
          suggestions.push({ label: kw, kind: 17, insertText: kw, filterText: kw, detail: 'ROP Keyword', range });
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
          suggestions.push({ label: field, kind: 3, insertText: hasAtPrefix ? cleanText : field, filterText: hasAtPrefix ? cleanText : field, detail: 'Built-in Annotation', range });
        }
      });

      foundLabels.forEach(label => {
        if (!seenLabels.has(label)) {
          seenLabels.add(label);
          suggestions.push({ label: label, kind: 13, insertText: label, filterText: label, detail: activeDef ? 'Address Label (Local Def)' : 'Address Label (Global/Block)', range });
        }
      });

      try {
        const meta = getWasmMetadata(currentCode);
        (meta.macro_names || []).forEach((name: string) => {
          if (!seenLabels.has(name)) {
            seenLabels.add(name);
            const params: string[] = meta.macro_details[name] || [];
            suggestions.push({ label: name, kind: 11, insertText: `${name}(${params.map((p: string, i: number) => `\${${i + 1}:${p}}`).join(', ')})`, insertTextRules: 4, filterText: name, detail: `Macro Def: (${params.join(', ')})`, range });
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