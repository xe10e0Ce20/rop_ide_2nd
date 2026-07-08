// src/ropCompletion.ts
import type { AutocompleteMeta, DefInterval } from './types';
import type { languages } from 'monaco-editor';

declare const monaco: {
    languages: typeof languages;
};

// 稳健的 def 区间提取（支持跨行 def 声明、含默认值的参数、$ 宏名）
export function getDefIntervals(model: any): DefInterval[] {
  const totalLines = model.getLineCount();
  const intervals: DefInterval[] = [];
  const defStartRegex = /\bdef\s+(?:[a-zA-Z_]\w*|\$\S+)\b/;
  for (let i = 1; i <= totalLines; i++) {
    const line = model.getLineContent(i);
    if (defStartRegex.test(line)) {
      let braceLine = i;
      let foundBrace = false;
      while (braceLine <= totalLines) {
        if (model.getLineContent(braceLine).includes('{')) {
          foundBrace = true;
          break;
        }
        braceLine++;
      }
      if (!foundBrace) continue;

      let braceCount = 0;
      let endLine = -1;
      for (let j = braceLine; j <= totalLines; j++) {
        const sub = model.getLineContent(j);
        const open = (sub.match(/\{/g) || []).length;
        const close = (sub.match(/\}/g) || []).length;
        if (j === braceLine) braceCount = open;
        else braceCount += open - close;
        if (braceCount <= 0) {
          endLine = j;
          break;
        }
      }
      if (endLine !== -1) {
        intervals.push({ start: i, end: endLine });
        i = endLine;
      }
    }
  }
  return intervals;
}

// 从元数据中获取参数名（字符串数组）
function getMacroParamNames(meta: AutocompleteMeta, macroName: string): string[] {
  if (!meta?.macro_details) return [];
  const details = meta.macro_details[macroName];
  if (!details) return [];
  if (Array.isArray(details) && details.length > 0) {
    if (typeof details[0] === 'string') {
      return details as unknown as string[];
    }
    return (details as any[]).map((p: any) => p.name || '');
  }
  return [];
}

/**
 * 💡 增强版转义：为保护特殊宏名，不仅转义正则元字符，同时彻底抛弃不靠谱的 \b
 */
function safeEscapeMacroName(macroName: string): string {
  return macroName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 从源码中提取指定宏定义前的连续注释行（完美兼容特殊符号，且遇到空行立即截断）
 */
function extractMacroDocFromSource(source: string, macroName: string): string[] {
  const lines = source.split('\n');
  const escapedName = safeEscapeMacroName(macroName);
  
  // 终极正则：def 后面跟随空白，然后完全匹配宏名，后面允许紧跟 ( 或 { 或者空白
  const defRegex = new RegExp(`\\bdef\\s+${escapedName}\\s*(?:\\(|\\{|\\s|$)`);
  
  for (let i = 0; i < lines.length; i++) {
    if (defRegex.test(lines[i])) {
      const docLines: string[] = [];
      let p = i - 1;
      while (p >= 0) {
        const trimmed = lines[p].trim();
        if (trimmed.startsWith('//')) {
          // 提取有效注释文本
          docLines.unshift(trimmed.replace(/^\/\/\s*/, ''));
          p--;
        } else {
          // 💡 核心修复：无论是遇到了真正的空行 (trimmed === '')，
          // 还是遇到了其他代码行，只要不是紧密连续的 // 注释，直接阻断向上回溯
          break;
        }
      }
      return docLines;
    }
  }
  return [];
}

// ==================== 1. 自动补全提供者 ====================
export function createRopCompletionProvider(
  getWasmMetadata: (code: string) => AutocompleteMeta,
  getAvailableLibs?: () => string[]
) {
  return {
    triggerCharacters: ['@', '&', '_', '$'],
    provideCompletionItems: (model: any, position: any) => {
      const currentCode = model.getValue();
      const wordInfo = model.getWordUntilPosition(position);
      
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: wordInfo.startColumn,
        endColumn: wordInfo.endColumn
      };

      const textUntilPosition = model.getValueInRange({
        startLineNumber: 1, startColumn: 1,
        endLineNumber: position.lineNumber, endColumn: position.column
      });
      const isInsideImport = /@import\s*\(\s*[^)]*$/.test(textUntilPosition);

      if (isInsideImport && getAvailableLibs) {
        const suggestions = getAvailableLibs().map(lib => ({
          label: lib,
          kind: monaco.languages.CompletionItemKind.Module,
          insertText: lib,
          detail: 'VFS Library',
          range
        }));
        return { suggestions };
      }

      const staticKeywords = ['def', 'block', 'yield'];
      const builtInFields = ['@offset', '@filler', '@import'];
      const suggestions: any[] = [];
      const foundLabels: string[] = [];
      const currentLine = position.lineNumber;

      const defIntervals = getDefIntervals(model);
      const activeDef = defIntervals.find(interval => currentLine >= interval.start && currentLine <= interval.end);

      const labelRegex = /\b([a-zA-Z_]\w*):(?=\s|$)/g;
      if (activeDef) {
        let defBodyContent = '';
        for (let i = activeDef.start; i <= activeDef.end; i++) {
          defBodyContent += model.getLineContent(i) + '\n';
        }
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
          
          const baseText = field.startsWith('@') ? field.slice(1) : field;
          const tokenText = hasAtPrefix ? baseText : field;
          const insertText = `${tokenText}()`;
          const finalFilterText = hasAtPrefix ? baseText : field;

          suggestions.push({ 
            label: field, 
            kind: Kind.Function, 
            insertText: insertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            filterText: finalFilterText,
            detail: 'Built-in Annotation', 
            range 
          });
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
          if (seenLabels.has(name)) return;
          seenLabels.add(name);

          const params = getMacroParamNames(meta, name);
          const docLines = extractMacroDocFromSource(currentCode, name);
          const isRT = docLines.length > 0 && docLines[0].startsWith('RT');
          const detailParts = [`Macro Def: (${params.join(', ')})`];
          if (isRT) detailParts.push('[RT]');

          const filterText = name; 

          const escapedInsertName = name.replace(/\$/g, '\\$');
          const snippetArgs = params.map((p, i) => `\${${i + 1}:${p}}`).join(', ');
          const finalInsertText = `${escapedInsertName}(${snippetArgs})`;

          suggestions.push({
            label: name,
            kind: Kind.Method,
            insertText: finalInsertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            filterText: filterText,
            sortText: '000', 
            detail: detailParts.join(' '),
            range: range,
            commitCharacters: ['(']
          });
        });
      } catch (e) {
        console.error("WASM 宏提取失败:", e);
      }

      return { suggestions } as any;
    }
  };
}

