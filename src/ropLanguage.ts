// src/ropLanguage.ts
export const ROP_LANG_ID = 'rop';

export const languageDef = {
    keywords: ['def', 'block', 'yield'],
    directives: ['@offset', '@filler', '@import'],
    operators: ['+', '-', '|', '=', ':'],
    
    tokenizer: {
        root: [
            // 关键字与指令
            [/[a-zA-Z_]\w*/, {
                cases: {
                    '@keywords': 'keyword',
                    '@default': 'identifier'
                }
            }],
            [/@[a-zA-Z_]\w*/, 'keyword.directive'],

            // 十六进制与字节流
            [/0x[0-9a-zA-F.]+/, 'number.hex'],
            [/\b[0-9a-fA-F.]{2}\b/, 'number.byte'],
            [/\b[0-9a-fA-F.]+\b/, 'number'],

            // 标签和引用
            [/[a-zA-Z_]\w*:/, 'type.identifier'], // 标签定义
            [/&[a-zA-Z_]\w*/, 'variable.predefined'], // 引用

            // 空白与注释
            { include: '@whitespace' },
        ],
        whitespace: [
            [/[ \t\r\n]+/, 'white'],
            [/\/\/.*$/, 'comment'],
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