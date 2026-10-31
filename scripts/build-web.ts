import { promises as fs } from "node:fs";
const target = ".local/publish-web";
await fs.mkdir(target, { recursive: true });
await fs.cp("dist", target, { recursive: true });
await fs.copyFile("web/demo.html", `${target}/demo.html`);
for (const name of ["demo.mp4", "demo-poster.jpg"])
  try {
    await fs.copyFile(`.local/demo/${name}`, `${target}/${name}`);
  } catch {}
await fs.writeFile(
  `${target}/vercel.json`,
  JSON.stringify(
    {
      rewrites: [
        {
          source: "/api/:path*",
          destination: "https://oddly-clear-engine.vercel.app/api/:path*",
        },
        { source: "/demo", destination: "/demo.html" },
        { source: "/(.*)", destination: "/index.html" },
      ],
      headers: [
        {
          source: "/api/(.*)",
          headers: [{ key: "Cache-Control", value: "private, no-store" }],
        },
      ],
    },
    null,
    2,
  ),
);
await fs.writeFile(`${target}/.vercelignore`, ".env*\n.vercel/\n");
console.log("Static studio prepared in " + target);
