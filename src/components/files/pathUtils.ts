// Device paths are always posix, regardless of the host OS running the browser.
// `dirname` for this style of path is already provided by `@yume-chan/adb`.

export function joinPath(base: string, name: string): string {
  if (base === "/") return `/${name}`;
  return `${base}/${name}`;
}

export function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);

const TEXT_EXTENSIONS = new Set([
  "txt", "xml", "csv", "tsv", "json", "js", "jsx", "ts", "tsx", "html", "htm", "css",
  "md", "markdown", "log", "yaml", "yml", "ini", "conf", "cfg", "properties", "env",
  "sh", "bash", "py", "java", "kt", "kts", "gradle", "toml", "sql", "c", "cpp", "h",
  "hpp", "rs", "go", "rb", "php", "pl", "proto", "graphql", "vue", "svelte", "smali",
]);

export function extname(path: string): string {
  const name = basename(path);
  const idx = name.lastIndexOf(".");
  // idx <= 0 excludes both "no dot" and a leading-dot dotfile like ".bashrc".
  return idx <= 0 ? "" : name.slice(idx + 1).toLowerCase();
}

export function isImageFile(name: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(name));
}

export function isTextFile(name: string): boolean {
  return TEXT_EXTENSIONS.has(extname(name));
}

export function splitBreadcrumbs(path: string): { name: string; path: string }[] {
  const segments = path.split("/").filter(Boolean);
  const crumbs: { name: string; path: string }[] = [{ name: "/", path: "/" }];
  let current = "";
  for (const segment of segments) {
    current = `${current}/${segment}`;
    crumbs.push({ name: segment, path: current });
  }
  return crumbs;
}
