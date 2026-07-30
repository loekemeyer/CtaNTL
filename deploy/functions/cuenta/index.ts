import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { PAGE_GZ_B64 } from "./page.ts";

// La página (HTML+CSS+JS) va comprimida en gzip+base64; se descomprime al arrancar.
const gz = Uint8Array.from(atob(PAGE_GZ_B64), (c) => c.charCodeAt(0));
const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"));
const HTML = await new Response(stream).text();

Deno.serve((_req: Request) =>
  new Response(HTML, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  })
);
