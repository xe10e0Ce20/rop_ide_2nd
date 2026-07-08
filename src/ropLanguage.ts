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

            // 4. 用硬编码全字边界规则精准拦截关键字
            [/\b(def|block|yield)\b/, 'rop.keyword'],

            // 5. 地址标签定义：冒号后必须是空白或行尾（排除 arg0:2b 之类）
            [/(?:^|\s)([a-zA-Z_]\w*):(?=\s|$)/, 'rop.label.definition'],

            // 6. 带 & 的标签地址引用 (如 &_label)
            [/&[a-zA-Z_]\w*/, 'rop.label.rawrefrence'],

            // 7. 【优化】：$ 宏调用名（后面紧跟括号，或者后面紧随参数，将其染成统一的宏调用色）
            [/\$\S+(?=\s*\()/, 'rop.macro.call'],

            // 8. 普通函数/宏调用名匹配 (如 func_name(...)) -> 后面必须有括号
            [/[a-zA-Z_]\w*(?=\s*\()/, 'rop.macro.call'],

            // 9. 严格的 2 位纯字节码：前后均不能是字母、数字或下划线
            [/(?<![0-9a-fA-F_])([0-9a-fA-F]{2})(?![0-9a-fA-F_])/, 'rop.bytecode'],

            // 10. 兜底：普通的标识符/标签调用
            [/[a-zA-Z_]\w*/, 'rop.label.reference'],

            // 11. 【核心同步】：$ 开头的宏定义名、无括号宏调用或特殊参数引用
            [/\$\S+/, 'rop.macro.call'], 
            
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
    // 💡 注入自定义 wordPattern。
    // 告诉 Monaco：一个“单词”要么是普通的 a-z 标识符，要么是包含 $ 符号并且后面随便写直到空格或括号的连体串。
    // 这可以让 Monaco 在处理 $my_macro 时，把 $ 当做单词本身的皮肤，不再产生任何截断。
    wordPattern: /(?:\$[^\s(){}[\].,:;""']*)|(?:[a-zA-Z_]\w*)/
};