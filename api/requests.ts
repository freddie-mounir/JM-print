import { handleApiRequest } from "../lib/quote-api.ts";

export function GET(request: Request): Promise<Response> {
    return handleApiRequest("requests", request);
}
