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
 * 从源码中提取指定宏定义前的连续注释行（兼容 $ 宏名，安全去除边界 \b 限制）
 */
function extractMacroDocFromSource(source: string, macroName: string): string[] {
  const lines = source.split('\n');
  const escapedName = macroName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 💡 针对以 $ 开头的宏名，取消前面的 \b 限制，改用 (?:\b|(?=\$)) 兼容
  const defRegex = new RegExp(`(?:\\b|(?=\\$))def\\s+${escapedName}(?:\\b|(?=\\())`);
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

      // 3. 压入普通关键字 (使用常规 range)
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

          // 💡 绝杀修复：处理 Monaco Snippet 把 $ 当作变量吃掉的问题
          // 把 $ 转义为 \$，防止 Snippet 引擎解析错误
          const escapedNameForSnippet = name.replace(/\$/g, '\\$');

          suggestions.push({
            label: name,
            kind: Kind.Method,
            // 👈 使用转义后的名称拼接 Snippet
            insertText: `${escapedNameForSnippet}(${params.map((p, i) => `\${${i + 1}:${p}}`).join(', ')})`,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            filterText: name, 
            detail: detailParts.join(' '),
            range, 
          });
        });
      } catch (e) {}

      return { suggestions } as any;
    }
  };
}

// ==================== 2. 定义跳转提供者 ====================
export function createRopDefinitionProvider() {
  return {
    provideDefinition: (model: any, position: any) => {
      // 💡 兼容 $ 符号的单词提取
      const lineContent = model.getLineContent(position.lineNumber);
      const wordInfo = model.getWordAtPosition(position);
      if (!wordInfo) return null;

      let targetLabel = wordInfo.word;
      // 检查前面是不是隐藏了 $
      if (wordInfo.startColumn > 1 && lineContent[wordInfo.startColumn - 2] === '$') {
        targetLabel = '$' + targetLabel;
      }

      const escapedTarget = targetLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const definitionRegex = new RegExp(`(?:\\b|(?=\\$))${escapedTarget}\\s*:`);

      const defIntervals = getDefIntervals(model);
      const activeDef = defIntervals.find(interval => currentLine >= interval.start && currentLine <= interval.end);
      const currentLine = position.lineNumber;

      if (activeDef) {
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
        const totalLines = model.getLineCount();
        for (let lineNumber = 1; lineNumber <= totalLines; lineNumber++) {
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

// ==================== 3. 悬停提供者 ====================
export function createRopHoverProvider(
  getWasmMetadata: (code: string) => AutocompleteMeta,
  getLibSource?: (libName: string) => string | undefined
) {
  return {
    provideHover: (model: any, position: any) => {
      const lineContent = model.getLineContent(position.lineNumber);
      const wordInfo = model.getWordAtPosition(position);
      if (!wordInfo) return null;

      // 💡 核心修复：如果是 $ 宏，wordInfo.word 拿到的只是后面的纯文本，必须补上 $
      let targetWord = wordInfo.word;
      let startColumn = wordInfo.startColumn;
      if (wordInfo.startColumn > 1 && lineContent[wordInfo.startColumn - 2] === '$') {
        targetWord = '$' + targetWord;
        startColumn = wordInfo.startColumn - 1; // 悬停高亮区间向前扩展覆盖 $
      }

      const currentCode = model.getValue();

      // 1. 从元数据获取参数名
      let params: string[] = [];
      let isImported = false;
      try {
        const meta = getWasmMetadata(currentCode);
        if (meta?.macro_names?.includes(targetWord)) {
          params = getMacroParamNames(meta, targetWord);
          const escaped = targetWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const defRegex = new RegExp(`(?:\\b|(?=\\$))def\\s+${escaped}(?:\\b|(?=\\())`);
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
      const escaped = targetWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const defRegex = new RegExp(`(?:\\b|(?=\\$))def\\s+${escaped}(?:\\b|(?=\\())`);
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
        let match;
        while ((match = importRegex.exec(currentCode)) !== null) {
          const libName = match[1];
          const libSource = getLibSource(libName);
          if (libSource) {
            const lines = libSource.split('\n');
            const escapedLib = targetWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const defLine = lines.find(line => new RegExp(`(?:\\b|(?=\\$))def\\s+${escapedLib}(?:\\b|(?=\\())`).test(line));
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
        let match;
        while ((match = importRegex.exec(currentCode)) !== null) {
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
          startColumn: startColumn, // 使用修正后的 startColumn，保证 $ 符号在悬停时也能亮起
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