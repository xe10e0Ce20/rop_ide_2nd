// src/ropCompletion.ts
import type { AutocompleteMeta, DefInterval } from './types';
import type { languages } from 'monaco-editor';

declare const monaco: {
    languages: typeof languages;
};

/**
 * 💡 终极增强版光标标识符提取：完全脱离 Monaco 单词规则的控制
 * 以光标为中心向左右双向辐射，精准抓取不含空格和左括号的完整宏名字符串
 */
function getFullMacroNameAtCursor(model: any, position: any): string | null {
  const line = model.getLineContent(position.lineNumber);
  const col = position.column - 1; // 转为 0-based
  if (col < 0 || col >= line.length) return null;

  // 如果当前光标处于空格或括号上，直接返回空
  if (/[\s()]/.test(line.charAt(col))) return null;

  // 向左寻找边界（直到遇到空格或左括号）
  let start = col;
  while (start > 0 && !/[\s(]/.test(line.charAt(start - 1))) {
    start--;
  }

  // 向右寻找边界（直到遇到空格或左括号）
  let end = col;
  while (end < line.length && !/[\s(]/.test(line.charAt(end))) {
    end++;
  }

  const word = line.substring(start, end).trim();
  // 过滤清洗掉尾部可能误连带的标点符号
  return word ? word.replace(/[),;]+$/, '') : null;
}

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
 * 💡 终极稳健的 def 行匹配器：纯前缀边界判定
 * 免疫一切 \r\n 换行符污染，完美兼容末尾紧跟 {、(、空格或直接换行的硬核宏名
 */
function isDefLine(line: string, macroName: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith('def ')) return false;
  
  // 剥离掉开头的 def 关键字
  const afterDef = trimmed.substring(4).trimStart();
  
  // 严格比对：必须以当前宏名开头
  if (afterDef.startsWith(macroName)) {
    const nextChar = afterDef.charAt(macroName.length);
    // 确保紧随其后的字符属于合法的宏声明边界（行尾、空格、括号、花括号、等号、中括号等）
    if (!nextChar || /[\s(){[=]/.test(nextChar)) {
      return true;
    }
  }
  return false;
}

/**
 * 从源码中提取指定宏定义前的连续注释行（通用字符串匹配）
 */
function extractMacroDocFromSource(source: string, macroName: string): string[] {
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (isDefLine(lines[i], macroName)) {
      const docLines: string[] = [];
      let p = i - 1;
      while (p >= 0) {
        const trimmed = lines[p].trim();
        if (trimmed.startsWith('//')) {
          docLines.unshift(trimmed.replace(/^\/\/\s*/, ''));
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
      const isInsideInclude = /@include\s*\(\s*[^)]*$/.test(textUntilPosition);

      if (isInsideInclude && getAvailableLibs) {
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
      const builtInFields = ['@offset', '@filler', '@include'];
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

          let itemRange = { ...range };
          const currentMacroName = getFullMacroNameAtCursor(model, position);
          if (currentMacroName && currentMacroName.startsWith('$')) {
            const line = model.getLineContent(position.lineNumber);
            const idx = line.indexOf(currentMacroName);
            if (idx !== -1) {
              itemRange = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: idx + 1,
                endColumn: idx + currentMacroName.length + 1
              };
            }
          }

          const escapedInsertName = name.replace(/\$/g, '\\$');
          const snippetArgs = params.map((p, i) => `\${${i + 1}:${p}}`).join(', ');
          const finalInsertText = `${escapedInsertName}(${snippetArgs})`;

          suggestions.push({
            label: name,
            kind: Kind.Method,
            insertText: finalInsertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            filterText: name,
            detail: detailParts.join(' '),
            range: itemRange,
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
      const targetWord = getFullMacroNameAtCursor(model, position);
      if (!targetWord) return null;

      const defIntervals = getDefIntervals(model);
      const currentLine = position.lineNumber;
      const activeDef = defIntervals.find(interval => currentLine >= interval.start && currentLine <= interval.end);

      if (activeDef) {
        for (let lineNumber = activeDef.start; lineNumber <= activeDef.end; lineNumber++) {
          const line = model.getLineContent(lineNumber);
          if (isDefLine(line, targetWord) || line.match(new RegExp(`^\\s*${targetWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`))) {
            const column = line.indexOf(targetWord) + 1;
            return {
              uri: model.uri,
              range: { startLineNumber: lineNumber, startColumn: column, endLineNumber: lineNumber, endColumn: column + targetWord.length }
            };
          }
        }
      } else {
        const totalLines = model.getLineCount();
        for (let lineNumber = 1; lineNumber <= totalLines; lineNumber++) {
          const isInsideAnyDef = defIntervals.some(interval => lineNumber >= interval.start && lineNumber <= interval.end);
          if (isInsideAnyDef) continue;
          const line = model.getLineContent(lineNumber);
          if (isDefLine(line, targetWord) || line.match(new RegExp(`^\\s*${targetWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`))) {
            const column = line.indexOf(targetWord) + 1;
            return {
              uri: model.uri,
              range: { startLineNumber: lineNumber, startColumn: column, endLineNumber: lineNumber, endColumn: column + targetWord.length }
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
      const targetWord = getFullMacroNameAtCursor(model, position);
      if (!targetWord) return null;

      const line = model.getLineContent(position.lineNumber);
      const idx = line.indexOf(targetWord);
      const startColumn = idx !== -1 ? idx + 1 : position.column;
      const endColumn = startColumn + targetWord.length;

      const currentCode = model.getValue();

      // 1. 从元数据获取参数名
      let params: string[] = [];
      let isIncluded = false;
      try {
        const meta = getWasmMetadata(currentCode);
        if (meta?.macro_names?.includes(targetWord)) {
          params = getMacroParamNames(meta, targetWord);
          let hasLocal = false;
          for (let i = 1; i <= model.getLineCount(); i++) {
            if (isDefLine(model.getLineContent(i), targetWord)) {
              hasLocal = true;
              break;
            }
          }
          isIncluded = !hasLocal;
        }
      } catch (e) { }

      // 2. 查找本地 def 行
      let defLineNumber = -1;
      let defLineText = '';
      for (let i = 1; i <= model.getLineCount(); i++) {
        if (isDefLine(model.getLineContent(i), targetWord)) {
          defLineNumber = i;
          defLineText = model.getLineContent(i);
          break;
        }
      }

      // 3. 从导入库源码提取
      if (defLineNumber === -1 && params.length === 0 && getLibSource) {
        const includeRegex = /@include\s*\(\s*([a-zA-Z_]\w*(?:[-.][a-zA-Z_]\w*)*)\s*\)/g;
        let match;
        while ((match = includeRegex.exec(currentCode)) !== null) {
          const libName = match[1];
          const libSource = getLibSource(libName);
          if (libSource) {
            const lines = libSource.split('\n');
            const defLine = lines.find(line => isDefLine(line, targetWord));
            if (defLine) {
              const m = defLine.match(/\(([^)]*)\)/);
              if (m) params = m[1].split(',').map(s => s.trim()).filter(Boolean);
              isIncluded = true;
              break;
            }
          }
        }
      }

      // 💡 核心修复：放行 0 参数的外部依赖库宏。
      // 只要它是合法的外部库导入宏 (isIncluded === true)，即使参数长度为 0，也绝不拦截返回 null！
      if (!isIncluded && defLineNumber === -1) return null;

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
          } else {
            break;
          }
        }
      } else if (isIncluded && getLibSource) {
        const includeRegex = /@include\s*\(\s*([a-zA-Z_]\w*(?:[-.][a-zA-Z_]\w*)*)\s*\)/g;
        let match;
        while ((match = includeRegex.exec(currentCode)) !== null) {
          const libSource = getLibSource(match[1]);
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