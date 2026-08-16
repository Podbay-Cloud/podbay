import { requireAdmin } from "@/lib/access";
import { listImages, type ImageRow } from "@/lib/image-manifest";
import DashboardPage from "@/components/dashboard-page";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

/**
 * Pod-base image history (openspec image-manifest). One row per published image:
 * what each digest brought (git-derived notes), which is current, which are safe to
 * prune. Replaces the bare PODBAY_INCUS_IMAGE_DIGEST that carried no record.
 */

function short(d: string): string {
  return d.length > 12 ? d.slice(0, 12) : d;
}
function size(bytes: number | null): string {
  if (!bytes) return "—";
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${Math.round(mb)} MB`;
}
function when(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toISOString().slice(0, 16).replace("T", " ");
}
const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  current: { label: "current", variant: "default" },
  superseded: { label: "superseded", variant: "secondary" },
  "rolled-back": { label: "rolled back", variant: "outline" },
};

export const metadata = { title: "Images" };

export default async function ImagesPage() {
  await requireAdmin();
  const images = await listImages();

  return (
    <DashboardPage title="Pod-base images">
      {images.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-[13px] text-muted-foreground">
            No images recorded yet. They appear here once the build pipeline records each publish
            (the record-image helper posts the digest + git-derived notes).
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {images.map((img: ImageRow) => {
            const s = STATUS[img.status] ?? STATUS.superseded;
            return (
              <Card key={img.digest} className={img.status === "current" ? "border-[var(--accent-light)]" : ""}>
                <CardContent className="flex flex-col gap-2 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={s.variant}>{s.label}</Badge>
                    <code className="text-[13px] font-medium">{short(img.digest)}</code>
                    {img.alias && <span className="text-xs text-muted-foreground">{img.alias}</span>}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {when(img.builtAt ?? img.recordedAt)} · {size(img.sizeBytes)}
                    </span>
                  </div>
                  {img.summary && <p className="text-sm font-medium">{img.summary}</p>}
                  {img.notes ? (
                    <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-[12px] leading-relaxed text-muted-foreground">
                      {img.notes}
                    </pre>
                  ) : (
                    <p className="text-[12px] text-muted-foreground">No notes recorded.</p>
                  )}
                  {img.toSha && (
                    <p className="text-[11px] text-muted-foreground">
                      built from {img.fromSha ? `${short(img.fromSha)}…` : ""}
                      {short(img.toSha)}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </DashboardPage>
  );
}
