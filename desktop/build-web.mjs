import { copyFile, mkdir, writeFile } from "node:fs/promises";

const output = new URL("../dist/", import.meta.url);
const project = "https://tfuiwogiwbvqxfqktnwe.supabase.co";
const key = process.env.SUPABASE_PUBLISHABLE_KEY || null;
if (key && !/^sb_publishable_[\w-]+$/.test(key)) {
  throw new Error("Use a chave publicável do Supabase.");
}

await mkdir(output, { recursive: true });
for (const name of ["index.html", "app.mjs", "survey.mjs", "styles.css"]) {
  await copyFile(new URL(name, import.meta.url), new URL(name, output));
}
await copyFile(
  new URL("../app/src/main/assets/field-theme.css", import.meta.url),
  new URL("field-theme.css", output),
);
await writeFile(new URL("config.json", output), JSON.stringify({ project, key }));
