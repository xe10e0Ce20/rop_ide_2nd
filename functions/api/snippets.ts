interface Env {
  ROP_LIBS_KV: KVNamespace; // 绑定 Cloudflare KV
}

// 统一的数据版本拓扑定义
interface VersionSnapshot {
  version: string;
  code: string;
  updatedAt: number;
}

interface CloudAsset {
  title: string;       // 标识符 (对于库就是 name, 对于片段就是 title)
  author: string;
  description: string;
  isLocal: boolean;    // 云端下发统一为 false
  activeVersion: string;
  versions: Record<string, VersionSnapshot>;
}

// ========================================================
// 1. 获取所有云端资产 (GET) - 兼容处理 libs 和 snippets 两个路由
// ========================================================
export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const url = new URL(context.request.url);
    // 判断前端拉取的是库(libs)还是纯代码(snippets)
    const isSnippetRoute = url.pathname.includes('snippets');
    const prefix = isSnippetRoute ? "snippet:" : "lib:";

    const list = await context.env.ROP_LIBS_KV.list({ prefix });
    const assets: CloudAsset[] = [];

    for (const key of list.keys) {
      const val = await context.env.ROP_LIBS_KV.get(key.name);
      if (val) {
        assets.push(JSON.parse(val));
      }
    }

    // 默认按最后更新的版本时间倒序
    assets.sort((a, b) => {
      const timeA = a.versions[a.activeVersion]?.updatedAt || 0;
      const timeB = b.versions[b.activeVersion]?.updatedAt || 0;
      return timeB - timeA;
    });

    return new Response(JSON.stringify(assets), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

// ========================================================
// 2. 强锁版本分发与追加 (POST) - 绝不覆盖老版本
// ========================================================
export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const url = new URL(context.request.url);
    const isSnippetRoute = url.pathname.includes('snippets');
    
    const body: any = await context.request.json();
    
    // 兼容前端字段：库用 name，片段用 title
    const targetName = (isSnippetRoute ? body.title : body.name)?.trim();
    const { author, version, code, description } = body;
    const targetVersion = version?.trim();

    if (!targetName || !code) {
      return new Response(JSON.stringify({ error: "资产名称/标题和源码不能为空" }), { status: 400 });
    }
    if (!targetVersion) {
      return new Response(JSON.stringify({ error: "必须指定广播锁定的版本号 (如 1.0.0)" }), { status: 400 });
    }

    // 构造带前缀的独立命名空间 KV 键
    const kvKey = isSnippetRoute ? `snippet:${targetName}` : `lib:${targetName}`;

    // 1. 读取云端现有的资产快照
    const existingRaw = await context.env.ROP_LIBS_KV.get(kvKey);
    let assetObj: CloudAsset;

    if (existingRaw) {
      assetObj = JSON.parse(existingRaw);
      
      if (assetObj.versions && assetObj.versions[targetVersion]) {
        return new Response(
          JSON.stringify({ error: `该资产已存在锁定版本 v${targetVersion}，请升级版本号后再行分发。` }), 
          { status: 409 } // 409 Conflict
        );
      }

      // 追加新版本，更新描述和当前活跃游标
      assetObj.activeVersion = targetVersion;
      if (description) assetObj.description = description.trim();
      assetObj.versions[targetVersion] = {
        version: targetVersion,
        code: code,
        updatedAt: Date.now()
      };
    } else {
      // 2. 如果是全新的资产，初始化全新的多版本标准拓扑
      assetObj = {
        title: targetName,
        author: author?.trim() || "Remote",
        description: description?.trim() || "暂无描述",
        isLocal: false, // 标记为云端下发资产
        activeVersion: targetVersion,
        versions: {
          [targetVersion]: {
            version: targetVersion,
            code: code,
            updatedAt: Date.now()
          }
        }
      };
    }

    // 写入 Cloudflare KV
    await context.env.ROP_LIBS_KV.put(kvKey, JSON.stringify(assetObj));

    // 完美回吐多版本拓扑，让前端 res.ok 顺利解析
    return new Response(JSON.stringify({ success: true, data: assetObj }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};