// src/ropLanguage.ts
export const ROP_LANG_ID = 'rop';

export const languageDef = {
    // 依然保留关键字定义，作为全字匹配参考
    keywords: ['def', 'block', 'yield'],
    directives: ['@offset', '@filler', '@import'],
    
    tokenizer: {
        root: [
            // 1. 空白与注释（最高优先级）
            { include: '@whitespace' },

            // 2. 0x 十六进制长地址常数
            [/0x[0-9a-fA-F.]+/, 'rop.hex'],

            // 3. @ 指令体系
            [/@[a-zA-Z_]\w*/, {
                cases: {
                    '@directives': 'rop.directive',
                    '@default': 'rop.directive'
                }
            }],

            // 4. 【核心修正】：用硬编码全字边界规则精准拦截关键字！
            // 使用 \b 确保只匹配独立的 def, block, yield，且匹配完直接离场
            [/\b(def|block|yield)\b/, 'rop.keyword'],

            // 5. 地址标签定义 (如 _label: 或 gadget:) -> 必须带冒号
            [/(?:^|\s)[a-zA-Z_]\w*(?=:)(?![0-9a-zA-Z])/, 'rop.label.definition'], 

            // 6. 带 & 的标签地址引用 (如 &_label)
            [/&[a-zA-Z_]\w*/, 'rop.label.rawrefrence'], 

            // 7. 函数/宏调用名匹配 (如 func_name(...)) -> 后面必须有括号
            [/[a-zA-Z_]\w*(?=\s*\()/, 'rop.macro.call'],

            // 8. 严格的 2 位纯字节码（通过负向断言完美隔离 AA.. 或长字母变量）
            [/(?<![0-9a-fA-F.])([0-9a-fA-F.]{2})(?![0-9a-fA-F.])/, 'rop.bytecode'],

            // 9. 兜底：既不是关键字、也不是宏、也不是字节码的普通标识符/标签调用
            [/[a-zA-Z_]\w*/, 'rop.label.reference'],
            
            // 操作符
            [/[+\-|:=]/, 'operator'],
        ],
        whitespace: [
            [/[ \t\r\n]+/, 'white'],
            [/\/\/.*$/, 'rop.comment'],
        ],
    },
};

export const configDef = {
    comments: {
        lineComment: '//',
    },
    brackets: [
        ['{', '}'],
        ['[', ']'],
        ['(', ')'],
    ],
    autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
    ],
};