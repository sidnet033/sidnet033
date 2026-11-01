// A "genuine" Google Drive / Docs / Sheets link: https, a Google Drive or
// Docs host, and a path that points at a real file or folder (an id), e.g.
//   https://drive.google.com/drive/folders/<id>
//   https://drive.google.com/file/d/<id>/view
//   https://drive.google.com/open?id=<id>
//   https://docs.google.com/document/d/<id>/edit
//   https://docs.google.com/spreadsheets/d/<id>/edit
//   https://docs.google.com/presentation/d/<id>/edit
const ID = /^[A-Za-z0-9_-]{10,}$/;
const HOSTS = new Set([
  "drive.google.com",
  "docs.google.com",
  "sheets.google.com",
]);

export function isGoogleDriveLink(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || !HOSTS.has(url.hostname)) return false;
  const idParam = url.searchParams.get("id");
  if (idParam && ID.test(idParam)) return true;
  const parts = url.pathname.split("/").filter(Boolean);
  // .../folders/<id>  or  .../d/<id>
  for (let i = 0; i < parts.length - 1; i++) {
    if ((parts[i] === "folders" || parts[i] === "d") && ID.test(parts[i + 1]))
      return true;
  }
  return false;
}