// ==================== 2. 定义跳转提供者 ====================
export function createRopDefinitionProvider() {
  return {
    provideDefinition: (model: any, position: any) => {
      const lineContent = model.getLineContent(position.lineNumber);
      
      // 💡 针对包含特殊符号的自定义宏名进行整行回溯扫描
      let targetLabel = '';
      const totalLines = model.getLineCount();
      
      // 尝试匹配光标位置属于哪个宏调用/定义
      const currentColumn = position.column;
      // 匹配可能带有 $、[ ]、=、| 的长宏调用名或标签
      const macroMatchRegex = /(?:\b|\$)[a-zA-Z_0-9$|=[\]@#&_~.-]+/g;
      let match;
      while ((match = macroMatchRegex.exec(lineContent)) !== null) {
        const start = match.index + 1;
        const end = start + match[0].length;
        if (currentColumn >= start && currentColumn <= end) {
          targetLabel = match[0];
          break;
        }
      }

      if (!targetLabel) return null;

      const escapedTarget = safeEscapeMacroName(targetLabel);
      const definitionRegex = new RegExp(`(?:\\bdef\\s+${escapedTarget}\\b|${escapedTarget}\\s*:)`);

      const defIntervals = getDefIntervals(model);
      const currentLine = position.lineNumber;
      const activeDef = defIntervals.find(interval => currentLine >= interval.start && currentLine <= interval.end);

      if (activeDef) {
        for (let lineNumber = activeDef.start; lineNumber <= activeDef.end; lineNumber++) {
          const currentLineText = model.getLineContent(lineNumber);
          if (definitionRegex.test(currentLineText)) {
            const column = currentLineText.indexOf(targetLabel) + 1;
            return {
              uri: model.uri,
              range: { startLineNumber: lineNumber, startColumn: column, endLineNumber: lineNumber, endColumn: column + targetLabel.length }
            };
          }
        }
      } else {
        for (let lineNumber = 1; lineNumber <= totalLines; lineNumber++) {
          const isInsideAnyDef = defIntervals.some(interval => lineNumber >= interval.start && lineNumber <= interval.end);
          if (isInsideAnyDef) continue;

          const currentLineText = model.getLineContent(lineNumber);
          if (definitionRegex.test(currentLineText)) {
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

// ==================== 3. 悬停提供者 ====================
export function createRopHoverProvider(
  getWasmMetadata: (code: string) => AutocompleteMeta,
  getLibSource?: (libName: string) => string | undefined
) {
  return {
    provideHover: (model: any, position: any) => {
      const lineContent = model.getLineContent(position.lineNumber);
      const currentColumn = position.column;
      
      // 💡 核心破局点：绕过 Monaco 的 Word 分隔限制。
      // 使用更宽松的自定义正则，在当前行抓取出包含 $、[、]、=、| 组合的真实长标识符。
      let targetWord = '';
      let startColumn = currentColumn;
      let endColumn = currentColumn;

      const fullMacroCallRegex = /(?:\b|\$)[a-zA-Z_0-9$|=[\]@#&_~.-]+/g;
      let match;
      while ((match = fullMacroCallRegex.exec(lineContent)) !== null) {
        const start = match.index + 1;
        const end = start + match[0].length;
        if (currentColumn >= start && currentColumn <= end) {
          targetWord = match[0];
          startColumn = start;
          endColumn = end;
          break;
        }
      }

      if (!targetWord) return null;
      const currentCode = model.getValue();

      // 1. 从元数据获取参数名
      let params: string[] = [];
      let isImported = false;
      try {
        const meta = getWasmMetadata(currentCode);
        if (meta?.macro_names?.includes(targetWord)) {
          params = getMacroParamNames(meta, targetWord);
          const escaped = safeEscapeMacroName(targetWord);
          const defRegex = new RegExp(`\\bdef\\s+${escaped}\\s*(?:\\(|\\{|\\s|$)`);
          let hasLocal = false;
          for (let i = 1; i <= model.getLineCount(); i++) {
            if (defRegex.test(model.getLineContent(i))) {
              hasLocal = true;
              break;
            }
          }
          isImported = !hasLocal;
        }
      } catch (e) { }

      // 2. 查找本地 def 行（回退参数和文档）
      let defLineNumber = -1;
      let defLineText = '';
      const escaped = safeEscapeMacroName(targetWord);
      const defRegex = new RegExp(`\\bdef\\s+${escaped}\\s*(?:\\(|\\{|\\s|$)`);
      for (let i = 1; i <= model.getLineCount(); i++) {
        const line = model.getLineContent(i);
        if (defRegex.test(line)) {
          defLineNumber = i;
          defLineText = line;
          break;
        }
      }

      // 3. 如果仍然没有参数信息，尝试从导入库源码提取
      if (defLineNumber === -1 && params.length === 0 && getLibSource) {
        const importRegex = /@import\s*\(\s*([a-zA-Z_]\w*)\s*\)/g;
        let matchImport;
        while ((matchImport = importRegex.exec(currentCode)) !== null) {
          const libName = matchImport[1];
          const libSource = getLibSource(libName);
          if (libSource) {
            const lines = libSource.split('\n');
            const escapedLib = safeEscapeMacroName(targetWord);
            const defLine = lines.find(line => new RegExp(`\\bdef\\s+${escapedLib}\\s*(?:\\(|\\{|\\s|$)`).test(line));
            if (defLine) {
              const m = defLine.match(/\(([^)]*)\)/);
              if (m) params = m[1].split(',').map(s => s.trim()).filter(Boolean);
              isImported = true;
              break;
            }
          }
        }
      }

      if (params.length === 0 && defLineNumber === -1) return null;

      // 4. 构建签名
      if (params.length === 0 && defLineText) {
        const m = defLineText.match(/\(([^)]*)\)/);
        if (m) params = m[1].split(',').map(s => s.trim()).filter(Boolean);
      }

      const signature = `macro ${targetWord}(${params.join(', ')})`;

      // 5. 提取文档注释
      let docLines: string[] = [];
      if (defLineNumber !== -1) {
        for (let i = defLineNumber - 1; i >= 1; i--) {
          const line = model.getLineContent(i).trim();
          if (line.startsWith('//')) {
            docLines.unshift(line.replace(/^\/\/\s*/, ''));
          } else if (line === '') {
            continue;
          } else {
            break;
          }
        }
      } else if (isImported && getLibSource) {
        const importRegex = /@import\s*\(\s*([a-zA-Z_]\w*)\s*\)/g;
        let matchImport;
        while ((matchImport = importRegex.exec(currentCode)) !== null) {
          const libSource = getLibSource(matchImport[1]);
          if (libSource) {
            const found = extractMacroDocFromSource(libSource, targetWord);
            if (found.length > 0) { docLines = found; break; }
          }
        }
      }

      const isRT = docLines.length > 0 && docLines[0].startsWith('RT');
      const docText = docLines.length > 0 ? docLines.join('\n') : '*暂无文档说明*';
      const rtBadge = isRT ? ' 🔴 RT' : '';

      return {
        range: {
          startLineNumber: position.lineNumber,
          startColumn: startColumn, 
          endLineNumber: position.lineNumber,
          endColumn: endColumn
        },
        contents: [
          { value: `\`\`\`rop\n${signature}\n\`\`\`` },
          { value: docText + rtBadge }
        ]
      };
    }
  };
}