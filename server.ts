import { DB } from "https://deno.land/x/sqlite@v3.9.1/mod.ts";

const port = Number(Deno.env.get("PORT") ?? "8000");
const adminUsername = Deno.env.get("ADMIN_USERNAME");
const adminPassword = Deno.env.get("ADMIN_PASSWORD");
const sessionSecret = Deno.env.get("SESSION_SECRET");
const secureCookies = Deno.env.get("COOKIE_SECURE") !== "false";
const sessionDurationSeconds = 8 * 60 * 60;
const maxQuoteBodyBytes = 16_384;
const quoteTypes = new Set(["book", "booklet", "banner", "business-cards"]);

interface QuoteRequestRow extends Record<string, unknown> {
    id: number;
    name: string;
    mobile: string;
    type: string;
    address: string;
    createdAt: string;
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a valid TCP port number.");
}
if (!adminUsername || !adminPassword || adminPassword.length < 14) {
    throw new Error("Set ADMIN_USERNAME and an ADMIN_PASSWORD of at least 14 characters.");
}
if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error("Set SESSION_SECRET to a random value of at least 32 characters.");
}

await Deno.mkdir("./data", { recursive: true });
const db = new DB("./data/quote-requests.sqlite3");
db.execute(`
    CREATE TABLE IF NOT EXISTS quote_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        mobile TEXT NOT NULL,
        type TEXT NOT NULL,
        address TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
`);

const sessionKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(sessionSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
);
const loginFailures = new Map<string, { count: number; lockedUntil: number }>();

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
    const responseHeaders = new Headers(headers);
    responseHeaders.set("Content-Type", "application/json; charset=utf-8");
    responseHeaders.set("Cache-Control", "no-store");
    return new Response(JSON.stringify(data), { status, headers: responseHeaders });
}

function cookie(value: string, maxAge: number): string {
    return `jmprint_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookies ? "; Secure" : ""}`;
}

function encodeBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeBase64Url(value: string): ArrayBuffer | null {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
    try {
        const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
        const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        const buffer = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(buffer).set(bytes);
        return buffer;
    } catch {
        return null;
    }
}

async function createSession(): Promise<string> {
    const expiresAt = Date.now() + sessionDurationSeconds * 1000;
    const nonce = encodeBase64Url(crypto.getRandomValues(new Uint8Array(24)));
    const payload = `${expiresAt}.${nonce}`;
    const signature = await crypto.subtle.sign("HMAC", sessionKey, new TextEncoder().encode(payload));
    return `${payload}.${encodeBase64Url(new Uint8Array(signature))}`;
}

async function hasValidSession(request: Request): Promise<boolean> {
    const token = request.headers.get("Cookie")?.split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("jmprint_session="))
        ?.slice("jmprint_session=".length);
    if (!token) return false;

    const [expiresAtText, nonce, signatureText, extra] = token.split(".");
    const expiresAt = Number(expiresAtText);
    const signature = signatureText ? decodeBase64Url(signatureText) : null;
    if (extra !== undefined || !nonce || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || !signature) {
        return false;
    }

    return await crypto.subtle.verify(
        "HMAC",
        sessionKey,
        signature,
        new TextEncoder().encode(`${expiresAtText}.${nonce}`),
    );
}

function sameOrigin(request: Request): boolean {
    const origin = request.headers.get("Origin");
    if (!origin) return true;
    try {
        return new URL(origin).origin === new URL(request.url).origin;
    } catch {
        return false;
    }
}

function clientAddress(remoteAddr: Deno.Addr): string {
    if ("hostname" in remoteAddr) return `${remoteAddr.hostname}:${remoteAddr.port}`;
    if ("path" in remoteAddr) return remoteAddr.path;
    return remoteAddr.transport;
}

function getField(form: FormData, name: string, maxLength: number): string | null {
    const value = form.get(name);
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}

async function readLimitedBody(request: Request, limit: number): Promise<ArrayBuffer | null> {
    if (!request.body) return null;
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > limit) {
                await reader.cancel();
                return null;
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }

    const body = new ArrayBuffer(size);
    const bodyView = new Uint8Array(body);
    let offset = 0;
    for (const chunk of chunks) {
        bodyView.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return body;
}

async function handleQuote(request: Request): Promise<Response> {
    if (!sameOrigin(request)) return json({ error: "Invalid request origin." }, 403);
    const body = await readLimitedBody(request, maxQuoteBodyBytes);
    if (!body) return json({ error: "Request is too large or empty." }, 413);

    let form: FormData;
    try {
        const headers = new Headers(request.headers);
        headers.delete("Content-Length");
        form = await new Request(request.url, {
            method: request.method,
            headers,
            body,
        }).formData();
    } catch {
        return json({ error: "Please submit the quote form using the website." }, 400);
    }

    const name = getField(form, "name", 120);
    const mobile = getField(form, "mobile", 40);
    const type = getField(form, "type", 40);
    const address = getField(form, "address", 2000);
    if (!name || !mobile || !type || !quoteTypes.has(type) || !address) {
        return json({ error: "Please check the form fields and try again." }, 400);
    }

    db.query(
        "INSERT INTO quote_requests (name, mobile, type, address) VALUES (?, ?, ?, ?)",
        [name, mobile, type, address],
    );

    if (request.headers.get("Accept")?.includes("application/json")) {
        return json({ ok: true }, 201);
    }
    return new Response(null, { status: 303, headers: { Location: "/quote.html?submitted=1" } });
}

