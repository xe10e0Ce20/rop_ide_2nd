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

export function createRopHoverProvider(getWasmMetadata: (code: string) => AutocompleteMeta) {
  return {
    provideHover: (model: any, position: any) => {
      const wordInfo = model.getWordAtPosition(position);
      if (!wordInfo) return null;

      const targetWord = wordInfo.word;
      const currentCode = model.getValue();
      const totalLines = model.getLineCount();

      // 1. 在全文件中精确定位该宏的真正 def 定义行
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

      // 如果连 def 定义都没找到，说明它不是宏，或者是用户正在打字的不完整标识符，直接退出
      if (defLineNumber === -1) return null;

      // 2. 提取参数列表 (优先从 WASM 拿，WASM 此时若因语法未解析完返回空，则启用正则兜底)
      let params: string[] = [];
      try {
        const meta = getWasmMetadata(currentCode);
        if (meta && meta.macro_details && meta.macro_details[targetWord]) {
          params = meta.macro_details[targetWord];
        }
      } catch (e) {
        console.error("Hover 实时获取 WASM 元数据失败，启动本地正则解析兜底", e);
      }

      // 【核心修复】：WASM 降级兜底：直接从 def 所在的行提取括号内的参数
      if (params.length === 0) {
        const paramMatch = defLineText.match(new RegExp(`\\bdef\\s+${targetWord}\\s*\\((.*?)\\)`));
        if (paramMatch && paramMatch[1]) {
          params = paramMatch[1].split(',').map(p => p.trim()).filter(p => p.length > 0);
        }
      }

      const signature = `macro ${targetWord}(${params.join(', ')})`;

      // 3. 从精确的定义行向上扫描，抓取连续的文档注释
      const docLines: string[] = [];
      for (let i = defLineNumber - 1; i >= 1; i--) {
        const lineText = model.getLineContent(i).trim();
        if (lineText.startsWith('//')) {
          const commentContent = lineText.replace(/^\/\/ ?/, '');
          docLines.unshift(commentContent);
        } else if (lineText === '') {
          // 容错处理：允许定义头顶有一行空行，但不允许中断连续注释
          continue;
        } else {
          break;
        }
      }

      // 4. 完美组装 Markdown 气泡卡片
      const markdownContents = [
        { value: `\`\`\`rop\n${signature}\n\`\`\`` }
      ];

      if (docLines.length > 0) {
        markdownContents.push({ value: docLines.join('\n') });
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