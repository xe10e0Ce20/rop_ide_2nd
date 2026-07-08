import React, { useState } from 'react';

interface RopTutorialModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TutorialSection {
  id: string;
  title: string;
  description: string;
  codeExample: string;
  points: string[];
}

export const RopTutorialModal: React.FC<RopTutorialModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<string>('intro');

  if (!isOpen) return null;

  const sections: TutorialSection[] = [
    {
      id: 'intro 简介',
      title: '00 // 语言及IDE简介 (INTRODUCTION)',
      description: '专用于16位微控制器的ROP链开发。只要有一点点（真的只要一点点！没有其实也行）代码基础就能学会。',
      codeExample: `//示例函数
def example(arg0:2b, arg1:2b=0x0000) {
  0x3461.1..
  arg0 arg1
}

block main {
@offset(0xd710)
@filler(0)
  ff ff
  example(0x0000, 0x0000)
}
block launcher {
  12 34 56 78
}`,
      points: [
        '强字节尺寸约束，确保字节严格对齐。',
        '支持宏嵌套展开、地址标签、局部标签作用域隔离与动态对应字节码高亮。',
        '支持导入库文件。',
        '公共库文件/代码文件，并支持缓存至本地。',
        'IDE基于Monaco引擎开发，操作与VS Code一致。'
      ]
    },
    {
      id: 'blocks 数据块',
      title: '基础01 // 数据块 (BLOCKS)',
      description: '使用 block 划分最终需要导出的命名二进制片段。通过地址标签可以自动管理地址标签。',
      codeExample: `block main {
  //你创建了一个数据块，耶！
}
block launcher{
  //可以有多个不同的数据块
}
block main {
  //如果有同名数据块，则会从前往后依次拼接而非报错。这在一些时候可能会有用...?
}`,
      points: [
        '数据块，一切字节码的容器。',
      ]
    },
    {
      id: 'syntax 语法',
      title: '基础02 // 基本语法 (BASIC_SYNTAX)',
      description: '创建字节码（流），并正确地使用运算符操作它们',
      codeExample: `12 34 ab cd  //如果一字节一空格，则可以直接打出字节流
.2 .. .b cd  //可以将"."用作占位符，并且通过相关配置更改占位符的值（后面会讲）
0x12345678abcdefff  //可以用0x开头来输出长字节流
0x....abcd  //长字节流也可以使用"."用作占位符

//字节码的运算
//要正确地进行运算，首先要理解“一个元素”是什么
00 0x0000  //一个短字节流和一个长字节流分别都是一个元素
00 00  //而这则是两个元素，它们不会被视作“一块”东西
00 01 + 0x0101  //因此，这一块代码生成的字节码是000102而不是0102
//特别地，加减法不支持8字节以上的字节码（应该也没人用吧）

00|01  // | 运算符可以将两个元素合并成一个元素
00|01 + 0x0101  //现在，它可以运算得出0x0102

0x5678 - (0x0102 + 0x0304)  //圆括号可以用于运算，效果和常规的圆括号一样

[0x0102]  //方括号用于转换大小端，例如这个算式得到0201
[0x000121a8]  //得到a8210100`,
      points: [
        '字节流：使用不带"0x"的短字节流和带有0x的长字节流',
        '基础运算符：包括 +、-、| 符号的使用，以及括号( )[ ]'
      ]
    },
    {
      id: 'annotations 注解',
      title: '基础03 // 注解 (ANNOTATIONS)',
      description: '使用三个注解：@offset, @filler, @import 执行一些"编译外"操作',
      codeExample: `@import(lib_name)      // 引入公共库中的库，建议在旁边的注释写明版本号

block main{

@filler(0)     //定义"."为0（当然"."默认就是0，不过还是声明一下为好）
@offset(0xd710)  //注意，@filler和@offset语句必须在一个block内部
.. .1  //输出0001

@filler(3)  //filler可以中途更换
.. .1  //输出3331
}`,
      points: [
        '@import(lib_name) 会在虚拟文件系统里查找对应的活动版本镜像并导入，建议在公共库界面中将导入的库缓存，防止网络环境拖慢速度。',
        '@filler 接收一个0-f的字符，用于定义"."占位符的值。',
        '@offset 用于改变地址标签的偏移量，会在地址标签的章节讲到。'
      ]
    },
    {
      id: 'macros 宏',
      title: '基础04 // 宏基础 (MACROS_BASIC)',
      description: '使用 def 声明一段可复用的代码。类似于函数但没那么高级。支持为参数指定严格的字节长度限制（如 4b/8b）以及默认值。',
      codeExample: `//在一个宏的定义语句头顶上写的注释，会被识别为该宏的介绍，会在光标悬停在宏上时显示。
def example(arg0, arg1:2b, arg2:2b = 0x0000) {  //声明宏要用到的参数
  //可以用argname:xb（例如2b就是两字节，1b就是一字节）来限定该参数长度，防止犯蠢。
  //可以用argname=xxxx来规定如果没有传入任何参数时的默认值

  0x00112233
  arg1  //直接在内部调用上面的参数，真正运行时会将这些参数替换成实际传入的值
  arg2
  arg0
}
def example(arg){}  //宏可以多次定义，后定义的覆盖之前定义的

//RT  在宏定义的上方注释的第一行写“RT”，其就会被标注为RT返回的函数
def example2 (arg){}

block main {
  example (11, 11|11)
}`,
      points: [
        '使用 xb 后缀可以强校验传入数据的宽度，防止犯蠢。',
        '悬停在宏名称上可实时预览其参数签名与上方编写的双斜杠 (//) 注释。',
        '宏命名（尤其是基础gadgets）建议遵循以下规范：如果执行后伴随POP效果，则在尾部标明',
        '例如执行后会pop xr4qr8，则在名字的尾部标上"_X4Q8"',
        '如果执行时还伴随其它“一言难尽”的副作用，则直接在最尾部加上"__"(双下划线)',
        '如果宏的名字以$开头，则可以在宏的名字中写特殊符号',
        '如果要输入以$开头的宏并触发自动补全，不要在开头直接输入$。由于技术原因。特殊符号似乎难以参与自动补全匹配。欢迎发补丁'
      ]
    },
    {
      id: 'labels 地址标签',
      title: '基础05 // 地址标签 (ADDRESS_LABELS)',
      description: '使用地址标签以自动计算地址。',
      codeExample: `block main {
  @offset(0xd710) // 使用@offset声明偏移量 0xd710

  0x0000

  //和宏一样，在地址标签的上方写注释，该注释就会被识别为该地址标签的介绍
  example:  //这就是一个地址标签
  
  example  //调用地址标签，因为前面example标签前面有两字节，因此就是d714(d710+0004)
  &example  //在地址标签前面加&，就不加偏移量，这里就是0004

  @offset(0xd800)  //偏移量可以重新声明，偏移量只影响标签的定义而不影响调用
  example2:  //定义另一个标签

  example2  //此时这个地址实际上就是d808(d800+0004)
    
  // 地址标签本身不占用任何字节码，它只是一个标记
}`,
      points: [
        '使用@offset声明偏移量，使调用地址标签时不再需要手动加地址偏移',
        '使用 labelname: 声明一个地址标签。',
        '在任何地方使用 labelname 即可直接取出该标签求值后的绝对地址。使用 &labelname 可以取出未加偏移量的地址',
        'Ctrl + 鼠标左键点击 labelname 可以直接跳转到它被声明的源码行，极其适合长脚本的逆向追溯。',
        '鼠标悬停在 labelname 上会显示其信息。'
      ]
    },
    {
      id: 'libraries 库文件编写',
      title: '高级01 // 库文件编写 (LIBRARY_WRITING)',
      description: '库文件其实就是一堆 def 宏定义的集合。编写、同步并共享你的库文件，让 ROP 链的构建像搭积木一样简单。',
      codeExample: `// ----------------------------------------
// 例如这是一个存放在公共库文件 “example” 中的代码段：
// ----------------------------------------

// 这里可以介绍这个函数……
def example(arg:2b) {
  0x1122
  arg
  0x3344
  0x0000
  0x5566
}

// ----------------------------------------
// 在你自己的主脚本里，你只需要：
// ----------------------------------------
@import(example)  //v1.0.0
//最好在导入库时注明当前导入的是哪个版本，防止以后库更新后造成不必要的困惑

block main {
  example(arg:2b)  //这样就可以直接使用这个函数了
}`,
      points: [
        '库文件不需要写 block，它只是供其他文件调用的 “函数仓库”。',
        '推荐将高频使用的 Gadgets/宏 按平台打包成独立的库文件。',
        '推荐在公共库界面将要使用的库缓存到本地，这样不仅可以离线运行，而且能加速@import的解析，节省流量。',
      ]
    },
    {
      id: 'yield 宏-yield字段',
      title: '高级02 // 宏 - yield 字段 (MACROS_YIELD)',
      description: 'yield 允许我们在调用宏的时候，动态地向宏的内部“塞入”一段自定义的任意代码。这赋予了宏近乎无限的扩展性。',
      codeExample: `// 声明一个带有 yield 的通用包裹宏
def example(arg0:2b) {
  0xaaaa
  arg0
  
  yield  // 👈 占位符。编译时会直接把这一个yield关键字替换为实际输入在大括号的内容
  
  0xbbbb
}

block main {
@offset(0xd710)
  // 调用时，后面紧跟一个大括号 {}，里面的内容会被直接灌入到 yield 所在的位置
  example(0x00ff) {
    11 22 33 44 //这里可以填入任意代码，均会被插入到yield的位置
    0x9090
  }
}`,
      points: [
        '利用 yield 可以轻松写出像高级语言中的结构体包裹。'
      ]
    },
    {
      id: 'local_labels 宏-内部标签',
      title: '高级03 // 宏 - 内部局部标签 (LOCAL_LABELS)',
      description: '在宏内部声明的地址标签被称为局部标签。使用局部标签以防止全局冲突。',
      codeExample: `//考虑这样一个函数
def example(arg0:2b) {
  arg0
  label:
  0x1111
  label
}

block main {
@offset(0x8000)
  example(0x0005)
  example(0x000a)

// 连续调用两次，在编译器内部，它们首先会被展开为如下的样子：
   0x0005
   label:
   0x1111
   label
  
   0x000a
   label:
   0x0001
   label
}
// 这显然会导致混乱，因此我们引入了局部标签。
def example(arg0:2b) {
  arg0
  _label:  // 在def语句内部这样定义标签，其就会被识别为局部标签。
  0x1111
  _label  //编译器底层会自动隔离作用域，不会污染全局标签
}


`,
      points: [
        '局部标签的作用域严格限制在当前宏内部，出了这个 def 外界就无法引用它。',
        '因此支持无限次在 block 内部调用同一个含有标签的宏，展开后的安全机制交由编译器底层处理。'
      ]
    }
  ];

  const currentSection = sections.find(s => s.id === activeTab) || sections[0];

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000, backdropFilter: 'blur(4px)' }}>
      <div style={{ background: '#161616', border: '1px solid #333', borderRadius: '8px', width: '850px', maxWidth: '95%', height: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 40px rgba(0,0,0,0.5)' }}>
        
        {/* Header - 保持你原本的样式和 JetBrains Mono 字体 */}
        <div style={{ padding: '16px 24px', background: '#1a1a1a', borderBottom: '1px solid #2d2d2d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#38bdf8', fontFamily: "'JetBrains Mono', monospace", textAlign: 'left' }}>
            DOCUMENTATION // ROP_COMPILER_TUTORIAL
          </span>
          <button 
            type="button" 
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', fontSize: '16px' }}
            onMouseEnter={(e) => e.currentTarget.style.color = '#ff5555'}
            onMouseLeave={(e) => e.currentTarget.style.color = '#666'}
          >
            ✕
          </button>
        </div>

        {/* 主体部分：左侧极简导航 + 右侧教程内容 */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          
          {/* 左侧导航栏 - 纯色硬朗风格 */}
          <div style={{ width: '200px', background: '#111', borderRight: '1px solid #222', padding: '12px 0', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            {sections.map(sec => {
              const isActive = activeTab === sec.id;
              return (
                <button
                  key={sec.id}
                  onClick={() => setActiveTab(sec.id)}
                  style={{
                    background: isActive ? '#1a1a1a' : 'transparent',
                    border: 'none',
                    borderLeft: isActive ? '3px solid #38bdf8' : '3px solid transparent',
                    color: isActive ? '#38bdf8' : '#888',
                    padding: '12px 16px',
                    fontSize: '12px',
                    fontFamily: "'JetBrains Mono', monospace",
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.color = '#ccc';
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.color = '#888';
                  }}
                >
                  {sec.id.toUpperCase()}
                </button>
              );
            })}
          </div>

          {/* 右侧内容区 - 全部靠左对齐，复用 RopInfoModal 的文档排版 */}
          <div style={{ flex: 1, padding: '24px', overflowY: 'auto', fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", fontSize: '14px', lineHeight: '1.6', color: '#ccc', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            
            {/* 标题 */}
            <h3 style={{ margin: 0, color: '#fff', fontSize: '15px', fontFamily: "'JetBrains Mono', monospace", textAlign: 'left' }}>
              {currentSection.title}
            </h3>

            {/* 描述说明栏 */}
            <div style={{ background: '#0d0d0d', padding: '12px', borderRadius: '6px', border: '1px solid #222', color: '#aaa', fontSize: '13px', textAlign: 'left' }}>
              {currentSection.description}
            </div>

            {/* 特性要点 */}
            <div>
              <h4 style={{ margin: '0 0 8px 0', color: '#00ffb3', fontFamily: "'JetBrains Mono', monospace", fontSize: '13px', textAlign: 'left' }}>
                ⚡ 核心要点 / CORE_POINTS
              </h4>
              <ul style={{ margin: 0, paddingLeft: '20px', color: '#ccc', textAlign: 'left' }}>
                {currentSection.points.map((pt, idx) => (
                  <li key={idx} style={{ marginBottom: '6px' }}>{pt}</li>
                ))}
              </ul>
            </div>

            {/* 代码示例 - 纯黑底色加绿字，贴合你原本的审美 */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '180px' }}>
              <h4 style={{ margin: '0 0 6px 0', color: '#fff', fontFamily: "'JetBrains Mono', monospace", fontSize: '13px', textAlign: 'left' }}>
                CODE_SAMPLE
              </h4>
              <div style={{ flex: 1, background: '#0d0d0d', padding: '12px', borderRadius: '6px', border: '1px solid #222', fontFamily: "'JetBrains Mono', monospace", fontSize: '12px', color: '#00ffb3', lineHeight: '1.5', overflow: 'auto', shadow: 'none', whiteSpace: 'pre-wrap', selectText: 'all' } as any}>
                <pre style={{ margin: 0 , fontFamily: "'JetBrains Mono', monospace"}}>{currentSection.codeExample}</pre>
              </div>
            </div>

          </div>
        </div>

        {/* Footer - 按钮左对齐 */}
        <div style={{ padding: '12px 24px', background: '#1a1a1a', borderTop: '1px solid #2d2d2d', display: 'flex', justifyContent: 'flex-start' }}>
          <button 
            type="button" 
            onClick={onClose}
            style={{ background: '#38bdf8', border: 'none', color: '#000', padding: '6px 16px', fontSize: '12px', fontWeight: 'bold', fontFamily: "'JetBrains Mono', monospace", borderRadius: '4px', cursor: 'pointer' }}
          >
            ACKNOWLEDGE
          </button>
        </div>

      </div>
    </div>
  );
};