interface Env {
  ROP_LIBS_KV: KVNamespace; // 绑定 Cloudflare KV
}

// 1. 获取所有库文件 (GET)
export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const list = await context.env.ROP_LIBS_KV.list();
    const libs = [];

    for (const key of list.keys) {
      const val = await context.env.ROP_LIBS_KV.get(key.name);
      if (val) {
        libs.push(JSON.parse(val));
      }
    }

    // 按更新时间倒序排列
    libs.sort((a, b) => b.updatedAt - a.updatedAt);

    return new Response(JSON.stringify(libs), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

// 2. 发布或更新库文件 (POST)
export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const body: any = await context.request.json();
    const { name, author, code, description } = body;

    if (!name || !code) {
      return new Response(JSON.stringify({ error: "库名称和代码不能为空" }), { status: 400 });
    }

    const libKey = `lib:${name.trim()}`;
    
    const libData = {
      name: name.trim(),
      author: author?.trim() || "匿名小部件",
      description: description?.trim() || "暂无描述",
      code: code,
      updatedAt: Date.now()
    };

    // 写入 Cloudflare KV
    await context.env.ROP_LIBS_KV.put(libKey, JSON.stringify(libData));

    return new Response(JSON.stringify({ success: true, data: libData }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};