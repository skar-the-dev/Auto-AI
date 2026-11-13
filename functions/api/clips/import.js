function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type":"application/json", "Cache-Control":"no-store" } });
}
function authorised(request, env) {
  const expected = env.AUTO_AI_ADMIN_KEY || "";
  return Boolean(expected && request.headers.get("x-auto-ai-admin-key") === expected);
}
async function ensureColumns(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS clip_sources (
    id TEXT PRIMARY KEY, script_id TEXT NOT NULL, platform TEXT NOT NULL, url TEXT NOT NULL,
    creator TEXT, title TEXT, rights_status TEXT NOT NULL DEFAULT 'Needs permission',
    rights_note TEXT, review_status TEXT NOT NULL DEFAULT 'Pending review', review_note TEXT,
    reviewed_at TEXT, media_key TEXT, media_filename TEXT, media_type TEXT, media_size INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`).run();
  for (const [column, type] of [["media_key","TEXT"],["media_filename","TEXT"],["media_type","TEXT"],["media_size","INTEGER"]]) {
    try { await db.prepare("ALTER TABLE clip_sources ADD COLUMN "+column+" "+type).run(); }
    catch (error) { if (!/duplicate column/i.test(error.message || "")) throw error; }
  }
}
export async function onRequestPost({request,env}) {
  try {
    if (!authorised(request,env)) return json({success:false,error:"Admin access key is missing or incorrect."},401);
    if (!env.DB) return json({success:false,error:"Database binding DB is missing."},500);
    if (!env.CLIP_MEDIA) return json({success:false,error:"Private clip storage is not connected yet. Add an R2 bucket binding named CLIP_MEDIA to the auto-ai Pages project."},503);
    await ensureColumns(env.DB);
    const form=await request.formData();
    const scriptId=String(form.get("script_id")||"").trim();
    const sourceId=String(form.get("source_id")||"").trim();
    const file=form.get("file");
    if (!scriptId || !sourceId || !(file instanceof File)) return json({success:false,error:"Choose the saved script, candidate and video file."},400);
    if (!["video/mp4","video/webm","video/quicktime","video/x-m4v"].includes(file.type)) return json({success:false,error:"Only MP4, WebM or QuickTime video files are accepted."},415);
    if (!file.size || file.size>90*1024*1024) return json({success:false,error:"Video must be between 1 byte and 90 MB."},413);
    const source=await env.DB.prepare("SELECT id,media_key FROM clip_sources WHERE id=? AND script_id=?").bind(sourceId,scriptId).first();
    if (!source) return json({success:false,error:"That candidate was not found under the selected script."},404);
    const ext=({ "video/mp4":"mp4","video/webm":"webm","video/quicktime":"mov","video/x-m4v":"m4v" })[file.type];
    const key=scriptId+"/"+sourceId+"/"+crypto.randomUUID()+"."+ext;
    await env.CLIP_MEDIA.put(key,file.stream(),{httpMetadata:{contentType:file.type,cacheControl:"private, no-store"},customMetadata:{scriptId,sourceId,originalName:String(file.name||"clip."+ext).slice(0,180)}});
    await env.DB.prepare("UPDATE clip_sources SET media_key=?,media_filename=?,media_type=?,media_size=? WHERE id=?")
      .bind(key,String(file.name||"clip."+ext).slice(0,180),file.type,file.size,sourceId).run();
    if (source.media_key) await env.CLIP_MEDIA.delete(source.media_key);
    return json({success:true,message:"Clip saved in private R2 storage.",filename:file.name,size:file.size},201);
  } catch(error) { return json({success:false,error:error.message||"Clip import failed."},500); }
}
export async function onRequestGet({request,env}) {
  try {
    if (!authorised(request,env)) return json({success:false,error:"Admin access key is missing or incorrect."},401);
    if (!env.DB || !env.CLIP_MEDIA) return json({success:false,error:"Private clip storage is not configured."},503);
    await ensureColumns(env.DB);
    const url=new URL(request.url), sourceId=url.searchParams.get("source_id"), scriptId=url.searchParams.get("script_id");
    if (!sourceId || !scriptId) return json({success:false,error:"Source and script IDs are required."},400);
    const source=await env.DB.prepare("SELECT media_key,media_filename,media_type FROM clip_sources WHERE id=? AND script_id=?").bind(sourceId,scriptId).first();
    if (!source?.media_key) return json({success:false,error:"No imported clip exists for this candidate."},404);
    const object=await env.CLIP_MEDIA.get(source.media_key);
    if (!object) return json({success:false,error:"Stored clip file is missing."},404);
    return new Response(object.body,{headers:{"Content-Type":source.media_type||"application/octet-stream","Content-Disposition":'inline; filename="'+String(source.media_filename||"clip.mp4").replace(/["\\\r\n]/g,"_")+'"',"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
  } catch(error) { return json({success:false,error:error.message||"Could not load imported clip."},500); }
}
