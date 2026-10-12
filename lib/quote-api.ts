import { type Client, createClient } from "@libsql/client";
import process from "node:process";

const sessionDurationSeconds = 8 * 60 * 60;
const maxQuoteBodyBytes = 16_384;
const quoteTypes = new Set(["book", "booklet", "banner", "business-cards"]);

interface QuoteRequestRow {
    id: number;
    name: string;
    mobile: string;
    type: string;
    address: string;
    createdAt: string;
}

interface Credentials {
    username: string;
    password: string;
}

type ApiRoute = "quote" | "login" | "logout" | "requests";

let database: Client | undefined;
let schemaInitialization: Promise<void> | undefined;

function getDatabase(): Promise<Client> {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (!url || !authToken) {
        throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be configured.");
    }

    if (!database) {
        database = createClient({ url, authToken });
    }
    if (!schemaInitialization) {
        const client = database;
        schemaInitialization = Promise.all([
            client.execute(`
                CREATE TABLE IF NOT EXISTS quote_requests (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    mobile TEXT NOT NULL,
                    type TEXT NOT NULL,
                    address TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                )
            `),
            client.execute(`
                CREATE TABLE IF NOT EXISTS login_failures (
                    address_hash TEXT PRIMARY KEY,
                    count INTEGER NOT NULL,
                    locked_until INTEGER NOT NULL
                )
            `),
        ]).then(() => undefined).catch((error: unknown) => {
            schemaInitialization = undefined;
            throw error;
        });
    }
    return schemaInitialization.then(() => database!);
}

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
    const responseHeaders = new Headers(headers);
    responseHeaders.set("Content-Type", "application/json; charset=utf-8");
    responseHeaders.set("Cache-Control", "no-store");
    return new Response(JSON.stringify(data), { status, headers: responseHeaders });
}

function cookie(value: string, maxAge: number): string {
    return `jmprint_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}; Secure`;
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

function getSessionKey(): Promise<CryptoKey> {
    const secret = process.env.SESSION_SECRET;
    if (!secret || secret.length < 32) {
        throw new Error("SESSION_SECRET must be configured with at least 32 characters.");
    }
    return crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"],
    );
}

async function createSession(): Promise<string> {
    const expiresAt = Date.now() + sessionDurationSeconds * 1000;
    const nonce = encodeBase64Url(crypto.getRandomValues(new Uint8Array(24)));
    const payload = `${expiresAt}.${nonce}`;
    const signature = await crypto.subtle.sign(
        "HMAC",
        await getSessionKey(),
        new TextEncoder().encode(payload),
    );
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
    if (
        extra !== undefined || !nonce || !Number.isSafeInteger(expiresAt) ||
        expiresAt <= Date.now() ||
        !signature
    ) {
        return false;
    }

    return await crypto.subtle.verify(
        "HMAC",
        await getSessionKey(),
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

function getField(form: FormData, name: string, maxLength: number): string | null {
    const value = form.get(name);
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}

async function readLimitedBody(request: Request, limit: number): Promise<ArrayBuffer | null> {
    const contentLength = Number(request.headers.get("Content-Length"));
    if (Number.isFinite(contentLength) && contentLength > limit) return null;
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

    const db = await getDatabase();
    await db.execute({
        sql: "INSERT INTO quote_requests (name, mobile, type, address) VALUES (?, ?, ?, ?)",
        args: [name, mobile, type, address],
    });

    if (request.headers.get("Accept")?.includes("application/json")) {
        return json({ ok: true }, 201);
    }
    return new Response(null, { status: 303, headers: { Location: "/quote.html?submitted=1" } });
}

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

async function getAddressHash(request: Request): Promise<string> {
    const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        request.headers.get("x-real-ip") || "unknown";
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
        "",
    );
}

async function handleLogin(request: Request): Promise<Response> {
    if (!sameOrigin(request)) return json({ error: "Invalid request origin." }, 403);
    const body = await readLimitedBody(request, 2048);
    if (!body) return json({ error: "Sign-in request is too large or empty." }, 413);

    let credentials: unknown;
    try {
        credentials = JSON.parse(new TextDecoder().decode(body));
    } catch {
        return json({ error: "Invalid sign-in request." }, 400);
    }
    if (
        typeof credentials !== "object" || credentials === null ||
        !("username" in credentials) || !("password" in credentials)
    ) {
        return json({ error: "Invalid sign-in request." }, 400);
    }

    const username = process.env.ADMIN_USERNAME;
    const password = process.env.ADMIN_PASSWORD;
    if (!username || !password || password.length < 14) {
        throw new Error(
            "ADMIN_USERNAME and an ADMIN_PASSWORD of at least 14 characters are required.",
        );
    }

    const db = await getDatabase();
    const addressHash = await getAddressHash(request);
    const now = Date.now();
    const failureResult = await db.execute({
        sql: "SELECT count, locked_until AS lockedUntil FROM login_failures WHERE address_hash = ?",
        args: [addressHash],
    });
    const failure = failureResult.rows[0];
    const lockedUntil = failure?.lockedUntil == null ? 0 : Number(failure.lockedUntil);
    if (lockedUntil > now) {
        return json({ error: "Too many sign-in attempts. Try again in 15 minutes." }, 429);
    }

    const suppliedUsername = typeof credentials.username === "string" ? credentials.username : "";
    const suppliedPassword = typeof credentials.password === "string" ? credentials.password : "";
    if (
        !constantTimeEqual(suppliedUsername, username) ||
        !constantTimeEqual(suppliedPassword, password)
    ) {
        const count = Number(failure?.count ?? 0) + 1;
        await db.execute({
            sql: `INSERT INTO login_failures (address_hash, count, locked_until) VALUES (?, ?, ?)
                  ON CONFLICT(address_hash) DO UPDATE SET count = excluded.count,
                  locked_until = excluded.locked_until`,
            args: [addressHash, count, count >= 5 ? now + 15 * 60 * 1000 : 0],
        });
        return json({ error: "Incorrect username or password." }, 401);
    }

    await db.execute({
        sql: "DELETE FROM login_failures WHERE address_hash = ?",
        args: [addressHash],
    });
    return json({ ok: true }, 200, {
        "Set-Cookie": cookie(await createSession(), sessionDurationSeconds),
    });
}

async function handleRequests(request: Request): Promise<Response> {
    if (!await hasValidSession(request)) return json({ error: "Authentication required." }, 401);
    const db = await getDatabase();
    const result = await db.execute(
        `SELECT id, name, mobile, type, address, created_at AS createdAt
         FROM quote_requests ORDER BY id DESC LIMIT 500`,
    );
    const requests: QuoteRequestRow[] = result.rows.map((row) => ({
        id: Number(row.id),
        name: String(row.name),
        mobile: String(row.mobile),
        type: String(row.type),
        address: String(row.address),
        createdAt: String(row.createdAt),
    }));
    return json(requests);
}

export async function handleApiRequest(route: ApiRoute, request: Request): Promise<Response> {
    try {
        if (route === "quote" && request.method === "POST") return await handleQuote(request);
        if (route === "login" && request.method === "POST") return await handleLogin(request);
        if (route === "logout" && request.method === "POST") {
            if (!sameOrigin(request)) return json({ error: "Invalid request origin." }, 403);
            return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
        }
        if (route === "requests" && request.method === "GET") return await handleRequests(request);
        return json({ error: "Method not allowed." }, 405, {
            Allow: route === "requests" ? "GET" : "POST",
        });
    } catch (error) {
        console.error(`API route ${route} failed:`, error);
        return json({ error: "The request could not be completed. Please try again." }, 500);
    }
}