const staticFiles = new Map<string, string>([
    ["/", "./index.html"],
    ["/index.html", "./index.html"],
    ["/services.html", "./services.html"],
    ["/portfolio.html", "./portfolio.html"],
    ["/contact.html", "./contact.html"],
    ["/quote.html", "./quote.html"],
    ["/admin.html", "./admin.html"],
    ["/styles.css", "./styles.css"],
    ["/app.js", "./app.js"],
    ["/quote.js", "./quote.js"],
    ["/admin.js", "./admin.js"],
    ["/assests/jmprint.jpg", "./assests/jmprint.jpg"],
    ["/assests/jmprint-hero-poster.jpg", "./assests/jmprint-hero-poster.jpg"],
    ["/assests/jmprint-hero.mp4", "./assests/jmprint-hero.mp4"],
    ["/assests/fb-work-1.jpg", "./assests/fb-work-1.jpg"],
    ["/assests/fb-work-3.jpg", "./assests/fb-work-3.jpg"],
    ["/assests/fb-work-4.jpg", "./assests/fb-work-4.jpg"],
    ["/assests/fb-work-5.jpg", "./assests/fb-work-5.jpg"],
    ["/assests/fb-work-6.jpg", "./assests/fb-work-6.jpg"],
]);
const contentTypes: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".mp4": "video/mp4",
};

async function serveStatic(pathname: string): Promise<Response> {
    const filePath = staticFiles.get(pathname);
    if (!filePath) return new Response("Not found", { status: 404 });

    const extension = filePath.slice(filePath.lastIndexOf("."));
    try {
        return new Response(await Deno.readFile(filePath), {
            headers: {
                "Content-Type": contentTypes[extension] ?? "application/octet-stream",
                "X-Content-Type-Options": "nosniff",
            },
        });
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return new Response("Not found", { status: 404 });
        throw error;
    }
}

console.log(`JMprint server listening on http://localhost:${port}`);

Deno.serve({ port }, async (request, info) => {
    const url = new URL(request.url);
    if (url.pathname === "/api/quote" && request.method === "POST") {
        return await handleQuote(request);
    }
    if (url.pathname === "/api/login" && request.method === "POST") {
        if (!sameOrigin(request)) return json({ error: "Invalid request origin." }, 403);
        const loginBody = await readLimitedBody(request, 2048);
        if (!loginBody) return json({ error: "Sign-in request is too large or empty." }, 413);
        const address = clientAddress(info.remoteAddr);
        const failure = loginFailures.get(address);
        if (failure && failure.lockedUntil > Date.now()) {
            return json({ error: "Too many sign-in attempts. Try again in 15 minutes." }, 429);
        }

        let credentials: unknown;
        try {
            credentials = JSON.parse(new TextDecoder().decode(loginBody));
        } catch {
            return json({ error: "Invalid sign-in request." }, 400);
        }
        if (typeof credentials !== "object" || credentials === null || !("username" in credentials) ||
            !("password" in credentials)) {
            return json({ error: "Invalid sign-in request." }, 400);
        }
        const usernameMatches = typeof credentials.username === "string" &&
            constantTimeEqual(credentials.username, adminUsername);
        const passwordMatches = typeof credentials.password === "string" &&
            constantTimeEqual(credentials.password, adminPassword);
        if (!usernameMatches || !passwordMatches) {
            const count = (failure?.count ?? 0) + 1;
            loginFailures.set(address, {
                count,
                lockedUntil: count >= 5 ? Date.now() + 15 * 60 * 1000 : 0,
            });
            return json({ error: "Incorrect username or password." }, 401);
        }

        loginFailures.delete(address);
        return json({ ok: true }, 200, { "Set-Cookie": cookie(await createSession(), sessionDurationSeconds) });
    }
    if (url.pathname === "/api/logout" && request.method === "POST") {
        if (!sameOrigin(request)) return json({ error: "Invalid request origin." }, 403);
        return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
    }
    if (url.pathname === "/api/requests" && request.method === "GET") {
        if (!await hasValidSession(request)) return json({ error: "Authentication required." }, 401);
        const rows = db.queryEntries<QuoteRequestRow>(
            "SELECT id, name, mobile, type, address, created_at AS createdAt " +
                "FROM quote_requests ORDER BY id DESC LIMIT 500",
        );
        return json(rows);
    }
    if (url.pathname === "/admin") {
        return new Response(null, { status: 302, headers: { Location: "/admin.html" } });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", { status: 405 });
    }
    const response = await serveStatic(url.pathname);
    if (request.method === "HEAD" && response.body) {
        return new Response(null, { status: response.status, headers: response.headers });
    }
    return response;
});

function constantTimeEqual(first: string, second: string): boolean {
    const encoder = new TextEncoder();
    const firstBytes = encoder.encode(first);
    const secondBytes = encoder.encode(second);
    let difference = firstBytes.length ^ secondBytes.length;
    const length = Math.max(firstBytes.length, secondBytes.length);
    for (let index = 0; index < length; index++) {
        difference |= (firstBytes[index] ?? 0) ^ (secondBytes[index] ?? 0);
    }
    return difference === 0;
}
