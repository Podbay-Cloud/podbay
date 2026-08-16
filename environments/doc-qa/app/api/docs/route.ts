import { NextResponse } from "next/server";
import { addDocument, listDocuments, deleteDocument, seedDemoIfEmpty } from "../../rag";
import { isAdmin } from "../../auth";

// pg needs the Node runtime (not edge).
export const runtime = "nodejs";

const forbidden = () => NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

// GET    → uploaded documents + chunk counts (public — informational).
// POST   → add a doc (OWNER only): multipart file upload, OR JSON { name, text }.
// DELETE → remove a doc (OWNER only): JSON { name }.
export async function GET() {
  try {
    await seedDemoIfEmpty().catch(() => {}); // demo docs on first boot
    return NextResponse.json(await listDocuments());
  } catch {
    return NextResponse.json([]); // DB not ready yet — empty, not an error
  }
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return forbidden();
  const ct = req.headers.get("content-type") ?? "";
  try {
    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (file && typeof file !== "string") {
        const text = await file.text();
        const chunks = await addDocument(file.name || "upload.txt", text);
        return NextResponse.json({ doc: file.name, chunks }, { status: 201 });
      }
      return NextResponse.json({ ok: false, error: "no file" }, { status: 400 });
    }
    const { name, text } = (await req.json().catch(() => ({}))) as { name?: string; text?: string };
    if (!name || !text) return NextResponse.json({ ok: false, error: "name + text required" }, { status: 400 });
    const chunks = await addDocument(name, text);
    return NextResponse.json({ doc: name, chunks }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!(await isAdmin())) return forbidden();
  const { name } = (await req.json().catch(() => ({}))) as { name?: string };
  if (!name) return NextResponse.json({ ok: false }, { status: 400 });
  await deleteDocument(name);
  return NextResponse.json({ ok: true });
}
